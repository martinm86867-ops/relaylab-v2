import type { LevelDefinition } from './types';

export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 540;

export const LEVELS: LevelDefinition[] = [
  {
    id: 'level-1',
    index: 0,
    name: '01. Dual Gate Relay',
    subtitle: 'Hold Plate A so a partner can reach Switch B and unlock the exit.',
    hint: 'One teammate weights Plate A (left pit) to drop Gate A. The second climbs to Switch B (top alcove) to latch Channel B open for everyone.',
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    spawns: [
      { x: 64, y: 430 },
      { x: 112, y: 430 },
      { x: 160, y: 430 },
      { x: 208, y: 430 },
    ],
    platforms: [
      // Outer boundary walls & ceiling
      { id: 'floor-main', x: 0, y: 492, w: 960, h: 48, kind: 'solid' },
      { id: 'wall-left', x: 0, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'wall-right', x: 936, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'ceil-top', x: 0, y: 0, w: 960, h: 24, kind: 'solid' },

      // Left staging steps (easy 60px climb)
      { id: 'step-1', x: 240, y: 432, w: 120, h: 20, kind: 'solid' },
      { id: 'step-2', x: 390, y: 370, w: 140, h: 20, kind: 'solid' },

      // Upper alcove behind Gate A housing Switch B
      { id: 'alcove-floor', x: 260, y: 260, w: 230, h: 22, kind: 'solid' },
      { id: 'alcove-roof', x: 260, y: 120, w: 230, h: 22, kind: 'solid' },
      { id: 'alcove-backwall', x: 260, y: 142, w: 20, h: 118, kind: 'solid' },
      // Step up from step-2 (y=370) to alcove-floor (y=260) via mid-step at y=312
      { id: 'step-mid-right', x: 545, y: 312, w: 105, h: 20, kind: 'solid' },

      // Right side bridge leading to Exit Pad behind Gate B
      { id: 'right-ledge-low', x: 640, y: 432, w: 110, h: 20, kind: 'solid' },
      { id: 'exit-deck', x: 750, y: 370, w: 186, h: 24, kind: 'solid' },
      // Enclosure above exit gate so you must pass through Gate B
      { id: 'exit-wall-top', x: 750, y: 24, w: 22, h: 234, kind: 'solid' },
    ],
    plates: [
      {
        id: 'plate-a',
        label: 'Plate A',
        x: 130,
        y: 480,
        w: 64,
        h: 12,
        channel: 'A',
        mode: 'momentary',
      },
    ],
    switches: [
      {
        id: 'switch-b',
        label: 'Switch B',
        x: 310,
        y: 224,
        w: 28,
        h: 36,
        channel: 'B',
        initialActive: false,
      },
    ],
    doors: [
      {
        id: 'door-a',
        label: 'Gate A',
        x: 468,
        y: 142,
        w: 22,
        h: 118,
        channels: ['A', 'B'],
        logic: 'ANY',
      },
      {
        id: 'door-b',
        label: 'Gate B',
        x: 750,
        y: 258,
        w: 22,
        h: 112,
        channels: ['B'],
        logic: 'ALL',
      },
    ],
    crates: [],
    hazards: [
      { id: 'hazard-1', x: 555, y: 482, w: 70, h: 10, kind: 'plasma' },
    ],
    exit: {
      id: 'exit-1',
      x: 826,
      y: 306,
      w: 76,
      h: 64,
      requiredChannels: ['B'],
    },
  },
  {
    id: 'level-2',
    index: 1,
    name: '02. Crate Counterweight',
    subtitle: 'Raise the bridge lift so a partner can push the crate onto Plate A.',
    hint: 'Toggle Lift Lever B to raise the Elevator Bridge to the crate shelf, push Crate 1 down onto Plate A to hold Gate A open, then climb to the Exit.',
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    spawns: [
      { x: 56, y: 430 },
      { x: 104, y: 430 },
      { x: 152, y: 430 },
      { x: 200, y: 430 },
    ],
    platforms: [
      { id: 'floor-main', x: 0, y: 492, w: 960, h: 48, kind: 'solid' },
      { id: 'wall-left', x: 0, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'wall-right', x: 936, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'ceil-top', x: 0, y: 0, w: 960, h: 24, kind: 'solid' },

      // Left climbing steps with clear sky ascent onto crate shelf
      { id: 'l2-step1', x: 120, y: 428, w: 100, h: 20, kind: 'solid' },
      { id: 'l2-step2', x: 24, y: 364, w: 94, h: 20, kind: 'solid' },
      { id: 'l2-crate-shelf', x: 122, y: 292, w: 172, h: 22, kind: 'solid' },

      // Moving elevator bridge controlled by Channel B (starts lowered at y=430, rises to y=292 when B active)
      {
        id: 'l2-elevator',
        x: 302,
        y: 430,
        w: 116,
        h: 20,
        kind: 'moving',
        startPos: { x: 302, y: 430 },
        endPos: { x: 302, y: 292 },
        speed: 0.7,
        channel: 'B',
      },

      // Right steps & central tower with Gate A
      { id: 'l2-right-step', x: 655, y: 428, w: 100, h: 20, kind: 'solid' },
      { id: 'l2-mid-shelf', x: 540, y: 354, w: 108, h: 20, kind: 'solid' },
      { id: 'l2-upper-bridge', x: 580, y: 292, w: 165, h: 22, kind: 'solid' },
      { id: 'l2-gate-cap', x: 722, y: 24, w: 22, h: 158, kind: 'solid' },

      // Exit deck
      { id: 'l2-exit-deck', x: 745, y: 292, w: 191, h: 24, kind: 'solid' },
    ],
    plates: [
      {
        id: 'plate-a',
        label: 'Plate A',
        x: 446,
        y: 480,
        w: 86,
        h: 12,
        channel: 'A',
        mode: 'momentary',
      },
    ],
    switches: [
      {
        id: 'switch-b',
        label: 'Lift Lever B',
        x: 350,
        y: 456,
        w: 28,
        h: 36,
        channel: 'B',
        initialActive: false,
      },
    ],
    doors: [
      {
        id: 'door-a',
        label: 'Gate A',
        x: 722,
        y: 182,
        w: 22,
        h: 110,
        channels: ['A'],
        logic: 'ALL',
      },
    ],
    crates: [
      {
        id: 'crate-1',
        label: 'Crate 1',
        x: 168,
        y: 262,
        w: 30,
        h: 30,
      },
    ],
    hazards: [
      { id: 'hazard-l2', x: 580, y: 482, w: 46, h: 10, kind: 'plasma' },
    ],
    exit: {
      id: 'exit-2',
      x: 828,
      y: 228,
      w: 76,
      h: 64,
      requiredChannels: ['A'],
    },
  },
  {
    id: 'level-3',
    index: 2,
    name: '03. Lift & Boost',
    subtitle: 'Power the vertical shaft lift, then coordinate upper dual-channel gates.',
    hint: 'Push Crate 1 onto Plate A to power Lift A up the central shaft. On the top tier, one player stands on Plate B so the other can toggle Switch C.',
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    spawns: [
      { x: 58, y: 430 },
      { x: 106, y: 430 },
      { x: 154, y: 430 },
      { x: 202, y: 430 },
    ],
    platforms: [
      { id: 'floor-main', x: 0, y: 492, w: 960, h: 48, kind: 'solid' },
      { id: 'wall-left', x: 0, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'wall-right', x: 936, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'ceil-top', x: 0, y: 0, w: 960, h: 24, kind: 'solid' },

      // Lower barrier forcing shaft lift usage
      { id: 'l3-mid-wall', x: 510, y: 310, w: 24, h: 182, kind: 'solid' },

      // Vertical shaft lift powered by Channel A (cycles between floor and upper deck)
      {
        id: 'l3-shaft-lift',
        x: 376,
        y: 454,
        w: 112,
        h: 18,
        kind: 'moving',
        startPos: { x: 376, y: 454 },
        endPos: { x: 376, y: 244 },
        speed: 0.52,
        channel: 'A',
        loopWhenActive: true,
      },

      // Upper left & center deck
      { id: 'l3-upper-left', x: 24, y: 224, w: 330, h: 22, kind: 'solid' },
      // Upper right deck
      { id: 'l3-upper-right', x: 510, y: 224, w: 426, h: 22, kind: 'solid' },

      // Lower right chamber behind mid-wall (accessible by dropping from upper right or crossing)
      { id: 'l3-step-r1', x: 640, y: 380, w: 120, h: 20, kind: 'solid' },
      { id: 'l3-step-r2', x: 785, y: 310, w: 125, h: 20, kind: 'solid' },

      // Gate dividers on upper tier
      { id: 'l3-gate-b-cap', x: 618, y: 24, w: 22, h: 88, kind: 'solid' },
      { id: 'l3-gate-c-cap', x: 786, y: 24, w: 22, h: 88, kind: 'solid' },
    ],
    plates: [
      {
        id: 'plate-a',
        label: 'Plate A',
        x: 260,
        y: 480,
        w: 70,
        h: 12,
        channel: 'A',
        mode: 'momentary',
      },
      {
        id: 'plate-b',
        label: 'Plate B',
        x: 130,
        y: 212,
        w: 66,
        h: 12,
        channel: 'B',
        mode: 'momentary',
      },
    ],
    switches: [
      {
        id: 'switch-c',
        label: 'Switch C',
        x: 694,
        y: 188,
        w: 28,
        h: 36,
        channel: 'C',
        initialActive: false,
      },
    ],
    doors: [
      {
        id: 'door-b',
        label: 'Gate B',
        x: 618,
        y: 112,
        w: 22,
        h: 112,
        channels: ['B', 'C'],
        logic: 'ANY',
      },
      {
        id: 'door-c',
        label: 'Gate C',
        x: 786,
        y: 112,
        w: 22,
        h: 112,
        channels: ['C'],
        logic: 'ALL',
      },
    ],
    crates: [
      {
        id: 'crate-1',
        label: 'Crate 1',
        x: 195,
        y: 462,
        w: 30,
        h: 30,
      },
    ],
    hazards: [
      { id: 'hazard-l3', x: 550, y: 482, w: 72, h: 10, kind: 'plasma' },
    ],
    exit: {
      id: 'exit-3',
      x: 836,
      y: 160,
      w: 76,
      h: 64,
      requiredChannels: ['C'],
    },
  },
  {
    id: 'level-4',
    index: 3,
    name: '04. Tri-Channel Vault',
    subtitle: 'Sequence dual crates, an active ferry, and a final compound gate.',
    hint: 'Use Crate 1 on Plate A to run the Horizontal Ferry. Use Switch B to open Gate B for Crate 2, then weight Plate C so the Vault Gate (A+C) opens.',
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    spawns: [
      { x: 56, y: 430 },
      { x: 102, y: 430 },
      { x: 148, y: 430 },
      { x: 194, y: 430 },
    ],
    platforms: [
      { id: 'floor-main', x: 0, y: 492, w: 960, h: 48, kind: 'solid' },
      { id: 'wall-left', x: 0, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'wall-right', x: 936, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'ceil-top', x: 0, y: 0, w: 960, h: 24, kind: 'solid' },

      // Left steps
      { id: 'l4-step1', x: 240, y: 428, w: 100, h: 20, kind: 'solid' },
      { id: 'l4-mid-left', x: 90, y: 360, w: 150, h: 20, kind: 'solid' },
      { id: 'l4-upper-left', x: 24, y: 286, w: 170, h: 22, kind: 'solid' },

      // Horizontal ferry powered by Channel A
      {
        id: 'l4-ferry',
        x: 215,
        y: 286,
        w: 112,
        h: 18,
        kind: 'moving',
        startPos: { x: 215, y: 286 },
        endPos: { x: 430, y: 286 },
        speed: 0.42,
        channel: 'A',
        loopWhenActive: true,
      },

      // Center plateau with Crate 2 behind Gate B (aligned drop directly over Plate C)
      { id: 'l4-center-deck', x: 545, y: 286, w: 140, h: 22, kind: 'solid' },
      { id: 'l4-center-roof', x: 545, y: 140, w: 140, h: 20, kind: 'solid' },

      // Lower right deck & Vault
      { id: 'l4-right-step', x: 485, y: 428, w: 110, h: 20, kind: 'solid' },
      { id: 'l4-vault-wall', x: 786, y: 24, w: 22, h: 356, kind: 'solid' },
    ],
    plates: [
      {
        id: 'plate-a',
        label: 'Plate A',
        x: 365,
        y: 480,
        w: 66,
        h: 12,
        channel: 'A',
        mode: 'momentary',
      },
      {
        id: 'plate-c',
        label: 'Plate C',
        x: 640,
        y: 480,
        w: 76,
        h: 12,
        channel: 'C',
        mode: 'momentary',
      },
    ],
    switches: [
      {
        id: 'switch-b',
        label: 'Switch B',
        x: 92,
        y: 250,
        w: 28,
        h: 36,
        channel: 'B',
        initialActive: false,
      },
    ],
    doors: [
      {
        id: 'door-b',
        label: 'Gate B',
        x: 548,
        y: 160,
        w: 22,
        h: 126,
        channels: ['B'],
        logic: 'ALL',
      },
      {
        id: 'door-vault',
        label: 'Vault Gate',
        x: 786,
        y: 380,
        w: 22,
        h: 112,
        channels: ['A', 'C'],
        logic: 'ALL',
      },
    ],
    crates: [
      {
        id: 'crate-1',
        label: 'Crate 1',
        x: 286,
        y: 462,
        w: 30,
        h: 30,
      },
      {
        id: 'crate-2',
        label: 'Crate 2',
        x: 610,
        y: 256,
        w: 30,
        h: 30,
      },
    ],
    hazards: [
      { id: 'hazard-l4', x: 446, y: 482, w: 42, h: 10, kind: 'plasma' },
    ],
    exit: {
      id: 'exit-4',
      x: 840,
      y: 428,
      w: 76,
      h: 64,
      requiredChannels: ['A', 'C'],
    },
  },
  {
    id: 'level-5',
    index: 4,
    name: '05. Cascade Foundry',
    subtitle: 'Keep the plate weighted while a partner rides the lift and threads two gated switches.',
    hint: 'Push Crate 1 onto Plate A to raise Gate A and drive the lift. Ride the lift to the upper deck, toggle Switch B, then Switch C; the exit needs A, B and C held together.',
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    spawns: [
      { x: 56, y: 430 },
      { x: 102, y: 430 },
      { x: 148, y: 430 },
      { x: 194, y: 430 },
    ],
    platforms: [
      { id: 'floor-main', x: 0, y: 492, w: 960, h: 48, kind: 'solid' },
      { id: 'wall-left', x: 0, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'wall-right', x: 936, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'ceil-top', x: 0, y: 0, w: 960, h: 24, kind: 'solid' },

      // No upper bypass: the launch pad is the only route once Gate A opens.
      // Upper maintenance deck reached by the Channel A lift or the launch pad
      { id: 'l5-upper-deck', x: 620, y: 320, w: 140, h: 20, kind: 'solid' },
      {
        id: 'l5-lift',
        x: 520,
        y: 454,
        w: 96,
        h: 18,
        kind: 'moving',
        startPos: { x: 520, y: 454 },
        endPos: { x: 520, y: 320 },
        speed: 0.5,
        channel: 'A',
        loopWhenActive: true,
      },

      // Right exit deck behind Gate B
      { id: 'l5-exit-deck', x: 760, y: 380, w: 176, h: 24, kind: 'solid' },

      // High-restitution launch pad under the upper deck
      { id: 'l5-launch', x: 640, y: 478, w: 92, h: 14, kind: 'solid', material: 'bouncy', bounceVelocity: 820 },

      // Low ice lip before the plate; makes the crate push feel slippery
      { id: 'l5-ice', x: 300, y: 484, w: 92, h: 8, kind: 'solid', material: 'ice' },
    ],
    plates: [
      {
        id: 'plate-a',
        label: 'Plate A',
        x: 236,
        y: 480,
        w: 70,
        h: 12,
        channel: 'A',
        mode: 'momentary',
      },
    ],
    switches: [
      {
        id: 'switch-b',
        label: 'Switch B',
        x: 650,
        y: 284,
        w: 28,
        h: 36,
        channel: 'B',
        initialActive: false,
      },
      {
        id: 'switch-c',
        label: 'Switch C',
        x: 872,
        y: 344,
        w: 28,
        h: 36,
        channel: 'C',
        initialActive: false,
      },
    ],
    doors: [
      {
        id: 'door-a',
        label: 'Gate A',
        x: 480,
        y: 332,
        w: 22,
        h: 160,
        channels: ['A'],
        logic: 'ALL',
      },
      {
        id: 'door-b',
        label: 'Gate B',
        x: 760,
        y: 320,
        w: 22,
        h: 172,
        channels: ['B'],
        logic: 'ALL',
      },
    ],
    crates: [
      {
        id: 'crate-1',
        label: 'Crate 1',
        x: 150,
        y: 462,
        w: 30,
        h: 30,
        shape: 'box',
        material: 'wood',
        mass: 1.2,
      },
    ],
    hazards: [
      { id: 'hazard-l5', x: 530, y: 482, w: 74, h: 10, kind: 'plasma' },
    ],
    exit: {
      id: 'exit-5',
      x: 824,
      y: 316,
      w: 76,
      h: 64,
      requiredChannels: ['A', 'B', 'C'],
    },
  },
  {
    id: 'sandbox',
    index: 5,
    name: '06. Physics Sandbox',
    subtitle: 'Experiment with gravity, elastic collisions, ice, bounce pads, and wind tunnels.',
    hint: 'Use the Sandbox tab to spawn crates, kinetic spheres, ice strips, bounce pads, or updrafts, fling bodies with your cursor, or tune gravity & restitution in real time.',
    isSandbox: true,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    spawns: [
      { x: 60, y: 430 },
      { x: 108, y: 430 },
      { x: 156, y: 430 },
      { x: 204, y: 430 },
    ],
    platforms: [
      { id: 'floor-main', x: 0, y: 492, w: 960, h: 48, kind: 'solid' },
      { id: 'wall-left', x: 0, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'wall-right', x: 936, y: 0, w: 24, h: 540, kind: 'solid' },
      { id: 'ceil-top', x: 0, y: 0, w: 960, h: 24, kind: 'solid' },

      // Low-friction ice rink flush on floor
      { id: 'sb-ice-strip', x: 250, y: 484, w: 170, h: 8, kind: 'solid', material: 'ice' },

      // Mid-tier conveyor deck & stepping ledges
      { id: 'sb-step-left', x: 96, y: 386, w: 130, h: 18, kind: 'solid' },
      { id: 'sb-conveyor', x: 350, y: 368, w: 170, h: 18, kind: 'solid', material: 'conveyor', conveyorSpeed: 115 },
      { id: 'sb-upper-shelf', x: 130, y: 248, w: 180, h: 18, kind: 'solid' },
      { id: 'sb-high-pad', x: 430, y: 214, w: 145, h: 18, kind: 'solid' },

      // High-restitution trampoline launch pad
      { id: 'sb-bounce-pad', x: 585, y: 478, w: 86, h: 14, kind: 'solid', material: 'bouncy', bounceVelocity: 700 },

      // Right exit deck & optional gate divider
      { id: 'sb-exit-deck', x: 785, y: 300, w: 151, h: 22, kind: 'solid' },
      { id: 'sb-gate-cap', x: 785, y: 24, w: 20, h: 164, kind: 'solid' },
    ],
    plates: [
      {
        id: 'plate-a',
        label: 'Plate A',
        x: 470,
        y: 480,
        w: 70,
        h: 12,
        channel: 'A',
        mode: 'momentary',
      },
    ],
    switches: [
      {
        id: 'switch-b',
        label: 'Switch B',
        x: 196,
        y: 212,
        w: 28,
        h: 36,
        channel: 'B',
        initialActive: false,
      },
    ],
    doors: [
      {
        id: 'door-a',
        label: 'Gate A',
        x: 785,
        y: 188,
        w: 20,
        h: 112,
        channels: ['A', 'B'],
        logic: 'ANY',
      },
    ],
    crates: [
      {
        id: 'crate-1',
        label: 'Wood 1',
        x: 270,
        y: 454,
        w: 30,
        h: 30,
        shape: 'box',
        material: 'wood',
        mass: 1.2,
      },
      {
        id: 'crate-2',
        label: 'Poly 1',
        x: 272,
        y: 420,
        w: 26,
        h: 26,
        shape: 'box',
        material: 'polymer',
        mass: 0.65,
      },
      {
        id: 'crate-3',
        label: 'Steel 1',
        x: 155,
        y: 352,
        w: 32,
        h: 32,
        shape: 'box',
        material: 'steel',
        mass: 2.8,
      },
      {
        id: 'ball-1',
        label: 'Ball 1',
        x: 400,
        y: 260,
        w: 28,
        h: 28,
        shape: 'ball',
        material: 'rubber',
        mass: 0.8,
        restitution: 0.74,
      },
    ],
    hazards: [],
    forceZones: [
      {
        id: 'fz-updraft',
        label: 'Updraft',
        x: 690,
        y: 160,
        w: 84,
        h: 332,
        fx: 0,
        fy: -1950,
      },
    ],
    exit: {
      id: 'exit-sb',
      x: 842,
      y: 236,
      w: 76,
      h: 64,
      requiredChannels: ['A', 'B'],
    },
  },
];

export const DEFAULT_PHYSICS_CONFIG = {
  gravity: 1450,
  airDrag: 0.35,
  surfaceFriction: 1.0,
  restitution: 0.35,
  pushForce: 1.0,
  actorMass: 1.0,
};

export const PHYSICS_PRESETS = {
  earth: {
    label: 'Earth',
    gravity: 1450,
    airDrag: 0.35,
    surfaceFriction: 1.0,
    restitution: 0.35,
    pushForce: 1.0,
    actorMass: 1.0,
  },
  moon: {
    label: 'Moon',
    gravity: 260,
    airDrag: 0.08,
    surfaceFriction: 0.85,
    restitution: 0.45,
    pushForce: 1.0,
    actorMass: 1.0,
  },
  zero_g: {
    label: 'Low-G',
    gravity: 45,
    airDrag: 0.05,
    surfaceFriction: 0.4,
    restitution: 0.75,
    pushForce: 1.2,
    actorMass: 1.0,
  },
  jupiter: {
    label: 'Heavy-G',
    gravity: 2450,
    airDrag: 0.55,
    surfaceFriction: 1.35,
    restitution: 0.18,
    pushForce: 1.45,
    actorMass: 1.25,
  },
  super_bounce: {
    label: 'Elastic',
    gravity: 1150,
    airDrag: 0.12,
    surfaceFriction: 0.45,
    restitution: 0.9,
    pushForce: 1.3,
    actorMass: 1.0,
  },
} as const;

export function getLevelById(id: string): LevelDefinition {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}
