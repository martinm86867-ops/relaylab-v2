import type { ActorState, CrateState, Vec2 } from '../engine/types';
import { getActorArchetype } from './ActorAvatar';

export type EmoteKind = 'exit' | 'alert' | 'bounce' | 'strain' | 'spark' | 'curious' | 'content' | 'impatient' | 'stretch';

type IdleStyle = 'tap' | 'sway' | 'scan' | 'stretch';
type IdleFidgetKind = 'tap' | 'sway' | 'scan' | 'stretch';

interface ActorPersonality {
  tempo: number;
  bobAmp: number;
  blinkMin: number;
  blinkMax: number;
  style: IdleStyle;
  fidgetMin: number;
  fidgetMax: number;
  tiltBias: number;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function personalityFor(actor: ActorState): ActorPersonality {
  const archetype = getActorArchetype(actor.role, actor.color);
  const seed = hashString(`${actor.id}|${actor.name}|${actor.role}`);
  const unit = (salt: number) => {
    let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x85ebca6b) >>> 0;
    value ^= value >>> 13;
    return (value >>> 0) / 4294967296;
  };
  const styleRoll = unit(3);
  let style: IdleStyle;
  if (archetype === 'operator') {
    style = styleRoll < 0.55 ? 'sway' : styleRoll < 0.85 ? 'tap' : 'stretch';
  } else if (archetype === 'alpha') {
    style = styleRoll < 0.5 ? 'scan' : styleRoll < 0.8 ? 'tap' : 'stretch';
  } else if (archetype === 'beta') {
    style = styleRoll < 0.5 ? 'sway' : styleRoll < 0.8 ? 'stretch' : 'scan';
  } else {
    style = styleRoll < 0.55 ? 'scan' : styleRoll < 0.85 ? 'sway' : 'tap';
  }
  return {
    tempo: 0.82 + unit(4) * 0.34,
    bobAmp: 0.55 + unit(5) * 0.55,
    blinkMin: 1.9 + unit(6) * 2.2,
    blinkMax: 4.2 + unit(7) * 3.2,
    style,
    fidgetMin: 2.6 + unit(8) * 2.0,
    fidgetMax: 4.6 + unit(9) * 3.0,
    tiltBias: (unit(10) - 0.5) * 0.09,
  };
}

export interface ActorAnimState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  wasGrounded: boolean;
  prevVy: number;
  prevOnExit: boolean;
  prevHoldingId: string | null;
  prevIntent: string | undefined;
  prevRespawnTimer: number;
  walkPhase: number;
  stepDustCooldown: number;
  thrusterCooldown: number;
  leanAngle: number;
  antennaAngle: number;
  antennaVel: number;
  blinkTimer: number;
  isBlinking: boolean;
  scarfNodes: Vec2[];
  trail: Array<{ x: number; y: number; alpha: number }>;
  idleSeconds: number;
  emote: { kind: EmoteKind; ttl: number; maxTtl: number } | null;
  personality: ActorPersonality;
  idleFidget: { kind: IdleFidgetKind; ttl: number; maxTtl: number } | null;
  fidgetTimer: number;
  headTilt: number;
  gazeX: number;
  gazeY: number;
  startleTimer: number;
  pickupTimer: number;
  stackRole: 'top' | 'bottom' | null;
  stackKind: 'deliberate' | 'accidental' | null;
  stackMateId: string | null;
  stackTimer: number;
  stackWobble: number;
  stackOffset: number;
}

export interface ParticleSpawnFn {
  (opts: {
    x: number;
    y: number;
    count: number;
    color: string;
    spreadVx?: number;
    spreadVy?: number;
    baseVx?: number;
    baseVy?: number;
    size?: number;
    life?: number;
    shape?: 'circle' | 'square' | 'spark' | 'ring';
    gravityScale?: number;
  }): void;
}

export function createActorAnimState(actor: ActorState): ActorAnimState {
  const cx = actor.x + actor.w * 0.5;
  const neckY = actor.y + 18;
  return {
    x: actor.x,
    y: actor.y,
    vx: actor.vx,
    vy: actor.vy,
    wasGrounded: actor.grounded,
    prevVy: actor.vy,
    prevOnExit: actor.onExit,
    prevHoldingId: actor.holdingCrateId,
    prevIntent: actor.lastInput.intent,
    prevRespawnTimer: actor.respawnTimer,
    walkPhase: Math.random() * Math.PI * 2,
    stepDustCooldown: 0,
    thrusterCooldown: 0,
    leanAngle: 0,
    antennaAngle: 0,
    antennaVel: 0,
    blinkTimer: 1.5 + Math.random() * 2.8,
    isBlinking: false,
    scarfNodes: [
      { x: cx, y: neckY },
      { x: cx - actor.facing * 5, y: neckY + 2 },
      { x: cx - actor.facing * 10, y: neckY + 4 },
      { x: cx - actor.facing * 14, y: neckY + 6 },
    ],
    trail: [],
    idleSeconds: 0,
    emote: null,
    personality: personalityFor(actor),
    idleFidget: null,
    fidgetTimer: 0.9 + Math.random() * 1.5,
    headTilt: 0,
    gazeX: actor.facing * 0.6,
    gazeY: 0,
    startleTimer: 0,
    pickupTimer: 0,
    stackRole: null,
    stackKind: null,
    stackMateId: null,
    stackTimer: 0,
    stackWobble: 0,
    stackOffset: 0,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function updateActorAnimState(
  anim: ActorAnimState,
  actor: ActorState,
  crates: CrateState[],
  dt: number,
  spawnParticles: ParticleSpawnFn,
  teammates: ActorState[] = [],
  now = 0
): { landedIntensity: number; bounced: boolean; grabbed: boolean; threw: boolean } {
  const dist = Math.hypot(actor.x - anim.x, actor.y - anim.y);
  let teleported = false;
  if (dist > 85) {
    anim.x = actor.x;
    anim.y = actor.y;
    teleported = true;
  } else {
    const lerp = Math.min(1, 26 * dt);
    anim.x += (actor.x - anim.x) * lerp;
    anim.y += (actor.y - anim.y) * lerp;
  }

  const prevVx = anim.vx;
  anim.vx += (actor.vx - anim.vx) * Math.min(1, 22 * dt);
  anim.vy += (actor.vy - anim.vy) * Math.min(1, 22 * dt);

  // Contextual gaze: prefer the held crate, then the agent's deliberate target,
  // then a nearby teammate or loose crate. Fast movement keeps the eyes forward.
  const selfCx = anim.x + actor.w * 0.5;
  const selfCy = anim.y + actor.h * 0.45;
  let gazeTargetX = selfCx + actor.facing * 60;
  let gazeTargetY = selfCy;
  let hasGazeTarget = false;
  if (actor.holdingCrateId) {
    const held = crates.find((crate) => crate.id === actor.holdingCrateId);
    if (held) {
      gazeTargetX = held.x + held.w * 0.5;
      gazeTargetY = held.y + held.h * 0.5;
      hasGazeTarget = true;
    }
  } else if (actor.role === 'agent' && actor.lastInput.targetPos && Math.abs(actor.vx) < 150) {
    gazeTargetX = actor.lastInput.targetPos.x;
    gazeTargetY = actor.lastInput.targetPos.y;
    hasGazeTarget = true;
  } else if (Math.abs(actor.vx) < 120) {
    let bestDist = 210;
    for (const mate of teammates) {
      if (mate.id === actor.id || mate.onExit) continue;
      const dx = mate.x + mate.w * 0.5 - selfCx;
      const dy = mate.y + mate.h * 0.5 - selfCy;
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        gazeTargetX = mate.x + mate.w * 0.5;
        gazeTargetY = mate.y + mate.h * 0.45;
        hasGazeTarget = true;
      }
    }
    if (!hasGazeTarget) {
      bestDist = 150;
      for (const crate of crates) {
        if (crate.id === actor.holdingCrateId) continue;
        const dx = crate.x + crate.w * 0.5 - selfCx;
        const dy = crate.y + crate.h * 0.5 - selfCy;
        const dist = Math.hypot(dx, dy);
        if (dist < bestDist) {
          bestDist = dist;
          gazeTargetX = crate.x + crate.w * 0.5;
          gazeTargetY = crate.y + crate.h * 0.45;
          hasGazeTarget = true;
        }
      }
    }
  }
  if (Math.abs(actor.vx) > 170) {
    gazeTargetX = selfCx + actor.facing * 80;
    gazeTargetY = selfCy;
    hasGazeTarget = true;
  }
  const desiredGazeX = hasGazeTarget ? clamp((gazeTargetX - selfCx) / 72, -1, 1) : actor.facing * 0.55;
  const desiredGazeY = hasGazeTarget ? clamp((gazeTargetY - selfCy) / 52, -1, 1) : 0;
  let stackGazeY = 0;
  if (actor.standingOnActorId) stackGazeY = 0.7;
  else if (actor.supportingActorId) stackGazeY = -0.7;
  const finalGazeY = stackGazeY !== 0 ? stackGazeY : desiredGazeY;
  anim.gazeX += (desiredGazeX - anim.gazeX) * Math.min(1, 7 * dt);
  anim.gazeY += (finalGazeY - anim.gazeY) * Math.min(1, 7 * dt);

  // Stacks are relationships, not just collisions: one actor carries another.
  // The engine tags both participants, including whether the arrival was a
  // deliberate jump or an accidental fall, so both characters react together.
  const stackRole = actor.standingOnActorId ? 'top' : actor.supportingActorId ? 'bottom' : null;
  const stackMateId = actor.standingOnActorId ?? actor.supportingActorId ?? null;
  if (stackRole && (anim.stackRole !== stackRole || anim.stackMateId !== stackMateId)) {
    const impact = Math.abs(anim.prevVy);
    anim.stackRole = stackRole;
    anim.stackMateId = stackMateId;
    anim.stackKind = actor.stackKind ?? 'accidental';
    anim.stackTimer = 0;
    anim.stackWobble = stackRole === 'top'
      ? clamp(impact / 430 + 0.2, 0.3, 1)
      : 0.55;
    anim.idleFidget = null;
    anim.fidgetTimer = Math.max(anim.fidgetTimer, 2.2);
    const contactY = stackRole === 'top' ? actor.y + actor.h : actor.y;
    spawnParticles({
      x: anim.x + actor.w * 0.5,
      y: contactY,
      count: anim.stackKind === 'deliberate' ? 5 : 9,
      color: stackRole === 'top' ? actor.color : '#CBD5E1',
      spreadVx: anim.stackKind === 'deliberate' ? 45 : 95,
      spreadVy: 30,
      size: 2.2,
      shape: 'circle',
      gravityScale: 0.1,
    });
    anim.emote = stackRole === 'top'
      ? { kind: anim.stackKind === 'deliberate' ? 'spark' : 'alert', ttl: 0.9, maxTtl: 0.9 }
      : { kind: anim.stackKind === 'deliberate' ? 'content' : 'strain', ttl: 0.9, maxTtl: 0.9 };
    if (anim.stackKind === 'accidental') anim.startleTimer = 0.45;
    anim.antennaVel += (Math.random() > 0.5 ? 1 : -1) * (anim.stackKind === 'accidental' ? 5 : 2.2);
  } else if (stackRole) {
    anim.stackTimer += dt;
    anim.stackWobble = Math.max(0, anim.stackWobble - dt * 1.35);
    const mate = teammates.find((m) => m.id === stackMateId);
    if (mate) {
      anim.stackOffset =
        actor.x + actor.w * 0.5 - (mate.x + mate.w * 0.5);
    }
  } else if (anim.stackRole) {
    anim.stackRole = null;
    anim.stackKind = null;
    anim.stackMateId = null;
    anim.stackTimer = 0;
    anim.stackWobble = 0;
  }

  let landedIntensity = 0;
  let bounced = false;
  let grabbed = false;
  let threw = false;

  const footX = anim.x + actor.w * 0.5;
  const footY = anim.y + actor.h;

  // Jump / Bounce / Landing particle feedback
  if (anim.wasGrounded && !actor.grounded && actor.vy < -140) {
    const isBounce = actor.vy < -590;
    bounced = isBounce;
    spawnParticles({
      x: footX,
      y: footY,
      count: isBounce ? 11 : 6,
      color: isBounce ? '#34D399' : actor.color,
      spreadVx: isBounce ? 120 : 75,
      spreadVy: isBounce ? 140 : 65,
      size: isBounce ? 3.5 : 2.6,
      shape: isBounce ? 'spark' : 'circle',
      gravityScale: 0.25,
    });
    spawnParticles({
      x: footX,
      y: footY - 2,
      count: 1,
      color: isBounce ? '#34D399' : actor.color,
      spreadVx: 0,
      spreadVy: 0,
      baseVy: 0,
      size: isBounce ? 16 : 11,
      life: 0.24,
      shape: 'ring',
      gravityScale: 0,
    });
    if (isBounce) {
      anim.emote = { kind: 'bounce', ttl: 0.75, maxTtl: 0.75 };
      anim.antennaVel -= actor.facing * 9;
    }
  } else if (!anim.wasGrounded && actor.grounded) {
    const impact = Math.abs(anim.prevVy);
    if (impact > 110) {
      landedIntensity = clamp((impact - 110) / 650, 0.1, 1);
      const dustColor =
        actor.groundedMaterial === 'ice'
          ? '#A5F3FC'
          : actor.groundedMaterial === 'conveyor'
            ? '#FCD34D'
            : '#CBD5E1';
      spawnParticles({
        x: footX,
        y: footY,
        count: Math.round(4 + landedIntensity * 7),
        color: dustColor,
        spreadVx: 70 + landedIntensity * 85,
        spreadVy: 35 + landedIntensity * 50,
        size: 2.2 + landedIntensity * 1.5,
        shape: 'circle',
        gravityScale: 0.2,
      });
      anim.antennaVel += (Math.random() > 0.5 ? 1 : -1) * (5 + landedIntensity * 10);
      if (landedIntensity > 0.5) anim.startleTimer = 0.4;
    }
  }

  // Respawn teleport shimmer
  if (actor.respawnTimer > anim.prevRespawnTimer + 0.1 || (teleported && actor.respawnTimer > 0)) {
    spawnParticles({
      x: anim.x + actor.w * 0.5,
      y: anim.y + actor.h * 0.5,
      count: 14,
      color: '#F43F5E',
      spreadVx: 130,
      spreadVy: 130,
      size: 3,
      shape: 'spark',
      gravityScale: 0.1,
    });
    anim.emote = { kind: 'spark', ttl: 0.85, maxTtl: 0.85 };
  }
  anim.prevRespawnTimer = actor.respawnTimer;

  // Grab / throw detection
  if (!anim.prevHoldingId && actor.holdingCrateId) {
    grabbed = true;
    anim.pickupTimer = 0.34;
    spawnParticles({
      x: anim.x + actor.w * 0.5 + actor.facing * 12,
      y: anim.y + 4,
      count: 6,
      color: '#7DD3FC',
      spreadVx: 60,
      spreadVy: 60,
      size: 2.5,
      shape: 'spark',
      gravityScale: 0.05,
    });
  } else if (anim.prevHoldingId && !actor.holdingCrateId) {
    threw = true;
  }
  anim.prevHoldingId = actor.holdingCrateId;

  // Exit celebration emote
  if (!anim.prevOnExit && actor.onExit) {
    anim.emote = { kind: 'exit', ttl: 1.2, maxTtl: 1.2 };
    spawnParticles({
      x: anim.x + actor.w * 0.5,
      y: anim.y + 6,
      count: 9,
      color: '#34D399',
      spreadVx: 85,
      spreadVy: 110,
      size: 3,
      shape: 'spark',
      gravityScale: 0.15,
    });
  }
  anim.prevOnExit = actor.onExit;

  // Intent change ping for autonomous agents
  if (actor.role === 'agent' && actor.lastInput.intent && actor.lastInput.intent !== anim.prevIntent) {
    if (!anim.emote && actor.lastInput.intent !== 'Human Idle') {
      anim.emote = { kind: 'alert', ttl: 0.65, maxTtl: 0.65 };
    }
    anim.antennaVel -= actor.facing * 4.5;
  }
  anim.prevIntent = actor.lastInput.intent;

  // Walk cycle & footstep dust
  const speedX = Math.abs(actor.vx);
  if (actor.grounded && speedX > 18) {
    anim.walkPhase += (speedX / 28) * dt;
    anim.stepDustCooldown -= dt;
    if (anim.stepDustCooldown <= 0) {
      anim.stepDustCooldown = clamp(0.24 - speedX * 0.00045, 0.1, 0.22);
      const stepColor =
        actor.groundedMaterial === 'ice'
          ? 'rgba(165, 243, 252, 0.75)'
          : actor.groundedMaterial === 'conveyor'
            ? 'rgba(251, 191, 36, 0.7)'
            : 'rgba(148, 163, 184, 0.55)';
      spawnParticles({
        x: footX - actor.facing * 4,
        y: footY - 1,
        count: 2,
        color: stepColor,
        baseVx: -actor.vx * 0.18,
        baseVy: -22,
        spreadVx: 24,
        spreadVy: 16,
        size: 2.3,
        life: 0.24,
        shape: 'circle',
        gravityScale: 0.05,
      });
    }
  } else if (actor.grounded) {
    // Gently settle walk phase toward neutral stance
    anim.walkPhase += (Math.round(anim.walkPhase / Math.PI) * Math.PI - anim.walkPhase) * Math.min(1, 12 * dt);
  }

  // Aero-bot thruster micro-sparks when airborne and rising
  const archetype = getActorArchetype(actor.role, actor.color);
  if (archetype === 'beta' && !actor.grounded && actor.vy < -40) {
    anim.thrusterCooldown -= dt;
    if (anim.thrusterCooldown <= 0) {
      anim.thrusterCooldown = 0.055;
      spawnParticles({
        x: anim.x + actor.w * 0.5 - actor.facing * 7,
        y: anim.y + actor.h - 10,
        count: 1,
        color: '#34D399',
        baseVx: -actor.facing * 35,
        baseVy: 55,
        spreadVx: 18,
        spreadVy: 18,
        size: 2.4,
        life: 0.2,
        shape: 'spark',
        gravityScale: 0.05,
      });
    }
  }

  // Velocity lean angle
  const targetLean = actor.grounded
    ? clamp(actor.vx * 0.00045, -0.11, 0.11)
    : clamp(actor.vx * 0.00055, -0.16, 0.16);
  anim.leanAngle += (targetLean - anim.leanAngle) * Math.min(1, 16 * dt);

  // Secondary spring motion for antenna / ear fins
  const accelX = (anim.vx - prevVx) / Math.max(0.001, dt);
  const targetAntenna = clamp(-actor.vx * 0.0015 - accelX * 0.00018, -0.55, 0.55);
  const springForce = (targetAntenna - anim.antennaAngle) * 140;
  const dampingForce = -anim.antennaVel * 9.5;
  anim.antennaVel += (springForce + dampingForce) * dt;
  anim.antennaAngle = clamp(anim.antennaAngle + anim.antennaVel * dt, -0.75, 0.75);

  // Scarf / Ribbon chain physics (anchored at neck/back)
  const anchorX = anim.x + actor.w * 0.5 - actor.facing * 6;
  const anchorY = anim.y + 18;
  anim.scarfNodes[0].x = anchorX;
  anim.scarfNodes[0].y = anchorY;
  const segLen = 5.2;
  for (let i = 1; i < anim.scarfNodes.length; i++) {
    const prev = anim.scarfNodes[i - 1];
    const curr = anim.scarfNodes[i];
    // Wind + trailing drag + gentle gravity droop
    curr.x += (-actor.vx * 0.028 - actor.facing * 18) * dt;
    curr.y += (32 - actor.vy * 0.015) * dt;
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const d = Math.hypot(dx, dy) || 0.001;
    if (d > segLen) {
      curr.x = prev.x + (dx / d) * segLen;
      curr.y = prev.y + (dy / d) * segLen;
    }
  }

  // Natural blinking
  anim.blinkTimer -= dt;
  if (anim.isBlinking) {
    if (anim.blinkTimer <= 0) {
      anim.isBlinking = false;
      anim.blinkTimer = anim.personality.blinkMin + Math.random() * (anim.personality.blinkMax - anim.personality.blinkMin);
    }
  } else if (anim.blinkTimer <= 0) {
    anim.isBlinking = true;
    anim.blinkTimer = 0.11;
  }

  // Heavy pushing strain check
  const pushingCrate = isActorPushingCrate(actor, crates);
  if (pushingCrate && Math.random() < 0.06) {
    spawnParticles({
      x: anim.x + actor.w * 0.5 + actor.facing * (actor.w * 0.5 + 2),
      y: anim.y + actor.h - 4,
      count: 1,
      color: '#FDE68A',
      baseVx: -actor.facing * 25,
      baseVy: -40,
      spreadVx: 20,
      spreadVy: 20,
      size: 2,
      life: 0.22,
      shape: 'spark',
      gravityScale: 0.4,
    });
  }

  // High-speed motion afterimage trail
  const speedMag = Math.hypot(actor.vx, actor.vy);
  for (let i = anim.trail.length - 1; i >= 0; i--) {
    anim.trail[i].alpha -= dt * 5.2;
    if (anim.trail[i].alpha <= 0) anim.trail.splice(i, 1);
  }
  if (speedMag > 390 && !teleported) {
    const last = anim.trail[0];
    if (!last || Math.hypot(anim.x - last.x, anim.y - last.y) > 9) {
      anim.trail.unshift({ x: anim.x, y: anim.y, alpha: 0.34 });
      if (anim.trail.length > 4) anim.trail.pop();
    }
  }

  // Idle timer and personality fidgets
  const isIdle =
    actor.grounded &&
    Math.abs(actor.vx) < 12 &&
    !actor.holdingCrateId &&
    !actor.onExit &&
    !actor.standingOnActorId &&
    !actor.supportingActorId;
  if (isIdle) {
    anim.idleSeconds += dt;
    anim.fidgetTimer -= dt;
    if (anim.fidgetTimer <= 0 && !anim.idleFidget && !anim.emote) {
      const style = anim.personality.style;
      const roll = Math.random();
      const kind: IdleFidgetKind =
        roll < 0.72
          ? style
          : (['tap', 'sway', 'scan', 'stretch'] as const)[Math.floor(Math.random() * 4)];
      const ttl = kind === 'stretch' ? 1.8 : kind === 'scan' ? 1.9 : 1.4;
      anim.idleFidget = { kind, ttl, maxTtl: ttl };
      if (!anim.emote) {
        const emoteKind: EmoteKind =
          kind === 'scan' ? 'curious' : kind === 'sway' ? 'content' : kind === 'tap' ? 'impatient' : 'stretch';
        anim.emote = { kind: emoteKind, ttl: 1.4, maxTtl: 1.4 };
      }
      anim.fidgetTimer =
        anim.personality.fidgetMin + Math.random() * (anim.personality.fidgetMax - anim.personality.fidgetMin);
      anim.antennaVel += (Math.random() > 0.5 ? 1 : -1) * (kind === 'stretch' ? 3.4 : 2.1);
    }
  } else {
    anim.idleSeconds = 0;
    anim.idleFidget = null;
    anim.fidgetTimer = Math.max(anim.fidgetTimer, 1.4);
  }

  if (anim.idleFidget) {
    anim.idleFidget.ttl -= dt;
    if (anim.idleFidget.ttl <= 0) anim.idleFidget = null;
  }

  // Personality head tilt: a slow resting bias, a tilt into a fidget, and a
  // small recoil after a heavy landing. Kept separate from leanAngle.
  let targetHeadTilt = anim.personality.tiltBias + Math.sin(now * 0.0014 + actor.spawnIndex * 1.9) * 0.012;
  if (anim.idleFidget?.kind === 'sway') {
    targetHeadTilt += Math.sin(now * 0.0045 + actor.spawnIndex) * 0.075;
  } else if (anim.idleFidget?.kind === 'scan') {
    targetHeadTilt += Math.sin(now * 0.006 + actor.spawnIndex) * 0.12;
  } else if (anim.idleFidget?.kind === 'stretch') {
    targetHeadTilt += Math.sin((1 - anim.idleFidget.ttl / anim.idleFidget.maxTtl) * Math.PI) * 0.08;
  } else if (isIdle && Math.abs(actor.vx) < 40) {
    // Lean the head a little toward whatever the eyes are attending to.
    targetHeadTilt += anim.gazeX * 0.035;
  }
  if (isActorPushingCrate(actor, crates) || actor.holdingCrateId) targetHeadTilt = 0;
  if (anim.stackRole === 'top') targetHeadTilt += actor.facing * 0.045;
  else if (anim.stackRole === 'bottom') targetHeadTilt -= actor.facing * 0.06;
  if (anim.startleTimer > 0) targetHeadTilt -= actor.facing * 0.09;
  anim.headTilt += (targetHeadTilt - anim.headTilt) * Math.min(1, 9 * dt);
  anim.startleTimer = Math.max(0, anim.startleTimer - dt);

  if (anim.emote) {
    anim.emote.ttl -= dt;
    if (anim.emote.ttl <= 0) anim.emote = null;
  }

  anim.wasGrounded = actor.grounded;
  anim.prevVy = actor.vy;
  anim.pickupTimer = Math.max(0, anim.pickupTimer - dt);

  return { landedIntensity, bounced, grabbed, threw };
}

function isActorPushingCrate(actor: ActorState, crates: CrateState[]): boolean {
  if (actor.lastInput.move === 0 || actor.holdingCrateId) return false;
  for (const c of crates) {
    const verticalOverlap = actor.y + actor.h > c.y + 4 && actor.y < c.y + c.h - 4;
    if (!verticalOverlap) continue;
    if (actor.lastInput.move > 0 && Math.abs(actor.x + actor.w - c.x) <= 6) return true;
    if (actor.lastInput.move < 0 && Math.abs(actor.x - (c.x + c.w)) <= 6) return true;
  }
  return false;
}

export function drawActorCharacter(
  ctx: CanvasRenderingContext2D,
  actor: ActorState,
  anim: ActorAnimState,
  crates: CrateState[],
  now: number,
  showPlans: boolean
): void {
  const archetype = getActorArchetype(actor.role, actor.color);
  const cx = anim.x + actor.w * 0.5;
  const bottomY = anim.y + actor.h;
  const speedX = Math.abs(actor.vx);
  const isMoving = actor.grounded && speedX > 18;
  const isHolding = Boolean(actor.holdingCrateId);
  const isPushing = isActorPushingCrate(actor, crates);
  const isAirborne = !actor.grounded;
  const fidget = anim.idleFidget;
  const fidgetProgress = fidget ? 1 - fidget.ttl / fidget.maxTtl : 0;
  const fidgetEnvelope = fidget ? Math.sin(Math.PI * clamp(fidgetProgress, 0, 1)) : 0;
  const fidgetKind = fidget?.kind ?? null;
  const stackTop = anim.stackRole === 'top';
  const stackBottom = anim.stackRole === 'bottom';
  const stackWobble = anim.stackWobble;
  const stackBrace = stackBottom ? Math.max(0, 1 - anim.stackTimer / 0.55) : 0;
  const stackBalance = stackTop ? clamp(stackWobble * 1.15 + (anim.stackKind === 'deliberate' ? 0.25 : 0), 0, 1) : 0;
  const stackBracePose = stackBottom ? clamp(1 - anim.stackTimer / 1.1, 0, 1) : 0;
  const isTap = fidgetKind === 'tap';
  const isSway = fidgetKind === 'sway';
  const isStretch = fidgetKind === 'stretch';
  const isScan = fidgetKind === 'scan';

  const heldCrate = isHolding ? crates.find((c) => c.id === actor.holdingCrateId) : undefined;
  const pickupProgress = isHolding ? clamp(1 - anim.pickupTimer / 0.34, 0, 1) : 1;
  const carryLift = pickupProgress * pickupProgress * (3 - 2 * pickupProgress);

  // Draw Operator's trailing scarf (in world space behind the body)
  if (archetype === 'operator') {
    ctx.save();
    if (actor.respawnTimer > 0) {
      ctx.globalAlpha = Math.sin(now * 0.04) > 0 ? 0.9 : 0.3;
    }
    ctx.strokeStyle = '#0EA5E9';
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(anim.scarfNodes[0].x, anim.scarfNodes[0].y);
    for (let i = 1; i < anim.scarfNodes.length; i++) {
      ctx.lineTo(anim.scarfNodes[i].x, anim.scarfNodes[i].y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#BAE6FD';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  // High-speed afterimage echoes
  if (anim.trail.length > 0) {
    ctx.save();
    for (const ghost of anim.trail) {
      ctx.globalAlpha = ghost.alpha;
      ctx.fillStyle = actor.color;
      ctx.beginPath();
      ctx.roundRect(ghost.x + 2, ghost.y + 4, actor.w - 4, actor.h - 8, 6);
      ctx.fill();
    }
    ctx.restore();
  }

  // Ground contact shadow + subtle human player spotlight ring
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  const shadowScale = actor.grounded ? 1 : 0.72;
  ctx.beginPath();
  ctx.ellipse(cx, bottomY, actor.w * 0.46 * shadowScale, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (actor.role === 'human' && actor.grounded) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(cx, bottomY + 0.5, actor.w * 0.58, 3.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  if (stackTop) {
    // Pressure line at the contact point: green for a chosen stack, amber for
    // a stumble. It also anchors the rider to the carrier's helmet.
    ctx.save();
    ctx.strokeStyle = anim.stackKind === 'deliberate' ? 'rgba(52, 211, 153, 0.62)' : 'rgba(251, 191, 36, 0.62)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx - 7.5, bottomY + 0.6);
    ctx.lineTo(cx + 7.5, bottomY + 0.6);
    ctx.stroke();
    ctx.fillStyle = anim.stackKind === 'deliberate' ? 'rgba(52, 211, 153, 0.22)' : 'rgba(251, 191, 36, 0.22)';
    ctx.beginPath();
    ctx.ellipse(cx, bottomY + 0.6, 10, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Main articulated body transform
  ctx.save();
  ctx.translate(cx, bottomY);
  const stackLean = stackTop ? Math.sin(now * 0.032 + actor.spawnIndex) * 0.045 * stackWobble : 0;
  ctx.rotate(anim.leanAngle + stackLean);
  ctx.scale(
    actor.squashX * (1 + 0.025 * stackBrace),
    actor.squashY * (1 - 0.055 * stackBrace)
  );
  const weightShift = !isMoving && !isAirborne
    ? Math.sin(now * 0.0011 * anim.personality.tempo + actor.spawnIndex * 1.3) * 0.55 * anim.personality.bobAmp
    : 0;
  const stackSway = stackTop
    ? Math.sin(now * 0.03 + actor.spawnIndex * 1.7) *
      (1.4 + Math.min(4, Math.abs(anim.stackOffset) * 0.12)) *
      stackWobble
    : 0;
  const swayX =
    (isSway ? Math.sin(now * 0.0045 + actor.spawnIndex) * 2.2 * fidgetEnvelope : 0) +
    weightShift +
    stackSway;
  ctx.translate(swayX, 0);

  if (actor.respawnTimer > 0) {
    ctx.globalAlpha = Math.sin(now * 0.04) > 0 ? 1 : 0.32;
  }

  const idleBob = !isMoving && !isAirborne
    ? Math.sin(now * 0.005 * anim.personality.tempo + actor.spawnIndex * 1.7) * 0.8 * anim.personality.bobAmp
    : 0;
  const runBounce = isMoving ? Math.abs(Math.sin(anim.walkPhase)) * -1.8 : 0;
  const stretch = isStretch
    ? fidgetEnvelope
    : actor.onExit && !isHolding
      ? 0.5 + 0.18 * Math.sin(now * 0.006)
      : 0;
  const stretchLift = -2.2 * stretch;
  const exitHop = actor.onExit && actor.grounded ? -Math.abs(Math.sin(now * 0.006 + actor.spawnIndex)) * 1.2 : 0;
  const pickupDip = isHolding ? -Math.sin(pickupProgress * Math.PI) * 1.4 : 0;
  const stackDip = stackBottom
    ? -Math.sin(clamp(anim.stackTimer / 0.45, 0, 1) * Math.PI) * 1.3
    : 0;
  const bodyOffsetY = idleBob + runBounce + stretchLift + exitHop + pickupDip + stackDip;
  const tapLift = isTap ? Math.max(0, Math.sin(fidgetProgress * Math.PI * 4)) * 2.6 * fidgetEnvelope : 0;

  const stride = isMoving ? Math.sin(anim.walkPhase) : 0;
  const liftL = isMoving ? Math.max(0, Math.cos(anim.walkPhase)) * 3.5 : 0;
  const liftR = isMoving ? Math.max(0, -Math.cos(anim.walkPhase)) * 3.5 : 0;

  // --- 1. Back Arm (behind torso, at front/far shoulder) ---
  drawArm(
    ctx,
    actor.facing * 9,
    -13 + bodyOffsetY,
    actor.facing,
    stride,
    isHolding,
    isPushing,
    isAirborne,
    actor.vy,
    actor.color,
    true,
    stretch,
    carryLift,
    stackBalance,
    stackBracePose
  );

  // --- 2. Articulated Legs & Boots ---
  const legSpread = isAirborne ? (actor.vy < 0 ? 3.5 : 5.5) : 4.8;
  const leftFootX = -legSpread + stride * 5.2;
  const rightFootX = legSpread - stride * 5.2;
  const airTuckL = isAirborne ? (actor.vy < 0 ? -3.5 : -1) : -liftL;
  const airTuckR = isAirborne ? (actor.vy < 0 ? -1.5 : -2.5) : -liftR;

  drawFoot(ctx, leftFootX - swayX, airTuckL, actor.facing, archetype, actor.color, true);
  drawFoot(ctx, rightFootX - swayX, airTuckR - tapLift, actor.facing, archetype, actor.color, false);

  // --- 3. Torso & Head Silhouette ---
  const bodyTop = -actor.h + 4 + bodyOffsetY;
  const bodyH = actor.h - 8;
  const bodyW = actor.w;

  // Soft outer aura when at exit (radial gradient, zero heavy shadowBlur)
  if (actor.onExit) {
    ctx.save();
    const exitAura = ctx.createRadialGradient(0, bodyTop + bodyH * 0.5, 4, 0, bodyTop + bodyH * 0.5, bodyW * 0.95);
    exitAura.addColorStop(0, 'rgba(16, 185, 129, 0.34)');
    exitAura.addColorStop(1, 'rgba(16, 185, 129, 0)');
    ctx.fillStyle = exitAura;
    ctx.beginPath();
    ctx.arc(0, bodyTop + bodyH * 0.5, bodyW * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Compact archetype back pack / thruster nozzle behind torso
  if (archetype === 'operator') {
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.roundRect(-actor.facing * (bodyW * 0.5 + 2.5) - 2, bodyTop + 11, 4.5, 11, 1.5);
    ctx.fill();
    ctx.strokeStyle = '#0B1120';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  } else if (archetype === 'beta') {
    ctx.fillStyle = '#064E3B';
    ctx.beginPath();
    ctx.roundRect(-actor.facing * (bodyW * 0.5 + 1.5) - 2.5, bodyTop + 13, 5, 9, 2);
    ctx.fill();
    ctx.strokeStyle = '#0B1120';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

  // Secondary Headgear (behind or atop chassis)
  drawHeadgear(ctx, archetype, bodyTop, actor.facing, anim.antennaAngle, anim.headTilt, actor.color, actor.onExit, now);

  // Main Chassis with directional sculptural shading
  const defineChassisPath = () => {
    ctx.beginPath();
    if (archetype === 'beta') {
      ctx.roundRect(-bodyW * 0.5, bodyTop, bodyW, bodyH, [11, 11, 5, 5]);
    } else if (archetype === 'alpha') {
      ctx.roundRect(-bodyW * 0.5 - 0.5, bodyTop, bodyW + 1, bodyH, 4.5);
    } else {
      ctx.roundRect(-bodyW * 0.5, bodyTop, bodyW, bodyH, 6);
    }
  };

  ctx.fillStyle = actor.color;
  defineChassisPath();
  ctx.fill();

  // Subtle vertical shading overlay so silhouette reads crisply at 2x scale
  const bodyShade = ctx.createLinearGradient(0, bodyTop, 0, bodyTop + bodyH);
  bodyShade.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
  bodyShade.addColorStop(0.38, 'rgba(255, 255, 255, 0.0)');
  bodyShade.addColorStop(1, 'rgba(8, 12, 22, 0.34)');
  ctx.fillStyle = bodyShade;
  defineChassisPath();
  ctx.fill();

  // Subtle top highlight bevel for 3D tactile depth
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.beginPath();
  ctx.roundRect(-bodyW * 0.5 + 3, bodyTop + 1.5, bodyW - 6, 3.2, 1.6);
  ctx.fill();

  // Horizontal chassis collar seam
  ctx.strokeStyle = 'rgba(11, 17, 32, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.5 + 2, bodyTop + 16.5);
  ctx.lineTo(bodyW * 0.5 - 2, bodyTop + 16.5);
  ctx.stroke();

  // Crisp dark outline
  ctx.strokeStyle = '#0B1120';
  ctx.lineWidth = 1.6;
  defineChassisPath();
  ctx.stroke();

  // Chest Core / Suit Trim
  drawChestDetail(ctx, archetype, bodyTop + bodyH - 8, actor.facing, actor.color, actor.onExit, isPushing || isHolding, now);

  // --- 4. Expressive Faceplate & Eyes (subtle head tilt + contextual gaze) ---
  ctx.save();
  const headPivotY = bodyTop + 10;
  ctx.translate(0, headPivotY);
  ctx.rotate(anim.headTilt);
  ctx.translate(0, -headPivotY);
  let lookOffsetX = actor.facing * 3.6 + clamp(actor.vx * 0.008, -1.5, 1.5) + anim.gazeX * 2.4;
  if (actor.role === 'agent' && actor.lastInput.targetPos && Math.abs(actor.vx) < 25) {
    lookOffsetX += clamp((actor.lastInput.targetPos.x - cx) * 0.02, -2.2, 2.2);
  } else if (anim.idleSeconds > 1.2) {
    lookOffsetX += Math.sin(now * 0.0016 + actor.spawnIndex * 2.1) * 1.6;
  }
  if (isScan) lookOffsetX += Math.sin(now * 0.009 + actor.spawnIndex) * 2.3 * fidgetEnvelope;
  const eyeShiftY = clamp(actor.vy * 0.003, -1.2, 1.4) + anim.gazeY * 1.1;
  const visorX = -9.5 + lookOffsetX * 0.42;
  const visorY = bodyTop + 5;
  const visorW = 19;
  const visorH = 10;
  const visorR = archetype === 'beta' ? 4.5 : 3;

  // Visor recess with deep indigo gradient
  const visorGrad = ctx.createLinearGradient(visorX, visorY, visorX, visorY + visorH);
  visorGrad.addColorStop(0, '#070B12');
  visorGrad.addColorStop(1, '#121B2B');
  ctx.fillStyle = visorGrad;
  ctx.beginPath();
  ctx.roundRect(visorX, visorY, visorW, visorH, visorR);
  ctx.fill();

  drawEyes(
    ctx,
    archetype,
    visorX + visorW * 0.5 + lookOffsetX * 0.42,
    visorY + visorH * 0.5 + eyeShiftY,
    actor.color,
    {
      isBlinking: anim.isBlinking,
      isHappy:
        actor.onExit ||
        (stackTop && anim.stackKind === 'deliberate' && anim.stackTimer > 0.18 && anim.stackTimer < 1.25),
      isRespawning: actor.respawnTimer > 0,
      isStraining: isPushing || isHolding || (stackBottom && anim.stackKind === 'accidental' && anim.stackTimer < 0.8),
      isStartled:
        (isAirborne && Math.abs(actor.vy) > 380) ||
        anim.startleTimer > 0 ||
        (stackTop && anim.stackKind === 'accidental' && anim.stackTimer < 0.75),
      facing: actor.facing,
      gazeX: anim.gazeX,
      gazeY: anim.gazeY,
      fidgetKind,
    }
  );

  // Subtle diagonal glass glare across visor corner
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(visorX, visorY, visorW, visorH, visorR);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.beginPath();
  ctx.moveTo(visorX + 2, visorY);
  ctx.lineTo(visorX + 7.5, visorY);
  ctx.lineTo(visorX + 3.5, visorY + visorH);
  ctx.lineTo(visorX - 1, visorY + visorH);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.roundRect(visorX, visorY, visorW, visorH, visorR);
  ctx.stroke();
  ctx.restore();

  // --- 5. Front Arm (foreground, anchored at back shoulder below visor) ---
  drawArm(
    ctx,
    isPushing ? actor.facing * 10 : -actor.facing * 5,
    -13 + bodyOffsetY,
    actor.facing,
    -stride,
    isHolding,
    isPushing,
    isAirborne,
    actor.vy,
    actor.color,
    false,
    stretch,
    carryLift,
    stackBalance,
    stackBracePose
  );

  ctx.restore();

  // --- 6. Minimal Floating Markers & Optional Agent Plans ---
  ctx.save();
  ctx.textAlign = 'center';
  const carryClearance = heldCrate ? heldCrate.h + 6 : 0;

  // Micro Emote Bubble
  if (anim.emote) {
    const p = 1 - anim.emote.ttl / anim.emote.maxTtl;
    const floatY = anim.y - 20 - p * 10;
    const alpha = p < 0.2 ? p / 0.2 : p > 0.75 ? (1 - p) / 0.25 : 1;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    const emoteMeta = getEmoteVisual(anim.emote.kind, actor.color);
    ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = emoteMeta.color;
    ctx.fillText(emoteMeta.text, cx + 15, floatY);
    ctx.globalAlpha = 1;
  }

  if (actor.role === 'human') {
    if (actor.holdingCrateId) {
      // Compact [Q] throw keycap above held crate
      const ky = anim.y - (heldCrate?.h ?? 0) - 12;
      ctx.fillStyle = '#0B1018';
      ctx.beginPath();
      ctx.roundRect(cx - 8, ky - 7, 16, 15, 3.5);
      ctx.fill();
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.roundRect(cx - 7.5, ky - 7, 15, 13, 3);
      ctx.fill();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.fillStyle = '#E0F2FE';
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.fillText('Q', cx, ky + 2.5);
    } else {
      // Crisp downward player indicator chevron
      const bob = Math.sin(now * 0.005) * 1.4;
      const py = anim.y - 12 + bob;
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.moveTo(cx - 4, py - 4);
      ctx.lineTo(cx + 4, py - 4);
      ctx.lineTo(cx, py + 1);
      ctx.closePath();
      ctx.fill();
    }
  } else if (showPlans) {
    // Clean unboxed agent callsign + lightweight intent readout when Plans are enabled
    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(11, 16, 24, 0.75)';
    ctx.fillText(actor.label, cx + 1, anim.y - 9 - carryClearance);
    ctx.fillStyle = actor.color;
    ctx.fillText(actor.label, cx, anim.y - 10 - carryClearance);

    if (actor.lastInput.intent) {
      const tag = actor.lastInput.intent;
      const isWaiting = /wait|hold|yield/i.test(tag);
      ctx.font = '500 9px "Plus Jakarta Sans", sans-serif';
      const metrics = ctx.measureText(tag);
      const padW = Math.min(148, metrics.width + 12);
      ctx.fillStyle = 'rgba(11, 16, 24, 0.78)';
      ctx.beginPath();
      ctx.roundRect(cx - padW * 0.5, anim.y - 36 - carryClearance, padW, 14, 4);
      ctx.fill();
      ctx.strokeStyle = isWaiting ? 'rgba(245, 158, 11, 0.42)' : 'rgba(148, 163, 184, 0.24)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(tag, cx, anim.y - 26 - carryClearance, 140);
    }
  }
  ctx.restore();
}

function getEmoteVisual(kind: EmoteKind, actorColor: string): { text: string; color: string } {
  switch (kind) {
    case 'exit':
      return { text: '✓', color: '#34D399' };
    case 'bounce':
      return { text: '▲', color: '#6EE7B7' };
    case 'strain':
      return { text: '⚡', color: '#FDE68A' };
    case 'spark':
      return { text: '✦', color: '#FB7185' };
    case 'curious':
      return { text: '?', color: '#FDE68A' };
    case 'content':
      return { text: '♪', color: '#A5F3FC' };
    case 'impatient':
      return { text: '…', color: actorColor };
    case 'stretch':
      return { text: '✦', color: '#F8FAFC' };
    default:
      return { text: '!', color: actorColor };
  }
}

function drawFoot(
  ctx: CanvasRenderingContext2D,
  x: number,
  yOffset: number,
  facing: 1 | -1,
  archetype: ReturnType<typeof getActorArchetype>,
  color: string,
  isBack: boolean
): void {
  ctx.save();
  ctx.translate(x, -3 + yOffset);
  if (archetype === 'alpha') {
    // Sturdy rover tread shoe
    ctx.fillStyle = isBack ? '#1E293B' : '#334155';
    ctx.beginPath();
    ctx.roundRect(-4.5, -2.5, 9, 5.5, 2);
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(facing > 0 ? 1.5 : -4.5, -1, 3, 2);
  } else {
    // Sleek articulated boot
    ctx.fillStyle = isBack ? '#0F172A' : '#1E293B';
    ctx.beginPath();
    ctx.roundRect(-3.8, -2, 7.6, 5, 2.2);
    ctx.fill();
    ctx.fillStyle = isBack ? '#475569' : color;
    ctx.fillRect(facing > 0 ? 1 : -3.5, -1.5, 2.8, 2.2);
  }
  ctx.restore();
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  shoulderX: number,
  shoulderY: number,
  facing: 1 | -1,
  swing: number,
  isHolding: boolean,
  isPushing: boolean,
  isAirborne: boolean,
  vy: number,
  color: string,
  isBack: boolean,
  stretch = 0,
  carryLift = 1,
  balance = 0,
  brace = 0
): void {
  ctx.save();
  ctx.translate(shoulderX, shoulderY);
  let handX = swing * 4.5;
  let handY = 6.5;
  let elbowX: number | null = null;
  let elbowY: number | null = null;

  if (isHolding) {
    // Reach from the shoulder to the underside of the overhead crate. During the
    // first third of a second the hands start low and rise, so the pick reads as a lift.
    const lift = clamp(carryLift, 0, 1);
    const eased = lift * lift * (3 - 2 * lift);
    if (isBack) {
      elbowX = facing * 4;
      elbowY = -8 + (1 - eased) * 5;
      handX = -facing * 19;
      handY = 2 - 29 * eased;
    } else {
      elbowX = -facing * 5;
      elbowY = -9 + (1 - eased) * 5;
      handX = facing * 15;
      handY = 2 - 29 * eased;
    }
  } else if (isPushing) {
    handX = facing * 7.5;
    handY = -1;
  } else if (isAirborne) {
    if (isBack) {
      handX = facing * 6;
      handY = vy < 0 ? -5 : -2;
    } else {
      handX = -facing * 5.5;
      handY = vy < 0 ? -4 : -7;
    }
  } else if (stretch > 0) {
    // A lazy stretch: both arms reach up past the shoulders and slightly outward.
    handX = facing * (isBack ? 6.8 : -5.6) + (isBack ? 1 : -1) * stretch * 1.4;
    handY = -14 - stretch * 6.5;
    elbowX = handX * 0.45;
    elbowY = -9 - stretch * 4.2;
  } else if (balance > 0.01) {
    // Tightrope balance: the arms fan out sideways while the rider settles.
    const outward = 10.5 + balance * 4.5;
    handX = (isBack ? -1 : 1) * facing * outward;
    handY = -4 - balance * 2.5;
    elbowX = handX * 0.48;
    elbowY = -1.5;
  } else if (brace > 0.01) {
    // The carrier widens its stance with low, outward hands.
    handX = (isBack ? -1 : 1) * facing * (8.5 + brace * 2.2);
    handY = 1.5 + brace * 2.2;
    elbowX = handX * 0.5;
    elbowY = 0.5;
  }

  ctx.strokeStyle = isBack ? '#1E293B' : '#0F172A';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  if (elbowX !== null && elbowY !== null) {
    ctx.lineTo(elbowX, elbowY);
  }
  ctx.lineTo(handX, handY);
  ctx.stroke();

  ctx.strokeStyle = isBack ? '#475569' : color;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Glove / gripper tip
  ctx.fillStyle = isBack ? '#64748B' : '#F8FAFC';
  ctx.beginPath();
  ctx.arc(handX, handY, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHeadgear(
  ctx: CanvasRenderingContext2D,
  archetype: ReturnType<typeof getActorArchetype>,
  bodyTop: number,
  facing: 1 | -1,
  antennaAngle: number,
  headTilt: number,
  color: string,
  onExit: boolean,
  now: number
): void {
  ctx.save();
  ctx.translate(0, bodyTop);
  ctx.rotate(headTilt);

  if (archetype === 'operator') {
    // Field engineer helmet crest + headlamp nub
    ctx.fillStyle = '#E0F2FE';
    ctx.beginPath();
    ctx.roundRect(-7, -4.5, 14, 5, [3, 3, 1, 1]);
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Little headlamp lens
    ctx.fillStyle = onExit ? '#34D399' : '#BAE6FD';
    ctx.beginPath();
    ctx.arc(facing * 4.5, -2.2, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (archetype === 'alpha') {
    // Springy twin-coil antenna
    ctx.rotate(antennaAngle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.lineTo(-2, -3);
    ctx.lineTo(2, -6);
    ctx.lineTo(0, -10);
    ctx.stroke();
    const glow = onExit ? '#34D399' : 0.7 + 0.3 * Math.sin(now * 0.01) > 0.85 ? '#FEF3C7' : '#FDE68A';
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -10.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (archetype === 'beta') {
    // Dual swept aero-fins that flex with velocity
    ctx.save();
    ctx.translate(-8, 3);
    ctx.rotate(-0.25 + antennaAngle * 0.7);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-5, -8);
    ctx.lineTo(3, -3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(8, 3);
    ctx.rotate(0.25 + antennaAngle * 0.7);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, -8);
    ctx.lineTo(-3, -3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  } else if (archetype === 'gamma') {
    // Dual sensor ears
    ctx.rotate(antennaAngle * 0.6);
    for (const sx of [-6, 6]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sx, 1);
      ctx.lineTo(sx * 1.15, -6);
      ctx.stroke();
      ctx.fillStyle = '#FCE7F3';
      ctx.beginPath();
      ctx.arc(sx * 1.15, -7, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Prism crest
    ctx.rotate(antennaAngle * 0.5);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(5, 1);
    ctx.lineTo(-5, 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.restore();
}

function drawChestDetail(
  ctx: CanvasRenderingContext2D,
  archetype: ReturnType<typeof getActorArchetype>,
  y: number,
  facing: 1 | -1,
  color: string,
  onExit: boolean,
  activeEffort: boolean,
  now: number
): void {
  const pulse = 0.65 + 0.35 * Math.sin(now * 0.008);
  const coreColor = onExit ? '#34D399' : activeEffort ? '#FDE68A' : '#F8FAFC';

  if (archetype === 'operator') {
    // Utility belt / buckle
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-11, y - 1, 22, 3.2);
    ctx.fillStyle = coreColor;
    ctx.fillRect(facing * 2 - 2, y - 1, 4, 3.2);
  } else if (archetype === 'alpha') {
    // Chest telemetry core bar
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.roundRect(-6, y - 2, 12, 4.5, 2);
    ctx.fill();
    ctx.fillStyle = coreColor;
    ctx.globalAlpha = pulse;
    ctx.fillRect(-4, y - 0.8, 8, 2);
    ctx.globalAlpha = 1;
  } else {
    // Circular chest node
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(facing * 2, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = onExit ? '#34D399' : color;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(facing * 2, y, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  archetype: ReturnType<typeof getActorArchetype>,
  cx: number,
  cy: number,
  color: string,
  state: {
    isBlinking: boolean;
    isHappy: boolean;
    isRespawning: boolean;
    isStraining: boolean;
    isStartled: boolean;
    facing: 1 | -1;
    gazeX: number;
    gazeY: number;
    fidgetKind?: IdleFidgetKind | null;
  }
): void {
  const eyeColor =
    archetype === 'operator'
      ? '#F8FAFC'
      : archetype === 'alpha'
        ? '#FDE68A'
        : archetype === 'beta'
          ? '#A7F3D0'
          : '#F8FAFC';

  ctx.save();
  ctx.strokeStyle = eyeColor;
  ctx.fillStyle = eyeColor;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  const gx = state.gazeX * 1.25;
  const gy = state.gazeY * 0.75;

  if (state.isRespawning) {
    // Dizzy X X eyes
    for (const ox of [-4, 4]) {
      ctx.beginPath();
      ctx.moveTo(cx + ox + gx - 1.8, cy + gy - 1.8);
      ctx.lineTo(cx + ox + gx + 1.8, cy + gy + 1.8);
      ctx.moveTo(cx + ox + gx + 1.8, cy + gy - 1.8);
      ctx.lineTo(cx + ox + gx - 1.8, cy + gy + 1.8);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (state.isHappy) {
    // Happy ^ ^ crescent eyes
    for (const ox of [-4.2, 4.2]) {
      ctx.beginPath();
      ctx.arc(cx + ox + gx, cy + 1.2 + gy, 2.6, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (state.isBlinking) {
    ctx.beginPath();
    ctx.moveTo(cx - 6.2 + gx, cy + gy * 0.4);
    ctx.lineTo(cx - 2 + gx, cy + gy * 0.4);
    ctx.moveTo(cx + 2 + gx, cy + gy * 0.4);
    ctx.lineTo(cx + 6.2 + gx, cy + gy * 0.4);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (archetype === 'beta') {
    // Sleek panoramic cyclops eye with animated pupil
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(cx - 6.5, cy - 2.2, 13, 4.4, 2.2);
    ctx.fill();
    ctx.fillStyle = '#ECFEFF';
    ctx.beginPath();
    ctx.arc(cx + state.facing * 2.2 + state.gazeX * 2, cy + gy, state.isStartled ? 2 : 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (state.isStraining) {
    // Focused > < determined eyes
    ctx.beginPath();
    ctx.moveTo(cx - 5.5 + gx, cy + gy - 1.8);
    ctx.lineTo(cx - 2.5 + gx, cy + gy);
    ctx.lineTo(cx - 5.5 + gx, cy + gy + 1.8);
    ctx.moveTo(cx + 5.5 + gx, cy + gy - 1.8);
    ctx.lineTo(cx + 2.5 + gx, cy + gy);
    ctx.lineTo(cx + 5.5 + gx, cy + gy + 1.8);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (state.isStartled) {
    // Wide surprised O O eyes
    for (const ox of [-4, 4]) {
      ctx.beginPath();
      ctx.arc(cx + ox + gx, cy + gy, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  if (state.fidgetKind) {
    // Small idle expressions: curious, content, impatient, mid-stretch.
    if (state.fidgetKind === 'scan') {
      for (const [ox, radius] of [[-4.2, 2.3], [4.2, 2.0]] as const) {
        ctx.beginPath();
        ctx.arc(cx + ox + gx, cy + gy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + ox + gx + 0.7, cy + gy + 0.4, 0.75, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (state.fidgetKind === 'sway') {
      for (const ox of [-4.2, 4.2]) {
        ctx.beginPath();
        ctx.arc(cx + ox + gx, cy + 1.1 + gy, 2.5, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      }
    } else if (state.fidgetKind === 'tap') {
      // Half-lidded, mildly impatient: one flat eye, one round eye.
      ctx.beginPath();
      ctx.moveTo(cx - 6.2 + gx, cy + gy);
      ctx.lineTo(cx - 2.1 + gx, cy + gy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 3.9 + gx, cy + gy, 1.9, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Closed-eye stretch.
      for (const ox of [-4.2, 4.2]) {
        ctx.beginPath();
        ctx.arc(cx + ox + gx, cy + 1.2 + gy, 2.2, Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
    }
    ctx.restore();
    return;
  }

  // Default expressive crisp eyes
  for (const ox of [-4, 4]) {
    ctx.beginPath();
    ctx.roundRect(cx + ox + gx - 1.8, cy + gy - 2.4, 3.6, 4.8, 1.2);
    ctx.fill();
  }
  ctx.restore();
}
