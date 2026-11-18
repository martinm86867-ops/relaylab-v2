import { DEFAULT_PHYSICS_CONFIG, PHYSICS_PRESETS } from './levels';
import type {
  ActorInput,
  ActorRole,
  ActorState,
  AgentMessage,
  AgentMessageKind,
  AgentObservation,
  ChannelId,
  CrateState,
  DoorState,
  DynamicBodyMaterial,
  DynamicBodyShape,
  EditableEntityPatch,
  ForceZoneDef,
  LevelDefinition,
  PhysicsConfig,
  PlatformMaterial,
  PlatformState,
  PlateState,
  Rect,
  SandboxAction,
  SwitchState,
  TelemetryEvent,
  WorldState,
} from './types';

export const FIXED_DT = 1 / 60;
export const GRAVITY = 1450;
export const MAX_FALL_SPEED = 980;
export const RUN_SPEED = 230;
export const GROUND_ACCEL = 2200;
export const AIR_ACCEL = 1500;
export const GROUND_FRICTION = 2000;
export const AIR_DRAG = 400;
export const JUMP_SPEED = 520;
export const COYOTE_TIME = 0.1;
export const JUMP_BUFFER = 0.12;
export const CRATE_PUSH_SPEED = 140;
export const ACTOR_W = 26;
export const ACTOR_H = 34;

const ACTOR_PALETTE = [
  '#38BDF8', // Sky cyan (Human default)
  '#F59E0B', // Warm amber (Agent 1)
  '#10B981', // Emerald (Agent 2)
  '#F472B6', // Rose (Agent 3)
  '#A78BFA', // Violet (Extra)
];

const MATERIAL_DEFAULTS: Record<
  DynamicBodyMaterial,
  { mass: number; restitution: number; friction: number }
> = {
  wood: { mass: 1.2, restitution: 0.12, friction: 0.92 },
  steel: { mass: 2.8, restitution: 0.08, friction: 1.15 },
  polymer: { mass: 0.65, restitution: 0.28, friction: 0.62 },
  rubber: { mass: 0.8, restitution: 0.74, friction: 0.32 },
};

let eventSeq = 0;
let sandboxSeq = 0;
let messageSeq = 0;

function makeEvent(
  tick: number,
  type: TelemetryEvent['type'],
  message: string,
  actorId?: string,
  entityId?: string
): TelemetryEvent {
  eventSeq += 1;
  return {
    id: `ev-${tick}-${eventSeq}`,
    tick,
    timestamp: Date.now(),
    type,
    actorId,
    entityId,
    message,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function approach(val: number, target: number, maxDelta: number): number {
  if (val < target) return Math.min(target, val + maxDelta);
  if (val > target) return Math.max(target, val - maxDelta);
  return target;
}

function createCrateState(c: LevelDefinition['crates'][number]): CrateState {
  const mat: DynamicBodyMaterial = c.material ?? 'wood';
  const shape: DynamicBodyShape = c.shape ?? 'box';
  const defaults = MATERIAL_DEFAULTS[mat];
  return {
    ...c,
    shape,
    material: mat,
    mass: c.mass ?? defaults.mass,
    restitution: c.restitution ?? defaults.restitution,
    friction: c.friction ?? defaults.friction,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVel: 0,
    grounded: false,
    spawnX: c.x,
    spawnY: c.y,
  };
}

export function createActor(
  level: LevelDefinition,
  index: number,
  opts: { id?: string; name: string; role: ActorRole; connected?: boolean }
): ActorState {
  const spawn = level.spawns[index % level.spawns.length] ?? { x: 64, y: 430 };
  const color =
    opts.role === 'human'
      ? ACTOR_PALETTE[0]
      : ACTOR_PALETTE[1 + (index % (ACTOR_PALETTE.length - 1))];
  const label = opts.role === 'human' ? 'P1' : `A${index + 1}`;
  return {
    id: opts.id ?? `${opts.role}-${index + 1}`,
    name: opts.name,
    role: opts.role,
    label,
    color,
    x: spawn.x,
    y: spawn.y,
    w: ACTOR_W,
    h: ACTOR_H,
    vx: 0,
    vy: 0,
    mass: DEFAULT_PHYSICS_CONFIG.actorMass,
    grounded: false,
    groundedMaterial: 'standard',
    coyoteTimer: 0,
    jumpBufferTimer: 0,
    prevJumpHeld: false,
    prevInteractHeld: false,
    prevGrabHeld: false,
    holdingCrateId: null,
    facing: 1,
    onExit: false,
    respawnTimer: 0,
    spawnIndex: index,
    lastInput: { move: 0, jump: false, interact: false },
    lastDecisionAt: Date.now(),
    connected: opts.connected ?? true,
    latencyMs: 0,
    actionCount: 0,
    decisionsCount: 0,
    squashX: 1,
    squashY: 1,
    knockbackVx: 0,
    knockbackTimer: 0,
    lastJumpTick: 0,
    standingOnActorId: null,
    supportingActorId: null,
    stackKind: null,
  };
}

export function createWorld(
  level: LevelDefinition,
  initialActors: Array<{ id?: string; name: string; role: ActorRole; connected?: boolean }> = [],
  physicsOverride?: Partial<PhysicsConfig>
): WorldState {
  const platforms: PlatformState[] = level.platforms.map((p) => ({
    ...p,
    material: p.material ?? 'standard',
    progress: 0,
    direction: 1,
    vx: 0,
    vy: 0,
    compression: 0,
  }));

  const plates: PlateState[] = level.plates.map((p) => ({
    ...p,
    active: false,
    pressedBy: [],
  }));

  const switches: SwitchState[] = level.switches.map((s) => ({
    ...s,
    active: Boolean(s.initialActive),
    cooldown: 0,
  }));

  const doors: DoorState[] = level.doors.map((d) => ({
    ...d,
    channels: [...d.channels],
    linkedIds: d.linkedIds ? [...d.linkedIds] : [],
    open: false,
    openProgress: 0,
  }));

  const crates: CrateState[] = level.crates.map((c) => createCrateState(c));

  const channels: Record<ChannelId, boolean> = { A: false, B: false, C: false };
  for (const s of switches) {
    if (s.active) channels[s.channel] = true;
  }

  const physics: PhysicsConfig = {
    ...DEFAULT_PHYSICS_CONFIG,
    ...physicsOverride,
  };

  const actors = initialActors.map((a, idx) => {
    const actor = createActor(level, idx, a);
    actor.mass = physics.actorMass;
    return actor;
  });

  const world: WorldState = {
    levelId: level.id,
    levelIndex: level.index,
    levelName: level.name,
    levelSubtitle: level.subtitle,
    levelHint: level.hint,
    isSandbox: Boolean(level.isSandbox),
    width: level.width,
    height: level.height,
    tick: 0,
    paused: false,
    timeScale: 1,
    solved: false,
    solvedAtTick: null,
    solvedAtSeconds: null,
    physics,
    channels,
    actors,
    platforms,
    plates,
    switches,
    doors,
    crates,
    hazards: level.hazards.map((h) => ({ ...h })),
    forceZones: (level.forceZones ?? []).map((f) => ({ ...f })),
    recentImpulses: [],
    exit: {
      ...level.exit,
      requiredChannels: [...level.exit.requiredChannels],
      linkedIds: level.exit.linkedIds ? [...level.exit.linkedIds] : [],
      logic: level.exit.logic ?? 'ALL',
    },
    messages: [],
    events: [makeEvent(0, 'level:loaded', `Loaded ${level.name}`)],
    metrics: {
      totalTicks: 0,
      elapsedSeconds: 0,
      tickComputeMs: 0,
      decisionsLogged: 0,
      plateActivations: 0,
      switchToggles: 0,
      respawns: 0,
      actorsAtExit: 0,
      totalActors: actors.length,
      totalKineticEnergy: 0,
      collisionCount: 0,
    },
  };

  return world;
}

/**
 * Resets dynamic simulation state (tick, actors, crates, switches, plates, gates)
 * while preserving user-edited platforms, force zones, hazards, props, and wiring.
 */
export function softResetWorld(world: WorldState, level: LevelDefinition): void {
  world.tick = 0;
  world.solved = false;
  world.solvedAtTick = null;
  world.solvedAtSeconds = null;
  world.recentImpulses = [];
  world.messages = [];

  for (const plat of world.platforms) {
    plat.progress = 0;
    plat.direction = 1;
    plat.vx = 0;
    plat.vy = 0;
    plat.compression = 0;
    if (plat.kind === 'moving' && plat.startPos) {
      plat.x = plat.startPos.x;
      plat.y = plat.startPos.y;
    }
  }

  for (const plate of world.plates) {
    plate.active = false;
    plate.pressedBy = [];
  }

  for (const sw of world.switches) {
    sw.active = Boolean(sw.initialActive);
    sw.cooldown = 0;
  }

  for (const door of world.doors) {
    door.open = false;
    door.openProgress = 0;
  }

  for (const crate of world.crates) {
    crate.x = crate.spawnX;
    crate.y = crate.spawnY;
    crate.vx = 0;
    crate.vy = 0;
    crate.angle = 0;
    crate.angularVel = 0;
    crate.grounded = false;
  }

  const spawns = level.spawns;
  world.actors.forEach((actor, idx) => {
    const sp = spawns[idx % spawns.length] ?? { x: 64 + idx * 44, y: 440 };
    actor.spawnIndex = idx;
    actor.x = sp.x;
    actor.y = sp.y;
    actor.vx = 0;
    actor.vy = 0;
    actor.grounded = false;
    actor.holdingCrateId = null;
    actor.onExit = false;
    actor.respawnTimer = 0;
    actor.decisionsCount = 0;
    actor.actionCount = 0;
    actor.lastInput = { move: 0, jump: false, interact: false };
    actor.prevJumpHeld = false;
    actor.prevInteractHeld = false;
    actor.prevGrabHeld = false;
  });

  const nextChannels: Record<ChannelId, boolean> = { A: false, B: false, C: false };
  for (const sw of world.switches) {
    if (sw.active) nextChannels[sw.channel] = true;
  }
  world.channels = nextChannels;

  world.metrics = {
    totalTicks: 0,
    elapsedSeconds: 0,
    tickComputeMs: 0,
    decisionsLogged: 0,
    plateActivations: 0,
    switchToggles: 0,
    respawns: 0,
    actorsAtExit: 0,
    totalActors: world.actors.length,
    totalKineticEnergy: 0,
    collisionCount: 0,
  };
  syncWorldLogicState(world, true);
  world.events = [makeEvent(0, 'level:loaded', `Restarted ${world.levelName}`)];
}

export function addActorToWorld(
  world: WorldState,
  level: LevelDefinition,
  opts: { id?: string; name: string; role: ActorRole; connected?: boolean }
): ActorState {
  const existing = opts.id ? world.actors.find((a) => a.id === opts.id) : undefined;
  if (existing) {
    existing.connected = true;
    return existing;
  }
  const idx = world.actors.length;
  const actor = createActor(level, idx, opts);
  actor.mass = world.physics.actorMass;
  if (actor.role === 'human') {
    const humanCount = world.actors.filter((a) => a.role === 'human').length + 1;
    actor.label = `P${humanCount}`;
  } else {
    const agentCount = world.actors.filter((a) => a.role === 'agent').length + 1;
    actor.label = `A${agentCount}`;
    actor.color = ACTOR_PALETTE[1 + ((agentCount - 1) % (ACTOR_PALETTE.length - 1))];
  }
  world.actors.push(actor);
  world.metrics.totalActors = world.actors.length;
  pushWorldEvent(
    world,
    makeEvent(world.tick, 'actor:joined', `${actor.name} (${actor.label}) joined as ${actor.role}`, actor.id)
  );
  return actor;
}

export function removeActorFromWorld(world: WorldState, actorId: string): boolean {
  const idx = world.actors.findIndex((a) => a.id === actorId);
  if (idx === -1) return false;
  const [removed] = world.actors.splice(idx, 1);
  world.metrics.totalActors = world.actors.length;
  pushWorldEvent(
    world,
    makeEvent(world.tick, 'actor:left', `${removed.name} (${removed.label}) disconnected`, removed.id)
  );
  return true;
}

function pushWorldEvent(world: WorldState, ev: TelemetryEvent): void {
  world.events.push(ev);
  if (world.events.length > 80) {
    world.events.splice(0, world.events.length - 80);
  }
}

export function recordAgentMessage(
  world: WorldState,
  actorId: string,
  text: string,
  opts?: {
    kind?: AgentMessageKind;
    targetId?: string;
    channel?: ChannelId;
  },
  outEvents?: TelemetryEvent[]
): AgentMessage | null {
  const actor = world.actors.find((a) => a.id === actorId);
  if (!actor) return null;
  const cleanText = text.trim().replace(/\s+/g, ' ').slice(0, 220);
  if (!cleanText) return null;

  const kind: AgentMessageKind = opts?.kind ?? 'status';
  const targetId = opts?.targetId;

  // Deduplicate identical messages from the same actor within 120 ticks (~2s)
  for (let i = world.messages.length - 1; i >= 0; i--) {
    const prev = world.messages[i];
    if (prev.actorId === actorId) {
      if (
        prev.text === cleanText &&
        prev.kind === kind &&
        prev.targetId === targetId &&
        world.tick - prev.tick < 120
      ) {
        return null;
      }
      break;
    }
  }

  messageSeq += 1;
  const msg: AgentMessage = {
    id: `msg-${world.tick}-${messageSeq}`,
    tick: world.tick,
    timestamp: Date.now(),
    actorId: actor.id,
    actorLabel: actor.label,
    actorName: actor.name,
    actorColor: actor.color,
    text: cleanText,
    kind,
    targetId,
    channel: opts?.channel,
  };
  world.messages.push(msg);
  if (world.messages.length > 24) {
    world.messages.splice(0, world.messages.length - 24);
  }

  actor.lastInput = {
    ...actor.lastInput,
    message: cleanText,
    messageKind: kind,
    messageChannel: opts?.channel,
    ...(kind === 'claim' && targetId ? { claimTargetId: targetId } : {}),
  };

  const ev = makeEvent(
    world.tick,
    'agent:message',
    `${actor.label} [${kind}]: ${cleanText}`,
    actor.id,
    targetId
  );
  pushWorldEvent(world, ev);
  if (outEvents) outEvents.push(ev);
  return msg;
}

export function updateWorldPhysics(
  world: WorldState,
  patch: Partial<PhysicsConfig>,
  presetName?: string
): void {
  if (typeof patch.gravity === 'number' && Number.isFinite(patch.gravity)) {
    world.physics.gravity = clamp(patch.gravity, 0, 3200);
  }
  if (typeof patch.airDrag === 'number' && Number.isFinite(patch.airDrag)) {
    world.physics.airDrag = clamp(patch.airDrag, 0, 3.0);
  }
  if (typeof patch.surfaceFriction === 'number' && Number.isFinite(patch.surfaceFriction)) {
    world.physics.surfaceFriction = clamp(patch.surfaceFriction, 0.05, 2.5);
  }
  if (typeof patch.restitution === 'number' && Number.isFinite(patch.restitution)) {
    world.physics.restitution = clamp(patch.restitution, 0, 0.95);
  }
  if (typeof patch.pushForce === 'number' && Number.isFinite(patch.pushForce)) {
    world.physics.pushForce = clamp(patch.pushForce, 0.25, 3.0);
  }
  if (typeof patch.actorMass === 'number' && Number.isFinite(patch.actorMass)) {
    world.physics.actorMass = clamp(patch.actorMass, 0.3, 4.0);
    for (const a of world.actors) {
      a.mass = world.physics.actorMass;
    }
  }
  const msg = presetName
    ? `Physics preset "${presetName}" applied (g=${Math.round(world.physics.gravity)}, e=${world.physics.restitution.toFixed(2)})`
    : `Physics updated (g=${Math.round(world.physics.gravity)}, e=${world.physics.restitution.toFixed(2)}, μ=${world.physics.surfaceFriction.toFixed(2)})`;
  pushWorldEvent(world, makeEvent(world.tick, 'physics:updated', msg));
}

export function applyPhysicsPreset(world: WorldState, presetKey: string): boolean {
  const preset = PHYSICS_PRESETS[presetKey as keyof typeof PHYSICS_PRESETS];
  if (!preset) return false;
  updateWorldPhysics(
    world,
    {
      gravity: preset.gravity,
      airDrag: preset.airDrag,
      surfaceFriction: preset.surfaceFriction,
      restitution: preset.restitution,
      pushForce: preset.pushForce,
      actorMass: preset.actorMass,
    },
    preset.label
  );
  return true;
}

const PROTECTED_ENTITY_IDS = new Set([
  'floor-main',
  'wall-left',
  'wall-right',
  'ceil-top',
]);

export function applySandboxAction(
  world: WorldState,
  level: LevelDefinition,
  action: SandboxAction
): { ok: boolean; entityId?: string; message: string } {
  sandboxSeq += 1;

  if (action.action === 'spawn') {
    const id = `sb-${action.kind}-${sandboxSeq}`;
    const x = clamp(Math.round(action.x), 26, world.width - 60);
    const y = clamp(Math.round(action.y), 26, world.height - 64);
    const ch: ChannelId = action.channel ?? 'A';

    switch (action.kind) {
      case 'crate_wood':
      case 'crate_steel':
      case 'crate_polymer':
      case 'ball_rubber': {
        const mat: DynamicBodyMaterial =
          action.kind === 'crate_steel'
            ? 'steel'
            : action.kind === 'crate_polymer'
              ? 'polymer'
              : action.kind === 'ball_rubber'
                ? 'rubber'
                : 'wood';
        const shape: DynamicBodyShape = action.kind === 'ball_rubber' ? 'ball' : 'box';
        const size = mat === 'steel' ? 32 : mat === 'polymer' ? 26 : 30;
        const count = world.crates.length + 1;
        const label =
          shape === 'ball'
            ? `Ball ${count}`
            : mat === 'steel'
              ? `Steel ${count}`
              : mat === 'polymer'
                ? `Poly ${count}`
                : `Wood ${count}`;
        const crate = createCrateState({
          id,
          label,
          x: clamp(x - size * 0.5, 26, world.width - 26 - size),
          y: clamp(y - size * 0.5, 26, world.height - 48 - size),
          w: size,
          h: size,
          shape,
          material: mat,
          sandboxPlaced: true,
        });
        if (typeof action.vx === 'number') crate.vx = action.vx;
        if (typeof action.vy === 'number') crate.vy = action.vy;
        world.crates.push(crate);
        pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Spawned ${label} (${mat})`, undefined, id));
        return { ok: true, entityId: id, message: `Spawned ${label}` };
      }

      case 'platform_solid':
      case 'platform_ice':
      case 'platform_bouncy':
      case 'platform_conveyor': {
        const w = clamp(action.w ?? (action.kind === 'platform_bouncy' ? 88 : 132), 48, 320);
        const h = action.kind === 'platform_bouncy' ? 14 : 18;
        const material: PlatformMaterial =
          action.kind === 'platform_ice'
            ? 'ice'
            : action.kind === 'platform_bouncy'
              ? 'bouncy'
              : action.kind === 'platform_conveyor'
                ? 'conveyor'
                : 'standard';
        const plat: PlatformState = {
          id,
          x: clamp(x - w * 0.5, 24, world.width - 24 - w),
          y: clamp(y - h * 0.5, 28, world.height - 48 - h),
          w,
          h,
          kind: 'solid',
          material,
          bounceVelocity: material === 'bouncy' ? 700 : undefined,
          conveyorSpeed: material === 'conveyor' ? 120 : undefined,
          sandboxPlaced: true,
          progress: 0,
          direction: 1,
          vx: 0,
          vy: 0,
          compression: 0,
        };
        world.platforms.push(plat);
        pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Placed ${material} platform`, undefined, id));
        return { ok: true, entityId: id, message: `Placed ${material} platform` };
      }

      case 'plate': {
        const w = 68;
        const h = 12;
        const plate: PlateState = {
          id,
          label: `Plate ${ch}`,
          x: clamp(x - w * 0.5, 28, world.width - 28 - w),
          y: clamp(y - h * 0.5, 40, world.height - 48 - h),
          w,
          h,
          channel: ch,
          mode: 'momentary',
          active: false,
          pressedBy: [],
          sandboxPlaced: true,
        };
        world.plates.push(plate);
        pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Placed ${plate.label} (CH-${ch})`, undefined, id));
        return { ok: true, entityId: id, message: `Placed ${plate.label}` };
      }

      case 'switch': {
        const w = 28;
        const h = 36;
        const sw: SwitchState = {
          id,
          label: `Switch ${ch}`,
          x: clamp(x - w * 0.5, 28, world.width - 28 - w),
          y: clamp(y - h * 0.5, 36, world.height - 48 - h),
          w,
          h,
          channel: ch,
          active: false,
          cooldown: 0,
          sandboxPlaced: true,
        };
        world.switches.push(sw);
        pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Placed ${sw.label} (CH-${ch})`, undefined, id));
        return { ok: true, entityId: id, message: `Placed ${sw.label}` };
      }

      case 'door': {
        const w = 22;
        const h = action.h ?? 108;
        const door: DoorState = {
          id,
          label: `Gate ${ch}`,
          x: clamp(x - w * 0.5, 28, world.width - 28 - w),
          y: clamp(y - h * 0.5, 28, world.height - 48 - h),
          w,
          h,
          channels: [ch],
          logic: 'ALL',
          open: false,
          openProgress: 0,
          sandboxPlaced: true,
        };
        world.doors.push(door);
        pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Placed ${door.label} (CH-${ch})`, undefined, id));
        return { ok: true, entityId: id, message: `Placed ${door.label}` };
      }

      case 'hazard': {
        const w = action.w ?? 64;
        const h = 10;
        world.hazards.push({
          id,
          x: clamp(x - w * 0.5, 28, world.width - 28 - w),
          y: clamp(y - h * 0.5, 36, world.height - 48 - h),
          w,
          h,
          kind: 'plasma',
          sandboxPlaced: true,
        });
        pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Placed plasma hazard`, undefined, id));
        return { ok: true, entityId: id, message: 'Placed plasma hazard' };
      }

      case 'force_updraft':
      case 'force_wind': {
        const isUpdraft = action.kind === 'force_updraft';
        const w = isUpdraft ? 84 : 160;
        const h = isUpdraft ? 210 : 88;
        const fz: ForceZoneDef = {
          id,
          label: isUpdraft ? 'Updraft' : 'Crosswind',
          x: clamp(x - w * 0.5, 26, world.width - 26 - w),
          y: clamp(y - h * 0.5, 26, world.height - 48 - h),
          w,
          h,
          fx: isUpdraft ? 0 : 950,
          fy: isUpdraft ? -1950 : 0,
          sandboxPlaced: true,
        };
        world.forceZones.push(fz);
        pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Placed ${fz.label} force zone`, undefined, id));
        return { ok: true, entityId: id, message: `Placed ${fz.label}` };
      }
    }
  }

  if (action.action === 'remove') {
    const id = action.entityId;
    if (PROTECTED_ENTITY_IDS.has(id)) {
      return { ok: false, message: 'Outer arena walls cannot be removed' };
    }
    const crateIdx = world.crates.findIndex((c) => c.id === id);
    if (crateIdx !== -1) {
      const [removed] = world.crates.splice(crateIdx, 1);
      for (const a of world.actors) {
        if (a.holdingCrateId === id) a.holdingCrateId = null;
      }
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Removed ${removed.label}`, undefined, id));
      return { ok: true, entityId: id, message: `Removed ${removed.label}` };
    }
    const platIdx = world.platforms.findIndex((p) => p.id === id);
    if (platIdx !== -1) {
      world.platforms.splice(platIdx, 1);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', 'Removed platform', undefined, id));
      return { ok: true, entityId: id, message: 'Removed platform' };
    }
    const plateIdx = world.plates.findIndex((p) => p.id === id);
    if (plateIdx !== -1) {
      world.plates.splice(plateIdx, 1);
      pruneDeletedTriggerLinks(world, id);
      syncWorldLogicState(world, world.paused);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', 'Removed plate', undefined, id));
      return { ok: true, entityId: id, message: 'Removed plate' };
    }
    const swIdx = world.switches.findIndex((s) => s.id === id);
    if (swIdx !== -1) {
      world.switches.splice(swIdx, 1);
      pruneDeletedTriggerLinks(world, id);
      syncWorldLogicState(world, world.paused);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', 'Removed switch', undefined, id));
      return { ok: true, entityId: id, message: 'Removed switch' };
    }
    const doorIdx = world.doors.findIndex((d) => d.id === id);
    if (doorIdx !== -1) {
      world.doors.splice(doorIdx, 1);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', 'Removed gate', undefined, id));
      return { ok: true, entityId: id, message: 'Removed gate' };
    }
    const hazIdx = world.hazards.findIndex((h) => h.id === id);
    if (hazIdx !== -1) {
      world.hazards.splice(hazIdx, 1);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', 'Removed hazard', undefined, id));
      return { ok: true, entityId: id, message: 'Removed hazard' };
    }
    const fzIdx = world.forceZones.findIndex((f) => f.id === id);
    if (fzIdx !== -1) {
      world.forceZones.splice(fzIdx, 1);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', 'Removed force zone', undefined, id));
      return { ok: true, entityId: id, message: 'Removed force zone' };
    }
    return { ok: false, message: `Entity '${id}' not found` };
  }

  if (action.action === 'move') {
    const crate = world.crates.find((c) => c.id === action.entityId);
    if (crate) {
      crate.x = clamp(action.x - crate.w * 0.5, 26, world.width - 26 - crate.w);
      crate.y = clamp(action.y - crate.h * 0.5, 26, world.height - 48 - crate.h);
      crate.spawnX = crate.x;
      crate.spawnY = crate.y;
      crate.vx = 0;
      crate.vy = 0;
      return { ok: true, entityId: crate.id, message: `Moved ${crate.label}` };
    }
    const actor = world.actors.find((a) => a.id === action.entityId);
    if (actor) {
      actor.x = clamp(action.x - actor.w * 0.5, 26, world.width - 26 - actor.w);
      actor.y = clamp(action.y - actor.h * 0.5, 26, world.height - 48 - actor.h);
      actor.vx = 0;
      actor.vy = 0;
      return { ok: true, entityId: actor.id, message: `Moved ${actor.label}` };
    }
    if (!PROTECTED_ENTITY_IDS.has(action.entityId)) {
      const plat = world.platforms.find((p) => p.id === action.entityId);
      if (plat) {
        const nextX = clamp(action.x - plat.w * 0.5, 24, world.width - 24 - plat.w);
        const nextY = clamp(action.y - plat.h * 0.5, 24, world.height - 48 - plat.h);
        const dx = nextX - plat.x;
        const dy = nextY - plat.y;
        plat.x = nextX;
        plat.y = nextY;
        if (plat.startPos) plat.startPos = { x: plat.startPos.x + dx, y: plat.startPos.y + dy };
        if (plat.endPos) plat.endPos = { x: plat.endPos.x + dx, y: plat.endPos.y + dy };
        return { ok: true, entityId: plat.id, message: 'Moved platform' };
      }
      const fz = world.forceZones.find((f) => f.id === action.entityId);
      if (fz) {
        fz.x = clamp(action.x - fz.w * 0.5, 24, world.width - 24 - fz.w);
        fz.y = clamp(action.y - fz.h * 0.5, 24, world.height - 48 - fz.h);
        return { ok: true, entityId: fz.id, message: `Moved ${fz.label}` };
      }
      const plate = world.plates.find((p) => p.id === action.entityId);
      if (plate) {
        plate.x = clamp(action.x - plate.w * 0.5, 26, world.width - 26 - plate.w);
        plate.y = clamp(action.y - plate.h * 0.5, 28, world.height - 48 - plate.h);
        return { ok: true, entityId: plate.id, message: `Moved ${plate.label}` };
      }
      const sw = world.switches.find((s) => s.id === action.entityId);
      if (sw) {
        sw.x = clamp(action.x - sw.w * 0.5, 26, world.width - 26 - sw.w);
        sw.y = clamp(action.y - sw.h * 0.5, 28, world.height - 48 - sw.h);
        return { ok: true, entityId: sw.id, message: `Moved ${sw.label}` };
      }
      const door = world.doors.find((d) => d.id === action.entityId);
      if (door) {
        door.x = clamp(action.x - door.w * 0.5, 26, world.width - 26 - door.w);
        door.y = clamp(action.y - door.h * 0.5, 24, world.height - 48 - door.h);
        return { ok: true, entityId: door.id, message: `Moved ${door.label}` };
      }
      const haz = world.hazards.find((h) => h.id === action.entityId);
      if (haz) {
        haz.x = clamp(action.x - haz.w * 0.5, 26, world.width - 26 - haz.w);
        haz.y = clamp(action.y - haz.h * 0.5, 28, world.height - 48 - haz.h);
        return { ok: true, entityId: haz.id, message: 'Moved hazard' };
      }
      if (world.exit.id === action.entityId) {
        world.exit.x = clamp(action.x - world.exit.w * 0.5, 26, world.width - 26 - world.exit.w);
        world.exit.y = clamp(action.y - world.exit.h * 0.5, 26, world.height - 48 - world.exit.h);
        return { ok: true, entityId: world.exit.id, message: 'Moved exit zone' };
      }
    }
    return { ok: false, message: 'Target not movable' };
  }

  if (action.action === 'update_entity') {
    const id = action.entityId;
    const p: EditableEntityPatch = action.patch;
    if (PROTECTED_ENTITY_IDS.has(id)) {
      return { ok: false, message: 'Outer arena perimeter cannot be modified' };
    }

    const plat = world.platforms.find((item) => item.id === id);
    if (plat) {
      const prevX = plat.x;
      const prevY = plat.y;
      if (typeof p.w === 'number') plat.w = clamp(Math.round(p.w), 36, 640);
      if (typeof p.h === 'number') plat.h = clamp(Math.round(p.h), 10, 260);
      if (typeof p.x === 'number') plat.x = clamp(Math.round(p.x), 24, world.width - 24 - plat.w);
      if (typeof p.y === 'number') plat.y = clamp(Math.round(p.y), 24, world.height - 48 - plat.h);

      if (p.material === 'standard' || p.material === 'ice' || p.material === 'bouncy' || p.material === 'conveyor') {
        plat.material = p.material;
        if (p.material === 'conveyor' && typeof plat.conveyorSpeed !== 'number') {
          plat.conveyorSpeed = 140;
        }
        if (p.material === 'bouncy' && typeof plat.bounceVelocity !== 'number') {
          plat.bounceVelocity = 700;
        }
      }
      if (typeof p.conveyorSpeed === 'number') {
        plat.conveyorSpeed = clamp(Math.round(p.conveyorSpeed), -420, 420);
      }
      if (typeof p.bounceVelocity === 'number') {
        plat.bounceVelocity = clamp(Math.round(p.bounceVelocity), 280, 1200);
      }
      if (p.kind === 'moving' || p.kind === 'solid') {
        plat.kind = p.kind;
        if (p.kind === 'moving') {
          if (!plat.startPos) plat.startPos = { x: plat.x, y: plat.y };
          if (!plat.endPos) {
            plat.endPos = {
              x: clamp(plat.x, 24, world.width - 24 - plat.w),
              y: clamp(plat.y - 110, 48, world.height - 48 - plat.h),
            };
          }
          if (typeof plat.speed !== 'number') plat.speed = 0.5;
        } else {
          plat.vx = 0;
          plat.vy = 0;
        }
      }
      if (p.startPos) {
        plat.startPos = {
          x: clamp(Math.round(p.startPos.x), 24, world.width - 24 - plat.w),
          y: clamp(Math.round(p.startPos.y), 24, world.height - 48 - plat.h),
        };
      } else if ((typeof p.x === 'number' || typeof p.y === 'number') && plat.startPos) {
        const dx = plat.x - prevX;
        const dy = plat.y - prevY;
        plat.startPos = { x: plat.startPos.x + dx, y: plat.startPos.y + dy };
        if (plat.endPos && !p.endPos) {
          plat.endPos = { x: plat.endPos.x + dx, y: plat.endPos.y + dy };
        }
      }
      if (p.endPos) {
        plat.endPos = {
          x: clamp(Math.round(p.endPos.x), 24, world.width - 24 - plat.w),
          y: clamp(Math.round(p.endPos.y), 24, world.height - 48 - plat.h),
        };
      }
      if (typeof p.speed === 'number') plat.speed = clamp(p.speed, 0.1, 2.5);
      if (typeof p.loopWhenActive === 'boolean') plat.loopWhenActive = p.loopWhenActive;
      if (p.channel === null) plat.channel = undefined;
      else if (p.channel) plat.channel = p.channel;
      if (Array.isArray(p.linkedIds)) plat.linkedIds = [...new Set(p.linkedIds)];
      if (p.logic === 'ALL' || p.logic === 'ANY') plat.logic = p.logic;

      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Edited platform (${plat.material})`, undefined, id));
      return { ok: true, entityId: id, message: 'Updated platform' };
    }

    const fz = world.forceZones.find((item) => item.id === id);
    if (fz) {
      if (typeof p.label === 'string' && p.label.trim()) fz.label = p.label.trim();
      if (typeof p.w === 'number') fz.w = clamp(Math.round(p.w), 36, 480);
      if (typeof p.h === 'number') fz.h = clamp(Math.round(p.h), 36, 420);
      if (typeof p.x === 'number') fz.x = clamp(Math.round(p.x), 24, world.width - 24 - fz.w);
      if (typeof p.y === 'number') fz.y = clamp(Math.round(p.y), 24, world.height - 48 - fz.h);
      if (typeof p.fx === 'number') fz.fx = clamp(Math.round(p.fx), -2600, 2600);
      if (typeof p.fy === 'number') fz.fy = clamp(Math.round(p.fy), -2800, 2600);
      if (!p.label) {
        fz.label = Math.abs(fz.fx) >= Math.abs(fz.fy)
          ? fz.fx >= 0 ? 'Crosswind →' : '← Crosswind'
          : fz.fy <= 0 ? 'Updraft' : 'Downdraft';
      }
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Updated ${fz.label} (fx:${fz.fx}, fy:${fz.fy})`, undefined, id));
      return { ok: true, entityId: id, message: `Updated ${fz.label}` };
    }

    const sw = world.switches.find((item) => item.id === id);
    if (sw) {
      if (typeof p.label === 'string' && p.label.trim()) sw.label = p.label.trim();
      if (typeof p.x === 'number') sw.x = clamp(Math.round(p.x), 26, world.width - 26 - sw.w);
      if (typeof p.y === 'number') sw.y = clamp(Math.round(p.y), 28, world.height - 48 - sw.h);
      if (p.channel) sw.channel = p.channel;
      if (typeof p.active === 'boolean') {
        sw.active = p.active;
        sw.initialActive = p.active;
      }
      syncWorldLogicState(world, world.paused);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Updated ${sw.label} (CH-${sw.channel})`, undefined, id));
      return { ok: true, entityId: id, message: `Updated ${sw.label}` };
    }

    const plate = world.plates.find((item) => item.id === id);
    if (plate) {
      if (typeof p.label === 'string' && p.label.trim()) plate.label = p.label.trim();
      if (typeof p.w === 'number') plate.w = clamp(Math.round(p.w), 36, 220);
      if (typeof p.x === 'number') plate.x = clamp(Math.round(p.x), 26, world.width - 26 - plate.w);
      if (typeof p.y === 'number') plate.y = clamp(Math.round(p.y), 28, world.height - 48 - plate.h);
      if (p.channel) plate.channel = p.channel;
      if (p.mode === 'momentary' || p.mode === 'latch') plate.mode = p.mode;
      syncWorldLogicState(world, world.paused);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Updated ${plate.label} (${plate.mode})`, undefined, id));
      return { ok: true, entityId: id, message: `Updated ${plate.label}` };
    }

    const door = world.doors.find((item) => item.id === id);
    if (door) {
      if (typeof p.label === 'string' && p.label.trim()) door.label = p.label.trim();
      if (typeof p.w === 'number') door.w = clamp(Math.round(p.w), 14, 96);
      if (typeof p.h === 'number') door.h = clamp(Math.round(p.h), 36, 360);
      if (typeof p.x === 'number') door.x = clamp(Math.round(p.x), 26, world.width - 26 - door.w);
      if (typeof p.y === 'number') door.y = clamp(Math.round(p.y), 24, world.height - 48 - door.h);
      if (Array.isArray(p.channels)) door.channels = [...new Set(p.channels)];
      if (Array.isArray(p.linkedIds)) door.linkedIds = [...new Set(p.linkedIds)];
      if (p.logic === 'ALL' || p.logic === 'ANY') door.logic = p.logic;
      syncWorldLogicState(world, world.paused);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Updated ${door.label}`, undefined, id));
      return { ok: true, entityId: id, message: `Updated ${door.label}` };
    }

    const crate = world.crates.find((item) => item.id === id);
    if (crate) {
      if (typeof p.x === 'number') {
        crate.x = clamp(Math.round(p.x), 26, world.width - 26 - crate.w);
        crate.spawnX = crate.x;
        crate.vx = 0;
      }
      if (typeof p.y === 'number') {
        crate.y = clamp(Math.round(p.y), 26, world.height - 48 - crate.h);
        crate.spawnY = crate.y;
        crate.vy = 0;
      }
      if (p.shape === 'box' || p.shape === 'ball') crate.shape = p.shape;
      if (p.material === 'wood' || p.material === 'steel' || p.material === 'polymer' || p.material === 'rubber') {
        crate.material = p.material;
        const spec = MATERIAL_DEFAULTS[p.material];
        if (typeof p.mass !== 'number') crate.mass = spec.mass;
        if (typeof p.restitution !== 'number') crate.restitution = spec.restitution;
        if (typeof p.friction !== 'number') crate.friction = spec.friction;
      }
      if (typeof p.mass === 'number') crate.mass = clamp(p.mass, 0.3, 8);
      if (typeof p.restitution === 'number') crate.restitution = clamp(p.restitution, 0, 0.95);
      if (typeof p.friction === 'number') crate.friction = clamp(p.friction, 0.05, 1.5);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Updated ${crate.label}`, undefined, id));
      return { ok: true, entityId: id, message: `Updated ${crate.label}` };
    }

    const haz = world.hazards.find((item) => item.id === id);
    if (haz) {
      if (typeof p.w === 'number') haz.w = clamp(Math.round(p.w), 24, 360);
      if (typeof p.h === 'number') haz.h = clamp(Math.round(p.h), 8, 80);
      if (typeof p.x === 'number') haz.x = clamp(Math.round(p.x), 26, world.width - 26 - haz.w);
      if (typeof p.y === 'number') haz.y = clamp(Math.round(p.y), 28, world.height - 48 - haz.h);
      if (p.hazardKind === 'plasma' || p.hazardKind === 'spikes') haz.kind = p.hazardKind;
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Updated ${haz.kind} hazard`, undefined, id));
      return { ok: true, entityId: id, message: 'Updated hazard' };
    }

    if (world.exit.id === id) {
      if (typeof p.w === 'number') world.exit.w = clamp(Math.round(p.w), 48, 220);
      if (typeof p.h === 'number') world.exit.h = clamp(Math.round(p.h), 48, 220);
      if (typeof p.x === 'number') world.exit.x = clamp(Math.round(p.x), 26, world.width - 26 - world.exit.w);
      if (typeof p.y === 'number') world.exit.y = clamp(Math.round(p.y), 26, world.height - 48 - world.exit.h);
      if (Array.isArray(p.requiredChannels)) world.exit.requiredChannels = [...new Set(p.requiredChannels)];
      if (Array.isArray(p.linkedIds)) world.exit.linkedIds = [...new Set(p.linkedIds)];
      if (p.logic === 'ALL' || p.logic === 'ANY') world.exit.logic = p.logic;
      syncWorldLogicState(world, world.paused);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', 'Updated exit zone', undefined, id));
      return { ok: true, entityId: id, message: 'Updated exit zone' };
    }

    return { ok: false, message: `Entity '${id}' not found` };
  }

  if (action.action === 'toggle_wire') {
    const sourceSw = world.switches.find((s) => s.id === action.sourceId);
    const sourcePlate = world.plates.find((p) => p.id === action.sourceId);
    const source = sourceSw ?? sourcePlate;
    if (!source) {
      return { ok: false, message: `Trigger source '${action.sourceId}' not found` };
    }
    const mode = action.mode ?? 'toggle';

    const wireTarget = (
      targetLabel: string,
      channels: ChannelId[],
      linkedIds: string[],
      setChannels: (next: ChannelId[]) => void,
      setLinkedIds: (next: string[]) => void
    ): { ok: boolean; entityId: string; message: string } => {
      const hasDirect = linkedIds.includes(source.id);
      const hasChannel = channels.includes(source.channel);
      const currentlyWired = hasDirect || hasChannel;
      const shouldAttach = mode === 'attach' ? true : mode === 'detach' ? false : !currentlyWired;

      if (shouldAttach) {
        if (!hasDirect && !hasChannel) {
          setLinkedIds([...linkedIds, source.id]);
        }
        pushWorldEvent(
          world,
          makeEvent(world.tick, 'sandbox:edit', `Wired ${source.label} -> ${targetLabel}`, undefined, action.targetId)
        );
        return { ok: true, entityId: action.targetId, message: `Attached ${source.label} to ${targetLabel}` };
      }

      // Detaching: remove explicit link; if connected via channel, migrate other sources on that channel or strip channel
      const nextLinked = linkedIds.filter((id) => id !== source.id);
      if (hasChannel) {
        const otherSourcesOnChannel = [
          ...world.switches.filter((s) => s.channel === source.channel && s.id !== source.id).map((s) => s.id),
          ...world.plates.filter((p) => p.channel === source.channel && p.id !== source.id).map((p) => p.id),
        ];
        setChannels(channels.filter((c) => c !== source.channel));
        setLinkedIds([...new Set([...nextLinked, ...otherSourcesOnChannel])]);
      } else {
        setLinkedIds(nextLinked);
      }
      pushWorldEvent(
        world,
        makeEvent(world.tick, 'sandbox:edit', `Detached ${source.label} from ${targetLabel}`, undefined, action.targetId)
      );
      return { ok: true, entityId: action.targetId, message: `Detached ${source.label} from ${targetLabel}` };
    };

    const door = world.doors.find((d) => d.id === action.targetId);
    if (door) {
      const res = wireTarget(
        door.label,
        door.channels,
        door.linkedIds ?? [],
        (next) => {
          door.channels = next;
        },
        (next) => {
          door.linkedIds = next;
        }
      );
      syncWorldLogicState(world, world.paused);
      return res;
    }

    const plat = world.platforms.find((p) => p.id === action.targetId);
    if (plat) {
      if (plat.kind !== 'moving') {
        plat.kind = 'moving';
        plat.startPos = plat.startPos ?? { x: plat.x, y: plat.y };
        plat.endPos = plat.endPos ?? {
          x: plat.x,
          y: clamp(plat.y - 110, 48, world.height - 48 - plat.h),
        };
        plat.speed = plat.speed ?? 0.5;
      }
      const res = wireTarget(
        'Moving Lift',
        plat.channel ? [plat.channel] : [],
        plat.linkedIds ?? [],
        (next) => {
          plat.channel = next[0];
        },
        (next) => {
          plat.linkedIds = next;
        }
      );
      syncWorldLogicState(world, world.paused);
      return res;
    }

    if (world.exit.id === action.targetId) {
      const res = wireTarget(
        'Exit Zone',
        world.exit.requiredChannels,
        world.exit.linkedIds ?? [],
        (next) => {
          world.exit.requiredChannels = next;
        },
        (next) => {
          world.exit.linkedIds = next;
        }
      );
      syncWorldLogicState(world, world.paused);
      return res;
    }

    return { ok: false, message: `Target '${action.targetId}' cannot receive logic wires` };
  }

  if (action.action === 'duplicate') {
    const id = action.entityId;
    if (PROTECTED_ENTITY_IDS.has(id)) {
      return { ok: false, message: 'Outer arena perimeter cannot be duplicated' };
    }
    const newId = `sb-dup-${sandboxSeq}`;
    const plat = world.platforms.find((p) => p.id === id);
    if (plat) {
      const nx = clamp(plat.x + 32, 24, world.width - 24 - plat.w);
      const ny = clamp(plat.y + 24, 24, world.height - 48 - plat.h);
      const dx = nx - plat.x;
      const dy = ny - plat.y;
      world.platforms.push({
        ...plat,
        id: newId,
        x: nx,
        y: ny,
        sandboxPlaced: true,
        startPos: plat.startPos ? { x: plat.startPos.x + dx, y: plat.startPos.y + dy } : undefined,
        endPos: plat.endPos ? { x: plat.endPos.x + dx, y: plat.endPos.y + dy } : undefined,
        linkedIds: plat.linkedIds ? [...plat.linkedIds] : undefined,
        progress: 0,
        direction: 1,
        vx: 0,
        vy: 0,
        compression: 0,
      });
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', 'Duplicated platform', undefined, newId));
      return { ok: true, entityId: newId, message: 'Duplicated platform' };
    }
    const fz = world.forceZones.find((f) => f.id === id);
    if (fz) {
      world.forceZones.push({
        ...fz,
        id: newId,
        x: clamp(fz.x + 32, 24, world.width - 24 - fz.w),
        y: clamp(fz.y + 24, 24, world.height - 48 - fz.h),
        sandboxPlaced: true,
      });
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Duplicated ${fz.label}`, undefined, newId));
      return { ok: true, entityId: newId, message: `Duplicated ${fz.label}` };
    }
    const crate = world.crates.find((c) => c.id === id);
    if (crate) {
      const clone = createCrateState({
        ...crate,
        id: newId,
        label: `${crate.label}*`,
        x: clamp(crate.x + 36, 26, world.width - 26 - crate.w),
        y: clamp(crate.y - 16, 26, world.height - 48 - crate.h),
        sandboxPlaced: true,
      });
      world.crates.push(clone);
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Duplicated ${crate.label}`, undefined, newId));
      return { ok: true, entityId: newId, message: `Duplicated ${crate.label}` };
    }
    const sw = world.switches.find((s) => s.id === id);
    if (sw) {
      world.switches.push({
        ...sw,
        id: newId,
        label: `${sw.label}*`,
        x: clamp(sw.x + 32, 26, world.width - 26 - sw.w),
        y: clamp(sw.y + 16, 28, world.height - 48 - sw.h),
        active: false,
        cooldown: 0,
        sandboxPlaced: true,
      });
      return { ok: true, entityId: newId, message: `Duplicated ${sw.label}` };
    }
    const plate = world.plates.find((p) => p.id === id);
    if (plate) {
      world.plates.push({
        ...plate,
        id: newId,
        label: `${plate.label}*`,
        x: clamp(plate.x + 32, 26, world.width - 26 - plate.w),
        y: clamp(plate.y - 24, 28, world.height - 48 - plate.h),
        active: false,
        pressedBy: [],
        sandboxPlaced: true,
      });
      return { ok: true, entityId: newId, message: `Duplicated ${plate.label}` };
    }
    const door = world.doors.find((d) => d.id === id);
    if (door) {
      world.doors.push({
        ...door,
        id: newId,
        label: `${door.label}*`,
        x: clamp(door.x + 32, 26, world.width - 26 - door.w),
        y: clamp(door.y + 16, 24, world.height - 48 - door.h),
        channels: [...door.channels],
        linkedIds: door.linkedIds ? [...door.linkedIds] : [],
        open: false,
        openProgress: 0,
        sandboxPlaced: true,
      });
      return { ok: true, entityId: newId, message: `Duplicated ${door.label}` };
    }
    const haz = world.hazards.find((h) => h.id === id);
    if (haz) {
      world.hazards.push({
        ...haz,
        id: newId,
        x: clamp(haz.x + 32, 26, world.width - 26 - haz.w),
        y: clamp(haz.y - 24, 28, world.height - 48 - haz.h),
        sandboxPlaced: true,
      });
      return { ok: true, entityId: newId, message: 'Duplicated hazard' };
    }
    return { ok: false, message: 'Entity cannot be duplicated' };
  }

  if (action.action === 'fling') {
    const vx = clamp(action.vx, -1200, 1200);
    const vy = clamp(action.vy, -1200, 1200);
    const crate = world.crates.find((c) => c.id === action.entityId);
    if (crate) {
      crate.vx = vx / Math.sqrt(crate.mass);
      crate.vy = vy / Math.sqrt(crate.mass);
      crate.grounded = false;
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Flung ${crate.label}`, undefined, crate.id));
      return { ok: true, entityId: crate.id, message: `Flung ${crate.label}` };
    }
    const actor = world.actors.find((a) => a.id === action.entityId);
    if (actor) {
      actor.vx = vx;
      actor.vy = vy;
      actor.grounded = false;
      pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', `Launched ${actor.label}`, actor.id));
      return { ok: true, entityId: actor.id, message: `Launched ${actor.label}` };
    }
    return { ok: false, message: `Entity '${action.entityId}' not found` };
  }

  if (action.action === 'blast') {
    const radius = clamp(action.radius ?? 175, 40, 420);
    const strength = clamp(action.strength ?? 780, 150, 1800);
    let affected = 0;

    for (const crate of world.crates) {
      const cx = crate.x + crate.w * 0.5;
      const cy = crate.y + crate.h * 0.5;
      const dx = cx - action.x;
      const dy = cy - action.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= radius) {
        const falloff = 1 - dist / radius;
        const nx = dist > 1 ? dx / dist : 0;
        const ny = dist > 1 ? dy / dist : -1;
        const dv = (strength * (0.45 + 0.55 * falloff)) / crate.mass;
        crate.vx = clamp(crate.vx + nx * dv, -1100, 1100);
        crate.vy = clamp(crate.vy + (ny - 0.35) * dv, -1100, 1100);
        crate.grounded = false;
        affected += 1;
      }
    }

    for (const actor of world.actors) {
      const cx = actor.x + actor.w * 0.5;
      const cy = actor.y + actor.h * 0.5;
      const dx = cx - action.x;
      const dy = cy - action.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= radius) {
        const falloff = 1 - dist / radius;
        const nx = dist > 1 ? dx / dist : 0;
        const ny = dist > 1 ? dy / dist : -1;
        const dv = (strength * 0.85 * (0.45 + 0.55 * falloff)) / actor.mass;
        actor.vx = clamp(actor.vx + nx * dv, -950, 950);
        actor.vy = clamp(actor.vy + (ny - 0.4) * dv, -950, 950);
        actor.grounded = false;
        affected += 1;
      }
    }

    world.recentImpulses.push({
      id: `imp-${sandboxSeq}`,
      x: action.x,
      y: action.y,
      radius,
      tick: world.tick,
    });
    if (world.recentImpulses.length > 8) {
      world.recentImpulses.splice(0, world.recentImpulses.length - 8);
    }

    pushWorldEvent(
      world,
      makeEvent(world.tick, 'sandbox:edit', `Impulse blast at (${Math.round(action.x)},${Math.round(action.y)}) hit ${affected} bodies`)
    );
    return { ok: true, message: `Blast affected ${affected} bodies` };
  }

  if (action.action === 'clear_spawned') {
    world.crates = level.crates.map((c) => createCrateState(c));
    world.platforms = level.platforms.map((p) => ({
      ...p,
      material: p.material ?? 'standard',
      progress: 0,
      direction: 1,
      vx: 0,
      vy: 0,
      compression: 0,
    }));
    world.plates = level.plates.map((p) => ({ ...p, active: false, pressedBy: [] }));
    world.switches = level.switches.map((s) => ({ ...s, active: Boolean(s.initialActive), cooldown: 0 }));
    world.doors = level.doors.map((d) => ({
      ...d,
      channels: [...d.channels],
      linkedIds: d.linkedIds ? [...d.linkedIds] : [],
      open: false,
      openProgress: 0,
    }));
    world.hazards = level.hazards.map((h) => ({ ...h }));
    world.forceZones = (level.forceZones ?? []).map((f) => ({ ...f }));
    world.exit = {
      ...level.exit,
      requiredChannels: [...level.exit.requiredChannels],
      linkedIds: level.exit.linkedIds ? [...level.exit.linkedIds] : [],
      logic: level.exit.logic ?? 'ALL',
    };
    for (const a of world.actors) a.holdingCrateId = null;
    syncWorldLogicState(world, true);
    pushWorldEvent(world, makeEvent(world.tick, 'sandbox:edit', 'Restored level geometry & wiring to defaults'));
    return { ok: true, message: 'Sandbox props cleared' };
  }

  return { ok: false, message: 'Unknown sandbox action' };
}

function pruneDeletedTriggerLinks(world: WorldState, triggerId: string): void {
  for (const door of world.doors) {
    if (door.linkedIds?.length) {
      door.linkedIds = door.linkedIds.filter((id) => id !== triggerId);
    }
  }
  for (const plat of world.platforms) {
    if (plat.linkedIds?.length) {
      plat.linkedIds = plat.linkedIds.filter((id) => id !== triggerId);
    }
  }
  if (world.exit.linkedIds?.length) {
    world.exit.linkedIds = world.exit.linkedIds.filter((id) => id !== triggerId);
  }
}

function syncWorldLogicState(world: WorldState, snapDoors: boolean): void {
  const nextChannels: Record<ChannelId, boolean> = { A: false, B: false, C: false };
  for (const plate of world.plates) {
    if (plate.active) nextChannels[plate.channel] = true;
  }
  for (const sw of world.switches) {
    if (sw.active) nextChannels[sw.channel] = true;
  }
  world.channels = nextChannels;
  for (const door of world.doors) {
    door.open = evaluateDoorOpen(door, world);
    if (snapDoors) {
      door.openProgress = door.open ? 1 : 0;
    }
  }
}

function isTriggerSourceActive(world: WorldState, sourceId: string): boolean {
  const plate = world.plates.find((p) => p.id === sourceId);
  if (plate) return plate.active;
  const sw = world.switches.find((s) => s.id === sourceId);
  if (sw) return sw.active;
  return false;
}

function evaluateLinkedControl(
  world: WorldState,
  channels: ChannelId[],
  linkedIds: string[] | undefined,
  logic: 'ALL' | 'ANY'
): boolean {
  const signals: boolean[] = [];
  for (const ch of channels) {
    signals.push(Boolean(world.channels[ch]));
  }
  if (linkedIds) {
    for (const id of linkedIds) {
      signals.push(isTriggerSourceActive(world, id));
    }
  }
  if (signals.length === 0) return true;
  if (logic === 'ALL') return signals.every(Boolean);
  return signals.some(Boolean);
}

function evaluateDoorOpen(door: DoorState, world: WorldState): boolean {
  return evaluateLinkedControl(world, door.channels, door.linkedIds, door.logic);
}

function getSolidObstacles(world: WorldState): Array<Rect & { material: PlatformMaterial; bounceVelocity?: number; conveyorSpeed?: number; id?: string }> {
  const solids: Array<Rect & { material: PlatformMaterial; bounceVelocity?: number; conveyorSpeed?: number; id?: string }> = [];
  for (const p of world.platforms) {
    solids.push({
      id: p.id,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      material: p.material,
      bounceVelocity: p.bounceVelocity,
      conveyorSpeed: p.conveyorSpeed,
    });
  }
  for (const d of world.doors) {
    if (!d.open) {
      solids.push({ x: d.x, y: d.y, w: d.w, h: d.h, material: 'standard' });
    }
  }
  return solids;
}

function resolveCrateStaticClearance(
  crate: CrateState,
  staticSolids: ReturnType<typeof getSolidObstacles>,
  world: WorldState
): void {
  crate.x = clamp(crate.x, 26, world.width - 26 - crate.w);
  crate.y = clamp(crate.y, 26, world.height - 48 - crate.h);
  for (const solid of staticSolids) {
    if (rectsOverlap(crate, solid)) {
      const overlapLeft = crate.x + crate.w - solid.x;
      const overlapRight = solid.x + solid.w - crate.x;
      const overlapTop = crate.y + crate.h - solid.y;
      const overlapBottom = solid.y + solid.h - crate.y;
      const minX = Math.min(overlapLeft, overlapRight);
      const minY = Math.min(overlapTop, overlapBottom);
      if (minX <= minY) {
        if (overlapLeft <= overlapRight) {
          crate.x = Math.max(26, solid.x - crate.w);
        } else {
          crate.x = Math.min(world.width - 26 - crate.w, solid.x + solid.w);
        }
      } else if (overlapBottom <= overlapTop && solid.id !== 'floor-main') {
        crate.y = Math.min(world.height - 48 - crate.h, solid.y + solid.h);
      } else {
        crate.y = Math.max(26, solid.y - crate.h);
      }
    }
  }
}

function segmentCrossesSolid(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  solids: ReturnType<typeof getSolidObstacles>
): boolean {
  // Sample the reach line; skip the endpoints so the actor/crate may graze a surface.
  for (let t = 0.16; t <= 0.84; t += 0.085) {
    const px = ax + (bx - ax) * t;
    const py = ay + (by - ay) * t;
    for (const solid of solids) {
      if (px > solid.x + 1 && px < solid.x + solid.w - 1 && py > solid.y + 1 && py < solid.y + solid.h - 1) {
        return true;
      }
    }
  }
  return false;
}

function isStandingOnPlatform(entity: Rect, plat: PlatformState, prevPlatX: number, prevPlatY: number): boolean {
  const horizOverlap = entity.x + entity.w > prevPlatX + 1 && entity.x < prevPlatX + plat.w - 1;
  const bottom = entity.y + entity.h;
  return horizOverlap && Math.abs(bottom - prevPlatY) <= 3;
}

function effectiveRestitution(base: number, globalRestitution: number): number {
  return clamp(base * (globalRestitution / DEFAULT_PHYSICS_CONFIG.restitution), 0, 0.95);
}

export function stepWorld(
  world: WorldState,
  level: LevelDefinition,
  inputs: Record<string, ActorInput>,
  dt: number = FIXED_DT
): TelemetryEvent[] {
  // Freeze simulation completely once solved so clear time, sync ticks, and decisions remain exact
  if (world.solved) return [];

  const clampedDt = Math.min(Math.max(dt, 0.001), 0.05);
  const newEvents: TelemetryEvent[] = [];
  const phys = world.physics;

  world.tick += 1;
  world.metrics.totalTicks += 1;
  world.metrics.elapsedSeconds = Number((world.metrics.elapsedSeconds + clampedDt).toFixed(2));

  // Prune expired visual impulse rings (~0.45s lifetime)
  if (world.recentImpulses.length > 0) {
    world.recentImpulses = world.recentImpulses.filter((imp) => world.tick - imp.tick < 28);
  }

  // Record pre-carry positions so passive platform/conveyor displacement resolves solids cleanly even when vx/vy == 0
  const preCarryCratePos = new Map<string, { x: number; y: number }>();
  for (const c of world.crates) preCarryCratePos.set(c.id, { x: c.x, y: c.y });
  const preCarryActorPos = new Map<string, { x: number; y: number }>();
  for (const a of world.actors) preCarryActorPos.set(a.id, { x: a.x, y: a.y });

  // 1. Update moving platforms & bounce pad spring recovery, carry riders
  const platformDeltas = new Map<string, { dx: number; dy: number; prevX: number; prevY: number }>();

  for (const plat of world.platforms) {
    if (plat.compression > 0) {
      plat.compression = Math.max(0, plat.compression - 6 * clampedDt);
    }
    if (plat.kind !== 'moving' || !plat.startPos || !plat.endPos) continue;
    const prevX = plat.x;
    const prevY = plat.y;
    const speed = plat.speed ?? 0.5;
    const channelActive = evaluateLinkedControl(
      world,
      plat.channel ? [plat.channel] : [],
      plat.linkedIds,
      plat.logic ?? 'ANY'
    );

    if (plat.loopWhenActive) {
      if (channelActive) {
        plat.progress += plat.direction * speed * clampedDt;
        if (plat.progress >= 1) {
          plat.progress = 1;
          plat.direction = -1;
        } else if (plat.progress <= 0) {
          plat.progress = 0;
          plat.direction = 1;
        }
      }
    } else {
      const targetProgress = channelActive ? 1 : 0;
      plat.progress = approach(plat.progress, targetProgress, speed * clampedDt);
    }

    const nextX = plat.startPos.x + (plat.endPos.x - plat.startPos.x) * plat.progress;
    const nextY = plat.startPos.y + (plat.endPos.y - plat.startPos.y) * plat.progress;
    const dx = nextX - prevX;
    const dy = nextY - prevY;
    plat.x = nextX;
    plat.y = nextY;
    plat.vx = dx / clampedDt;
    plat.vy = dy / clampedDt;
    platformDeltas.set(plat.id, { dx, dy, prevX, prevY });
  }

  for (const plat of world.platforms) {
    const delta = platformDeltas.get(plat.id);
    if (!delta || (delta.dx === 0 && delta.dy === 0)) continue;
    for (const crate of world.crates) {
      if (isStandingOnPlatform(crate, plat, delta.prevX, delta.prevY)) {
        crate.x += delta.dx;
        crate.y += delta.dy;
      }
    }
    for (const actor of world.actors) {
      if (isStandingOnPlatform(actor, plat, delta.prevX, delta.prevY)) {
        actor.x += delta.dx;
        actor.y += delta.dy;
      }
    }
  }

  const staticSolids = getSolidObstacles(world);
  const heldCrateIds = new Set(
    world.actors.map((a) => a.holdingCrateId).filter((id): id is string => Boolean(id))
  );

  // 2. Update Dynamic Rigid Bodies (Crates & Kinetic Spheres)
  for (const crate of world.crates) {
    if (heldCrateIds.has(crate.id)) {
      crate.grounded = false;
      continue;
    }

    // Gravity
    crate.vy = clamp(crate.vy + phys.gravity * clampedDt, -MAX_FALL_SPEED, MAX_FALL_SPEED);

    // Aerodynamic drag
    const dragFactor = Math.exp(-phys.airDrag * (crate.grounded ? 0.25 : 1.0) * clampedDt);
    crate.vx *= dragFactor;
    if (!crate.grounded) {
      crate.vy *= Math.exp(-phys.airDrag * 0.45 * clampedDt);
    }

    // Apply environmental Force Zones (updrafts / wind tunnels) weighted by inverse mass
    for (const fz of world.forceZones) {
      if (rectsOverlap(crate, fz)) {
        crate.vx = clamp(crate.vx + (fz.fx / crate.mass) * clampedDt, -1100, 1100);
        crate.vy = clamp(crate.vy + (fz.fy / crate.mass) * clampedDt, -1100, 1100);
      }
    }

    // Surface material friction & conveyor velocity when grounded
    if (crate.grounded) {
      let surfaceMult = 1.0;
      let conveyorTarget = 0;
      let onConveyor = false;

      for (const solid of staticSolids) {
        const horiz = crate.x + crate.w > solid.x + 1 && crate.x < solid.x + solid.w - 1;
        if (horiz && Math.abs(crate.y + crate.h - solid.y) <= 3) {
          if (solid.material === 'ice') surfaceMult = 0.08;
          else if (solid.material === 'conveyor' && solid.conveyorSpeed) {
            onConveyor = true;
            conveyorTarget = solid.conveyorSpeed;
          }
        }
      }

      if (onConveyor) {
        crate.vx = approach(crate.vx, conveyorTarget, 900 * clampedDt);
      } else {
        const decel = GROUND_FRICTION * crate.friction * phys.surfaceFriction * surfaceMult;
        crate.vx = approach(crate.vx, 0, decel * clampedDt);
      }
    }

    // Velocity-adaptive sub-stepping prevents fast blasted/flung crates from tunneling through thin pads or gates
    const crateAnchor = preCarryCratePos.get(crate.id) ?? { x: crate.x, y: crate.y };
    const maxDisp = Math.max(Math.abs(crate.vx), Math.abs(crate.vy)) * clampedDt;
    const subSteps = maxDisp > 7 ? Math.min(6, Math.ceil(maxDisp / 6)) : 1;
    const subDt = clampedDt / subSteps;
    let crateRespawned = false;

    for (let stepIdx = 0; stepIdx < subSteps; stepIdx++) {
      const stepAnchorX = stepIdx === 0 ? crateAnchor.x : crate.x;
      const stepAnchorY = stepIdx === 0 ? crateAnchor.y : crate.y;

      // Horizontal step & static solid collisions (with elastic restitution)
      crate.x += crate.vx * subDt;
      for (const solid of staticSolids) {
        if (rectsOverlap(crate, solid)) {
          const netDx = crate.x - stepAnchorX;
          const overlapLeft = crate.x + crate.w - solid.x;
          const overlapRight = solid.x + solid.w - crate.x;
          const overlapTop = crate.y + crate.h - solid.y;
          const overlapBottom = solid.y + solid.h - crate.y;
          const minX = Math.min(overlapLeft, overlapRight);
          const minY = Math.min(overlapTop, overlapBottom);
          const verticalLandingOverlap =
            (stepAnchorY + crate.h <= solid.y + 4 || stepAnchorY >= solid.y + solid.h - 4) &&
            minY < minX;
          if (verticalLandingOverlap) continue;

          if (solid.id === 'wall-left') crate.x = solid.x + solid.w;
          else if (solid.id === 'wall-right') crate.x = solid.x - crate.w;
          else if (crate.vx > 0 || (crate.vx === 0 && netDx > 0) || stepAnchorX + crate.w <= solid.x + 2) {
            crate.x = solid.x - crate.w;
          } else if (crate.vx < 0 || (crate.vx === 0 && netDx < 0) || stepAnchorX >= solid.x + solid.w - 2) {
            crate.x = solid.x + solid.w;
          } else if (minX <= minY) {
            crate.x = overlapLeft <= overlapRight ? solid.x - crate.w : solid.x + solid.w;
          }
          const bounce = effectiveRestitution(crate.restitution, phys.restitution);
          if (Math.abs(crate.vx) > 65 && bounce > 0.05) {
            crate.vx = -crate.vx * bounce;
            world.metrics.collisionCount += 1;
          } else {
            crate.vx = 0;
          }
        }
      }
      crate.x = clamp(crate.x, 24, world.width - 24 - crate.w);

      // Horizontal crate-vs-crate elastic momentum exchange
      for (const other of world.crates) {
        if (other.id === crate.id || heldCrateIds.has(other.id)) continue;
        if (rectsOverlap(crate, other)) {
          const overlapLeft = crate.x + crate.w - other.x;
          const overlapRight = other.x + other.w - crate.x;
          const overlapTop = crate.y + crate.h - other.y;
          const overlapBottom = other.y + other.h - crate.y;
          const minX = Math.min(overlapLeft, overlapRight);
          const minY = Math.min(overlapTop, overlapBottom);
          if (minX <= minY) {
            const invM1 = 1 / crate.mass;
            const invM2 = 1 / other.mass;
            const invSum = invM1 + invM2;
            if (overlapLeft < overlapRight) {
              crate.x -= minX * (invM1 / invSum);
              other.x += minX * (invM2 / invSum);
            } else {
              crate.x += minX * (invM1 / invSum);
              other.x -= minX * (invM2 / invSum);
            }
            const e = effectiveRestitution(Math.max(crate.restitution, other.restitution), phys.restitution);
            const relVx = crate.vx - other.vx;
            const sepDir = overlapLeft < overlapRight ? 1 : -1;
            if (relVx * sepDir > 0) {
              const j = (-(1 + e) * relVx) / invSum;
              crate.vx += j * invM1;
              other.vx -= j * invM2;
              world.metrics.collisionCount += 1;
            }
          }
        }
      }

      // Vertical step & collisions (static solids + bounce pads + crate stacking)
      const prevCrateY = stepAnchorY;
      crate.y += crate.vy * subDt;
      crate.grounded = false;

      for (const solid of staticSolids) {
        if (rectsOverlap(crate, solid)) {
          const netDy = crate.y - prevCrateY;
          const overlapTop = crate.y + crate.h - solid.y;
          const overlapBottom = solid.y + solid.h - crate.y;
          const cameFromAbove = prevCrateY + crate.h <= solid.y + 6;
          const cameFromBelow = prevCrateY >= solid.y + solid.h - 6 && solid.id !== 'floor-main';
          const shallowTop = !cameFromBelow && netDy >= 0 && crate.vy >= 0 && overlapTop <= Math.max(14, Math.abs(netDy) + 6);
          const shallowBottom = solid.id !== 'floor-main' && (netDy < 0 || crate.vy < 0) && overlapBottom <= Math.max(14, Math.abs(netDy) + 6);
          if (cameFromAbove || shallowTop) {
            crate.y = solid.y - crate.h;
            if (solid.material === 'bouncy') {
              crate.vy = -(solid.bounceVelocity ?? 680);
              const pad = world.platforms.find((p) => p.id === solid.id);
              if (pad) pad.compression = 1;
              world.metrics.collisionCount += 1;
            } else {
              const bounce = effectiveRestitution(crate.restitution, phys.restitution);
              if (crate.vy > 68 && bounce > 0.08) {
                crate.vy = -crate.vy * bounce;
                world.metrics.collisionCount += 1;
              } else {
                crate.vy = 0;
                crate.grounded = true;
              }
            }
          } else if (cameFromBelow || shallowBottom) {
            crate.y = solid.y + solid.h;
            const bounce = effectiveRestitution(crate.restitution, phys.restitution);
            crate.vy = Math.abs(crate.vy) > 65 ? -crate.vy * bounce : 0;
          }
        }
      }
      if (crate.y > world.height - 48 - crate.h) {
        crate.y = world.height - 48 - crate.h;
        crate.vy = 0;
        crate.grounded = true;
      }
      if (crate.y < 24) {
        crate.y = 24;
        crate.vy = Math.max(0, crate.vy);
      }

      // Crate-on-crate vertical stacking & restitution
      for (const other of world.crates) {
        if (other.id === crate.id || heldCrateIds.has(other.id)) continue;
        if (rectsOverlap(crate, other)) {
          const prevBottom = prevCrateY + crate.h;
          if (crate.vy >= 0 && prevBottom <= other.y + 10) {
            crate.y = other.y - crate.h;
            const relVy = crate.vy - other.vy;
            const e = effectiveRestitution(Math.max(crate.restitution, other.restitution), phys.restitution);
            if (relVy > 85 && e > 0.12) {
              const invM1 = 1 / crate.mass;
              const invM2 = 1 / other.mass;
              const j = (-(1 + e) * relVy) / (invM1 + invM2);
              crate.vy += j * invM1;
              other.vy -= j * invM2;
              world.metrics.collisionCount += 1;
            } else {
              crate.vy = other.vy;
              crate.grounded = true;
            }
          } else if (crate.vy < 0 && prevCrateY >= other.y + other.h - 10) {
            crate.y = other.y + other.h;
            crate.vy = 0;
          }
        }
      }

      // Hazard safety respawn for crates
      for (const haz of world.hazards) {
        if (rectsOverlap(crate, haz)) {
          crate.x = crate.spawnX;
          crate.y = crate.spawnY;
          crate.vx = 0;
          crate.vy = 0;
          crate.angle = 0;
          crate.angularVel = 0;
          crateRespawned = true;
          break;
        }
      }
      if (crateRespawned) break;
    }

    // Angular rotation for rolling balls & subtle tumble for airborne boxes
    if (!crateRespawned) {
      if (crate.shape === 'ball') {
        const radius = crate.w * 0.5;
        if (crate.grounded) {
          crate.angularVel = crate.vx / Math.max(8, radius);
        } else {
          crate.angularVel *= Math.exp(-0.4 * clampedDt);
        }
        crate.angle += crate.angularVel * clampedDt;
      } else {
        if (!crate.grounded && Math.abs(crate.vx) > 40) {
          crate.angularVel = clamp(crate.vx * 0.008, -2.5, 2.5);
          crate.angle = clamp(crate.angle + crate.angularVel * clampedDt, -0.22, 0.22);
        } else {
          crate.angle += (0 - crate.angle) * Math.min(1, 16 * clampedDt);
          crate.angularVel = 0;
        }
      }
    }
  }

  // 3. Update Actors
  for (const actor of world.actors) {
    actor.squashX += (1 - actor.squashX) * Math.min(1, 14 * clampedDt);
    actor.squashY += (1 - actor.squashY) * Math.min(1, 14 * clampedDt);
    if (actor.respawnTimer > 0) {
      actor.respawnTimer = Math.max(0, actor.respawnTimer - clampedDt);
    }

    const rawInput = inputs[actor.id] ?? { move: 0, jump: false, interact: false };
    const moveDir: -1 | 0 | 1 = rawInput.move > 0 ? 1 : rawInput.move < 0 ? -1 : 0;
    const jumpHeld = Boolean(rawInput.jump);
    const interactHeld = Boolean(rawInput.interact);
    const grabHeld = Boolean(rawInput.grab);
    const jumpJustPressed = jumpHeld && !actor.prevJumpHeld;
    const jumpJustReleased = !jumpHeld && actor.prevJumpHeld;
    const interactJustPressed = interactHeld && !actor.prevInteractHeld;
    const grabJustPressed = grabHeld && !actor.prevGrabHeld;

    if (
      rawInput.intent &&
      (rawInput.intent !== actor.lastInput.intent ||
        rawInput.targetId !== actor.lastInput.targetId)
    ) {
      actor.decisionsCount += 1;
      world.metrics.decisionsLogged += 1;
      const ev = makeEvent(
        world.tick,
        'agent:decision',
        `${actor.label}: ${rawInput.intent}${rawInput.reason ? ` — ${rawInput.reason}` : ''}`,
        actor.id,
        rawInput.targetId
      );
      newEvents.push(ev);
      pushWorldEvent(world, ev);
    }

    if (
      moveDir !== actor.lastInput.move ||
      jumpJustPressed ||
      interactJustPressed ||
      grabJustPressed
    ) {
      actor.actionCount += 1;
    }

    actor.lastInput = {
      ...rawInput,
      move: moveDir,
      jump: jumpHeld,
      interact: interactHeld,
      grab: grabHeld,
    };
    if (typeof rawInput.message === 'string' && rawInput.message.trim().length > 0) {
      recordAgentMessage(
        world,
        actor.id,
        rawInput.message,
        {
          kind: rawInput.messageKind,
          targetId: rawInput.claimTargetId ?? rawInput.targetId,
          channel: rawInput.messageChannel,
        },
        newEvents
      );
    }
    actor.prevJumpHeld = jumpHeld;
    actor.prevInteractHeld = interactHeld;
    actor.prevGrabHeld = grabHeld;

    if (moveDir !== 0) actor.facing = moveDir;

    // Grab / Throw toggle
    if (grabJustPressed) {
      if (actor.holdingCrateId) {
        const held = world.crates.find((c) => c.id === actor.holdingCrateId);
        if (held) {
          if (moveDir === 0 && actor.grounded) {
            // Set it down just ahead of the boots, but never inside a wall. If the
            // space ahead is blocked, fall back to the actor's feet, then behind.
            const aheadX =
              actor.x + actor.w * 0.5 + actor.facing * (actor.w * 0.5 + held.w * 0.5 + 3) - held.w * 0.5;
            const centerX = actor.x + (actor.w - held.w) * 0.5;
            const behindX =
              actor.x + actor.w * 0.5 - actor.facing * (actor.w * 0.5 + held.w * 0.5 + 3) - held.w * 0.5;
            const dropY = clamp(actor.y + actor.h - held.h, 26, world.height - 48 - held.h);
            const candidates = [aheadX, centerX, behindX];
            let chosenX = centerX;
            let foundDrop = false;
            const isFree = (candidateX: number) => {
              const x = clamp(candidateX, 26, world.width - 26 - held.w);
              const probe = { x, y: dropY, w: held.w, h: held.h };
              return !staticSolids.some((solid) => rectsOverlap(probe, solid));
            };
            for (const candidateX of candidates) {
              if (isFree(candidateX)) {
                chosenX = candidateX;
                foundDrop = true;
                break;
              }
            }
            // Tight corner: search outward from the feet for the nearest free patch.
            if (!foundDrop) {
              const baseX = clamp(centerX, 26, world.width - 26 - held.w);
              for (let offset = 4; offset <= 120 && !foundDrop; offset += 4) {
                for (const dir of [-1, 1]) {
                  const candidateX = baseX + dir * offset;
                  if (candidateX < 26 || candidateX > world.width - 26 - held.w) continue;
                  if (isFree(candidateX)) {
                    chosenX = candidateX;
                    foundDrop = true;
                    break;
                  }
                }
              }
            }
            held.x = clamp(chosenX, 26, world.width - 26 - held.w);
            held.y = dropY;
            held.vx = 0;
            held.vy = 0;
            held.grounded = true;
          } else {
            held.vx = actor.vx + actor.facing * 260 * phys.pushForce / Math.sqrt(held.mass);
            held.vy = actor.vy - 170 * phys.pushForce / Math.sqrt(held.mass);
            held.grounded = false;
          }
          resolveCrateStaticClearance(held, staticSolids, world);
        }
        actor.holdingCrateId = null;
      } else {
        const acx = actor.x + actor.w * 0.5;
        const acy = actor.y + actor.h * 0.5;
        let nearest: CrateState | null = null;
        let bestDist = 48;
        for (const c of world.crates) {
          const ccx = c.x + c.w * 0.5;
          const ccy = c.y + c.h * 0.5;
          if (Math.abs(ccy - acy) > 46) continue;
          if (segmentCrossesSolid(acx, acy, ccx, ccy, staticSolids)) continue;
          const d = Math.hypot(ccx - acx, ccy - acy);
          if (d < bestDist) {
            bestDist = d;
            nearest = c;
          }
        }
        if (nearest) {
          // Turn into the pick rather than grabbing through the character's back.
          actor.facing = nearest.x + nearest.w * 0.5 >= acx ? 1 : -1;
          actor.holdingCrateId = nearest.id;
        }
      }
    }

    if (actor.grounded) {
      actor.coyoteTimer = COYOTE_TIME;
    } else {
      actor.coyoteTimer = Math.max(0, actor.coyoteTimer - clampedDt);
    }

    if (jumpJustPressed) {
      actor.jumpBufferTimer = JUMP_BUFFER;
    } else {
      actor.jumpBufferTimer = Math.max(0, actor.jumpBufferTimer - clampedDt);
    }

    // Surface friction & conveyor belt effects for actor
    const iceMult = actor.grounded && actor.groundedMaterial === 'ice' ? 0.14 : 1.0;
    const frictionMult = phys.surfaceFriction * iceMult;
    const targetVx = moveDir * RUN_SPEED;

    if (moveDir !== 0) {
      const accel = actor.grounded ? GROUND_ACCEL * Math.max(0.22, frictionMult) : AIR_ACCEL;
      actor.vx = approach(actor.vx, targetVx, accel * clampedDt);
    } else {
      const decel = actor.grounded
        ? GROUND_FRICTION * frictionMult
        : AIR_DRAG * (0.4 + phys.airDrag);
      actor.vx = approach(actor.vx, 0, decel * clampedDt);
    }

    if (actor.grounded) {
      for (const solid of staticSolids) {
        if (
          solid.material === 'conveyor' &&
          solid.conveyorSpeed &&
          actor.x + actor.w > solid.x + 1 &&
          actor.x < solid.x + solid.w - 1 &&
          Math.abs(actor.y + actor.h - solid.y) <= 3
        ) {
          actor.x += solid.conveyorSpeed * clampedDt;
        }
      }
    }

    // Jump (coyote + buffered)
    if (actor.jumpBufferTimer > 0 && actor.coyoteTimer > 0) {
      actor.vy = -JUMP_SPEED;
      actor.grounded = false;
      actor.coyoteTimer = 0;
      actor.jumpBufferTimer = 0;
      actor.lastJumpTick = world.tick;
      actor.squashX = 0.84;
      actor.squashY = 1.18;
    }

    // Variable jump height cut
    if (jumpJustReleased && actor.vy < -120) {
      actor.vy *= 0.45;
    }

    // Gravity + Air Drag + Force Zones
    actor.vy = clamp(actor.vy + phys.gravity * clampedDt, -MAX_FALL_SPEED, MAX_FALL_SPEED);
    if (!actor.grounded && phys.airDrag > 0.01) {
      actor.vy *= Math.exp(-phys.airDrag * 0.28 * clampedDt);
    }
    for (const fz of world.forceZones) {
      if (rectsOverlap(actor, fz)) {
        actor.vx = clamp(actor.vx + (fz.fx / actor.mass) * clampedDt, -900, 900);
        actor.vy = clamp(actor.vy + (fz.fy / actor.mass) * clampedDt, -900, 900);
      }
    }

    // Move horizontally & apply mass-weighted push impulse to crates
    const actorAnchor = preCarryActorPos.get(actor.id) ?? { x: actor.x, y: actor.y };
    actor.x += actor.vx * clampedDt;
    if ((actor.knockbackTimer ?? 0) > 0) {
      actor.x += (actor.knockbackVx ?? 0) * clampedDt;
      actor.knockbackVx = (actor.knockbackVx ?? 0) * Math.exp(-7 * clampedDt);
      actor.knockbackTimer = Math.max(0, (actor.knockbackTimer ?? 0) - clampedDt);
    }
    const netActorDx = actor.x - actorAnchor.x;
    const actorPushSign = Math.sign(actor.vx) || Math.sign(netActorDx);

    for (const crate of world.crates) {
      if (crate.id === actor.holdingCrateId) continue;
      if (rectsOverlap(actor, crate)) {
        const actorCenterY = actor.y + actor.h * 0.5;
        const crateTop = crate.y;
        const crateBottom = crate.y + crate.h;
        if (actorCenterY > crateTop - 4 && actor.y < crateBottom - 4) {
          const pushCap = (CRATE_PUSH_SPEED * phys.pushForce) / Math.pow(crate.mass, 0.45);
          if (actorPushSign > 0 && actor.x + actor.w > crate.x && actor.x < crate.x) {
            const pushDist = Math.min(pushCap * clampedDt, actor.x + actor.w - crate.x);
            const prevCrateX = crate.x;
            crate.x += pushDist;
            crate.vx = Math.max(crate.vx, pushCap * 0.72);
            for (const solid of staticSolids) {
              if (rectsOverlap(crate, solid)) {
                crate.x = solid.x - crate.w;
              }
            }
            for (const otherCrate of world.crates) {
              if (otherCrate.id !== crate.id && rectsOverlap(crate, otherCrate)) {
                crate.x = otherCrate.x - crate.w;
              }
            }
            if (crate.x === prevCrateX) {
              actor.x = crate.x - actor.w;
              actor.vx = 0;
            } else {
              actor.x = crate.x - actor.w;
            }
          } else if (actorPushSign < 0 && actor.x < crate.x + crate.w && actor.x + actor.w > crate.x + crate.w) {
            const pushDist = Math.min(pushCap * clampedDt, crate.x + crate.w - actor.x);
            const prevCrateX = crate.x;
            crate.x -= pushDist;
            crate.vx = Math.min(crate.vx, -pushCap * 0.72);
            for (const solid of staticSolids) {
              if (rectsOverlap(crate, solid)) {
                crate.x = solid.x + solid.w;
              }
            }
            for (const otherCrate of world.crates) {
              if (otherCrate.id !== crate.id && rectsOverlap(crate, otherCrate)) {
                crate.x = otherCrate.x + otherCrate.w;
              }
            }
            if (crate.x === prevCrateX) {
              actor.x = crate.x + crate.w;
              actor.vx = 0;
            } else {
              actor.x = crate.x + crate.w;
            }
          }
        }
      }
    }

    for (const solid of staticSolids) {
      if (rectsOverlap(actor, solid)) {
        const overlapLeft = actor.x + actor.w - solid.x;
        const overlapRight = solid.x + solid.w - actor.x;
        const overlapTop = actor.y + actor.h - solid.y;
        const overlapBottom = solid.y + solid.h - actor.y;
        const minX = Math.min(overlapLeft, overlapRight);
        const minY = Math.min(overlapTop, overlapBottom);
        const verticalLandingOverlap =
          (actorAnchor.y + actor.h <= solid.y + 4 || actorAnchor.y >= solid.y + solid.h - 4) &&
          minY < minX;
        if (verticalLandingOverlap) continue;

        if (solid.id === 'wall-left') {
          actor.x = solid.x + solid.w;
        } else if (solid.id === 'wall-right') {
          actor.x = solid.x - actor.w;
        } else if (actor.vx > 0 || (actor.vx === 0 && netActorDx > 0) || actorAnchor.x + actor.w <= solid.x + 2) {
          actor.x = solid.x - actor.w;
        } else if (actor.vx < 0 || (actor.vx === 0 && netActorDx < 0) || actorAnchor.x >= solid.x + solid.w - 2) {
          actor.x = solid.x + solid.w;
        } else if (minX <= minY) {
          actor.x = overlapLeft <= overlapRight ? solid.x - actor.w : solid.x + solid.w;
        }
        actor.vx = 0;
      }
    }
    actor.x = clamp(actor.x, 24, world.width - 24 - actor.w);

    // Move vertically
    const prevY = actorAnchor.y;
    const wasGrounded = actor.grounded;
    actor.y += actor.vy * clampedDt;
    actor.grounded = false;
    actor.groundedMaterial = 'standard';

    for (const solid of staticSolids) {
      if (rectsOverlap(actor, solid)) {
        const netActorDy = actor.y - prevY;
        const overlapTop = actor.y + actor.h - solid.y;
        const overlapBottom = solid.y + solid.h - actor.y;
        const cameFromAbove = prevY + actor.h <= solid.y + 6;
        const cameFromBelow = prevY >= solid.y + solid.h - 6 && solid.id !== 'floor-main';
        const shallowTop = !cameFromBelow && netActorDy >= 0 && actor.vy >= 0 && overlapTop <= Math.max(14, Math.abs(netActorDy) + 6);
        const shallowBottom = solid.id !== 'floor-main' && (netActorDy < 0 || actor.vy < 0) && overlapBottom <= Math.max(14, Math.abs(netActorDy) + 6);
        if (cameFromAbove || shallowTop) {
          actor.y = solid.y - actor.h;
          if (solid.material === 'bouncy') {
            actor.vy = -(solid.bounceVelocity ?? 680);
            actor.squashX = 0.78;
            actor.squashY = 1.24;
            const pad = world.platforms.find((p) => p.id === solid.id);
            if (pad) pad.compression = 1;
          } else {
            if (!wasGrounded && actor.vy > 180) {
              actor.squashX = 1.2;
              actor.squashY = 0.8;
            }
            actor.vy = 0;
            actor.grounded = true;
            actor.groundedMaterial = solid.material;
          }
        } else if (cameFromBelow || shallowBottom) {
          actor.y = solid.y + solid.h;
          actor.vy = 0;
        }
      }
    }
    if (actor.y > world.height - 48 - actor.h) {
      actor.y = world.height - 48 - actor.h;
      actor.vy = 0;
      actor.grounded = true;
    }
    if (actor.y < 24) {
      actor.y = 24;
      actor.vy = Math.max(0, actor.vy);
    }

    // Stand on top of crates
    for (const crate of world.crates) {
      if (crate.id === actor.holdingCrateId) continue;
      if (rectsOverlap(actor, crate)) {
        const prevBottom = prevY + actor.h;
        if (actor.vy >= 0 && prevBottom <= crate.y + 8) {
          const impactSpeed = actor.vy;
          actor.y = crate.y - actor.h;
          if (!wasGrounded && impactSpeed > 180) {
            actor.squashX = 1.18;
            actor.squashY = 0.82;
          }
          // Landing on a dynamic body transfers momentum instead of treating
          // it as a static shelf. Balls roll and bounce the actor; boxes take
          // a smaller nudge and remain stable standing surfaces.
          let bouncedOffBall = false;
          if (!wasGrounded && impactSpeed > 80) {
            const actorCx = actor.x + actor.w * 0.5;
            const crateCx = crate.x + crate.w * 0.5;
            const dir = Math.sign(actorCx - crateCx) || Math.sign(actor.vx) || actor.facing || 1;
            const massRatio = actor.mass / Math.max(0.3, actor.mass + crate.mass);
            if (crate.shape === 'ball') {
              const kick = Math.min(460, impactSpeed * 0.95) * massRatio;
              crate.vx += dir * kick;
              crate.angularVel = crate.vx / Math.max(10, crate.w * 0.5);
              if (!crate.grounded) crate.vy += impactSpeed * massRatio * 0.35;
              const bounce = Math.min(0.62, crate.restitution * 0.8);
              if (bounce > 0.05) {
                actor.vy = -impactSpeed * bounce;
                actor.grounded = false;
                bouncedOffBall = true;
              }
            } else {
              crate.vx +=
                (dir * Math.min(130, impactSpeed * 0.2) * massRatio) / Math.max(0.55, crate.mass);
              if (!crate.grounded) crate.vy += impactSpeed * massRatio * 0.22;
            }
            world.metrics.collisionCount += 1;
          }
          if (!bouncedOffBall) {
            actor.vy = 0;
            actor.grounded = true;
            // A rolling ball slips out from under the actor; boxes and
            // platforms carry their rider because they are stable surfaces.
            if (crate.shape !== 'ball') actor.x += crate.vx * clampedDt;
          }
        } else if (actor.vy < 0 && prevY >= crate.y + crate.h - 8) {
          actor.y = crate.y + crate.h;
          actor.vy = 0;
        }
      }
    }

    // Rolling bodies shove actors sideways instead of passing through them.
    for (const crate of world.crates) {
      if (crate.id === actor.holdingCrateId) continue;
      if (!rectsOverlap(actor, crate)) continue;
      if (actor.y + actor.h <= crate.y + 4) continue; // standing on top
      const actorCx = actor.x + actor.w * 0.5;
      const crateCx = crate.x + crate.w * 0.5;
      const dir = Math.sign(actorCx - crateCx) || (crate.vx > 0 ? 1 : -1);
      // Only moving *toward* the actor counts as an impact. A crate being
      // pushed by this actor is moving away; resolving that as a collision
      // would push the actor back and break pushing entirely.
      if (crate.vx * dir <= 0) continue;
      actor.x = dir < 0 ? crate.x - actor.w - 0.01 : crate.x + crate.w + 0.01;
      const relVx = (crate.vx - actor.vx) * dir;
      if (relVx > 0) {
        const invM1 = 1 / crate.mass;
        const invM2 = 1 / Math.max(0.2, actor.mass);
        const j = (1.05 * relVx) / (invM1 + invM2);
        actor.vx += (j * invM2) * dir;
        actor.knockbackVx = (j * invM2) * dir;
        actor.knockbackTimer = 0.4;
        crate.vx -= (j * invM1) * dir;
        world.metrics.collisionCount += 1;
      }
    }

    // One-way teammate head-boost (collaborative stacking)
    if (actor.vy >= 0) {
      const prevBottom = prevY + actor.h;
      for (const other of world.actors) {
        if (other.id === actor.id) continue;
        if (
          actor.x + actor.w > other.x + 3 &&
          actor.x < other.x + other.w - 3 &&
          prevBottom <= other.y + 8 &&
          actor.y + actor.h >= other.y
        ) {
          actor.y = other.y - actor.h;
          actor.vy = 0;
          actor.grounded = true;
        }
      }
    }

    // Keep held crate positioned cleanly in front/above carrier without clipping through walls or locked gates
    if (actor.holdingCrateId) {
      const held = world.crates.find((c) => c.id === actor.holdingCrateId);
      if (held) {
        // Carry directly over the crown so the hands, cradle and silhouette share one axis.
        held.x = clamp(
          actor.x + (actor.w - held.w) * 0.5,
          26,
          world.width - 26 - held.w
        );
        held.y = clamp(actor.y - held.h - 6, 26, world.height - 48 - held.h);
        resolveCrateStaticClearance(held, staticSolids, world);
        held.vx = actor.vx;
        held.vy = actor.vy;
        held.angle = 0;
        held.angularVel = 0;
      } else {
        actor.holdingCrateId = null;
      }
    }

    // Interact with Switches
    if (interactJustPressed) {
      const actorCx = actor.x + actor.w * 0.5;
      const actorCy = actor.y + actor.h * 0.5;
      for (const sw of world.switches) {
        if (sw.cooldown > 0) continue;
        const swCx = sw.x + sw.w * 0.5;
        const swCy = sw.y + sw.h * 0.5;
        const dist = Math.hypot(actorCx - swCx, actorCy - swCy);
        if (dist <= 46) {
          sw.active = !sw.active;
          sw.cooldown = 0.25;
          world.metrics.switchToggles += 1;
          const ev = makeEvent(
            world.tick,
            'switch:toggled',
            `${actor.label} toggled ${sw.label} (${sw.active ? 'ON' : 'OFF'})`,
            actor.id,
            sw.id
          );
          newEvents.push(ev);
          pushWorldEvent(world, ev);
        }
      }
    }

    // Hazard check -> safe respawn
    for (const haz of world.hazards) {
      if (rectsOverlap(actor, haz)) {
        const spawn = level.spawns[actor.spawnIndex % level.spawns.length] ?? { x: 64, y: 430 };
        actor.x = spawn.x;
        actor.y = spawn.y;
        actor.vx = 0;
        actor.vy = 0;
        actor.holdingCrateId = null;
        actor.respawnTimer = 0.6;
        world.metrics.respawns += 1;
        const ev = makeEvent(
          world.tick,
          'actor:respawn',
          `${actor.label} hit ${haz.kind === 'spikes' ? 'spike' : 'plasma'} hazard and respawned`,
          actor.id,
          haz.id
        );
        newEvents.push(ev);
        pushWorldEvent(world, ev);
      }
    }
  }

  // Standing on a teammate is a real relationship, not just a collision result.
  // Recompute it after every actor has moved, so both participants get the same
  // classification in the same tick.
  const priorStack = new Map(
    world.actors.map((actor) => [actor.id, { on: actor.standingOnActorId, kind: actor.stackKind }])
  );
  for (const actor of world.actors) {
    actor.standingOnActorId = null;
    actor.supportingActorId = null;
    actor.stackKind = null;
  }
  for (const top of world.actors) {
    if (!top.grounded || top.respawnTimer > 0) continue;
    for (const bottom of world.actors) {
      if (bottom.id === top.id || bottom.respawnTimer > 0) continue;
      const overlap = Math.min(top.x + top.w, bottom.x + bottom.w) - Math.max(top.x, bottom.x);
      if (overlap < 6) continue;
      if (Math.abs(top.y + top.h - bottom.y) > 2.5) continue;
      // A stack keeps the classification it was formed with. Re-deriving it every
      // tick made a deliberate stack turn "accidental" after 1.8 s of standing.
      const prior = priorStack.get(top.id);
      const continuing = prior && prior.on === bottom.id ? prior.kind : null;
      const deliberate = top.lastJumpTick !== undefined && world.tick - top.lastJumpTick <= 110;
      top.standingOnActorId = bottom.id;
      top.stackKind = continuing ?? (deliberate ? 'deliberate' : 'accidental');
      bottom.supportingActorId = top.id;
      bottom.stackKind = top.stackKind;
      break;
    }
  }

  for (const sw of world.switches) {
    if (sw.cooldown > 0) sw.cooldown = Math.max(0, sw.cooldown - clampedDt);
  }

  // 4. Evaluate Pressure Plates
  for (const plate of world.plates) {
    const pressedBy: string[] = [];
    const sensorRect: Rect = {
      x: plate.x - 2,
      y: plate.y - 6,
      w: plate.w + 4,
      h: plate.h + 8,
    };

    for (const actor of world.actors) {
      if (rectsOverlap(actor, sensorRect)) {
        pressedBy.push(actor.label);
      }
    }
    for (const crate of world.crates) {
      if (!heldCrateIds.has(crate.id) && rectsOverlap(crate, sensorRect)) {
        pressedBy.push(crate.label);
      }
    }

    const wasActive = plate.active;
    if (plate.mode === 'latch') {
      if (pressedBy.length > 0) plate.active = true;
    } else {
      plate.active = pressedBy.length > 0;
    }
    plate.pressedBy = pressedBy;

    if (!wasActive && plate.active) {
      world.metrics.plateActivations += 1;
      const ev = makeEvent(
        world.tick,
        'plate:activated',
        `${plate.label} (CH-${plate.channel}) activated by ${pressedBy.join(', ')}`,
        undefined,
        plate.id
      );
      newEvents.push(ev);
      pushWorldEvent(world, ev);
    } else if (wasActive && !plate.active) {
      const ev = makeEvent(
        world.tick,
        'plate:released',
        `${plate.label} (CH-${plate.channel}) released`,
        undefined,
        plate.id
      );
      newEvents.push(ev);
      pushWorldEvent(world, ev);
    }
  }

  // 5. Compute Channel States
  const nextChannels: Record<ChannelId, boolean> = { A: false, B: false, C: false };
  for (const plate of world.plates) {
    if (plate.active) nextChannels[plate.channel] = true;
  }
  for (const sw of world.switches) {
    if (sw.active) nextChannels[sw.channel] = true;
  }
  world.channels = nextChannels;

  // 6. Update Doors
  for (const door of world.doors) {
    const shouldBeOpen = evaluateDoorOpen(door, world);
    if (shouldBeOpen !== door.open) {
      door.open = shouldBeOpen;
      const linkNote =
        door.linkedIds && door.linkedIds.length > 0
          ? `${door.channels.join('+')}${door.channels.length ? '+' : ''}${door.linkedIds.length} link`
          : `CH ${door.channels.join('+')}`;
      const ev = makeEvent(
        world.tick,
        shouldBeOpen ? 'door:opened' : 'door:closed',
        `${door.label} ${shouldBeOpen ? 'OPENED' : 'LOCKED'} (${linkNote})`,
        undefined,
        door.id
      );
      newEvents.push(ev);
      pushWorldEvent(world, ev);
    }
    const targetOpen = door.open ? 1 : 0;
    door.openProgress = approach(door.openProgress, targetOpen, 4.5 * clampedDt);
  }

  // 7. Compute total kinetic energy across all bodies
  let ke = 0;
  for (const a of world.actors) {
    ke += 0.5 * a.mass * (a.vx * a.vx + a.vy * a.vy);
  }
  for (const c of world.crates) {
    ke += 0.5 * c.mass * (c.vx * c.vx + c.vy * c.vy);
  }
  world.metrics.totalKineticEnergy = Number((ke / 1000).toFixed(1));

  // 8. Evaluate Exit Zone Completion
  const exitChannelsSatisfied = evaluateLinkedControl(
    world,
    world.exit.requiredChannels,
    world.exit.linkedIds,
    world.exit.logic ?? 'ALL'
  );
  let atExitCount = 0;
  for (const actor of world.actors) {
    actor.onExit = exitChannelsSatisfied && rectsOverlap(actor, world.exit);
    if (actor.onExit) atExitCount += 1;
  }
  world.metrics.actorsAtExit = atExitCount;

  if (
    !world.solved &&
    world.actors.length > 0 &&
    exitChannelsSatisfied &&
    atExitCount === world.actors.length
  ) {
    world.solved = true;
    world.solvedAtTick = world.tick;
    world.solvedAtSeconds = world.metrics.elapsedSeconds;
    const ev = makeEvent(
      world.tick,
      'puzzle:solved',
      `Puzzle "${world.levelName}" solved in ${world.metrics.elapsedSeconds.toFixed(1)}s (${world.tick} ticks)!`,
      undefined,
      world.exit.id
    );
    newEvents.push(ev);
    pushWorldEvent(world, ev);
  }

  return newEvents;
}

export function buildAgentObservation(world: WorldState, actorId: string): AgentObservation | null {
  const self = world.actors.find((a) => a.id === actorId);
  if (!self) return null;

  const exitUnlocked = evaluateLinkedControl(
    world,
    world.exit.requiredChannels,
    world.exit.linkedIds,
    world.exit.logic ?? 'ALL'
  );

  return {
    tick: world.tick,
    levelId: world.levelId,
    isSandbox: world.isSandbox,
    solved: world.solved,
    physics: { ...world.physics },
    self: {
      id: self.id,
      name: self.name,
      x: Math.round(self.x * 10) / 10,
      y: Math.round(self.y * 10) / 10,
      vx: Math.round(self.vx * 10) / 10,
      vy: Math.round(self.vy * 10) / 10,
      grounded: self.grounded,
      onExit: self.onExit,
      facing: self.facing,
      holdingCrateId: self.holdingCrateId,
    },
    teammates: world.actors
      .filter((a) => a.id !== actorId)
      .map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        x: Math.round(t.x * 10) / 10,
        y: Math.round(t.y * 10) / 10,
        vx: Math.round(t.vx * 10) / 10,
        vy: Math.round(t.vy * 10) / 10,
        grounded: t.grounded,
        onExit: t.onExit,
        intent: t.lastInput.intent,
        targetId: t.lastInput.targetId,
        claimTargetId: t.lastInput.claimTargetId,
        message: t.lastInput.message,
      })),
    channels: { ...world.channels },
    plates: world.plates.map((p) => ({
      id: p.id,
      label: p.label,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      channel: p.channel,
      mode: p.mode,
      active: p.active,
      pressedBy: [...p.pressedBy],
    })),
    switches: world.switches.map((s) => ({
      id: s.id,
      label: s.label,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      channel: s.channel,
      active: s.active,
    })),
    doors: world.doors.map((d) => ({
      id: d.id,
      label: d.label,
      x: d.x,
      y: d.y,
      w: d.w,
      h: d.h,
      channels: [...d.channels],
      linkedIds: d.linkedIds ? [...d.linkedIds] : [],
      logic: d.logic,
      open: d.open,
    })),
    crates: world.crates.map((c) => ({
      id: c.id,
      label: c.label,
      x: Math.round(c.x * 10) / 10,
      y: Math.round(c.y * 10) / 10,
      w: c.w,
      h: c.h,
      shape: c.shape,
      material: c.material,
      mass: c.mass,
      vx: Math.round(c.vx * 10) / 10,
      vy: Math.round(c.vy * 10) / 10,
    })),
    platforms: world.platforms.map((p) => ({
      id: p.id,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      w: p.w,
      h: p.h,
      kind: p.kind,
      material: p.material,
      conveyorSpeed: p.conveyorSpeed,
      bounceVelocity: p.bounceVelocity,
      channel: p.channel,
      linkedIds: p.linkedIds ? [...p.linkedIds] : [],
      logic: p.logic,
      startPos: p.startPos ? { ...p.startPos } : undefined,
      endPos: p.endPos ? { ...p.endPos } : undefined,
      loopWhenActive: p.loopWhenActive,
    })),
    hazards: world.hazards.map((h) => ({ ...h })),
    forceZones: world.forceZones.map((f) => ({ ...f })),
    messages: world.messages.map((m) => ({ ...m })),
    exit: {
      ...world.exit,
      unlocked: exitUnlocked,
    },
    level: {
      id: world.levelId,
      name: world.levelName,
      subtitle: world.levelSubtitle,
      hint: world.levelHint,
      isSandbox: world.isSandbox,
    },
    clock: {
      tick: world.tick,
      seconds: Math.round(world.metrics.elapsedSeconds * 100) / 100,
      paused: world.paused,
      timeScale: world.timeScale,
    },
    metrics: {
      actorsAtExit: world.metrics.actorsAtExit,
      totalActors: world.metrics.totalActors,
      decisionsLogged: world.metrics.decisionsLogged,
      solvedAtTick: world.solvedAtTick,
    },
    recentEvents: world.events.slice(-12).map((e) => ({
      id: e.id,
      tick: e.tick,
      type: e.type,
      message: e.message,
      actorId: e.actorId,
      entityId: e.entityId,
    })),
  };
}
