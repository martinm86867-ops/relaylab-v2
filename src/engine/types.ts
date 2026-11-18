export type ChannelId = 'A' | 'B' | 'C';

export type ActorRole = 'human' | 'agent';

export type PlatformMaterial = 'standard' | 'ice' | 'bouncy' | 'conveyor';

export type DynamicBodyShape = 'box' | 'ball';

export type DynamicBodyMaterial = 'wood' | 'steel' | 'polymer' | 'rubber';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhysicsConfig {
  gravity: number;         // px/s^2 (default 1450)
  airDrag: number;         // dimensionless exponential damping (default 0.35)
  surfaceFriction: number; // global friction multiplier (default 1.0)
  restitution: number;     // global bounce multiplier (default 0.35)
  pushForce: number;       // actor push strength multiplier (default 1.0)
  actorMass: number;       // actor inertial mass (default 1.0)
}

export type AgentMessageKind = 'status' | 'claim' | 'request' | 'alert';

export interface AgentMessage {
  id: string;
  tick: number;
  timestamp: number;
  actorId: string;
  actorLabel: string;
  actorName: string;
  actorColor: string;
  text: string;
  kind: AgentMessageKind;
  targetId?: string;
  channel?: ChannelId;
}

export interface ActorInput {
  move: -1 | 0 | 1;
  jump: boolean;
  interact: boolean;
  grab?: boolean;
  intent?: string;
  reason?: string;
  targetId?: string;
  claimTargetId?: string;
  targetPos?: Vec2;
  pathPreview?: Vec2[];
  utility?: number;
  message?: string;
  messageKind?: AgentMessageKind;
  messageChannel?: ChannelId;
}

export interface ActorState {
  id: string;
  name: string;
  role: ActorRole;
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  mass: number;
  grounded: boolean;
  groundedMaterial: PlatformMaterial;
  coyoteTimer: number;
  jumpBufferTimer: number;
  prevJumpHeld: boolean;
  prevInteractHeld: boolean;
  prevGrabHeld: boolean;
  holdingCrateId: string | null;
  facing: 1 | -1;
  onExit: boolean;
  respawnTimer: number;
  spawnIndex: number;
  lastInput: ActorInput;
  lastDecisionAt: number;
  connected: boolean;
  latencyMs: number;
  actionCount: number;
  decisionsCount: number;
  squashX: number;
  squashY: number;
  /** External horizontal shove from a moving body, in px/s. */
  knockbackVx?: number;
  knockbackTimer?: number;
  /** Tick when the actor last left the ground under its own jump input. */
  lastJumpTick?: number;
  /** Set each tick when this actor is standing on a teammate. */
  standingOnActorId?: string | null;
  /** Set each tick when a teammate is standing on this actor. */
  supportingActorId?: string | null;
  /** Why the current stack formed; shared by both participants. */
  stackKind?: 'deliberate' | 'accidental' | null;
  /** How this actor is driven. Absent means the legacy path (WS/direct API). */
  controller?: 'builtin' | 'external' | 'llm';
  provider?: string;
  model?: string;
  controlMode?: LlmControlMode;
  agentStatus?: LlmAgentStatus;
  agentError?: string;
  lastDecisionLatencyMs?: number;
}

export type LlmControlMode = 'hybrid' | 'direct';

export type LlmAgentStatus = 'idle' | 'thinking' | 'acting' | 'error' | 'stopped';

export interface PlatformDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'solid' | 'moving';
  material?: PlatformMaterial;
  bounceVelocity?: number;
  conveyorSpeed?: number;
  sandboxPlaced?: boolean;
  startPos?: Vec2;
  endPos?: Vec2;
  speed?: number; // progress units per second (0..1)
  channel?: ChannelId; // if set, moves toward endPos when channel active, returns when inactive
  linkedIds?: string[]; // explicit switch/plate trigger IDs
  logic?: 'ALL' | 'ANY';
  loopWhenActive?: boolean; // if true, oscillates between startPos and endPos while channel active
}

export interface PlatformState extends PlatformDef {
  material: PlatformMaterial;
  progress: number;
  direction: 1 | -1;
  vx: number;
  vy: number;
  compression: number; // 0..1 visual spring compression for bouncy pads
}

export interface PlateDef {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  channel: ChannelId;
  mode: 'momentary' | 'latch';
  sandboxPlaced?: boolean;
}

export interface PlateState extends PlateDef {
  active: boolean;
  pressedBy: string[];
}

export interface SwitchDef {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  channel: ChannelId;
  initialActive?: boolean;
  sandboxPlaced?: boolean;
}

export interface SwitchState extends SwitchDef {
  active: boolean;
  cooldown: number;
}

export interface DoorDef {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  channels: ChannelId[];
  linkedIds?: string[];
  logic: 'ALL' | 'ANY';
  sandboxPlaced?: boolean;
}

export interface DoorState extends DoorDef {
  open: boolean;
  openProgress: number; // 0 = closed, 1 = open
}

export interface CrateDef {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: DynamicBodyShape;
  material?: DynamicBodyMaterial;
  mass?: number;
  restitution?: number;
  friction?: number;
  sandboxPlaced?: boolean;
}

export interface CrateState extends CrateDef {
  shape: DynamicBodyShape;
  material: DynamicBodyMaterial;
  mass: number;
  restitution: number;
  friction: number;
  vx: number;
  vy: number;
  angle: number;
  angularVel: number;
  grounded: boolean;
  spawnX: number;
  spawnY: number;
}

export interface HazardDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'plasma' | 'spikes';
  sandboxPlaced?: boolean;
}

export interface ForceZoneDef {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fx: number; // horizontal acceleration px/s^2
  fy: number; // vertical acceleration px/s^2 (negative = updraft)
  sandboxPlaced?: boolean;
}

export interface ExitZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  requiredChannels: ChannelId[];
  linkedIds?: string[];
  logic?: 'ALL' | 'ANY';
}

export interface LevelDefinition {
  id: string;
  index: number;
  name: string;
  subtitle: string;
  hint: string;
  isSandbox?: boolean;
  width: number;
  height: number;
  spawns: Vec2[];
  platforms: PlatformDef[];
  plates: PlateDef[];
  switches: SwitchDef[];
  doors: DoorDef[];
  crates: CrateDef[];
  hazards: HazardDef[];
  forceZones?: ForceZoneDef[];
  exit: ExitZone;
}

export interface ImpulseEffect {
  id: string;
  x: number;
  y: number;
  radius: number;
  tick: number;
}

export interface TelemetryEvent {
  id: string;
  tick: number;
  timestamp: number;
  type:
    | 'actor:joined'
    | 'actor:left'
    | 'plate:activated'
    | 'plate:released'
    | 'switch:toggled'
    | 'door:opened'
    | 'door:closed'
    | 'crate:settled'
    | 'actor:respawn'
    | 'agent:decision'
    | 'agent:message'
    | 'level:loaded'
    | 'puzzle:solved'
    | 'sandbox:edit'
    | 'physics:updated'
    | 'api:command';
  actorId?: string;
  entityId?: string;
  message: string;
}

export interface WorldMetrics {
  totalTicks: number;
  elapsedSeconds: number;
  tickComputeMs: number;
  decisionsLogged: number;
  plateActivations: number;
  switchToggles: number;
  respawns: number;
  actorsAtExit: number;
  totalActors: number;
  totalKineticEnergy: number;
  collisionCount: number;
}

export interface WorldState {
  levelId: string;
  levelIndex: number;
  levelName: string;
  levelSubtitle: string;
  levelHint: string;
  isSandbox: boolean;
  width: number;
  height: number;
  tick: number;
  paused: boolean;
  timeScale: number;
  solved: boolean;
  solvedAtTick: number | null;
  solvedAtSeconds: number | null;
  physics: PhysicsConfig;
  channels: Record<ChannelId, boolean>;
  actors: ActorState[];
  platforms: PlatformState[];
  plates: PlateState[];
  switches: SwitchState[];
  doors: DoorState[];
  crates: CrateState[];
  hazards: HazardDef[];
  forceZones: ForceZoneDef[];
  recentImpulses: ImpulseEffect[];
  exit: ExitZone;
  messages: AgentMessage[];
  events: TelemetryEvent[];
  metrics: WorldMetrics;
}

export interface AgentObservation {
  tick: number;
  levelId: string;
  isSandbox: boolean;
  solved: boolean;
  physics: PhysicsConfig;
  self: {
    id: string;
    name: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
    grounded: boolean;
    onExit: boolean;
    facing: 1 | -1;
    holdingCrateId: string | null;
  };
  teammates: Array<{
    id: string;
    name: string;
    role: ActorRole;
    x: number;
    y: number;
    vx: number;
    vy: number;
    grounded: boolean;
    onExit: boolean;
    intent?: string;
    targetId?: string;
    claimTargetId?: string;
    message?: string;
  }>;
  channels: Record<ChannelId, boolean>;
  plates: Array<{ id: string; label: string; x: number; y: number; w: number; h: number; channel: ChannelId; mode: 'momentary' | 'latch'; active: boolean; pressedBy: string[] }>;
  switches: Array<{ id: string; label: string; x: number; y: number; w: number; h: number; channel: ChannelId; active: boolean }>;
  doors: Array<{ id: string; label: string; x: number; y: number; w: number; h: number; channels: ChannelId[]; linkedIds?: string[]; logic: 'ALL' | 'ANY'; open: boolean }>;
  crates: Array<{ id: string; label: string; x: number; y: number; w: number; h: number; shape: DynamicBodyShape; material: DynamicBodyMaterial; mass: number; vx: number; vy: number }>;
  platforms: Array<{ id: string; x: number; y: number; w: number; h: number; kind: 'solid' | 'moving'; material: PlatformMaterial; conveyorSpeed?: number; bounceVelocity?: number; channel?: ChannelId; linkedIds?: string[]; logic?: 'ALL' | 'ANY'; startPos?: Vec2; endPos?: Vec2; loopWhenActive?: boolean }>;
  hazards: Array<{ id: string; x: number; y: number; w: number; h: number; kind: 'plasma' | 'spikes' }>;
  forceZones: ForceZoneDef[];
  messages: AgentMessage[];
  exit: ExitZone & { unlocked: boolean };
  /** Static level metadata for LLM system context. Optional for backwards compatibility. */
  level?: {
    id: string;
    name: string;
    subtitle: string;
    hint: string;
    isSandbox: boolean;
  };
  /** Wall-clock-ish simulation clock, not a transport timestamp. */
  clock?: {
    tick: number;
    seconds: number;
    paused: boolean;
    timeScale: number;
  };
  metrics?: {
    actorsAtExit: number;
    totalActors: number;
    decisionsLogged: number;
    solvedAtTick: number | null;
  };
  /** Last few public telemetry events (no hidden server state). */
  recentEvents?: Array<{
    id: string;
    tick: number;
    type: string;
    message: string;
    actorId?: string;
    entityId?: string;
  }>;
}

export interface TraceRecord {
  tick: number;
  elapsedSeconds: number;
  channels: Record<ChannelId, boolean>;
  totalKineticEnergy: number;
  actors: Array<{
    id: string;
    role: ActorRole;
    x: number;
    y: number;
    vx: number;
    vy: number;
    intent?: string;
    move: number;
    jump: boolean;
  }>;
  events: TelemetryEvent[];
}

export type SandboxSpawnKind =
  | 'crate_wood'
  | 'crate_steel'
  | 'crate_polymer'
  | 'ball_rubber'
  | 'platform_solid'
  | 'platform_ice'
  | 'platform_bouncy'
  | 'platform_conveyor'
  | 'plate'
  | 'switch'
  | 'door'
  | 'hazard'
  | 'force_updraft'
  | 'force_wind';

export interface EditableEntityPatch {
  label?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  material?: PlatformMaterial | DynamicBodyMaterial;
  conveyorSpeed?: number;
  bounceVelocity?: number;
  kind?: 'solid' | 'moving';
  hazardKind?: 'plasma' | 'spikes';
  startPos?: Vec2;
  endPos?: Vec2;
  speed?: number;
  loopWhenActive?: boolean;
  channel?: ChannelId | null;
  channels?: ChannelId[];
  requiredChannels?: ChannelId[];
  linkedIds?: string[];
  logic?: 'ALL' | 'ANY';
  fx?: number;
  fy?: number;
  mode?: 'momentary' | 'latch';
  active?: boolean;
  shape?: DynamicBodyShape;
  mass?: number;
  restitution?: number;
  friction?: number;
}

export type SandboxAction =
  | {
      action: 'spawn';
      kind: SandboxSpawnKind;
      x: number;
      y: number;
      w?: number;
      h?: number;
      channel?: ChannelId;
      vx?: number;
      vy?: number;
    }
  | {
      action: 'remove';
      entityId: string;
    }
  | {
      action: 'fling';
      entityId: string;
      vx: number;
      vy: number;
    }
  | {
      action: 'move';
      entityId: string;
      x: number;
      y: number;
    }
  | {
      action: 'update_entity';
      entityId: string;
      patch: EditableEntityPatch;
    }
  | {
      action: 'toggle_wire';
      sourceId: string;
      targetId: string;
      mode?: 'attach' | 'detach' | 'toggle';
    }
  | {
      action: 'duplicate';
      entityId: string;
    }
  | {
      action: 'blast';
      x: number;
      y: number;
      radius?: number;
      strength?: number;
    }
  | {
      action: 'clear_spawned';
    };

export type ClientWsMessage =
  | {
      type: 'register';
      role: ActorRole | 'observer';
      name?: string;
      actorId?: string;
    }
  | {
      type: 'input';
      actorId: string;
      input: ActorInput;
    }
  | {
      type: 'message';
      actorId?: string;
      text: string;
      kind?: AgentMessageKind;
      targetId?: string;
      channel?: ChannelId;
    }
  | {
      type: 'control';
      command:
        | 'pause'
        | 'resume'
        | 'step'
        | 'reset'
        | 'set_timescale'
        | 'load_level'
        | 'spawn_agent'
        | 'remove_agent'
        | 'toggle_human'
        | 'set_physics'
        | 'apply_physics_preset';
      value?: number | string | boolean | Partial<PhysicsConfig>;
    }
  | {
      type: 'sandbox';
      payload: SandboxAction;
    }
  | {
      type: 'ping';
      clientTime: number;
    };

export type ServerWsMessage =
  | {
      type: 'welcome';
      clientId: string;
      assignedActorId: string | null;
      role: ActorRole | 'observer';
      world: WorldState;
    }
  | {
      type: 'state';
      world: WorldState;
      observation?: AgentObservation;
    }
  | {
      type: 'pong';
      clientTime: number;
      serverTime: number;
    }
  | {
      type: 'error';
      message: string;
    };

