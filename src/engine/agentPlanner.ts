import type {
  ActorInput,
  AgentMessage,
  AgentMessageKind,
  AgentObservation,
  ChannelId,
  Vec2,
} from './types';

export interface AgentPlannerMemory {
  lastX: number;
  lastY: number;
  stuckTicks: number;
  jumpReleaseCooldown: number;
  interactPulse: boolean;
  grabPulse: boolean;
  lastDecisionIntent: string;
  lastAnnouncedKey: string;
  lockedAirTarget: { x: number; y: number; ticks: number } | null;
  jumpFreezeTicks: number;
  hazardBackoffTicks: number;
  hazardBackoffDir: -1 | 0 | 1;
  airHazardDir: -1 | 0 | 1;
}

export function createAgentMemory(): AgentPlannerMemory {
  return {
    lastX: 0,
    lastY: 0,
    stuckTicks: 0,
    jumpReleaseCooldown: 0,
    interactPulse: false,
    grabPulse: false,
    lastDecisionIntent: '',
    lastAnnouncedKey: '',
    lockedAirTarget: null,
    jumpFreezeTicks: 0,
    hazardBackoffTicks: 0,
    hazardBackoffDir: 0,
    airHazardDir: 0,
  };
}

export interface WalkSegment {
  id: string;
  sourceId: string;
  x1: number;
  x2: number;
  y: number;
  isMoving?: boolean;
  loopWhenActive?: boolean;
  material?: string;
  bounceVelocity?: number;
  conveyorSpeed?: number;
  channel?: ChannelId;
  linkedIds?: string[];
  logic?: 'ALL' | 'ANY';
  startPos?: Vec2;
  endPos?: Vec2;
}

export type WaypointMode = 'walk' | 'jump' | 'drop' | 'wait';

export interface Waypoint extends Vec2 {
  mode: WaypointMode;
}

export interface EdgeTransition {
  tx: number;
  lx: number;
  mode: WaypointMode;
  cost: number;
}

export interface NavigationEdge {
  to: WalkSegment;
  edge: EdgeTransition;
}

export interface NavigationGraph {
  key: string;
  segments: WalkSegment[];
  adj: Map<string, NavigationEdge[]>;
  segById: Map<string, WalkSegment>;
}

export interface ShortestPathTree {
  graph: NavigationGraph;
  startPt: Vec2;
  startSeg: WalkSegment | null;
  distMap: Map<string, number>;
  prevEdge: Map<string, { from: WalkSegment; edge: EdgeTransition } | null>;
}

export interface PathResult {
  reachable: boolean;
  cost: number;
  nextTarget: Waypoint;
  waypoints: Waypoint[];
}

const ACTOR_W = 26;
const ACTOR_H = 34;
const RUN_SPEED = 230;
const AIR_ACCEL = 1500;
const JUMP_SPEED = 520;
const MAX_FALL_SPEED = 980;
const SIM_DT = 1 / 60;
const MAX_GRAPH_CACHE = 10;

const graphCache = new Map<string, NavigationGraph>();

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function hazardAt(obs: AgentObservation, x: number, y: number): boolean {
  return obs.hazards.some((hazard) =>
    rectsOverlap(x + 2, y + 2, ACTOR_W - 4, ACTOR_H - 4, hazard.x, hazard.y, hazard.w, hazard.h)
  );
}

function hazardAhead(obs: AgentObservation, move: -1 | 0 | 1): AgentObservation['hazards'][number] | null {
  if (move === 0) return null;
  const self = obs.self;
  const selfCx = self.x + ACTOR_W / 2;
  const selfBottom = self.y + ACTOR_H;
  for (const hazard of obs.hazards) {
    // Only hazards at (roughly) the bot's footing are a walking threat; a
    // hazard far overhead or above a platform is not in the path.
    if (hazard.y > selfBottom + 8 || hazard.y + hazard.h < selfBottom - 46) continue;
    if (move === 1) {
      if (hazard.x >= selfCx - 2 && hazard.x - selfCx <= 46) return hazard;
    } else if (hazard.x + hazard.w <= selfCx + 2 && selfCx - (hazard.x + hazard.w) <= 46) {
      return hazard;
    }
  }
  return null;
}

/**
 * Trace a jump arc and report whether it passes through or lands in a hazard.
 * Bots were killing themselves by triggering obstacle jumps while standing at
 * a plasma strip; a jump is only allowed when this trace is clear.
 */
function jumpHitsHazard(
  obs: AgentObservation,
  move: -1 | 0 | 1,
  initialVy = -JUMP_SPEED
): boolean {
  const gravity = obs.physics.gravity || 1450;
  let x = obs.self.x;
  let y = obs.self.y;
  let vx = move * RUN_SPEED;
  let vy = initialVy;
  for (let tick = 0; tick < 90; tick++) {
    vy = Math.min(MAX_FALL_SPEED, vy + gravity * SIM_DT);
    x += vx * SIM_DT;
    y += vy * SIM_DT;
    // Ignore the first instants of takeoff: an actor standing flush against a
    // hazard has to clear it before the arc is judged.
    if (tick >= 3 && hazardAt(obs, x, y)) return true;
    if (tick > 8 && vy > 0 && y + ACTOR_H >= 480) {
      const floorY = 492 - ACTOR_H;
      return hazardAt(obs, x, Math.min(y, floorY));
    }
  }
  return false;
}

/** Follow a free-fall arc and return the first hazard it would enter. */
function fallIntoHazard(
  obs: AgentObservation,
  startX: number,
  startY: number,
  startVx: number,
  startVy: number
): AgentObservation['hazards'][number] | null {
  const gravity = obs.physics.gravity || 1450;
  let x = startX;
  let y = startY;
  let vx = startVx;
  let vy = startVy;
  for (let tick = 0; tick < 120; tick++) {
    vy = Math.min(MAX_FALL_SPEED, vy + gravity * SIM_DT);
    x += vx * SIM_DT;
    y += vy * SIM_DT;
    const hazard = obs.hazards.find((hz) =>
      rectsOverlap(x + 2, y + 2, ACTOR_W - 4, ACTOR_H - 4, hz.x, hz.y, hz.w, hz.h)
    );
    if (hazard) return hazard;
    if (y + ACTOR_H >= 492) return null;
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function isPressedByDynamicBody(
  obs: AgentObservation,
  plate: AgentObservation['plates'][number]
): boolean {
  return obs.crates.some((c) => plate.pressedBy.includes(c.label));
}

function buildTopologyKey(obs: AgentObservation): string {
  const phys = obs.physics;
  const physKey = `${Math.round(phys.gravity)}:${phys.airDrag.toFixed(2)}:${(phys.actorMass || 1).toFixed(2)}`;
  const platKey = obs.platforms
    .map(
      (p) =>
        `${p.id}@${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.w)},${Math.round(p.h)},${p.material},${p.bounceVelocity ?? 0},${p.conveyorSpeed ?? 0}`
    )
    .join(';');
  const doorKey = obs.doors.map((d) => `${d.id}:${d.open ? 1 : 0}`).join(';');
  const hazKey = obs.hazards
    .map((h) => `${h.id}@${Math.round(h.x)},${Math.round(h.y)},${Math.round(h.w)}`)
    .join(';');
  const fzKey = (obs.forceZones ?? [])
    .map((f) => `${f.id}@${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.w)},${Math.round(f.h)},${Math.round(f.fx)},${Math.round(f.fy)}`)
    .join(';');
  const plateCrateKey = obs.crates
    .filter((c) => obs.plates.some((pl) => pl.pressedBy.includes(c.label)) && Math.abs(c.vx) < 20 && Math.abs(c.vy) < 20)
    .map((c) => `${c.id}@${Math.round(c.x)},${Math.round(c.y)}`)
    .join(';');
  const chanKey = `${obs.channels.A ? 1 : 0}${obs.channels.B ? 1 : 0}${obs.channels.C ? 1 : 0}`;
  return `${obs.levelId}|${physKey}|${chanKey}|${platKey}|${doorKey}|${hazKey}|${fzKey}|${plateCrateKey}`;
}

export function buildWalkSegments(obs: AgentObservation): WalkSegment[] {
  const rawSegments: WalkSegment[] = [];
  const standingWalls = obs.platforms.filter((p) => p.y > 30 && p.w < 36);

  const walkablePlatforms = obs.platforms.filter((p) => p.y > 30 && p.w >= 36);

  for (const p of obs.platforms) {
    if (p.y <= 30 || p.w < 36) continue;
    // A flush strip laid directly on a wider deck is not a separate ledge: the
    // actor walks over it. Treating it as its own segment creates micro-hops
    // (floor -> strip -> floor) and makes the follower flip at the strip edge.
    const redundantSurface = walkablePlatforms.some((other) => {
      if (other.id === p.id || other.w < p.w || other.y < p.y) return false;
      if (Math.abs(other.y - p.y) > 10) return false;
      const overlap = Math.min(p.x + p.w, other.x + other.w) - Math.max(p.x, other.x);
      return overlap >= Math.min(p.w, other.w) * 0.6;
    });
    if (redundantSurface) continue;
    rawSegments.push({
      id: p.id,
      sourceId: p.id,
      x1: p.x,
      x2: p.x + p.w,
      y: p.y,
      isMoving: p.kind === 'moving',
      loopWhenActive: p.loopWhenActive,
      material: p.material,
      bounceVelocity: p.bounceVelocity,
      conveyorSpeed: p.conveyorSpeed,
      channel: p.channel,
      linkedIds: p.linkedIds,
      logic: p.logic,
      startPos: p.startPos,
      endPos: p.endPos,
    });
  }

  const closedDoors = obs.doors.filter((d) => !d.open);
  const finalSegments: WalkSegment[] = [];

  for (const seg of rawSegments) {
    let pieces: WalkSegment[] = [seg];

    // Split around floor/platform hazards
    for (const haz of obs.hazards) {
      const nextPieces: WalkSegment[] = [];
      for (const piece of pieces) {
        const hazNearTop = Math.abs(haz.y + haz.h - piece.y) <= 14;
        const hazInsideX = haz.x > piece.x1 + 8 && haz.x + haz.w < piece.x2 - 8;
        if (hazNearTop && hazInsideX) {
          if (haz.x - 16 - piece.x1 >= 34) {
            nextPieces.push({ ...piece, id: `${piece.id}-HL-${haz.id}`, x2: haz.x - 16 });
          }
          if (piece.x2 - (haz.x + haz.w + 16) >= 34) {
            nextPieces.push({ ...piece, id: `${piece.id}-HR-${haz.id}`, x1: haz.x + haz.w + 16 });
          }
        } else {
          nextPieces.push(piece);
        }
      }
      pieces = nextPieces;
    }

    // Split around crates resting on plates so bots hop over instead of pushing them off
    for (const crate of obs.crates) {
      const restingOnPlate = obs.plates.some((pl) => pl.pressedBy.includes(crate.label));
      if (!restingOnPlate) continue;
      const nextPieces: WalkSegment[] = [];
      for (const piece of pieces) {
        const crateNearTop = Math.abs(crate.y + crate.h - piece.y) <= 8;
        const crateOverlapsX = crate.x < piece.x2 && crate.x + crate.w > piece.x1;
        if (crateNearTop && crateOverlapsX) {
          const leftEnd = Math.min(piece.x2, crate.x - 14);
          const rightStart = Math.max(piece.x1, crate.x + crate.w + 14);
          if (leftEnd - piece.x1 >= 24) {
            nextPieces.push({ ...piece, id: `${piece.id}-CL-${crate.id}`, x2: leftEnd });
          }
          if (piece.x2 - rightStart >= 24) {
            nextPieces.push({ ...piece, id: `${piece.id}-CR-${crate.id}`, x1: rightStart });
          }
        } else {
          nextPieces.push(piece);
        }
      }
      pieces = nextPieces;
    }

    // Split around standing narrow vertical walls (e.g., l3-mid-wall, alcove-backwall)
    for (const wall of standingWalls) {
      const nextPieces: WalkSegment[] = [];
      for (const piece of pieces) {
        const wallBlocksStanding = wall.y < piece.y - 2 && wall.y + wall.h >= piece.y - 4;
        const wallTouchesX = wall.x < piece.x2 - 2 && wall.x + wall.w > piece.x1 + 2;
        if (wallBlocksStanding && wallTouchesX) {
          if (wall.x - piece.x1 >= 12) {
            nextPieces.push({ ...piece, id: `${piece.id}-WL-${wall.id}`, x2: wall.x });
          }
          if (piece.x2 - (wall.x + wall.w) >= 12) {
            nextPieces.push({ ...piece, id: `${piece.id}-WR-${wall.id}`, x1: wall.x + wall.w });
          }
        } else {
          nextPieces.push(piece);
        }
      }
      pieces = nextPieces;
    }

    // Split around closed energy gates
    for (const door of closedDoors) {
      const nextPieces: WalkSegment[] = [];
      for (const piece of pieces) {
        const doorOverlapsY = door.y < piece.y && door.y + door.h >= piece.y - 4;
        const doorTouchesX = door.x < piece.x2 - 2 && door.x + door.w > piece.x1 + 2;
        if (doorOverlapsY && doorTouchesX) {
          if (door.x - piece.x1 >= 12) {
            nextPieces.push({ ...piece, id: `${piece.id}-DL-${door.id}`, x2: door.x });
          }
          if (piece.x2 - (door.x + door.w) >= 12) {
            nextPieces.push({ ...piece, id: `${piece.id}-DR-${door.id}`, x1: door.x + door.w });
          }
        } else {
          nextPieces.push(piece);
        }
      }
      pieces = nextPieces;
    }

    finalSegments.push(...pieces);
  }

  for (const crate of obs.crates) {
    const restingOnPlate = obs.plates.some((pl) => pl.pressedBy.includes(crate.label));
    if (restingOnPlate && Math.abs(crate.vx) < 20 && Math.abs(crate.vy) < 20) {
      finalSegments.push({
        id: `crate-top-${crate.id}`,
        sourceId: crate.id,
        x1: crate.x - 4,
        x2: crate.x + crate.w + 4,
        y: crate.y,
      });
    }
  }

  return finalSegments;
}

function isBlockedByClosedDoor(
  xFrom: number,
  xTo: number,
  yFrom: number,
  yTo: number,
  obs: AgentObservation
): boolean {
  const minX = Math.min(xFrom, xTo);
  const maxX = Math.max(xFrom, xTo);
  const minY = Math.min(yFrom, yTo) - 32;
  const maxY = Math.max(yFrom, yTo);

  for (const door of obs.doors) {
    if (door.open) continue;
    const doorCenterX = door.x + door.w * 0.5;
    if (doorCenterX >= minX - 2 && doorCenterX <= maxX + 2) {
      if (door.y < maxY - 2 && door.y + door.h > minY) {
        return true;
      }
    }
  }
  return false;
}

function isBlockedByVerticalWall(
  xFrom: number,
  xTo: number,
  yFrom: number,
  yTo: number,
  obs: AgentObservation
): boolean {
  const minX = Math.min(xFrom, xTo);
  const maxX = Math.max(xFrom, xTo);
  const minY = Math.min(yFrom, yTo) - 30;
  const maxY = Math.max(yFrom, yTo) - 4;

  for (const p of obs.platforms) {
    if (p.y <= 30 || p.w >= 36) continue;
    if (p.x + p.w > minX && p.x < maxX && p.y < maxY && p.y + p.h > minY) {
      return true;
    }
  }
  return false;
}

function rectsOverlapRaw(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * Physics-accurate 60Hz kinematic arc verifier accounting for gravity, airDrag,
 * actorMass, bouncy pad launch impulse, conveyor bias, wind/updraft forceZones,
 * ceilings, walls, closed doors, and floor hazards.
 */
function simulateTrajectory(
  tx: number,
  a: WalkSegment,
  b: WalkSegment,
  lx: number,
  mode: 'jump' | 'drop',
  obs: AgentObservation,
  requireComfortMargin: boolean
): boolean {
  const phys = obs.physics ?? {
    gravity: 1450,
    airDrag: 0.35,
    surfaceFriction: 1,
    restitution: 0.35,
    pushForce: 1,
    actorMass: 1,
  };
  const grav = Math.max(40, phys.gravity);
  const airDrag = Math.max(0, phys.airDrag);
  const actorMass = Math.max(0.25, phys.actorMass || 1);

  const dir = lx >= tx ? 1 : -1;
  const desiredVx = dir * RUN_SPEED * (requireComfortMargin ? 0.88 : 1.0);
  const initialSpeed =
    mode === 'drop'
      ? dir * 135
      : dir * Math.min(RUN_SPEED, 165) + (a.material === 'conveyor' ? (a.conveyorSpeed ?? 0) * 0.45 : 0);

  let x = tx - ACTOR_W * 0.5;
  let y = a.y - ACTOR_H;
  let vx = initialSpeed;
  let vy =
    mode === 'drop'
      ? 0
      : -(a.material === 'bouncy'
          ? Math.max(JUMP_SPEED, a.bounceVelocity ?? 680)
          : JUMP_SPEED * (requireComfortMargin ? 0.95 : 1.0));

  const maxTicks = grav < 500 ? 150 : 108;
  const targetMinX = b.x1 + 4;
  const targetMaxX = b.x2 - 4;

  for (let t = 0; t < maxTicks; t++) {
    const prevX = x;
    const prevY = y;
    const prevBottom = prevY + ACTOR_H;

    // Air steering toward landing point lx
    const centerX = x + ACTOR_W * 0.5;
    const targetSteerVx =
      Math.abs(lx - centerX) < 10 ? 0 : Math.sign(lx - centerX) * Math.abs(desiredVx);
    if (vx < targetSteerVx) vx = Math.min(targetSteerVx, vx + AIR_ACCEL * SIM_DT);
    else if (vx > targetSteerVx) vx = Math.max(targetSteerVx, vx - AIR_ACCEL * SIM_DT);

    // Gravity + vertical drag
    vy = clamp(vy + grav * SIM_DT, -MAX_FALL_SPEED, MAX_FALL_SPEED);
    if (airDrag > 0.01) {
      vy *= Math.exp(-airDrag * 0.28 * SIM_DT);
    }

    // Force zones (updrafts / crosswinds)
    for (const fz of obs.forceZones ?? []) {
      if (rectsOverlapRaw(x, y, ACTOR_W, ACTOR_H, fz.x, fz.y, fz.w, fz.h)) {
        vx = clamp(vx + (fz.fx / actorMass) * SIM_DT, -900, 900);
        vy = clamp(vy + (fz.fy / actorMass) * SIM_DT, -900, 900);
      }
    }

    x += vx * SIM_DT;
    y += vy * SIM_DT;

    // Perimeter containment
    if (x < 24) {
      x = 24;
      vx = Math.max(0, vx);
    } else if (x + ACTOR_W > 936) {
      x = 936 - ACTOR_W;
      vx = Math.min(0, vx);
    }
    if (y < 24) {
      y = 24;
      vy = Math.max(0, vy);
    }

    // Hazard collision rejects trajectory
    for (const hz of obs.hazards) {
      if (rectsOverlapRaw(x, y, ACTOR_W, ACTOR_H, hz.x, hz.y, hz.w, hz.h)) {
        return false;
      }
    }

    // Closed doors block trajectory
    for (const d of obs.doors) {
      if (d.open) continue;
      if (rectsOverlapRaw(x, y, ACTOR_W, ACTOR_H, d.x, d.y, d.w, d.h)) {
        return false;
      }
    }

    // Check landing onto target segment b first when falling onto top plane
    const cx = x + ACTOR_W * 0.5;
    if (
      t > 2 &&
      vy >= 0 &&
      prevBottom <= b.y + 8 &&
      y + ACTOR_H >= b.y &&
      cx >= targetMinX &&
      cx <= targetMaxX
    ) {
      return true;
    }

    // Intermediate solid obstacles (ceilings, walls, overhanging shelves)
    for (const p of obs.platforms) {
      if (p.id === a.sourceId || p.id === b.sourceId) continue;
      if (p.id === 'wall-left' || p.id === 'wall-right' || p.id === 'floor-main' || p.id === 'ceil-top') {
        continue;
      }
      if (!rectsOverlapRaw(x, y, ACTOR_W, ACTOR_H, p.x, p.y, p.w, p.h)) continue;

      // Head bonk against underside of ceiling/shelf
      if (vy < 0 && prevY >= p.y + p.h - 6) {
        y = p.y + p.h;
        vy = 0;
        continue;
      }

      // Standing on top of an intermediate platform doesn't pass through it
      if (vy >= 0 && prevBottom <= p.y + 6) {
        return false;
      }

      // Side collision against a vertical wall or platform edge
      if (p.w < 36 || (prevX + ACTOR_W <= p.x + 4 || prevX >= p.x + p.w - 4)) {
        return false;
      }
    }

    if (y > 492 - ACTOR_H) {
      // Fell all the way to floor; only valid if b is on floor-main
      if (b.y >= 490 && cx >= targetMinX && cx <= targetMaxX) return true;
      return false;
    }
  }

  return false;
}

export function findSegmentUnderPoint(
  segments: WalkSegment[],
  cx: number,
  bottomY: number
): WalkSegment | null {
  let best: WalkSegment | null = null;
  let bestDist = Infinity;
  for (const seg of segments) {
    if (cx >= seg.x1 - 6 && cx <= seg.x2 + 6) {
      const dy = Math.abs(seg.y - bottomY);
      if (dy < 22 && dy < bestDist) {
        bestDist = dy;
        best = seg;
      }
    }
  }
  if (best) return best;

  for (const seg of segments) {
    const dx = cx < seg.x1 ? seg.x1 - cx : cx > seg.x2 ? cx - seg.x2 : 0;
    const dy = seg.y >= bottomY - 12 ? seg.y - bottomY : (bottomY - seg.y) * 2;
    const score = dx + Math.abs(dy);
    if (score < bestDist) {
      bestDist = score;
      best = seg;
    }
  }
  return best;
}

function computeDirectTransition(
  a: WalkSegment,
  b: WalkSegment,
  obs: AgentObservation,
  requireComfortMargin: boolean = false
): EdgeTransition | null {
  if (a.id === b.id) return null;

  const dy = b.y - a.y;
  const grav = Math.max(40, obs.physics?.gravity ?? 1450);
  const gravityRatio = 1450 / grav;
  const hasUpdraft = (obs.forceZones ?? []).some(
    (fz) =>
      fz.fy < -350 &&
      fz.x < Math.max(a.x2, b.x2) &&
      fz.x + fz.w > Math.min(a.x1, b.x1) &&
      fz.y <= a.y &&
      fz.y + fz.h >= b.y
  );

  // Broad-phase vertical bound (generous so physics sim makes the true physical call)
  let maxBroadUp = Math.min(440, 120 * gravityRatio);
  if (a.material === 'bouncy') {
    const bv = a.bounceVelocity ?? 680;
    maxBroadUp = Math.max(maxBroadUp, (bv * bv) / (2 * grav) + 24);
  }
  if (hasUpdraft) {
    maxBroadUp = Math.max(maxBroadUp, 360);
  }
  if (dy < -maxBroadUp) return null;

  const maxBroadFlatGap = Math.min(340, 185 * Math.sqrt(Math.max(0.8, gravityRatio)));
  const maxBroadUpGap = Math.min(280, 150 * Math.sqrt(Math.max(0.8, gravityRatio)));

  // Case 1: Jumping UP (b is higher than a)
  if (dy < -12) {
    const candidates: Array<{ tx: number; lx: number; gap: number }> = [];
    const overlapsHoriz = a.x1 < b.x2 && a.x2 > b.x1;

    // Candidate 1: Jump from left side of b
    const leftEdgeTx = overlapsHoriz
      ? clamp(b.x1 - 34, a.x1 + 10, a.x2 - 10)
      : b.x1 >= a.x2
        ? Math.min(a.x2 - 8, b.x1 - 30)
        : clamp(b.x1 - 34, a.x1 + 10, a.x2 - 10);
    const leftClear = !overlapsHoriz || leftEdgeTx <= b.x1 - 18;
    const leftLx = clamp(b.x1 + 22, b.x1 + 12, b.x2 - 12);
    if (leftClear && Math.abs(leftLx - leftEdgeTx) <= maxBroadUpGap) {
      candidates.push({
        tx: leftEdgeTx,
        lx: leftLx,
        gap: Math.max(0, b.x1 - leftEdgeTx),
      });
    }

    // Candidate 2: Jump from right side of b
    const rightEdgeTx = overlapsHoriz
      ? clamp(b.x2 + 34, a.x1 + 10, a.x2 - 10)
      : a.x1 >= b.x2
        ? Math.max(a.x1 + 8, b.x2 + 30)
        : clamp(b.x2 + 34, a.x1 + 10, a.x2 - 10);
    const rightClear = !overlapsHoriz || rightEdgeTx >= b.x2 + 18;
    const rightLx = clamp(b.x2 - 22, b.x1 + 12, b.x2 - 12);
    if (rightClear && Math.abs(rightLx - rightEdgeTx) <= maxBroadUpGap) {
      candidates.push({
        tx: rightEdgeTx,
        lx: rightLx,
        gap: Math.max(0, rightEdgeTx - b.x2),
      });
    }

    let best: EdgeTransition | null = null;
    for (const cand of candidates) {
      if (cand.gap > maxBroadUpGap) continue;
      const baseSign = cand.lx >= cand.tx ? 1 : -1;
      const txOffsets = [0, baseSign * 16, baseSign * 26, -baseSign * 10];
      let validTx: number | null = null;
      for (const off of txOffsets) {
        const testTx = clamp(cand.tx + off, a.x1 + 8, a.x2 - 8);
        if (isBlockedByClosedDoor(testTx, cand.lx, a.y, b.y, obs)) continue;
        if (isBlockedByVerticalWall(testTx, cand.lx, a.y, b.y, obs)) continue;
        if (simulateTrajectory(testTx, a, b, cand.lx, 'jump', obs, requireComfortMargin)) {
          validTx = testTx;
          break;
        }
      }
      if (validTx === null) continue;

      const cost = Math.hypot(cand.lx - validTx, dy) + 18;
      if (!best || cost < best.cost) {
        best = { tx: validTx, lx: cand.lx, mode: 'jump', cost };
      }
    }

    // Candidate 3: updraft-assisted ascent. A bot cannot jump 200+ px, but the
    // updraft can carry it. Try takeoffs inside the updraft column and let the
    // ballistic simulator account for the force zone.
    for (const fz of obs.forceZones ?? []) {
      if (fz.fy >= -350) continue;
      if (!(fz.y <= a.y && fz.y + fz.h >= b.y)) continue;
      const zoneTxLo = Math.max(a.x1 + 8, fz.x + 8);
      const zoneTxHi = Math.min(a.x2 - 8, fz.x + fz.w - 8);
      if (zoneTxLo > zoneTxHi) continue;
      const zoneCenter = clamp(fz.x + fz.w * 0.5, zoneTxLo, zoneTxHi);
      const txCandidates = [zoneCenter, clamp(zoneCenter - 14, zoneTxLo, zoneTxHi), clamp(zoneCenter + 14, zoneTxLo, zoneTxHi)];
      const lxCandidates = [
        clamp(b.x1 + 22, b.x1 + 12, b.x2 - 12),
        clamp((b.x1 + b.x2) * 0.5, b.x1 + 12, b.x2 - 12),
        clamp(b.x2 - 22, b.x1 + 12, b.x2 - 12),
      ];
      for (const testTx of txCandidates) {
        for (const testLx of lxCandidates) {
          if (isBlockedByClosedDoor(testTx, testLx, a.y, b.y, obs)) continue;
          if (isBlockedByVerticalWall(testTx, testLx, a.y, b.y, obs)) continue;
          if (!simulateTrajectory(testTx, a, b, testLx, 'jump', obs, requireComfortMargin)) continue;
          const cost = Math.hypot(testLx - testTx, dy) + 42;
          if (!best || cost < best.cost) {
            best = { tx: testTx, lx: testLx, mode: 'jump', cost };
          }
        }
      }
    }
    return best;
  }

  // Case 2: Same level or slight step (|dy| <= 12)
  if (Math.abs(dy) <= 12) {
    let tx: number;
    let lx: number;
    let gap: number;
    if (b.x1 >= a.x2) {
      gap = b.x1 - a.x2;
      tx = a.x2 - 8;
      lx = clamp(b.x1 + 18, b.x1 + 12, b.x2 - 12);
    } else if (a.x1 >= b.x2) {
      gap = a.x1 - b.x2;
      tx = a.x1 + 8;
      lx = clamp(b.x2 - 18, b.x1 + 12, b.x2 - 12);
    } else {
      gap = 0;
      const mid = (Math.max(a.x1, b.x1) + Math.min(a.x2, b.x2)) * 0.5;
      tx = clamp(mid, a.x1 + 10, a.x2 - 10);
      lx = clamp(mid, b.x1 + 10, b.x2 - 10);
    }
    if (gap > maxBroadFlatGap) return null;
    if (isBlockedByClosedDoor(tx, lx, a.y, b.y, obs)) return null;
    const blockedByWall = isBlockedByVerticalWall(tx, lx, a.y, b.y, obs);
    if (gap <= 14 && blockedByWall) return null;

    if (gap > 14 || blockedByWall) {
      const baseSign = lx >= tx ? 1 : -1;
      const txOffsets = blockedByWall
        ? [-baseSign * 26, -baseSign * 38, -baseSign * 50, -baseSign * 14, 0]
        : [0];
      const lxOffsets = blockedByWall ? [0, baseSign * 14, baseSign * 26] : [0];
      let validTx: number | null = null;
      let validLx = lx;
      for (const lOff of lxOffsets) {
        const testLx = clamp(lx + lOff, b.x1 + 10, b.x2 - 10);
        for (const tOff of txOffsets) {
          const testTx = clamp(tx + tOff, a.x1 + 8, a.x2 - 8);
          if (simulateTrajectory(testTx, a, b, testLx, 'jump', obs, requireComfortMargin)) {
            validTx = testTx;
            validLx = testLx;
            break;
          }
        }
        if (validTx !== null) break;
      }
      if (validTx === null) return null;
      return {
        tx: validTx,
        lx: validLx,
        mode: 'jump',
        cost: Math.abs(validLx - validTx) + (blockedByWall ? 18 : 10),
      };
    }

    return {
      tx,
      lx,
      mode: 'walk',
      cost: Math.abs(lx - tx) + 2,
    };
  }

  // Case 3: Dropping DOWN (b.y > a.y + 12)
  const dropDist = dy;
  const maxDropGap = Math.min(220, 115 + dropDist * 0.45);
  const dropCandidates: Array<{ tx: number; lx: number; cost: number; mode: WaypointMode }> = [];

  if (a.x1 > 34) {
    const lipX = a.x1 - 14;
    const landX = clamp(a.x1 - 24, b.x1 + 14, b.x2 - 14);
    const hitsHazard = obs.hazards.some(
      (hz) =>
        Math.abs(hz.y + hz.h - b.y) <= 16 &&
        hz.x + hz.w > Math.min(lipX, b.x2) - 10 &&
        hz.x < Math.max(lipX, b.x2) + 10
    );
    const targetLandX = hitsHazard ? clamp(b.x2 - 18, b.x1 + 14, b.x2 - 14) : landX;
    const txX = hitsHazard ? clamp(a.x1 + 6, a.x1 + 6, a.x2 - 6) : lipX;
    const horizFromLip = Math.abs(targetLandX - txX);
    const allowedGap = hitsHazard ? maxBroadFlatGap : maxDropGap;
    if (
      b.x1 <= a.x1 + 20 &&
      b.x2 >= a.x1 - allowedGap &&
      horizFromLip <= allowedGap &&
      !isBlockedByClosedDoor(a.x1, targetLandX, a.y, b.y, obs) &&
      !isBlockedByVerticalWall(a.x1, targetLandX, a.y, b.y, obs) &&
      simulateTrajectory(
        clamp(txX, a.x1 + 4, a.x2 - 4),
        a,
        b,
        targetLandX,
        hitsHazard ? 'jump' : 'drop',
        obs,
        false
      )
    ) {
      dropCandidates.push({
        tx: txX,
        lx: targetLandX,
        mode: hitsHazard ? 'jump' : 'drop',
        cost: Math.hypot(targetLandX - txX, dropDist) + (hitsHazard ? 24 : 12),
      });
    }
  }

  if (a.x2 < 926) {
    const lipX = a.x2 + 14;
    const landX = clamp(a.x2 + 24, b.x1 + 14, b.x2 - 14);
    const hitsHazard = obs.hazards.some(
      (hz) =>
        Math.abs(hz.y + hz.h - b.y) <= 16 &&
        hz.x + hz.w > Math.min(a.x2, b.x1) - 10 &&
        hz.x < Math.max(lipX, b.x1 + 18) + 10
    );
    const targetLandX = hitsHazard ? clamp(b.x1 + 18, b.x1 + 14, b.x2 - 14) : landX;
    const txX = hitsHazard ? clamp(a.x2 - 6, a.x1 + 6, a.x2 - 6) : lipX;
    const horizFromLip = Math.abs(targetLandX - txX);
    const allowedGap = hitsHazard ? maxBroadFlatGap : maxDropGap;
    if (
      b.x2 >= a.x2 - 20 &&
      b.x1 <= a.x2 + allowedGap &&
      horizFromLip <= allowedGap &&
      !isBlockedByClosedDoor(a.x2, targetLandX, a.y, b.y, obs) &&
      !isBlockedByVerticalWall(a.x2, targetLandX, a.y, b.y, obs) &&
      simulateTrajectory(
        clamp(txX, a.x1 + 4, a.x2 - 4),
        a,
        b,
        targetLandX,
        hitsHazard ? 'jump' : 'drop',
        obs,
        false
      )
    ) {
      dropCandidates.push({
        tx: txX,
        lx: targetLandX,
        mode: hitsHazard ? 'jump' : 'drop',
        cost: Math.hypot(targetLandX - txX, dropDist) + (hitsHazard ? 24 : 12),
      });
    }
  }

  // A downward move can also be a jump across a gap. Walk-off drops use only
  // the small initial speed, so a platform 100+ px away is correctly rejected;
  // a real player jumps. Try both lips and the target's centre/edges.
  const jumpDownCandidates: typeof dropCandidates = [];
  const downTxCandidates = [
    clamp(a.x1 + 10, a.x1 + 4, a.x2 - 4),
    clamp(a.x2 - 10, a.x1 + 4, a.x2 - 4),
    clamp((a.x1 + a.x2) * 0.5, a.x1 + 4, a.x2 - 4),
  ];
  const downLxCandidates = [
    clamp(b.x1 + 20, b.x1 + 14, b.x2 - 14),
    clamp((b.x1 + b.x2) * 0.5, b.x1 + 14, b.x2 - 14),
    clamp(b.x2 - 20, b.x1 + 14, b.x2 - 14),
  ];
  for (const tx of downTxCandidates) {
    for (const lx of downLxCandidates) {
      if (isBlockedByClosedDoor(tx, lx, a.y, b.y, obs)) continue;
      if (isBlockedByVerticalWall(tx, lx, a.y, b.y, obs)) continue;
      if (!simulateTrajectory(tx, a, b, lx, 'jump', obs, false)) continue;
      jumpDownCandidates.push({
        tx,
        lx,
        mode: 'jump',
        cost: Math.hypot(lx - tx, dropDist) + 46,
      });
    }
  }

  const allDropCandidates = dropCandidates.concat(jumpDownCandidates);
  if (allDropCandidates.length === 0) return null;
  allDropCandidates.sort((c1, c2) => c1.cost - c2.cost);
  return allDropCandidates[0];
}

function isSegmentPowered(seg: WalkSegment, obs: AgentObservation): boolean {
  const signals: boolean[] = [];
  if (seg.channel) signals.push(Boolean(obs.channels[seg.channel]));
  for (const tid of seg.linkedIds ?? []) {
    const active =
      obs.switches.some((s) => s.id === tid && s.active) ||
      obs.plates.some((p) => p.id === tid && p.active);
    signals.push(active);
  }
  if (signals.length === 0) return true;
  return (seg.logic ?? 'ANY') === 'ALL' ? signals.every(Boolean) : signals.some(Boolean);
}

function getMovingSegmentSamples(seg: WalkSegment, obs: AgentObservation): WalkSegment[] {
  if (!seg.isMoving || !seg.startPos || !seg.endPos) return [seg];
  const powered = isSegmentPowered(seg, obs);
  if (!powered || !seg.loopWhenActive) return [seg];
  const w = seg.x2 - seg.x1;
  const samples: WalkSegment[] = [seg];
  for (const t of [0, 0.5, 1]) {
    const x = seg.startPos.x + (seg.endPos.x - seg.startPos.x) * t;
    const y = seg.startPos.y + (seg.endPos.y - seg.startPos.y) * t;
    samples.push({ ...seg, x1: x, x2: x + w, y });
  }
  return samples;
}

function canTransition(
  a: WalkSegment,
  b: WalkSegment,
  obs: AgentObservation
): EdgeTransition | null {
  const direct = computeDirectTransition(a, b, obs, Boolean(a.isMoving || b.isMoving));
  if (direct) return direct;

  if ((a.isMoving && a.loopWhenActive) || (b.isMoving && b.loopWhenActive)) {
    const aSamples = getMovingSegmentSamples(a, obs);
    const bSamples = getMovingSegmentSamples(b, obs);
    for (const as of aSamples) {
      for (const bs of bSamples) {
        const t = computeDirectTransition(as, bs, obs, true);
        if (t) {
          const waitX = a.isMoving
            ? (a.x1 + a.x2) * 0.5
            : clamp(t.tx, a.x1 + 14, a.x2 - 14);
          return {
            tx: waitX,
            lx: t.lx,
            mode: 'wait',
            cost: t.cost + 45,
          };
        }
      }
    }
  }

  return null;
}

export function buildNavigationGraph(obs: AgentObservation): NavigationGraph {
  const key = buildTopologyKey(obs);
  const cached = graphCache.get(key);
  if (cached) {
    // Refresh LRU position
    graphCache.delete(key);
    graphCache.set(key, cached);
    return cached;
  }

  const segments = buildWalkSegments(obs);
  const adj = new Map<string, NavigationEdge[]>();
  const segById = new Map<string, WalkSegment>();
  for (const s of segments) {
    segById.set(s.id, s);
    adj.set(s.id, []);
  }

  for (let i = 0; i < segments.length; i++) {
    const a = segments[i];
    const edges = adj.get(a.id)!;
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue;
      const b = segments[j];
      const edge = canTransition(a, b, obs);
      if (edge) {
        edges.push({ to: b, edge });
      }
    }
  }

  const graph: NavigationGraph = { key, segments, adj, segById };
  graphCache.set(key, graph);
  if (graphCache.size > MAX_GRAPH_CACHE) {
    const oldest = graphCache.keys().next().value;
    if (oldest !== undefined) graphCache.delete(oldest);
  }
  return graph;
}

export function buildShortestPathTree(
  graph: NavigationGraph,
  startPt: Vec2
): ShortestPathTree {
  const startSeg = findSegmentUnderPoint(graph.segments, startPt.x, startPt.y);
  const distMap = new Map<string, number>();
  const prevEdge = new Map<string, { from: WalkSegment; edge: EdgeTransition } | null>();

  if (!startSeg) {
    return { graph, startPt, startSeg: null, distMap, prevEdge };
  }

  const visited = new Set<string>();
  distMap.set(startSeg.id, 0);
  prevEdge.set(startSeg.id, null);

  while (true) {
    let currId: string | null = null;
    let bestD = Infinity;
    for (const [id, d] of distMap.entries()) {
      if (!visited.has(id) && d < bestD) {
        bestD = d;
        currId = id;
      }
    }
    if (!currId) break;
    visited.add(currId);

    const curr = graph.segById.get(currId)!;
    const neighbors = graph.adj.get(currId) ?? [];
    for (const { to, edge } of neighbors) {
      if (visited.has(to.id)) continue;
      const candCost = bestD + edge.cost;
      if (candCost < (distMap.get(to.id) ?? Infinity)) {
        distMap.set(to.id, candCost);
        prevEdge.set(to.id, { from: curr, edge });
      }
    }
  }

  return { graph, startPt, startSeg, distMap, prevEdge };
}

export function resolvePathFromTree(
  obs: AgentObservation,
  tree: ShortestPathTree,
  goalPt: Vec2
): PathResult {
  const startWp: Waypoint = { ...tree.startPt, mode: 'walk' };
  const goalWp: Waypoint = { ...goalPt, mode: 'walk' };
  const startSeg = tree.startSeg;
  const goalSeg = findSegmentUnderPoint(tree.graph.segments, goalPt.x, goalPt.y);

  if (!startSeg || !goalSeg) {
    return { reachable: false, cost: Infinity, nextTarget: goalWp, waypoints: [startWp, goalWp] };
  }

  if (startSeg.id === goalSeg.id) {
    const blocked =
      isBlockedByClosedDoor(tree.startPt.x, goalPt.x, tree.startPt.y, goalPt.y, obs) ||
      isBlockedByVerticalWall(tree.startPt.x, goalPt.x, tree.startPt.y, goalPt.y, obs);
    return {
      reachable: !blocked,
      cost: blocked ? Infinity : Math.hypot(goalPt.x - tree.startPt.x, goalPt.y - tree.startPt.y),
      nextTarget: goalWp,
      waypoints: [startWp, goalWp],
    };
  }

  if (!tree.prevEdge.has(goalSeg.id)) {
    // Unreachable goals used to fall back to a straight start->goal line, which
    // sent bots walking into locked gates, walls, and plasma. Retreat to the
    // reachable frontier closest to the goal instead: a safe partial route is
    // always better than a straight line through danger.
    let frontier: WalkSegment | null = null;
    let frontierDist = Infinity;
    for (const seg of tree.graph.segments) {
      if (!tree.prevEdge.has(seg.id)) continue;
      const px = clamp(goalPt.x, seg.x1 + 14, seg.x2 - 14);
      const dist = Math.hypot(px - goalPt.x, seg.y - goalPt.y);
      if (dist < frontierDist) {
        frontierDist = dist;
        frontier = seg;
      }
    }
    if (frontier) {
      const pt = {
        x: clamp(goalPt.x, frontier.x1 + 14, frontier.x2 - 14),
        y: frontier.y,
      };
      const partial = resolvePathFromTree(obs, tree, pt);
      return {
        reachable: false,
        cost: Infinity,
        nextTarget: partial.nextTarget,
        waypoints: partial.waypoints,
      };
    }
    return { reachable: false, cost: Infinity, nextTarget: startWp, waypoints: [startWp] };
  }

  const hops: Array<{ from: WalkSegment; to: WalkSegment; edge: EdgeTransition }> = [];
  let curSeg = goalSeg;
  while (true) {
    const link = tree.prevEdge.get(curSeg.id);
    if (!link) break;
    hops.unshift({ from: link.from, to: curSeg, edge: link.edge });
    curSeg = link.from;
  }

  const waypoints: Waypoint[] = [startWp];
  for (const hop of hops) {
    waypoints.push({ x: hop.edge.tx, y: hop.from.y, mode: hop.edge.mode });
    waypoints.push({ x: hop.edge.lx, y: hop.to.y, mode: 'walk' });
  }
  waypoints.push(goalWp);

  return {
    reachable: true,
    cost: tree.distMap.get(goalSeg.id) ?? Infinity,
    nextTarget: waypoints[1] ?? goalWp,
    waypoints,
  };
}

export function findPathToPoint(
  obs: AgentObservation,
  segmentsOrGraph: WalkSegment[] | NavigationGraph,
  startPt: Vec2,
  goalPt: Vec2
): PathResult {
  const graph = Array.isArray(segmentsOrGraph)
    ? buildNavigationGraph(obs)
    : segmentsOrGraph;
  const tree = buildShortestPathTree(graph, startPt);
  return resolvePathFromTree(obs, tree, goalPt);
}

function isExitSafeToLeavePlates(obs: AgentObservation): boolean {
  if (!obs.exit.unlocked) return false;
  const logic = obs.exit.logic ?? 'ALL';
  if (logic === 'ANY') {
    const hasSafeActiveSignal =
      obs.exit.requiredChannels.some((ch) => {
        if (obs.switches.some((s) => s.channel === ch && s.active)) return true;
        const p = obs.plates.find((pl) => pl.channel === ch && pl.active);
        return Boolean(p && (p.mode === 'latch' || isPressedByDynamicBody(obs, p)));
      }) ||
      (obs.exit.linkedIds ?? []).some((tid) => {
        if (obs.switches.some((s) => s.id === tid && s.active)) return true;
        const p = obs.plates.find((pl) => pl.id === tid && pl.active);
        return Boolean(p && (p.mode === 'latch' || isPressedByDynamicBody(obs, p)));
      });
    const totalSignals = obs.exit.requiredChannels.length + (obs.exit.linkedIds?.length ?? 0);
    return totalSignals === 0 || hasSafeActiveSignal;
  }

  for (const ch of obs.exit.requiredChannels) {
    const activeSwitch = obs.switches.some((s) => s.channel === ch && s.active);
    if (activeSwitch) continue;
    const plateOnCh = obs.plates.find((p) => p.channel === ch);
    if (!plateOnCh) continue;
    if (plateOnCh.mode === 'latch' && plateOnCh.active) continue;
    if (!isPressedByDynamicBody(obs, plateOnCh)) {
      return false;
    }
  }
  for (const tid of obs.exit.linkedIds ?? []) {
    const linkedPlate = obs.plates.find((p) => p.id === tid);
    if (!linkedPlate) continue;
    if (linkedPlate.mode === 'latch' && linkedPlate.active) continue;
    if (!isPressedByDynamicBody(obs, linkedPlate)) {
      return false;
    }
  }
  return true;
}

function isPointBlockedByWallOrDoor(x: number, yBottom: number, obs: AgentObservation): boolean {
  if (x <= 32 || x >= 928) return true;
  for (const p of obs.platforms) {
    if (p.y <= 30 || p.w >= 36) continue;
    if (x >= p.x - 10 && x <= p.x + p.w + 10 && yBottom > p.y && yBottom - 34 < p.y + p.h) {
      return true;
    }
  }
  for (const d of obs.doors) {
    if (d.open) continue;
    if (x >= d.x - 10 && x <= d.x + d.w + 10 && yBottom > d.y && yBottom - 34 < d.y + d.h) {
      return true;
    }
  }
  return false;
}

interface TeammateClaimSummary {
  claimedByTarget: Map<string, { actorId: string; dist: number; fromMessage: boolean }>;
  requestedTargets: Set<string>;
  requestedChannels: Set<ChannelId>;
}

function collectTeammateCoordination(obs: AgentObservation): TeammateClaimSummary {
  const claimedByTarget = new Map<string, { actorId: string; dist: number; fromMessage: boolean }>();
  const requestedTargets = new Set<string>();
  const requestedChannels = new Set<ChannelId>();

  const targetCenter = (id: string): Vec2 | null => {
    const sw = obs.switches.find((s) => s.id === id);
    if (sw) return { x: sw.x + sw.w * 0.5, y: sw.y + sw.h };
    const cr = obs.crates.find((c) => c.id === id);
    if (cr) return { x: cr.x + cr.w * 0.5, y: cr.y + cr.h };
    const pl = obs.plates.find((p) => p.id === id);
    if (pl) return { x: pl.x + pl.w * 0.5, y: pl.y + pl.h };
    return null;
  };

  for (const t of obs.teammates) {
    const claimedId = t.claimTargetId ?? t.targetId;
    if (!claimedId) continue;
    const tc = targetCenter(claimedId);
    const dist = tc ? Math.hypot(t.x + 13 - tc.x, t.y + 34 - tc.y) : 9999;
    const prev = claimedByTarget.get(claimedId);
    if (!prev || dist < prev.dist) {
      claimedByTarget.set(claimedId, { actorId: t.id, dist, fromMessage: false });
    }
  }

  // Incorporate only each teammate's LATEST message unless their live targetId already moved on
  const recentMessages: AgentMessage[] = obs.messages ?? [];
  const seenLatestMsgFrom = new Set<string>();
  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const m = recentMessages[i];
    if (m.actorId === obs.self.id) continue;
    if (seenLatestMsgFrom.has(m.actorId)) continue;
    seenLatestMsgFrom.add(m.actorId);
    if (obs.tick - m.tick > 180) continue;
    const sender = obs.teammates.find((t) => t.id === m.actorId);
    if (!sender) continue;

    if (m.kind === 'claim' && m.targetId) {
      const liveTarget = sender.claimTargetId ?? sender.targetId;
      // If teammate has already moved on to a different live target, do not enforce stale claim
      if (liveTarget && liveTarget !== m.targetId) continue;
      const tc = targetCenter(m.targetId);
      const dist = tc ? Math.hypot(sender.x + 13 - tc.x, sender.y + 34 - tc.y) : 9999;
      const existing = claimedByTarget.get(m.targetId);
      if (!existing || dist <= existing.dist) {
        claimedByTarget.set(m.targetId, { actorId: m.actorId, dist, fromMessage: true });
      }
    } else if (m.kind === 'request') {
      if (m.targetId) requestedTargets.add(m.targetId);
      if (m.channel) requestedChannels.add(m.channel);
    }
  }

  return { claimedByTarget, requestedTargets, requestedChannels };
}

export function decideAgentAction(
  obs: AgentObservation,
  memory: AgentPlannerMemory
): ActorInput {
  const selfCx = obs.self.x + 13;
  const selfBottom = obs.self.y + 34;
  const selfPt: Vec2 = { x: selfCx, y: selfBottom };

  if (obs.solved) {
    memory.lockedAirTarget = null;
    return {
      move: 0,
      jump: false,
      interact: false,
      intent: 'Puzzle Solved',
      reason: 'All collaborators arrived at exit pad',
      targetId: obs.exit.id,
      targetPos: { x: obs.exit.x + obs.exit.w * 0.5, y: obs.exit.y + obs.exit.h },
      utility: 1,
    };
  }

  const graph = buildNavigationGraph(obs);
  const pathTree = buildShortestPathTree(graph, selfPt);
  const coord = collectTeammateCoordination(obs);

  const exitCenter: Vec2 = {
    x: obs.exit.x + obs.exit.w * 0.5,
    y: obs.exit.y + obs.exit.h,
  };

  let chosenIntent = 'Explore Arena';
  let chosenReason = 'Evaluating reachability';
  let chosenTargetId: string | undefined;
  let chosenClaimTargetId: string | undefined;
  let chosenTargetPos: Vec2 = exitCenter;
  let chosenUtility = 0.5;
  let pathResult = resolvePathFromTree(obs, pathTree, exitCenter);
  let wantsInteract = false;
  let wantsGrab = false;
  let pushingCrateMode = false;
  let activePushDir: -1 | 1 | null = null;
  let holdingStationaryPlate = false;
  let collabMsgText: string | undefined;
  let collabMsgKind: AgentMessageKind | undefined;
  let collabMsgChannel: ChannelId | undefined;

  // 1. Hold momentary plate ONLY when not carrying a crate and no same-tier crate can immediately replace us
  const holdingNeededPlate = obs.self.holdingCrateId
    ? undefined
    : obs.plates.find((plate) => {
        if (plate.mode !== 'momentary' || !plate.active) return false;
        if (isPressedByDynamicBody(obs, plate)) return false;

        const plateBottom = plate.y + plate.h;
        const selfOnPlate =
          selfCx >= plate.x - 4 &&
          selfCx <= plate.x + plate.w + 4 &&
          Math.abs(selfBottom - plateBottom) <= 16;
        if (!selfOnPlate) return false;
        if (obs.teammates.length === 0) return false;

        const crateRightBesidePlateSameTier = obs.crates.some(
          (c) =>
            Math.abs(c.y + c.h - plateBottom) <= 36 &&
            Math.abs(c.x + c.w * 0.5 - (plate.x + plate.w * 0.5)) < 190
        );
        if (crateRightBesidePlateSameTier) return false;

        const teammateAlsoOnPlate = obs.teammates.find(
          (t) =>
            t.x + 13 >= plate.x - 4 &&
            t.x + 13 <= plate.x + plate.w + 4 &&
            Math.abs(t.y + 34 - plateBottom) <= 16
        );
        if (teammateAlsoOnPlate) {
          const teammateHolding = teammateAlsoOnPlate.intent === `Hold ${plate.label}`;
          if (teammateHolding && memory.lastDecisionIntent !== `Hold ${plate.label}`) return false;
          if (teammateAlsoOnPlate.id < obs.self.id) return false;
        }

        const doorDirectlyNeedsPlate = obs.doors.some(
          (d) => d.linkedIds?.includes(plate.id) && (d.logic === 'ALL' || !d.open)
        );
        const exitDirectlyNeedsPlate = Boolean(obs.exit.linkedIds?.includes(plate.id));
        const channelNeededByUnlatchedDoor = obs.doors.some(
          (d) =>
            d.channels.includes(plate.channel) &&
            !d.channels.some(
              (otherCh) =>
                otherCh !== plate.channel &&
                d.logic === 'ANY' &&
                obs.switches.some((s) => s.channel === otherCh && s.active)
            ) &&
            !(d.logic === 'ANY' && obs.switches.some((s) => s.channel === plate.channel && s.active))
        );
        const channelNeededByExit =
          obs.exit.requiredChannels.includes(plate.channel) &&
          !obs.switches.some((s) => s.channel === plate.channel && s.active);

        return (
          !obs.exit.unlocked ||
          doorDirectlyNeedsPlate ||
          exitDirectlyNeedsPlate ||
          channelNeededByUnlatchedDoor ||
          channelNeededByExit
        );
      });

  const exitPath = resolvePathFromTree(obs, pathTree, exitCenter);

  if (holdingNeededPlate) {
    holdingStationaryPlate = true;
    chosenIntent = `Hold ${holdingNeededPlate.label}`;
    chosenReason = `Maintaining CH-${holdingNeededPlate.channel} while partner advances`;
    chosenTargetId = holdingNeededPlate.id;
    chosenClaimTargetId = holdingNeededPlate.id;
    chosenTargetPos = {
      x: holdingNeededPlate.x + holdingNeededPlate.w * 0.5,
      y: holdingNeededPlate.y + holdingNeededPlate.h,
    };
    chosenUtility = 0.96;
    pathResult = {
      reachable: true,
      cost: 0,
      nextTarget: { ...chosenTargetPos, mode: 'walk' },
      waypoints: [{ ...selfPt, mode: 'walk' }, { ...chosenTargetPos, mode: 'walk' }],
    };
    collabMsgKind = 'status';
    collabMsgChannel = holdingNeededPlate.channel;
    collabMsgText = `Holding ${holdingNeededPlate.label} (CH-${holdingNeededPlate.channel}) — partner clear`;
  } else if (!obs.self.holdingCrateId && obs.exit.unlocked && exitPath.reachable && isExitSafeToLeavePlates(obs)) {
    chosenIntent = 'Move to Exit Pad';
    chosenReason = `Exit unlocked (CH ${obs.exit.requiredChannels.join('+') || 'OPEN'})`;
    chosenTargetId = obs.exit.id;
    chosenTargetPos = exitCenter;
    chosenUtility = 0.98;
    pathResult = exitPath;
    collabMsgKind = 'status';
    collabMsgText = obs.self.onExit ? 'On Exit Pad — ready' : 'Exit unlocked, heading to Exit Pad';
  } else {
    const neededChannels = new Set<ChannelId>();
    const crateRequiredChannels = new Set<ChannelId>();
    const neededTriggerIds = new Set<string>();

    for (const door of obs.doors) {
      if (!door.open) {
        for (const ch of door.channels) {
          if (!obs.channels[ch]) neededChannels.add(ch);
        }
        for (const tid of door.linkedIds ?? []) {
          neededTriggerIds.add(tid);
        }
      }
      for (const ch of door.channels) {
        if (!obs.switches.some((s) => s.channel === ch && s.active)) {
          crateRequiredChannels.add(ch);
        }
      }
    }
    for (const ch of obs.exit.requiredChannels) {
      if (!obs.channels[ch]) neededChannels.add(ch);
      if (!obs.switches.some((s) => s.channel === ch && s.active)) {
        crateRequiredChannels.add(ch);
      }
    }
    for (const tid of obs.exit.linkedIds ?? []) {
      if (!obs.exit.unlocked) neededTriggerIds.add(tid);
    }
    for (const plat of obs.platforms) {
      if (plat.kind === 'moving') {
        if (plat.channel) {
          if (!obs.channels[plat.channel]) neededChannels.add(plat.channel);
          if (!obs.switches.some((s) => s.channel === plat.channel && s.active)) {
            crateRequiredChannels.add(plat.channel);
          }
        }
        for (const tid of plat.linkedIds ?? []) {
          neededTriggerIds.add(tid);
        }
      }
    }

    const teammateOwnsClaim = (targetId: string, myDist: number, alreadyTargetingSelf: boolean): boolean => {
      const claim = coord.claimedByTarget.get(targetId);
      if (!claim) return false;
      if (claim.fromMessage && !alreadyTargetingSelf) return true;
      return claim.dist < myDist - 4 || (Math.abs(claim.dist - myDist) <= 4 && claim.actorId < obs.self.id);
    };

    // 2A. Reachable unflipped switches (resolved in O(hops) from single-source Dijkstra tree)
    const reachableSwitches = obs.switches
      .filter((sw) => !sw.active)
      .map((sw) => {
        const pt: Vec2 = { x: sw.x + sw.w * 0.5, y: sw.y + sw.h };
        const p = resolvePathFromTree(obs, pathTree, pt);
        const dist = Math.hypot(selfPt.x - pt.x, selfPt.y - pt.y);
        const alreadySelf = memory.lastDecisionIntent === `Activate ${sw.label}`;
        const teammateClaiming = teammateOwnsClaim(sw.id, dist, alreadySelf);
        const requestedBonus =
          coord.requestedTargets.has(sw.id) || coord.requestedChannels.has(sw.channel) ? 180 : 0;
        return { sw, pt, p, dist, score: p.cost - requestedBonus, teammateClaiming };
      })
      .filter((item) => item.p.reachable && !item.teammateClaiming)
      .sort((a, b) => a.score - b.score);

    // 2B. Crate-to-Plate delivery tasks (push + grab-carry including upward carry)
    interface CrateTask {
      crate: AgentObservation['crates'][number];
      plate: AgentObservation['plates'][number];
      approachPt: Vec2;
      pushDir: -1 | 1;
      useGrabCarry: boolean;
      path: PathResult;
      score: number;
    }

    const crateTasks: CrateTask[] = [];
    for (const plate of obs.plates) {
      if (isPressedByDynamicBody(obs, plate)) continue;
      if (
        !neededChannels.has(plate.channel) &&
        !crateRequiredChannels.has(plate.channel) &&
        !neededTriggerIds.has(plate.id) &&
        !coord.requestedTargets.has(plate.id) &&
        !coord.requestedChannels.has(plate.channel)
      ) {
        continue;
      }

      const plateCenterX = plate.x + plate.w * 0.5;
      const plateBottom = plate.y + plate.h;
      const platePt: Vec2 = { x: plateCenterX, y: plateBottom };

      for (const crate of obs.crates) {
        const isHeldBySelf = obs.self.holdingCrateId === crate.id;
        const alreadyPressingAnotherPlate = obs.plates.some(
          (pl) => pl.id !== plate.id && pl.pressedBy.includes(crate.label)
        );
        if (alreadyPressingAnotherPlate) continue;

        const crateCenterX = crate.x + crate.w * 0.5;
        const crateBottom = crate.y + crate.h;
        const needsUpwardCarry = crateBottom > plateBottom + 24;

        // Avoid pushing a floor crate across a deadly hazard pit on the same tier
        if (!needsUpwardCarry && Math.abs(crateBottom - plateBottom) < 20) {
          const minX = Math.min(crateCenterX, plateCenterX);
          const maxX = Math.max(crateCenterX, plateCenterX);
          const hazardBetween = obs.hazards.some(
            (hz) =>
              Math.abs(hz.y + hz.h - plateBottom) <= 16 &&
              hz.x + hz.w > minX &&
              hz.x < maxX
          );
          if (hazardBetween) continue;
        }

        const pushDir: -1 | 1 = plateCenterX >= crateCenterX ? 1 : -1;
        const rawPushPtX = pushDir === 1 ? crate.x - 16 : crate.x + crate.w + 16;
        const pushBlocked = isPointBlockedByWallOrDoor(rawPushPtX, crateBottom, obs);

        const approachPt: Vec2 =
          pushBlocked || needsUpwardCarry
            ? {
                x: clamp(pushDir === 1 ? crate.x + crate.w + 18 : crate.x - 18, 38, 922),
                y: crateBottom,
              }
            : { x: rawPushPtX, y: crateBottom };

        const p = isHeldBySelf
          ? resolvePathFromTree(obs, pathTree, platePt)
          : resolvePathFromTree(obs, pathTree, approachPt);
        if (!isHeldBySelf && !p.reachable && Math.abs(crate.vy) <= 35) continue;

        // If crate must be carried upward (or grabbed), confirm carry path crate -> plate is actually reachable
        if (needsUpwardCarry && !isHeldBySelf) {
          const carryPath = findPathToPoint(obs, graph, { x: crateCenterX, y: crateBottom }, platePt);
          if (!carryPath.reachable) continue;
        }

        const myDist = Math.hypot(selfPt.x - approachPt.x, selfPt.y - approachPt.y);
        const alreadySelfCrate = memory.lastDecisionIntent.includes(crate.label);
        const teammateShouldHandle =
          !isHeldBySelf &&
          (teammateOwnsClaim(crate.id, myDist, alreadySelfCrate) ||
            obs.teammates.some((t) => {
              if (t.intent?.startsWith('Hold ')) return false;
              const tDist = Math.hypot(t.x + 13 - approachPt.x, t.y + 34 - approachPt.y);
              if (t.targetId === crate.id && tDist < myDist + 60) return true;
              if (
                !t.targetId &&
                !t.claimTargetId &&
                (tDist < myDist - 4 || (Math.abs(tDist - myDist) <= 4 && t.id < obs.self.id))
              ) {
                return true;
              }
              return false;
            }));
        if (teammateShouldHandle) continue;

        const tierPenalty = Math.abs(crateBottom - plateBottom) < 24 ? 0 : needsUpwardCarry ? 160 : 120;
        const requestedBonus =
          coord.requestedTargets.has(plate.id) || coord.requestedChannels.has(plate.channel) ? 180 : 0;
        crateTasks.push({
          crate,
          plate,
          approachPt,
          pushDir,
          useGrabCarry: pushBlocked || needsUpwardCarry || isHeldBySelf,
          path: p,
          score: myDist + tierPenalty - requestedBonus - (isHeldBySelf ? 500 : 0),
        });
      }
    }
    crateTasks.sort((a, b) => a.score - b.score);
    const crateTask = crateTasks[0] ?? null;

    // 2C. Candidate plates for temporary partner holding
    const candidatePlates = obs.plates
      .filter((plate) => {
        if (
          plate.active &&
          !neededChannels.has(plate.channel) &&
          !neededTriggerIds.has(plate.id) &&
          !coord.requestedTargets.has(plate.id) &&
          !coord.requestedChannels.has(plate.channel)
        ) {
          return false;
        }
        const plateBottom = plate.y + plate.h;
        const crateCanDirectlyFill = obs.crates.some(
          (c) =>
            Math.abs(c.y + c.h - plateBottom) <= 20 &&
            Math.abs(c.x + c.w * 0.5 - (plate.x + plate.w * 0.5)) < 190
        );
        return !crateCanDirectlyFill;
      })
      .map((plate) => {
        const pt: Vec2 = { x: plate.x + plate.w * 0.5, y: plate.y + plate.h };
        const p = resolvePathFromTree(obs, pathTree, pt);
        const dist = Math.hypot(selfPt.x - pt.x, selfPt.y - pt.y);
        const alreadySelfPlate = memory.lastDecisionIntent === `Hold ${plate.label}`;
        const heldByTeammate =
          teammateOwnsClaim(plate.id, dist, alreadySelfPlate) ||
          obs.teammates.some(
            (t) =>
              Math.hypot(t.x + 13 - pt.x, t.y + 34 - pt.y) < 34 ||
              (t.targetId === plate.id && Math.hypot(t.x + 13 - pt.x, t.y + 34 - pt.y) < dist)
          );
        const requestedBonus =
          coord.requestedTargets.has(plate.id) || coord.requestedChannels.has(plate.channel) ? 180 : 0;
        return { plate, pt, p, dist, score: p.cost - requestedBonus, heldByTeammate };
      })
      .filter((item) => item.p.reachable)
      .sort((a, b) => a.score - b.score);

    const agentIndex = obs.teammates.filter((t) => t.id < obs.self.id).length;

    const selectCrate = (): boolean => {
      if (!crateTask) return false;
      const { crate, plate } = crateTask;
      const crateCenterX = crate.x + crate.w * 0.5;
      const crateBottom = crate.y + crate.h;
      const plateCenterX = plate.x + plate.w * 0.5;
      const plateBottom = plate.y + plate.h;

      const bridgeAheadNotReady = obs.platforms.some(
        (plat) =>
          plat.kind === 'moving' &&
          !plat.loopWhenActive &&
          Math.abs(crateBottom - (plat.endPos?.y ?? plat.y)) < 16 &&
          plat.x > crate.x &&
          plat.x - (crate.x + crate.w) < 160 &&
          Math.abs(plat.y - crateBottom) > 12
      );

      chosenIntent = `${crateTask.useGrabCarry ? 'Carry' : 'Push'} ${crate.label} -> ${plate.label}`;
      chosenReason = `Weighting CH-${plate.channel} frees teammates`;
      chosenTargetId = crate.id;
      chosenClaimTargetId = crate.id;
      chosenUtility = 0.9;
      collabMsgKind = 'claim';
      collabMsgChannel = plate.channel;
      collabMsgText = `${crateTask.useGrabCarry ? 'Carrying' : 'Pushing'} ${crate.label} to ${plate.label}`;

      if (obs.self.holdingCrateId === crate.id) {
        const dropTarget: Vec2 = { x: plateCenterX, y: plateBottom };
        chosenTargetPos = dropTarget;
        pathResult = crateTask.path;
        if (Math.abs(selfCx - plateCenterX) <= 20 && Math.abs(selfBottom - plateBottom) <= 16) {
          holdingStationaryPlate = true;
          wantsGrab = true;
        }
        return true;
      }

      if (crateTask.useGrabCarry) {
        chosenTargetPos = crateTask.approachPt;
        pathResult = crateTask.path;
        const distToCrate = Math.hypot(selfCx - crateCenterX, selfBottom - crateBottom);
        if (distToCrate <= 42) {
          wantsGrab = true;
        }
        return true;
      }

      const settledOnPlateHoriz =
        Math.abs(crateBottom - plateBottom) < 20 &&
        Math.abs(crateCenterX - plateCenterX) <= 14;

      if (settledOnPlateHoriz || Math.abs(crate.vy) >= 40 || bridgeAheadNotReady) {
        const waitPt: Waypoint = {
          x: clamp(crateTask.approachPt.x, 40, 920),
          y: selfBottom,
          mode: 'walk',
        };
        chosenTargetPos = waitPt;
        pathResult = {
          reachable: true,
          cost: 0,
          nextTarget: waitPt,
          waypoints: [{ ...selfPt, mode: 'walk' }, waitPt],
        };
        if (settledOnPlateHoriz) {
          holdingStationaryPlate = true;
        }
        return true;
      }

      const alignedBehindCrate =
        Math.abs(selfBottom - crateBottom) < 20 &&
        ((crateTask.pushDir === 1 &&
          selfCx < crateCenterX &&
          selfCx > crate.x - 32) ||
          (crateTask.pushDir === -1 &&
            selfCx > crateCenterX &&
            selfCx < crate.x + crate.w + 32));

      if (alignedBehindCrate) {
        pushingCrateMode = true;
        activePushDir = crateTask.pushDir;
        const pushGoal: Waypoint = {
          x: crateCenterX + crateTask.pushDir * 240,
          y: crateBottom,
          mode: 'walk',
        };
        chosenTargetPos = pushGoal;
        pathResult = {
          reachable: true,
          cost: 0,
          nextTarget: pushGoal,
          waypoints: [{ ...selfPt, mode: 'walk' }, pushGoal],
        };
      } else {
        chosenTargetPos = crateTask.approachPt;
        pathResult = crateTask.path;
      }
      return true;
    };

    const selectSwitch = (): boolean => {
      if (reachableSwitches.length === 0) return false;
      const target = reachableSwitches[0];
      chosenIntent = `Activate ${target.sw.label}`;
      chosenReason = `Channel ${target.sw.channel} required to open downstream path`;
      chosenTargetId = target.sw.id;
      chosenClaimTargetId = target.sw.id;
      chosenTargetPos = target.pt;
      chosenUtility = 0.94;
      pathResult = target.p;
      collabMsgKind = 'claim';
      collabMsgChannel = target.sw.channel;
      collabMsgText = `Claiming ${target.sw.label} (CH-${target.sw.channel})`;
      if (target.dist < 38) {
        wantsInteract = true;
      }
      return true;
    };

    const handled =
      obs.teammates.length > 0 && agentIndex === 0
        ? selectCrate() || selectSwitch()
        : selectSwitch() || selectCrate();

    if (!handled) {
      const unheldPlate = candidatePlates.find(
        (item) =>
          !item.heldByTeammate &&
          (neededChannels.has(item.plate.channel) ||
            neededTriggerIds.has(item.plate.id) ||
            coord.requestedTargets.has(item.plate.id) ||
            coord.requestedChannels.has(item.plate.channel))
      );
      const lockedDoor = obs.doors.find((d) => !d.open);

      if (unheldPlate && obs.teammates.length > 0) {
        chosenIntent = `Hold ${unheldPlate.plate.label}`;
        chosenReason = `Keeping ${unheldPlate.plate.label} active so partner can advance`;
        chosenTargetId = unheldPlate.plate.id;
        chosenClaimTargetId = unheldPlate.plate.id;
        chosenTargetPos = unheldPlate.pt;
        chosenUtility = 0.86;
        pathResult = unheldPlate.p;
        collabMsgKind = 'claim';
        collabMsgChannel = unheldPlate.plate.channel;
        collabMsgText = `Heading to hold ${unheldPlate.plate.label} (CH-${unheldPlate.plate.channel})`;
      } else if (lockedDoor) {
        const waitPt: Vec2 = {
          x:
            lockedDoor.x > selfCx
              ? lockedDoor.x - 36
              : lockedDoor.x + lockedDoor.w + 36,
          y: lockedDoor.y + lockedDoor.h,
        };
        const waitPath = resolvePathFromTree(obs, pathTree, waitPt);
        const gateReq = lockedDoor.channels.length
          ? `CH-${lockedDoor.channels.join('+')}`
          : `${lockedDoor.linkedIds?.length ?? 0} linked triggers`;
        chosenIntent = `Stage at ${lockedDoor.label}`;
        chosenReason = `Waiting for ${gateReq} activation`;
        chosenTargetId = lockedDoor.id;
        chosenTargetPos = waitPt;
        chosenUtility = 0.72;
        pathResult = waitPath;
        collabMsgKind = 'request';
        collabMsgChannel = lockedDoor.channels[0];
        collabMsgText = `Blocked at ${lockedDoor.label} — need ${gateReq}`;
      } else if (candidatePlates.length > 0) {
        const p0 = candidatePlates[0];
        chosenIntent = `Move to ${p0.plate.label}`;
        chosenReason = `Activating CH-${p0.plate.channel}`;
        chosenTargetId = p0.plate.id;
        chosenClaimTargetId = p0.plate.id;
        chosenTargetPos = p0.pt;
        chosenUtility = 0.7;
        pathResult = p0.p;
      }
    }
  }

  // Clear or update mid-air jump commitment so we never re-plan backward onto unlanded ledges mid-flight
  if (obs.self.grounded) {
    memory.lockedAirTarget = null;
  } else if (memory.lockedAirTarget) {
    memory.lockedAirTarget.ticks += 1;
    if (memory.lockedAirTarget.ticks > 42 || chosenIntent !== memory.lastDecisionIntent) {
      memory.lockedAirTarget = null;
    }
  }

  // 3. Low-level Waypoint Follower & Jump/Drop Controller
  const wp1 = pathResult.waypoints[1];
  const wp2 = pathResult.waypoints[2];
  let aimPt: Waypoint = wp1 ?? pathResult.nextTarget;
  let shouldJumpFromPlan = false;
  let isWaitingOnMoving = wp1?.mode === 'wait';

  if (!obs.self.grounded && memory.lockedAirTarget) {
    aimPt = { x: memory.lockedAirTarget.x, y: memory.lockedAirTarget.y, mode: 'walk' };
    isWaitingOnMoving = false;
  } else if (wp1 && wp2) {
    if (wp1.mode === 'wait') {
      aimPt = wp1;
      isWaitingOnMoving = true;
    } else if (wp1.mode === 'drop') {
      const passedLip =
        !obs.self.grounded ||
        Math.abs(selfBottom - wp1.y) > 16 ||
        Math.abs(selfCx - wp1.x) < 12;
      aimPt = passedLip ? wp2 : wp1;
    } else if (wp1.mode === 'jump') {
      const goingRight = wp2.x >= wp1.x;
      const inDirectionalZone = goingRight
        ? selfCx >= wp1.x - 6 && selfCx <= wp1.x + 14
        : selfCx <= wp1.x + 6 && selfCx >= wp1.x - 14;
      const atTakeoff = inDirectionalZone && Math.abs(selfBottom - wp1.y) <= 18;
      const alreadyLaunchedTowardLand =
        !obs.self.grounded &&
        ((goingRight && selfCx >= wp1.x - 10 && obs.self.vx >= -10) ||
          (!goingRight && selfCx <= wp1.x + 10 && obs.self.vx <= 10));

      if (atTakeoff && obs.self.grounded) {
        aimPt = wp2;
        shouldJumpFromPlan = true;
        memory.lockedAirTarget = { x: wp2.x, y: wp2.y, ticks: 0 };
      } else if (alreadyLaunchedTowardLand) {
        aimPt = wp2;
      } else {
        aimPt = wp1;
      }
    } else {
      if (Math.abs(selfCx - wp1.x) <= 14 && Math.abs(selfBottom - wp1.y) <= 18) {
        aimPt = wp2;
      }
    }
  }

  // A bot can end up standing on a crate (actors stack). The navigation graph
  // only knows platform tops, so its waypoints assume floor height and the
  // follower flips at the crate lip. Walk off the crate toward the current
  // objective instead of trying to follow a floor-level waypoint while elevated.
  const crateUnderfoot = obs.crates.find(
    (crate) =>
      selfCx >= crate.x - 1 &&
      selfCx <= crate.x + crate.w + 1 &&
      Math.abs(selfBottom - crate.y) <= 3
  );
  let forceJumpFromCrate = false;
  if (crateUnderfoot && !isWaitingOnMoving && !holdingStationaryPlate) {
    // Pick the escape side from the next route waypoint, not the final goal:
    // the route may legitimately go away from the goal before looping back.
    const escapeX =
      wp1 && Math.abs(wp1.x - selfCx) > 8
        ? wp1.x
        : wp2?.x ?? chosenTargetPos.x;
    const stepDir = escapeX >= selfCx ? 1 : -1;
    aimPt = { x: clamp(selfCx + stepDir * 52, 20, 940), y: selfBottom, mode: 'walk' };
    forceJumpFromCrate = true;
  }

  // A bounce-pad launch throws the bot upward away from its planned takeoff.
  // If an updraft is within reach while airborne, steer into it instead of
  // fighting the launch back toward the floor-level waypoint.
  const updraftInReach = obs.forceZones.find(
    (fz) =>
      fz.fy < -350 &&
      selfBottom >= fz.y + 70 &&
      selfBottom <= fz.y + fz.h + 12 &&
      Math.abs(selfCx - (fz.x + fz.w * 0.5)) <= 180
  );
  if (!obs.self.grounded && updraftInReach && !forceJumpFromCrate && chosenIntent !== 'Move to Exit Pad') {
    aimPt = { x: updraftInReach.x + updraftInReach.w * 0.5, y: selfBottom, mode: 'walk' };
  }

  const dx = aimPt.x - selfCx;
  const dy = aimPt.y - selfBottom;

  if (memory.jumpFreezeTicks > 0) {
    memory.jumpFreezeTicks -= 1;
  }

  let move: -1 | 0 | 1 = 0;
  if (holdingStationaryPlate) {
    move = 0;
  } else if (pushingCrateMode && activePushDir) {
    move = activePushDir;
  } else if (isWaitingOnMoving) {
    if (dx > 8) move = 1;
    else if (dx < -8) move = -1;
  } else {
    if (dx > 5) move = 1;
    else if (dx < -5) move = -1;
  }

  if (obs.self.grounded) memory.airHazardDir = 0;

  if (memory.hazardBackoffTicks > 0) {
    memory.hazardBackoffTicks -= 1;
    if (memory.hazardBackoffDir !== 0) move = memory.hazardBackoffDir;
  } else if (!obs.self.grounded && obs.self.vy > 30) {
    // Falling toward a strip: override route steering and lean away. Hold the
    // chosen direction until landing; recomputing it every tick made the input
    // alternate left/right and drift back onto the hazard edge.
    const hazard = fallIntoHazard(obs, obs.self.x, obs.self.y, obs.self.vx, obs.self.vy);
    if (hazard) {
      const hazardCx = hazard.x + hazard.w / 2;
      memory.airHazardDir = hazardCx >= selfCx ? -1 : 1;
    }
    if (memory.airHazardDir !== 0) move = memory.airHazardDir;
  }

  const movedDist = Math.hypot(obs.self.x - memory.lastX, obs.self.y - memory.lastY);
  if (
    move !== 0 &&
    movedDist < 0.45 &&
    !pushingCrateMode &&
    !isWaitingOnMoving &&
    !holdingStationaryPlate
  ) {
    memory.stuckTicks += 1;
  } else {
    memory.stuckTicks = 0;
  }
  memory.lastX = obs.self.x;
  memory.lastY = obs.self.y;

  if (memory.jumpReleaseCooldown > 0) {
    memory.jumpReleaseCooldown -= 1;
  }

  const blockingCrateAhead = obs.crates.find((crate) => {
    if (crate.id === chosenTargetId) return false;
    if (Math.abs(crate.y + crate.h - selfBottom) > 44) return false;
    const inFront =
      (move === 1 && crate.x >= selfCx && crate.x - selfCx <= 36) ||
      (move === -1 && crate.x + crate.w <= selfCx && selfCx - (crate.x + crate.w) <= 36);
    if (!inFront) return false;
    const stackedAbove = obs.crates.some(
      (other) =>
        other.id !== crate.id &&
        other.x < crate.x + crate.w &&
        other.x + other.w > crate.x &&
        Math.abs(other.y + other.h - crate.y) <= 4
    );
    return crate.shape === 'ball' || stackedAbove;
  });

  let jump = false;
  if (obs.self.grounded && memory.jumpReleaseCooldown === 0 && !isWaitingOnMoving && !holdingStationaryPlate) {
    // Bounce pads are solid surfaces with huge restitution. Walking onto one
    // launches the bot away from its route and into a fall loop, so hop over
    // the pad before contact.
    const bouncePadAhead = obs.platforms.some(
      (plat) =>
        plat.material === 'bouncy' &&
        Math.abs(selfBottom - plat.y) <= 18 &&
        ((move === 1 && plat.x > selfCx && plat.x - selfCx <= 34) ||
          (move === -1 && plat.x + plat.w < selfCx && selfCx - (plat.x + plat.w) <= 34))
    );
    const needsStepUp =
      shouldJumpFromPlan && (dy < -10 || Math.abs(dx) > 10);
    const sameSegmentJump =
      pathResult.waypoints.length === 2 && dy < -18 && Math.abs(dx) < 120;
    const isStuck = memory.stuckTicks > 22;

    const hazardInFront = hazardAhead(obs, move);
    const wantsJump =
      forceJumpFromCrate || bouncePadAhead || blockingCrateAhead || needsStepUp || sameSegmentJump || isStuck;
    if (wantsJump) {
      if (jumpHitsHazard(obs, move)) {
        // Neither jump nor keep walking into plasma. Back away from the strip
        // for a few ticks, then let the path planner find another route.
        const hazardBlocking =
          hazardInFront ??
          obs.hazards.find(
            (hz) =>
              hz.y + hz.h >= selfBottom - 4 &&
              hz.y <= selfBottom + 220 &&
              hz.x < selfCx + ACTOR_W + 28 &&
              hz.x + hz.w > selfCx - 28
          ) ??
          null;
        if (hazardBlocking) {
          const hazardCx = hazardBlocking.x + hazardBlocking.w / 2;
          memory.hazardBackoffTicks = 18;
          memory.hazardBackoffDir = hazardCx > selfCx ? -1 : 1;
          move = memory.hazardBackoffDir;
        }
      } else {
        jump = true;
        memory.jumpReleaseCooldown = 2;
        memory.stuckTicks = 0;
        // Jump straight up first when blocked by a body; steering into it during
        // the first few airborne ticks just re-collides and cancels the climb.
        if (isStuck || blockingCrateAhead) memory.jumpFreezeTicks = 14;
      }
    }
    if (memory.jumpFreezeTicks > 0 && !obs.self.grounded) {
      move = 0;
    }
  } else if (!obs.self.grounded && obs.self.vy < -35) {
    jump = true;
  }

  let interact = false;
  if (wantsInteract) {
    memory.interactPulse = !memory.interactPulse;
    interact = memory.interactPulse;
  } else {
    memory.interactPulse = false;
  }

  let grab = false;
  if (wantsGrab) {
    memory.grabPulse = !memory.grabPulse;
    grab = memory.grabPulse;
  } else {
    memory.grabPulse = false;
  }

  memory.lastDecisionIntent = chosenIntent;

  // Emit squad collaboration message only on meaningful state transitions
  let outgoingMessage: string | undefined;
  let outgoingKind: AgentMessageKind | undefined;
  let outgoingChannel: ChannelId | undefined;
  if (collabMsgText) {
    const annKey = `${collabMsgKind ?? 'status'}|${chosenTargetId ?? ''}|${collabMsgText}`;
    if (annKey !== memory.lastAnnouncedKey) {
      memory.lastAnnouncedKey = annKey;
      outgoingMessage = collabMsgText;
      outgoingKind = collabMsgKind;
      outgoingChannel = collabMsgChannel;
    }
  }

  return {
    move,
    jump,
    interact,
    grab,
    intent: chosenIntent,
    reason: chosenReason,
    targetId: chosenTargetId,
    claimTargetId: chosenClaimTargetId,
    targetPos: chosenTargetPos,
    pathPreview: pathResult.waypoints.slice(0, 6).map(({ x, y }) => ({ x, y })),
    utility: Number(chosenUtility.toFixed(2)),
    ...(outgoingMessage
      ? {
          message: outgoingMessage,
          messageKind: outgoingKind,
          messageChannel: outgoingChannel,
        }
      : {}),
  };
}
