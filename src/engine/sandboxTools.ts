import type { ChannelId, SandboxSpawnKind } from './types';

export type SandboxToolId =
  | 'pointer'
  | 'edit'
  | 'wire'
  | 'fling'
  | 'blast'
  | 'eraser'
  | SandboxSpawnKind;

export interface SandboxToolSpec {
  id: SandboxToolId;
  label: string;
  category: 'interact' | 'body' | 'surface' | 'logic';
  defaultW: number;
  defaultH: number;
  hint: string;
}

export const SANDBOX_TOOLS: SandboxToolSpec[] = [
  {
    id: 'pointer',
    label: 'Play',
    category: 'interact',
    defaultW: 0,
    defaultH: 0,
    hint: 'Focus arena for keyboard play',
  },
  {
    id: 'edit',
    label: 'Select & Edit',
    category: 'interact',
    defaultW: 0,
    defaultH: 0,
    hint: 'Click any platform, force zone, switch, gate, or prop to move, resize & configure',
  },
  {
    id: 'wire',
    label: 'Wire Logic',
    category: 'interact',
    defaultW: 0,
    defaultH: 0,
    hint: 'Drag from a Switch or Plate to a Gate, Moving Lift, or Exit to attach/detach',
  },
  {
    id: 'fling',
    label: 'Fling',
    category: 'interact',
    defaultW: 0,
    defaultH: 0,
    hint: 'Drag any crate, ball, or actor and release to launch',
  },
  {
    id: 'blast',
    label: 'Blast',
    category: 'interact',
    defaultW: 175,
    defaultH: 175,
    hint: 'Click anywhere to trigger a radial physics shockwave',
  },
  {
    id: 'eraser',
    label: 'Erase',
    category: 'interact',
    defaultW: 0,
    defaultH: 0,
    hint: 'Click any placed prop, platform, crate, or zone to remove',
  },
  {
    id: 'crate_wood',
    label: 'Wood Crate',
    category: 'body',
    defaultW: 30,
    defaultH: 30,
    hint: '1.2 kg balanced wooden crate',
  },
  {
    id: 'crate_steel',
    label: 'Steel Block',
    category: 'body',
    defaultW: 32,
    defaultH: 32,
    hint: '2.8 kg heavy high-inertia steel block',
  },
  {
    id: 'crate_polymer',
    label: 'Light Cube',
    category: 'body',
    defaultW: 26,
    defaultH: 26,
    hint: '0.65 kg lightweight agile cube',
  },
  {
    id: 'ball_rubber',
    label: 'Kinetic Ball',
    category: 'body',
    defaultW: 28,
    defaultH: 28,
    hint: '0.8 kg rolling high-restitution rubber sphere',
  },
  {
    id: 'platform_solid',
    label: 'Platform',
    category: 'surface',
    defaultW: 132,
    defaultH: 18,
    hint: 'Standard solid ledge',
  },
  {
    id: 'platform_ice',
    label: 'Ice Strip',
    category: 'surface',
    defaultW: 132,
    defaultH: 18,
    hint: 'Ultra-low friction slippery surface',
  },
  {
    id: 'platform_bouncy',
    label: 'Bounce Pad',
    category: 'surface',
    defaultW: 88,
    defaultH: 14,
    hint: 'Spring pad launching bodies upward',
  },
  {
    id: 'platform_conveyor',
    label: 'Conveyor',
    category: 'surface',
    defaultW: 132,
    defaultH: 18,
    hint: 'Motorized belt propelling crates & actors right',
  },
  {
    id: 'force_updraft',
    label: 'Updraft',
    category: 'surface',
    defaultW: 84,
    defaultH: 210,
    hint: 'Vertical air tunnel lifting objects against gravity',
  },
  {
    id: 'force_wind',
    label: 'Crosswind',
    category: 'surface',
    defaultW: 160,
    defaultH: 88,
    hint: 'Horizontal airflow acceleration zone',
  },
  {
    id: 'plate',
    label: 'Plate',
    category: 'logic',
    defaultW: 68,
    defaultH: 12,
    hint: 'Weight-triggered channel plate',
  },
  {
    id: 'switch',
    label: 'Switch',
    category: 'logic',
    defaultW: 28,
    defaultH: 36,
    hint: 'Toggleable [E] channel lever',
  },
  {
    id: 'door',
    label: 'Gate',
    category: 'logic',
    defaultW: 22,
    defaultH: 108,
    hint: 'Channel-linked energy barrier',
  },
  {
    id: 'hazard',
    label: 'Plasma',
    category: 'logic',
    defaultW: 64,
    defaultH: 10,
    hint: 'Reset hazard strip',
  },
];

export interface SandboxCanvasSelection {
  tool: SandboxToolId;
  channel: ChannelId;
  snapToGrid: boolean;
  selectedEntityId?: string | null;
}
