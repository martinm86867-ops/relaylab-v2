import { useEffect, useRef } from 'react';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../engine/levels';
import { SANDBOX_TOOLS, type SandboxCanvasSelection } from '../engine/sandboxTools';
import type {
  AgentMessage,
  ChannelId,
  SandboxAction,
  SandboxSpawnKind,
  Vec2,
  WorldState,
} from '../engine/types';
import { soundFX } from '../utils/sound';
import {
  createActorAnimState,
  drawActorCharacter,
  updateActorAnimState,
  type ActorAnimState,
  type ParticleSpawnFn,
} from './actorRenderer';

interface GameCanvasProps {
  worldRef: React.RefObject<WorldState | null>;
  humanActorId: string | null;
  showAgentPlans: boolean;
  sandboxSelection?: SandboxCanvasSelection;
  onSandboxAction?: (action: SandboxAction) => void;
  onSelectEntity?: (entityId: string | null) => void;
  onCanvasFocus?: () => void;
}

const CHANNEL_COLORS: Record<ChannelId, string> = {
  A: '#F59E0B',
  B: '#10B981',
  C: '#A78BFA',
};

type ParticleShape = 'circle' | 'square' | 'spark' | 'ring';

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  shape: ParticleShape;
  gravityScale: number;
}

interface AmbientMote {
  x: number;
  y: number;
  vy: number;
  vx: number;
  r: number;
  alpha: number;
}

type EditDragKind =
  | 'move'
  | 'resize-r'
  | 'resize-l'
  | 'resize-b'
  | 'resize-t'
  | 'resize-br'
  | 'vector'
  | 'endPos';

interface EditDragState {
  entityId: string;
  kind: EditDragKind;
  startPt: Vec2;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  origFx: number;
  origFy: number;
  origEndX: number;
  origEndY: number;
  resizable: boolean;
  isCrate: boolean;
}

const POOL_SIZE = 160;
const PROTECTED_IDS = new Set(['floor-main', 'wall-left', 'wall-right', 'ceil-top']);

const AMBIENT_MOTES: AmbientMote[] = Array.from({ length: 24 }, (_, idx) => ({
  x: ((idx * 137) % (WORLD_WIDTH - 80)) + 40,
  y: ((idx * 89) % (WORLD_HEIGHT - 90)) + 40,
  vy: -4 - (idx % 5) * 1.8,
  vx: ((idx % 3) - 1) * 3,
  r: 1 + (idx % 2) * 0.8,
  alpha: 0.08 + (idx % 4) * 0.04,
}));


function wrapBubbleText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  let truncated = false;
  for (const word of words) {
    if (lines.length >= maxLines) {
      truncated = true;
      break;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = '';
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
    }
    let next = word;
    while (next.length > 1 && ctx.measureText(next).width > maxWidth) {
      next = next.slice(0, -1);
      truncated = true;
    }
    current = next;
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  } else if (current) {
    truncated = true;
  }
  if (lines.length === 0) lines.push('');
  if (truncated) {
    const last = lines[lines.length - 1];
    let clipped = last;
    while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
      clipped = clipped.slice(0, -1);
    }
    lines[lines.length - 1] = `${clipped}…`;
  }
  return lines;
}

function drawChatBubble(
  ctx: CanvasRenderingContext2D,
  actor: { w: number },
  anim: { x: number; y: number },
  message: AgentMessage,
  tick: number
): void {
  const age = Math.max(0, tick - message.tick);
  const alpha = age > 200 ? Math.max(0.1, (240 - age) / 40) : 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '500 9px "Plus Jakarta Sans", sans-serif';
  const lines = wrapBubbleText(ctx, message.text.trim(), 150, 2);
  const lineHeight = 10.5;
  let widest = 0;
  for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width);
  const boxW = Math.max(40, Math.min(172, widest + 15));
  const boxH = 7 + lines.length * lineHeight;
  const centerX = Math.max(
    boxW / 2 + 14,
    Math.min(WORLD_WIDTH - boxW / 2 - 14, anim.x + actor.w / 2)
  );
  const boxY = Math.max(8, anim.y - 49 - (lines.length - 1) * lineHeight);
  const accent =
    message.kind === 'request'
      ? 'rgba(245, 158, 11, 0.7)'
      : message.kind === 'alert'
        ? 'rgba(244, 63, 94, 0.7)'
        : message.kind === 'claim'
          ? 'rgba(56, 189, 248, 0.65)'
          : 'rgba(148, 163, 184, 0.45)';

  ctx.fillStyle = 'rgba(2, 6, 12, 0.45)';
  ctx.beginPath();
  ctx.roundRect(centerX - boxW / 2 + 1.5, boxY + 2, boxW, boxH, 5);
  ctx.fill();

  ctx.fillStyle = 'rgba(9, 14, 23, 0.94)';
  ctx.beginPath();
  ctx.roundRect(centerX - boxW / 2, boxY, boxW, boxH, 5);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Small speech tail toward the actor.
  ctx.fillStyle = 'rgba(9, 14, 23, 0.94)';
  ctx.beginPath();
  ctx.moveTo(centerX - 4, boxY + boxH - 0.5);
  ctx.lineTo(centerX + 4, boxY + boxH - 0.5);
  ctx.lineTo(centerX, boxY + boxH + 4.5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#E8F0FA';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i], centerX, boxY + 3.8 + i * lineHeight + lineHeight / 2);
  }
  ctx.restore();
}

export function GameCanvas({
  worldRef,
  humanActorId,
  showAgentPlans,
  sandboxSelection,
  onSandboxAction,
  onSelectEntity,
  onCanvasFocus,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const humanIdRef = useRef<string | null>(humanActorId);
  const showPlansRef = useRef<boolean>(showAgentPlans);
  const sandboxSelRef = useRef<SandboxCanvasSelection>(
    sandboxSelection ?? { tool: 'pointer', channel: 'A', snapToGrid: true, selectedEntityId: null }
  );
  const onSandboxRef = useRef<((a: SandboxAction) => void) | undefined>(onSandboxAction);
  const onSelectRef = useRef<((id: string | null) => void) | undefined>(onSelectEntity);
  const onFocusRef = useRef<(() => void) | undefined>(onCanvasFocus);

  humanIdRef.current = humanActorId;
  showPlansRef.current = showAgentPlans;
  if (sandboxSelection) sandboxSelRef.current = sandboxSelection;
  onSandboxRef.current = onSandboxAction;
  onSelectRef.current = onSelectEntity;
  onFocusRef.current = onCanvasFocus;

  const hoverWorldRef = useRef<Vec2 | null>(null);
  const flingDragRef = useRef<{
    entityId: string;
    label: string;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);

  const editDragRef = useRef<EditDragState | null>(null);
  const lastEditEmitRef = useRef<number>(0);
  const lastClickRef = useRef<{ id: string; time: number } | null>(null);

  const wireDragRef = useRef<{
    sourceId: string;
    sourceLabel: string;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
    color: string;
  } | null>(null);
  const pendingWireSourceRef = useRef<{
    sourceId: string;
    sourceLabel: string;
    x: number;
    y: number;
    color: string;
  } | null>(null);

  const actorAnimsRef = useRef<Map<string, ActorAnimState>>(new Map());
  const platRenderPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const crateRenderPosRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const shakeMagRef = useRef(0);

  const particlesRef = useRef<Particle[]>(
    Array.from({ length: POOL_SIZE }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 3,
      color: '#38BDF8',
      shape: 'square',
      gravityScale: 0.25,
    }))
  );
  const particleCursorRef = useRef(0);
  const prevSolvedRef = useRef(false);
  const prevLevelIdRef = useRef<string | null>(null);
  const prevImpulseIdsRef = useRef<Set<string>>(new Set());
  const cratePrevRef = useRef<Map<string, { vy: number; grounded: boolean }>>(new Map());
  const switchPrevRef = useRef<Map<string, boolean>>(new Map());
  const platePrevRef = useRef<Map<string, boolean>>(new Map());
  const doorPrevRef = useRef<Map<string, boolean>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const triggerShake = (amount: number) => {
      if (prefersReducedMotion) return;
      shakeMagRef.current = Math.min(9, Math.max(shakeMagRef.current, amount));
    };

    const spawnParticles: ParticleSpawnFn = ({
      x,
      y,
      count,
      color,
      spreadVx = 90,
      spreadVy = 110,
      baseVx = 0,
      baseVy = -20,
      size = 2.6,
      life = 0.28,
      shape = 'circle',
      gravityScale = 0.25,
    }) => {
      const pool = particlesRef.current;
      for (let i = 0; i < count; i++) {
        const p = pool[particleCursorRef.current];
        particleCursorRef.current = (particleCursorRef.current + 1) % POOL_SIZE;
        p.active = true;
        p.x = x;
        p.y = y;
        p.vx = baseVx + (Math.random() - 0.5) * 2 * spreadVx;
        p.vy = baseVy - Math.random() * spreadVy;
        p.maxLife = life * (0.75 + Math.random() * 0.55);
        p.life = p.maxLife;
        p.size = size * (0.8 + Math.random() * 0.45);
        p.color = color;
        p.shape = shape;
        p.gravityScale = gravityScale;
      }
    };

    const getViewportTransform = () => {
      const rect = canvas.getBoundingClientRect();
      const cw = Math.max(1, rect.width);
      const ch = Math.max(1, rect.height);
      const scale = Math.min(cw / WORLD_WIDTH, ch / WORLD_HEIGHT);
      const offsetX = (cw - WORLD_WIDTH * scale) * 0.5;
      const offsetY = (ch - WORLD_HEIGHT * scale) * 0.5;
      return { rect, scale, offsetX, offsetY };
    };

    const screenToWorld = (clientX: number, clientY: number): Vec2 => {
      const { rect, scale, offsetX, offsetY } = getViewportTransform();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: Math.max(0, Math.min(WORLD_WIDTH, (sx - offsetX) / scale)),
        y: Math.max(0, Math.min(WORLD_HEIGHT, (sy - offsetY) / scale)),
      };
    };

    const snapCoord = (pt: Vec2): Vec2 => {
      if (!sandboxSelRef.current.snapToGrid) return pt;
      return {
        x: Math.round(pt.x / 16) * 16,
        y: Math.round(pt.y / 16) * 16,
      };
    };

    const findBodyAt = (pt: Vec2): { id: string; label: string; cx: number; cy: number } | null => {
      const w = worldRef.current;
      if (!w) return null;
      for (let i = w.crates.length - 1; i >= 0; i--) {
        const c = w.crates[i];
        if (pt.x >= c.x - 10 && pt.x <= c.x + c.w + 10 && pt.y >= c.y - 10 && pt.y <= c.y + c.h + 10) {
          return { id: c.id, label: c.label, cx: c.x + c.w * 0.5, cy: c.y + c.h * 0.5 };
        }
      }
      for (let i = w.actors.length - 1; i >= 0; i--) {
        const a = w.actors[i];
        if (pt.x >= a.x - 8 && pt.x <= a.x + a.w + 8 && pt.y >= a.y - 8 && pt.y <= a.y + a.h + 8) {
          return { id: a.id, label: a.label, cx: a.x + a.w * 0.5, cy: a.y + a.h * 0.5 };
        }
      }
      return null;
    };

    const findRemovableAt = (pt: Vec2): { id: string; rect: { x: number; y: number; w: number; h: number } } | null => {
      const w = worldRef.current;
      if (!w) return null;
      for (let i = w.crates.length - 1; i >= 0; i--) {
        const c = w.crates[i];
        if (pt.x >= c.x && pt.x <= c.x + c.w && pt.y >= c.y && pt.y <= c.y + c.h) {
          return { id: c.id, rect: c };
        }
      }
      for (let i = w.switches.length - 1; i >= 0; i--) {
        const s = w.switches[i];
        if (pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h) {
          return { id: s.id, rect: s };
        }
      }
      for (let i = w.plates.length - 1; i >= 0; i--) {
        const p = w.plates[i];
        if (pt.x >= p.x && pt.x <= p.x + p.w && pt.y >= p.y - 4 && pt.y <= p.y + p.h + 4) {
          return { id: p.id, rect: p };
        }
      }
      for (let i = w.doors.length - 1; i >= 0; i--) {
        const d = w.doors[i];
        if (pt.x >= d.x && pt.x <= d.x + d.w && pt.y >= d.y && pt.y <= d.y + d.h) {
          return { id: d.id, rect: d };
        }
      }
      for (let i = w.hazards.length - 1; i >= 0; i--) {
        const h = w.hazards[i];
        if (pt.x >= h.x && pt.x <= h.x + h.w && pt.y >= h.y - 6 && pt.y <= h.y + h.h + 6) {
          return { id: h.id, rect: h };
        }
      }
      for (let i = w.platforms.length - 1; i >= 0; i--) {
        const p = w.platforms[i];
        if (PROTECTED_IDS.has(p.id)) continue;
        if (pt.x >= p.x && pt.x <= p.x + p.w && pt.y >= p.y - 4 && pt.y <= p.y + p.h + 4) {
          return { id: p.id, rect: p };
        }
      }
      for (let i = w.forceZones.length - 1; i >= 0; i--) {
        const f = w.forceZones[i];
        if (pt.x >= f.x && pt.x <= f.x + f.w && pt.y >= f.y && pt.y <= f.y + f.h) {
          return { id: f.id, rect: f };
        }
      }
      return null;
    };

    interface SelectableHit {
      id: string;
      kind: 'crate' | 'switch' | 'plate' | 'door' | 'hazard' | 'platform' | 'forceZone' | 'exit';
      x: number;
      y: number;
      w: number;
      h: number;
      resizable: boolean;
    }

    const getEntityById = (id: string | null | undefined): SelectableHit | null => {
      const w = worldRef.current;
      if (!w || !id || PROTECTED_IDS.has(id)) return null;
      const c = w.crates.find((item) => item.id === id);
      if (c) return { id: c.id, kind: 'crate', x: c.x, y: c.y, w: c.w, h: c.h, resizable: false };
      const sw = w.switches.find((item) => item.id === id);
      if (sw) return { id: sw.id, kind: 'switch', x: sw.x, y: sw.y, w: sw.w, h: sw.h, resizable: false };
      const pl = w.plates.find((item) => item.id === id);
      if (pl) return { id: pl.id, kind: 'plate', x: pl.x, y: pl.y, w: pl.w, h: pl.h, resizable: true };
      const d = w.doors.find((item) => item.id === id);
      if (d) return { id: d.id, kind: 'door', x: d.x, y: d.y, w: d.w, h: d.h, resizable: true };
      const hz = w.hazards.find((item) => item.id === id);
      if (hz) return { id: hz.id, kind: 'hazard', x: hz.x, y: hz.y, w: hz.w, h: hz.h, resizable: true };
      const p = w.platforms.find((item) => item.id === id);
      if (p) return { id: p.id, kind: 'platform', x: p.x, y: p.y, w: p.w, h: p.h, resizable: true };
      const fz = w.forceZones.find((item) => item.id === id);
      if (fz) return { id: fz.id, kind: 'forceZone', x: fz.x, y: fz.y, w: fz.w, h: fz.h, resizable: true };
      if (w.exit.id === id) return { id: w.exit.id, kind: 'exit', x: w.exit.x, y: w.exit.y, w: w.exit.w, h: w.exit.h, resizable: true };
      return null;
    };

    const findSelectableAt = (pt: Vec2): SelectableHit | null => {
      const w = worldRef.current;
      if (!w) return null;
      for (let i = w.crates.length - 1; i >= 0; i--) {
        const c = w.crates[i];
        if (pt.x >= c.x - 6 && pt.x <= c.x + c.w + 6 && pt.y >= c.y - 6 && pt.y <= c.y + c.h + 6) {
          return { id: c.id, kind: 'crate', x: c.x, y: c.y, w: c.w, h: c.h, resizable: false };
        }
      }
      for (let i = w.switches.length - 1; i >= 0; i--) {
        const s = w.switches[i];
        if (pt.x >= s.x - 6 && pt.x <= s.x + s.w + 6 && pt.y >= s.y - 6 && pt.y <= s.y + s.h + 6) {
          return { id: s.id, kind: 'switch', x: s.x, y: s.y, w: s.w, h: s.h, resizable: false };
        }
      }
      for (let i = w.plates.length - 1; i >= 0; i--) {
        const p = w.plates[i];
        if (pt.x >= p.x - 4 && pt.x <= p.x + p.w + 4 && pt.y >= p.y - 8 && pt.y <= p.y + p.h + 6) {
          return { id: p.id, kind: 'plate', x: p.x, y: p.y, w: p.w, h: p.h, resizable: true };
        }
      }
      for (let i = w.doors.length - 1; i >= 0; i--) {
        const d = w.doors[i];
        if (pt.x >= d.x - 8 && pt.x <= d.x + d.w + 8 && pt.y >= d.y - 4 && pt.y <= d.y + d.h + 4) {
          return { id: d.id, kind: 'door', x: d.x, y: d.y, w: d.w, h: d.h, resizable: true };
        }
      }
      for (let i = w.hazards.length - 1; i >= 0; i--) {
        const h = w.hazards[i];
        if (pt.x >= h.x - 4 && pt.x <= h.x + h.w + 4 && pt.y >= h.y - 8 && pt.y <= h.y + h.h + 8) {
          return { id: h.id, kind: 'hazard', x: h.x, y: h.y, w: h.w, h: h.h, resizable: true };
        }
      }
      for (let i = w.platforms.length - 1; i >= 0; i--) {
        const p = w.platforms[i];
        if (PROTECTED_IDS.has(p.id)) continue;
        if (pt.x >= p.x - 4 && pt.x <= p.x + p.w + 4 && pt.y >= p.y - 6 && pt.y <= p.y + p.h + 6) {
          return { id: p.id, kind: 'platform', x: p.x, y: p.y, w: p.w, h: p.h, resizable: true };
        }
      }
      if (pt.x >= w.exit.x && pt.x <= w.exit.x + w.exit.w && pt.y >= w.exit.y && pt.y <= w.exit.y + w.exit.h) {
        return { id: w.exit.id, kind: 'exit', x: w.exit.x, y: w.exit.y, w: w.exit.w, h: w.exit.h, resizable: true };
      }
      for (let i = w.forceZones.length - 1; i >= 0; i--) {
        const f = w.forceZones[i];
        if (pt.x >= f.x && pt.x <= f.x + f.w && pt.y >= f.y && pt.y <= f.y + f.h) {
          return { id: f.id, kind: 'forceZone', x: f.x, y: f.y, w: f.w, h: f.h, resizable: true };
        }
      }
      return null;
    };

    const getForceVectorTip = (fz: { x: number; y: number; w: number; h: number; fx: number; fy: number }): Vec2 => {
      const cx = fz.x + fz.w * 0.5;
      const cy = fz.y + fz.h * 0.5;
      return {
        x: cx + Math.max(-75, Math.min(75, fz.fx / 24)),
        y: cy + Math.max(-75, Math.min(75, fz.fy / 24)),
      };
    };

    const findHandleAt = (pt: Vec2, hit: SelectableHit): EditDragKind | null => {
      const w = worldRef.current;
      if (!w) return null;
      if (hit.kind === 'forceZone') {
        const fz = w.forceZones.find((f) => f.id === hit.id);
        if (fz) {
          const tip = getForceVectorTip(fz);
          if (Math.hypot(pt.x - tip.x, pt.y - tip.y) <= 12) return 'vector';
        }
      }
      if (hit.kind === 'platform') {
        const plat = w.platforms.find((p) => p.id === hit.id);
        if (plat && plat.kind === 'moving' && plat.endPos) {
          const endCx = plat.endPos.x + plat.w * 0.5;
          const endCy = plat.endPos.y + plat.h * 0.5;
          if (Math.hypot(pt.x - endCx, pt.y - endCy) <= 14) return 'endPos';
        }
      }
      if (!hit.resizable) return null;
      if (Math.hypot(pt.x - (hit.x + hit.w), pt.y - (hit.y + hit.h)) <= 10) return 'resize-br';
      if (Math.hypot(pt.x - (hit.x + hit.w), pt.y - (hit.y + hit.h * 0.5)) <= 10) return 'resize-r';
      if (Math.hypot(pt.x - hit.x, pt.y - (hit.y + hit.h * 0.5)) <= 10) return 'resize-l';
      if (Math.hypot(pt.x - (hit.x + hit.w * 0.5), pt.y - (hit.y + hit.h)) <= 10) return 'resize-b';
      if (Math.hypot(pt.x - (hit.x + hit.w * 0.5), pt.y - hit.y) <= 10) return 'resize-t';
      return null;
    };

    const findWireSourceAt = (pt: Vec2): { id: string; label: string; cx: number; cy: number; color: string } | null => {
      const w = worldRef.current;
      if (!w) return null;
      for (let i = w.switches.length - 1; i >= 0; i--) {
        const s = w.switches[i];
        if (pt.x >= s.x - 14 && pt.x <= s.x + s.w + 14 && pt.y >= s.y - 14 && pt.y <= s.y + s.h + 14) {
          return { id: s.id, label: s.label, cx: s.x + s.w * 0.5, cy: s.y + s.h * 0.5, color: CHANNEL_COLORS[s.channel] };
        }
      }
      for (let i = w.plates.length - 1; i >= 0; i--) {
        const p = w.plates[i];
        if (pt.x >= p.x - 10 && pt.x <= p.x + p.w + 10 && pt.y >= p.y - 14 && pt.y <= p.y + p.h + 14) {
          return { id: p.id, label: p.label, cx: p.x + p.w * 0.5, cy: p.y + p.h * 0.5, color: CHANNEL_COLORS[p.channel] };
        }
      }
      return null;
    };

    const findWireTargetAt = (pt: Vec2): { id: string; label: string } | null => {
      const w = worldRef.current;
      if (!w) return null;
      for (let i = w.doors.length - 1; i >= 0; i--) {
        const d = w.doors[i];
        if (pt.x >= d.x - 14 && pt.x <= d.x + d.w + 14 && pt.y >= d.y - 10 && pt.y <= d.y + d.h + 10) {
          return { id: d.id, label: d.label };
        }
      }
      for (let i = w.platforms.length - 1; i >= 0; i--) {
        const p = w.platforms[i];
        if (PROTECTED_IDS.has(p.id)) continue;
        if (pt.x >= p.x - 8 && pt.x <= p.x + p.w + 8 && pt.y >= p.y - 10 && pt.y <= p.y + p.h + 10) {
          return { id: p.id, label: p.kind === 'moving' ? 'Moving Lift' : 'Platform' };
        }
      }
      if (pt.x >= w.exit.x - 8 && pt.x <= w.exit.x + w.exit.w + 8 && pt.y >= w.exit.y - 8 && pt.y <= w.exit.y + w.exit.h + 8) {
        return { id: w.exit.id, label: 'Exit Zone' };
      }
      return null;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const pt = screenToWorld(e.clientX, e.clientY);
      hoverWorldRef.current = pt;
      if (flingDragRef.current) {
        flingDragRef.current.curX = pt.x;
        flingDragRef.current.curY = pt.y;
      }
      if (wireDragRef.current) {
        wireDragRef.current.curX = pt.x;
        wireDragRef.current.curY = pt.y;
      }
      const ed = editDragRef.current;
      if (ed) {
        const now = performance.now();
        if (now - lastEditEmitRef.current < 42) return;
        lastEditEmitRef.current = now;
        const snap = (val: number) => (sandboxSelRef.current.snapToGrid ? Math.round(val / 8) * 8 : Math.round(val));
        const dx = pt.x - ed.startPt.x;
        const dy = pt.y - ed.startPt.y;
        const w = worldRef.current;

        if (ed.kind === 'move') {
          onSandboxRef.current?.({
            action: 'update_entity',
            entityId: ed.entityId,
            patch: { x: snap(ed.origX + dx), y: snap(ed.origY + dy) },
          });
        } else if (ed.kind === 'resize-r') {
          onSandboxRef.current?.({
            action: 'update_entity',
            entityId: ed.entityId,
            patch: { w: Math.max(24, snap(ed.origW + dx)) },
          });
        } else if (ed.kind === 'resize-l') {
          const nextW = Math.max(24, snap(ed.origW - dx));
          const nextX = ed.origX + (ed.origW - nextW);
          onSandboxRef.current?.({
            action: 'update_entity',
            entityId: ed.entityId,
            patch: { x: nextX, w: nextW },
          });
        } else if (ed.kind === 'resize-b') {
          onSandboxRef.current?.({
            action: 'update_entity',
            entityId: ed.entityId,
            patch: { h: Math.max(10, snap(ed.origH + dy)) },
          });
        } else if (ed.kind === 'resize-t') {
          const nextH = Math.max(10, snap(ed.origH - dy));
          const nextY = ed.origY + (ed.origH - nextH);
          onSandboxRef.current?.({
            action: 'update_entity',
            entityId: ed.entityId,
            patch: { y: nextY, h: nextH },
          });
        } else if (ed.kind === 'resize-br') {
          onSandboxRef.current?.({
            action: 'update_entity',
            entityId: ed.entityId,
            patch: { w: Math.max(24, snap(ed.origW + dx)), h: Math.max(10, snap(ed.origH + dy)) },
          });
        } else if (ed.kind === 'vector' && w) {
          const fz = w.forceZones.find((f) => f.id === ed.entityId);
          if (fz) {
            const cx = fz.x + fz.w * 0.5;
            const cy = fz.y + fz.h * 0.5;
            onSandboxRef.current?.({
              action: 'update_entity',
              entityId: ed.entityId,
              patch: {
                fx: Math.round((pt.x - cx) * 26),
                fy: Math.round((pt.y - cy) * 26),
              },
            });
          }
        } else if (ed.kind === 'endPos') {
          onSandboxRef.current?.({
            action: 'update_entity',
            entityId: ed.entityId,
            patch: {
              endPos: {
                x: snap(ed.origEndX + dx),
                y: snap(ed.origEndY + dy),
              },
            },
          });
        }
      }
    };

    const handlePointerLeave = () => {
      hoverWorldRef.current = null;
      if (!editDragRef.current && !flingDragRef.current && !wireDragRef.current) {
        return;
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      const sel = sandboxSelRef.current;
      const pt = screenToWorld(e.clientX, e.clientY);
      hoverWorldRef.current = pt;

      if (sel.tool === 'pointer') {
        onFocusRef.current?.();
        return;
      }

      if (sel.tool === 'edit') {
        const w = worldRef.current;
        const selectedHit = getEntityById(sel.selectedEntityId);
        if (selectedHit) {
          const handle = findHandleAt(pt, selectedHit);
          if (handle && w) {
            const fz = w.forceZones.find((f) => f.id === selectedHit.id);
            const plat = w.platforms.find((p) => p.id === selectedHit.id);
            editDragRef.current = {
              entityId: selectedHit.id,
              kind: handle,
              startPt: pt,
              origX: selectedHit.x,
              origY: selectedHit.y,
              origW: selectedHit.w,
              origH: selectedHit.h,
              origFx: fz?.fx ?? 0,
              origFy: fz?.fy ?? 0,
              origEndX: plat?.endPos?.x ?? selectedHit.x,
              origEndY: plat?.endPos?.y ?? selectedHit.y,
              resizable: selectedHit.resizable,
              isCrate: selectedHit.kind === 'crate',
            };
            canvas.setPointerCapture?.(e.pointerId);
            return;
          }
        }

        const hit = findSelectableAt(pt);
        if (hit && w) {
          const now = performance.now();
          if (
            hit.kind === 'switch' &&
            lastClickRef.current &&
            lastClickRef.current.id === hit.id &&
            now - lastClickRef.current.time < 340
          ) {
            const sw = w.switches.find((s) => s.id === hit.id);
            if (sw) {
              onSandboxRef.current?.({
                action: 'update_entity',
                entityId: sw.id,
                patch: { active: !sw.active },
              });
            }
          }
          lastClickRef.current = { id: hit.id, time: now };

          onSelectRef.current?.(hit.id);
          const fz = w.forceZones.find((f) => f.id === hit.id);
          const plat = w.platforms.find((p) => p.id === hit.id);
          editDragRef.current = {
            entityId: hit.id,
            kind: 'move',
            startPt: pt,
            origX: hit.x,
            origY: hit.y,
            origW: hit.w,
            origH: hit.h,
            origFx: fz?.fx ?? 0,
            origFy: fz?.fy ?? 0,
            origEndX: plat?.endPos?.x ?? hit.x,
            origEndY: plat?.endPos?.y ?? hit.y,
            resizable: hit.resizable,
            isCrate: hit.kind === 'crate',
          };
          canvas.setPointerCapture?.(e.pointerId);
        } else {
          onSelectRef.current?.(null);
        }
        return;
      }

      if (sel.tool === 'wire') {
        const pending = pendingWireSourceRef.current;
        if (pending) {
          const tgt = findWireTargetAt(pt);
          if (tgt && tgt.id !== pending.sourceId) {
            onSandboxRef.current?.({
              action: 'toggle_wire',
              sourceId: pending.sourceId,
              targetId: tgt.id,
              mode: 'toggle',
            });
            pendingWireSourceRef.current = null;
            return;
          }
        }
        const src = findWireSourceAt(pt);
        if (src) {
          wireDragRef.current = {
            sourceId: src.id,
            sourceLabel: src.label,
            startX: src.cx,
            startY: src.cy,
            curX: pt.x,
            curY: pt.y,
            color: src.color,
          };
          canvas.setPointerCapture?.(e.pointerId);
        } else {
          pendingWireSourceRef.current = null;
        }
        return;
      }

      if (sel.tool === 'fling') {
        const body = findBodyAt(pt);
        if (body) {
          flingDragRef.current = {
            entityId: body.id,
            label: body.label,
            startX: body.cx,
            startY: body.cy,
            curX: pt.x,
            curY: pt.y,
          };
          canvas.setPointerCapture?.(e.pointerId);
        }
        return;
      }

      if (sel.tool === 'blast') {
        onSandboxRef.current?.({
          action: 'blast',
          x: Math.round(pt.x),
          y: Math.round(pt.y),
          radius: 175,
          strength: 820,
        });
        return;
      }

      if (sel.tool === 'eraser') {
        const target = findRemovableAt(pt);
        if (target) {
          if (sel.selectedEntityId === target.id) {
            onSelectRef.current?.(null);
          }
          onSandboxRef.current?.({ action: 'remove', entityId: target.id });
        }
        return;
      }

      // Otherwise spawn selected entity at snapped world position
      const pos = snapCoord(pt);
      onSandboxRef.current?.({
        action: 'spawn',
        kind: sel.tool as SandboxSpawnKind,
        x: pos.x,
        y: pos.y,
        channel: sel.channel,
      });
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (editDragRef.current) {
        const ed = editDragRef.current;
        const pt = screenToWorld(e.clientX, e.clientY);
        const snap = (val: number) => (sandboxSelRef.current.snapToGrid ? Math.round(val / 8) * 8 : Math.round(val));
        const dx = pt.x - ed.startPt.x;
        const dy = pt.y - ed.startPt.y;
        const w = worldRef.current;
        if (Math.hypot(dx, dy) >= 2) {
          if (ed.kind === 'move') {
            onSandboxRef.current?.({
              action: 'update_entity',
              entityId: ed.entityId,
              patch: { x: snap(ed.origX + dx), y: snap(ed.origY + dy) },
            });
          } else if (ed.kind === 'resize-r') {
            onSandboxRef.current?.({ action: 'update_entity', entityId: ed.entityId, patch: { w: Math.max(24, snap(ed.origW + dx)) } });
          } else if (ed.kind === 'resize-l') {
            const nextW = Math.max(24, snap(ed.origW - dx));
            onSandboxRef.current?.({ action: 'update_entity', entityId: ed.entityId, patch: { x: ed.origX + (ed.origW - nextW), w: nextW } });
          } else if (ed.kind === 'resize-b') {
            onSandboxRef.current?.({ action: 'update_entity', entityId: ed.entityId, patch: { h: Math.max(10, snap(ed.origH + dy)) } });
          } else if (ed.kind === 'resize-t') {
            const nextH = Math.max(10, snap(ed.origH - dy));
            onSandboxRef.current?.({ action: 'update_entity', entityId: ed.entityId, patch: { y: ed.origY + (ed.origH - nextH), h: nextH } });
          } else if (ed.kind === 'resize-br') {
            onSandboxRef.current?.({ action: 'update_entity', entityId: ed.entityId, patch: { w: Math.max(24, snap(ed.origW + dx)), h: Math.max(10, snap(ed.origH + dy)) } });
          } else if (ed.kind === 'vector' && w) {
            const fz = w.forceZones.find((f) => f.id === ed.entityId);
            if (fz) {
              const cx = fz.x + fz.w * 0.5;
              const cy = fz.y + fz.h * 0.5;
              onSandboxRef.current?.({
                action: 'update_entity',
                entityId: ed.entityId,
                patch: { fx: Math.round((pt.x - cx) * 26), fy: Math.round((pt.y - cy) * 26) },
              });
            }
          } else if (ed.kind === 'endPos') {
            onSandboxRef.current?.({
              action: 'update_entity',
              entityId: ed.entityId,
              patch: { endPos: { x: snap(ed.origEndX + dx), y: snap(ed.origEndY + dy) } },
            });
          }
        }
        editDragRef.current = null;
        canvas.releasePointerCapture?.(e.pointerId);
        return;
      }

      if (wireDragRef.current) {
        const wd = wireDragRef.current;
        wireDragRef.current = null;
        canvas.releasePointerCapture?.(e.pointerId);
        const pt = screenToWorld(e.clientX, e.clientY);
        const dist = Math.hypot(pt.x - wd.startX, pt.y - wd.startY);
        const tgt = findWireTargetAt(pt);
        if (tgt && tgt.id !== wd.sourceId) {
          onSandboxRef.current?.({
            action: 'toggle_wire',
            sourceId: wd.sourceId,
            targetId: tgt.id,
            mode: 'toggle',
          });
          pendingWireSourceRef.current = null;
          spawnParticles({ x: pt.x, y: pt.y, count: 9, color: wd.color, spreadVx: 90, spreadVy: 90, shape: 'spark' });
        } else if (dist < 12) {
          pendingWireSourceRef.current = {
            sourceId: wd.sourceId,
            sourceLabel: wd.sourceLabel,
            x: wd.startX,
            y: wd.startY,
            color: wd.color,
          };
        }
        return;
      }

      const drag = flingDragRef.current;
      if (!drag) return;
      flingDragRef.current = null;
      canvas.releasePointerCapture?.(e.pointerId);

      const dx = drag.curX - drag.startX;
      const dy = drag.curY - drag.startY;
      const dist = Math.hypot(dx, dy);
      const vx = dist < 8 ? 0 : Math.max(-1050, Math.min(1050, dx * 4.8));
      const vy = dist < 8 ? -380 : Math.max(-1050, Math.min(1050, dy * 4.8));

      onSandboxRef.current?.({
        action: 'fling',
        entityId: drag.entityId,
        vx: Math.round(vx),
        vy: Math.round(vy),
      });
      spawnParticles({ x: drag.startX, y: drag.startY, count: 10, color: '#38BDF8', spreadVx: 115, spreadVy: 115, shape: 'spark' });
    };

    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerUp);

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const pw = Math.max(320, Math.round(rect.width * dpr));
      const ph = Math.max(180, Math.round(rect.height * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let rafId = 0;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const scale = Math.min(w / WORLD_WIDTH, h / WORLD_HEIGHT);
      const offsetX = (w - WORLD_WIDTH * scale) * 0.5;
      const offsetY = (h - WORLD_HEIGHT * scale) * 0.5;

      ctx.save();

      // Full-viewport outer subsurface facility backdrop (eliminates flat dead letterbox void on large screens)
      const outerGrad = ctx.createRadialGradient(
        w * 0.5,
        h * 0.45,
        Math.min(w, h) * 0.18,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.78
      );
      outerGrad.addColorStop(0, '#0F1827');
      outerGrad.addColorStop(1, '#070B12');
      ctx.fillStyle = outerGrad;
      ctx.fillRect(0, 0, w, h);

      // Continuous subtle blueprint grid extended across the full viewport aligned to chamber origin
      const gridStep = 32 * scale;
      if (gridStep >= 10) {
        const startGx = ((offsetX % gridStep) + gridStep) % gridStep;
        const startGy = ((offsetY % gridStep) + gridStep) % gridStep;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.025)';
        ctx.lineWidth = Math.max(1, scale * 0.5);
        ctx.beginPath();
        for (let gx = startGx; gx <= w; gx += gridStep) {
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, h);
        }
        for (let gy = startGy; gy <= h; gy += gridStep) {
          ctx.moveTo(0, gy);
          ctx.lineTo(w, gy);
        }
        ctx.stroke();
      }

      // Soft recessed casing shadow & technical corner brackets framing the active 960x540 test chamber
      const chamberW = WORLD_WIDTH * scale;
      const chamberH = WORLD_HEIGHT * scale;
      ctx.fillStyle = 'rgba(2, 6, 14, 0.72)';
      ctx.fillRect(offsetX - 6 * scale, offsetY - 4 * scale, chamberW + 12 * scale, chamberH + 12 * scale);

      if (offsetX > 10 || offsetY > 10) {
        const bPad = 5 * scale;
        const bLen = Math.min(22 * scale, Math.max(10, chamberW * 0.03));
        const xL = offsetX - bPad;
        const xR = offsetX + chamberW + bPad;
        const yT = offsetY - bPad;
        const yB = offsetY + chamberH + bPad;
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.24)';
        ctx.lineWidth = Math.max(1.25, 1.5 * scale);
        ctx.beginPath();
        // Top-left
        ctx.moveTo(xL, yT + bLen);
        ctx.lineTo(xL, yT);
        ctx.lineTo(xL + bLen, yT);
        // Top-right
        ctx.moveTo(xR - bLen, yT);
        ctx.lineTo(xR, yT);
        ctx.lineTo(xR, yT + bLen);
        // Bottom-left
        ctx.moveTo(xL, yB - bLen);
        ctx.lineTo(xL, yB);
        ctx.lineTo(xL + bLen, yB);
        // Bottom-right
        ctx.moveTo(xR - bLen, yB);
        ctx.lineTo(xR, yB);
        ctx.lineTo(xR, yB - bLen);
        ctx.stroke();
      }

      // Decaying micro screen shake
      let shakeX = 0;
      let shakeY = 0;
      if (shakeMagRef.current > 0.1) {
        shakeX = (Math.random() - 0.5) * 2 * shakeMagRef.current;
        shakeY = (Math.random() - 0.5) * 2 * shakeMagRef.current;
        shakeMagRef.current *= Math.exp(-16 * dt);
      } else {
        shakeMagRef.current = 0;
      }

      ctx.translate(offsetX + shakeX * scale, offsetY + shakeY * scale);
      ctx.scale(scale, scale);

      // Clip interior chamber atmosphere cleanly
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.clip();

      // Chamber Backdrop with rich multi-stop depth
      const bgGrad = ctx.createRadialGradient(
        WORLD_WIDTH * 0.5,
        WORLD_HEIGHT * 0.36,
        50,
        WORLD_WIDTH * 0.5,
        WORLD_HEIGHT * 0.5,
        WORLD_WIDTH * 0.68
      );
      bgGrad.addColorStop(0, '#142238');
      bgGrad.addColorStop(0.58, '#0F1929');
      bgGrad.addColorStop(1, '#09101B');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Subtle architectural structural wall bays (low-contrast depth layer)
      ctx.fillStyle = 'rgba(8, 13, 23, 0.36)';
      for (const bayX of [96, 352, 608, 816]) {
        ctx.fillRect(bayX, 24, 52, WORLD_HEIGHT - 72);
      }
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.04)';
      ctx.lineWidth = 1;
      for (const bayX of [96, 352, 608, 816]) {
        ctx.strokeRect(bayX + 0.5, 24, 51, WORLD_HEIGHT - 72);
      }

      // Minor & Major Blueprint Grid
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.042)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0; gx <= WORLD_WIDTH; gx += 32) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, WORLD_HEIGHT);
      }
      for (let gy = 0; gy <= WORLD_HEIGHT; gy += 32) {
        ctx.moveTo(0, gy);
        ctx.lineTo(WORLD_WIDTH, gy);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.065)';
      ctx.beginPath();
      for (let gx = 0; gx <= WORLD_WIDTH; gx += 128) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, WORLD_HEIGHT);
      }
      for (let gy = 0; gy <= WORLD_HEIGHT; gy += 128) {
        ctx.moveTo(0, gy);
        ctx.lineTo(WORLD_WIDTH, gy);
      }
      ctx.stroke();

      // Overhead ceiling light fixtures & soft volumetric light shafts
      for (const lx of [160, 480, 800]) {
        const coneGrad = ctx.createLinearGradient(lx, 24, lx, 340);
        coneGrad.addColorStop(0, 'rgba(125, 211, 252, 0.075)');
        coneGrad.addColorStop(0.55, 'rgba(56, 189, 248, 0.025)');
        coneGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = coneGrad;
        ctx.beginPath();
        ctx.moveTo(lx - 26, 24);
        ctx.lineTo(lx + 26, 24);
        ctx.lineTo(lx + 115, 340);
        ctx.lineTo(lx - 115, 340);
        ctx.closePath();
        ctx.fill();

        // Slim recessed fixture bar
        ctx.fillStyle = 'rgba(186, 230, 253, 0.42)';
        ctx.fillRect(lx - 22, 23, 44, 2.5);
      }

      // Subtle floor atmospheric bounce
      const floorBounce = ctx.createLinearGradient(0, WORLD_HEIGHT - 120, 0, WORLD_HEIGHT - 48);
      floorBounce.addColorStop(0, 'rgba(56, 189, 248, 0)');
      floorBounce.addColorStop(1, 'rgba(56, 189, 248, 0.045)');
      ctx.fillStyle = floorBounce;
      ctx.fillRect(24, WORLD_HEIGHT - 120, WORLD_WIDTH - 48, 72);

      // Ambient drifting laboratory dust motes
      if (!prefersReducedMotion) {
        for (const mote of AMBIENT_MOTES) {
          mote.x += mote.vx * dt;
          mote.y += mote.vy * dt;
          if (mote.y < 30) mote.y = WORLD_HEIGHT - 54;
          if (mote.x < 30) mote.x = WORLD_WIDTH - 34;
          if (mote.x > WORLD_WIDTH - 30) mote.x = 34;
          ctx.fillStyle = `rgba(186, 230, 253, ${mote.alpha})`;
          ctx.beginPath();
          ctx.arc(mote.x, mote.y, mote.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      const currentWorld = worldRef.current;
      if (currentWorld) {
        // Reset per-level transition trackers when switching chambers
        if (prevLevelIdRef.current !== currentWorld.levelId) {
          prevLevelIdRef.current = currentWorld.levelId;
          prevSolvedRef.current = currentWorld.solved;
          cratePrevRef.current.clear();
          switchPrevRef.current.clear();
          platePrevRef.current.clear();
          doorPrevRef.current.clear();
          platRenderPosRef.current.clear();
          crateRenderPosRef.current.clear();
        }

        // Celebration burst on puzzle solve transition
        if (currentWorld.solved && !prevSolvedRef.current) {
          triggerShake(4.5);
          const ex = currentWorld.exit.x + currentWorld.exit.w * 0.5;
          const ey = currentWorld.exit.y + currentWorld.exit.h * 0.5;
          spawnParticles({ x: ex, y: ey, count: 26, color: '#10B981', spreadVx: 200, spreadVy: 240, size: 3.5, life: 0.75, shape: 'spark' });
          spawnParticles({ x: ex, y: ey, count: 14, color: '#FDE68A', spreadVx: 170, spreadVy: 200, size: 3, life: 0.7, shape: 'circle' });
        }
        prevSolvedRef.current = currentWorld.solved;

        // Impulse blast particle burst
        for (const imp of currentWorld.recentImpulses ?? []) {
          if (!prevImpulseIdsRef.current.has(imp.id)) {
            prevImpulseIdsRef.current.add(imp.id);
            if (prevImpulseIdsRef.current.size > 40) {
              const first = prevImpulseIdsRef.current.values().next().value;
              if (first) prevImpulseIdsRef.current.delete(first);
            }
            triggerShake(6.5);
            soundFX.playBlast();
            spawnParticles({ x: imp.x, y: imp.y, count: 22, color: '#38BDF8', spreadVx: 260, spreadVy: 240, size: 3.2, life: 0.45, shape: 'spark' });
          }
        }

        // Helper: Sleek flush hardware LED indicator bar (replaces floating dots)
        const drawChannelBar = (
          bx: number,
          by: number,
          bw: number,
          bh: number,
          kind: ChannelId | 'LINK',
          active: boolean
        ) => {
          const col = kind === 'LINK' ? '#38BDF8' : CHANNEL_COLORS[kind];
          ctx.save();
          ctx.fillStyle = active ? col : '#0B1018';
          ctx.fillRect(bx, by, bw, bh);
          if (!active) {
            ctx.strokeStyle = col;
            ctx.globalAlpha = 0.72;
            ctx.lineWidth = 1;
            ctx.strokeRect(bx, by, bw, bh);
          } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
            ctx.fillRect(bx + 1, by, Math.max(1, bw - 2), 1);
          }
          ctx.restore();
        };

        // Helper: Miniature physical keycap badge ([E] / [Q])
        const drawKeycapPrompt = (kx: number, ky: number, keyLabel: string, accent: string) => {
          ctx.save();
          ctx.fillStyle = '#0B1018';
          ctx.beginPath();
          ctx.roundRect(kx - 9, ky - 8, 18, 17, 4);
          ctx.fill();
          ctx.fillStyle = '#1E293B';
          ctx.beginPath();
          ctx.roundRect(kx - 8.5, ky - 8, 17, 14.5, 3.5);
          ctx.fill();
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = '#F8FAFC';
          ctx.font = '700 9.5px "JetBrains Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(keyLabel, kx, ky + 2.5);
          ctx.restore();
        };

        // 0. Force / Wind Zones (self-descriptive wind tunnel vents & directional slipstreams)
        for (const fz of currentWorld.forceZones ?? []) {
          const mag = Math.hypot(fz.fx, fz.fy);
          const isVertical = Math.abs(fz.fy) >= Math.abs(fz.fx);
          const accentRgb = isVertical ? '56, 189, 248' : '167, 139, 250';
          ctx.save();

          if (mag > 10) {
            const ux = fz.fx / mag;
            const uy = fz.fy / mag;
            const px = -uy;
            const py = ux;
            const cx = fz.x + fz.w * 0.5;
            const cy = fz.y + fz.h * 0.5;
            const span = Math.abs(ux) * fz.w + Math.abs(uy) * fz.h;
            const grad = ctx.createLinearGradient(
              cx - ux * span * 0.5,
              cy - uy * span * 0.5,
              cx + ux * span * 0.5,
              cy + uy * span * 0.5
            );
            grad.addColorStop(0, `rgba(${accentRgb}, 0.14)`);
            grad.addColorStop(0.6, `rgba(${accentRgb}, 0.06)`);
            grad.addColorStop(1, `rgba(${accentRgb}, 0.015)`);
            ctx.fillStyle = grad;
            ctx.fillRect(fz.x, fz.y, fz.w, fz.h);

            // Subtle intake vent grill on the origin edge
            ctx.fillStyle = `rgba(${accentRgb}, 0.35)`;
            if (isVertical) {
              const ventY = fz.fy < 0 ? fz.y + fz.h - 4 : fz.y;
              ctx.fillRect(fz.x + 2, ventY, Math.max(2, fz.w - 4), 3);
            } else {
              const ventX = fz.fx > 0 ? fz.x : fz.x + fz.w - 4;
              ctx.fillRect(ventX, fz.y + 2, 3, Math.max(2, fz.h - 4));
            }

            // Soft boundary corner brackets
            ctx.strokeStyle = `rgba(${accentRgb}, 0.24)`;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 5]);
            ctx.strokeRect(fz.x, fz.y, fz.w, fz.h);

            // Animated airflow ribbons & chevrons aligned with exact (fx, fy)
            ctx.setLineDash([]);
            ctx.strokeStyle = isVertical ? 'rgba(125, 211, 252, 0.48)' : 'rgba(196, 181, 253, 0.52)';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            const phase = prefersReducedMotion ? 20 : (now * 0.15) % 44;
            ctx.save();
            ctx.beginPath();
            ctx.rect(fz.x + 2, fz.y + 2, Math.max(1, fz.w - 4), Math.max(1, fz.h - 4));
            ctx.clip();
            const cols = Math.max(2, Math.floor(fz.w / 28));
            const rows = Math.max(2, Math.floor(fz.h / 36));
            for (let c = 0; c < cols; c++) {
              for (let r = 0; r < rows; r++) {
                const bx = fz.x + ((c + 0.5) * fz.w) / cols + ux * (phase - 22);
                const by = fz.y + ((r + 0.5) * fz.h) / rows + uy * (phase - 22);
                const tipX = bx + ux * 12;
                const tipY = by + uy * 12;
                ctx.beginPath();
                ctx.moveTo(bx - ux * 8, by - uy * 8);
                ctx.lineTo(tipX, tipY);
                ctx.moveTo(tipX - ux * 4.5 + px * 3.5, tipY - uy * 4.5 + py * 3.5);
                ctx.lineTo(tipX, tipY);
                ctx.lineTo(tipX - ux * 4.5 - px * 3.5, tipY - uy * 4.5 - py * 3.5);
                ctx.stroke();
              }
            }
            ctx.restore();
          } else {
            ctx.fillStyle = `rgba(${accentRgb}, 0.06)`;
            ctx.fillRect(fz.x, fz.y, fz.w, fz.h);
          }
          ctx.restore();
        }

        // 1. Signal conduits: only shown when actively wiring or inspecting a selected entity in Edit mode
        const activeTool = sandboxSelRef.current.tool;
        const selectedEntityId = sandboxSelRef.current.selectedEntityId;
        const showAllConduits = activeTool === 'wire';
        const showSelectedConduits = activeTool === 'edit' && Boolean(selectedEntityId);

        if (showAllConduits || showSelectedConduits) {
          const drawConduit = (
            x1: number,
            y1: number,
            x2: number,
            y2: number,
            ch: ChannelId,
            active: boolean,
            isDirectWire = false
          ) => {
            ctx.save();
            ctx.strokeStyle = active ? CHANNEL_COLORS[ch] : 'rgba(148, 163, 184, 0.35)';
            ctx.globalAlpha = active ? 0.5 : 0.25;
            ctx.lineWidth = isDirectWire ? 1.75 : 1.25;
            ctx.setLineDash(active ? [] : [5, 4]);
            ctx.beginPath();
            const midX = (x1 + x2) * 0.5;
            ctx.moveTo(x1, y1);
            ctx.lineTo(midX, y1);
            ctx.lineTo(midX, y2);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            if (isDirectWire) {
              ctx.setLineDash([]);
              ctx.globalAlpha = 0.7;
              ctx.fillStyle = active ? CHANNEL_COLORS[ch] : '#64748B';
              ctx.beginPath();
              ctx.arc(midX, (y1 + y2) * 0.5, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          };

          const sources: Array<{ id: string; cx: number; cy: number; channel: ChannelId; active: boolean }> = [
            ...currentWorld.plates.map((p) => ({
              id: p.id,
              cx: p.x + p.w * 0.5,
              cy: p.y + p.h * 0.5,
              channel: p.channel,
              active: p.active,
            })),
            ...currentWorld.switches.map((s) => ({
              id: s.id,
              cx: s.x + s.w * 0.5,
              cy: s.y + s.h * 0.5,
              channel: s.channel,
              active: s.active,
            })),
          ];

          for (const src of sources) {
            for (const door of currentWorld.doors) {
              if (showSelectedConduits && selectedEntityId !== src.id && selectedEntityId !== door.id) continue;
              const direct = door.linkedIds?.includes(src.id);
              const viaCh = door.channels.includes(src.channel);
              if (direct || viaCh) {
                drawConduit(
                  src.cx,
                  src.cy,
                  door.x + door.w * 0.5,
                  door.y + door.h * 0.5,
                  src.channel,
                  direct ? src.active : currentWorld.channels[src.channel],
                  Boolean(direct)
                );
              }
            }
            for (const plat of currentWorld.platforms) {
              if (plat.kind !== 'moving') continue;
              if (showSelectedConduits && selectedEntityId !== src.id && selectedEntityId !== plat.id) continue;
              const direct = plat.linkedIds?.includes(src.id);
              const viaCh = plat.channel === src.channel;
              if (direct || viaCh) {
                const pPos = platRenderPosRef.current.get(plat.id) ?? plat;
                drawConduit(
                  src.cx,
                  src.cy,
                  pPos.x + plat.w * 0.5,
                  pPos.y + plat.h * 0.5,
                  src.channel,
                  direct ? src.active : currentWorld.channels[src.channel],
                  Boolean(direct)
                );
              }
            }
            const exitDirect = currentWorld.exit.linkedIds?.includes(src.id);
            const exitCh = currentWorld.exit.requiredChannels.includes(src.channel);
            if (
              (exitDirect || exitCh) &&
              (!showSelectedConduits || selectedEntityId === src.id || selectedEntityId === currentWorld.exit.id)
            ) {
              drawConduit(
                src.cx,
                src.cy,
                currentWorld.exit.x + currentWorld.exit.w * 0.5,
                currentWorld.exit.y + currentWorld.exit.h * 0.5,
                src.channel,
                exitDirect ? src.active : currentWorld.channels[src.channel],
                Boolean(exitDirect)
              );
            }
          }
        }

        // 2. Moving Platform Rails
        for (const plat of currentWorld.platforms) {
          if (plat.kind === 'moving' && plat.startPos && plat.endPos) {
            ctx.save();
            ctx.strokeStyle = plat.channel
              ? CHANNEL_COLORS[plat.channel]
              : 'rgba(148, 163, 184, 0.3)';
            ctx.globalAlpha = 0.16;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(plat.startPos.x + plat.w * 0.5, plat.startPos.y + plat.h * 0.5);
            ctx.lineTo(plat.endPos.x + plat.w * 0.5, plat.endPos.y + plat.h * 0.5);
            ctx.stroke();
            ctx.restore();
          }
        }

        // 3. Exit Extraction Portal (self-descriptive archway, occupant LEDs & channel sockets, zero text clutter)
        const exit = currentWorld.exit;
        const exitChannelsOk = exit.requiredChannels.every((c) => currentWorld.channels[c]);
        const exitLinkedIds = exit.linkedIds ?? [];
        const isSourceActive = (srcId: string) =>
          Boolean(
            currentWorld.switches.find((s) => s.id === srcId)?.active ||
              currentWorld.plates.find((p) => p.id === srcId)?.active
          );
        const exitLinksOk =
          exitLinkedIds.length === 0 ||
          (exit.logic === 'ANY'
            ? exitLinkedIds.some(isSourceActive)
            : exitLinkedIds.every(isSourceActive));
        const exitUnlocked = exitChannelsOk && exitLinksOk;
        ctx.save();

        // Ambient extraction floor & aura spill when unlocked
        if (exitUnlocked) {
          const aura = ctx.createRadialGradient(
            exit.x + exit.w * 0.5,
            exit.y + exit.h * 0.65,
            8,
            exit.x + exit.w * 0.5,
            exit.y + exit.h * 0.65,
            exit.w * 1.15
          );
          aura.addColorStop(0, 'rgba(16, 185, 129, 0.22)');
          aura.addColorStop(1, 'rgba(16, 185, 129, 0)');
          ctx.fillStyle = aura;
          ctx.fillRect(exit.x - 42, exit.y - 26, exit.w + 84, exit.h + 44);
        }

        // Portal interior glow
        if (exitUnlocked) {
          const portalGlow = ctx.createLinearGradient(exit.x, exit.y + exit.h, exit.x, exit.y);
          portalGlow.addColorStop(0, 'rgba(16, 185, 129, 0.36)');
          portalGlow.addColorStop(0.65, 'rgba(16, 185, 129, 0.14)');
          portalGlow.addColorStop(1, 'rgba(16, 185, 129, 0.04)');
          ctx.fillStyle = portalGlow;
        } else {
          ctx.fillStyle = 'rgba(10, 15, 25, 0.65)';
        }
        ctx.beginPath();
        ctx.roundRect(exit.x, exit.y, exit.w, exit.h, 6);
        ctx.fill();

        // Side gantry pylons + base extraction pad
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(exit.x, exit.y + 10, 5, exit.h - 14);
        ctx.fillRect(exit.x + exit.w - 5, exit.y + 10, 5, exit.h - 14);
        ctx.fillStyle = exitUnlocked ? '#10B981' : '#475569';
        ctx.fillRect(exit.x + 1.5, exit.y + 16, 2, exit.h - 24);
        ctx.fillRect(exit.x + exit.w - 3.5, exit.y + 16, 2, exit.h - 24);

        // Floor extraction pad
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(exit.x - 2, exit.y + exit.h - 6, exit.w + 4, 6);
        ctx.fillStyle = exitUnlocked ? '#34D399' : '#475569';
        ctx.fillRect(exit.x + 4, exit.y + exit.h - 6, exit.w - 8, 2.5);

        // Top arch lintel
        ctx.fillStyle = '#1E293B';
        ctx.beginPath();
        ctx.roundRect(exit.x - 2, exit.y - 2, exit.w + 4, 14, [5, 5, 2, 2]);
        ctx.fill();
        ctx.strokeStyle = exitUnlocked ? '#10B981' : '#475569';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // Outer portal frame border
        ctx.strokeStyle = exitUnlocked ? '#10B981' : '#475569';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.roundRect(exit.x, exit.y, exit.w, exit.h, 6);
        ctx.stroke();

        if (exitUnlocked) {
          // Rising extraction chevrons
          if (!prefersReducedMotion) {
            const phase = (now * 0.045) % 22;
            ctx.save();
            ctx.beginPath();
            ctx.rect(exit.x + 6, exit.y + 14, Math.max(4, exit.w - 12), Math.max(4, exit.h - 22));
            ctx.clip();
            ctx.strokeStyle = 'rgba(52, 211, 153, 0.42)';
            ctx.lineWidth = 1.8;
            ctx.lineCap = 'round';
            const ecx = exit.x + exit.w * 0.5;
            for (let cy = exit.y + exit.h + 10 - phase; cy > exit.y + 12; cy -= 22) {
              ctx.beginPath();
              ctx.moveTo(ecx - 13, cy + 5);
              ctx.lineTo(ecx, cy);
              ctx.lineTo(ecx + 13, cy + 5);
              ctx.stroke();
            }
            ctx.restore();
          }
        } else {
          // Color-coded horizontal laser security bars for locked requirements
          const reqColors: Array<{ color: string; met: boolean }> = [
            ...exit.requiredChannels.map((c) => ({ color: CHANNEL_COLORS[c], met: currentWorld.channels[c] })),
            ...exitLinkedIds.map((id) => ({ color: '#38BDF8', met: isSourceActive(id) })),
          ];
          const bars = reqColors.length > 0 ? reqColors : [{ color: '#94A3B8', met: false }];
          const barSpacing = Math.min(18, (exit.h - 34) / (bars.length + 1));
          bars.forEach((b, idx) => {
            if (b.met) return;
            const by = exit.y + 24 + idx * barSpacing;
            ctx.strokeStyle = b.color;
            ctx.globalAlpha = 0.52;
            ctx.lineWidth = 1.75;
            ctx.beginPath();
            ctx.moveTo(exit.x + 6, by);
            ctx.lineTo(exit.x + exit.w - 6, by);
            ctx.stroke();
          });
          ctx.globalAlpha = 1;
        }

        // Lintel segmented progress bar for occupants (clean rectangular segments, zero dots)
        const ecx = exit.x + exit.w * 0.5;
        const actorTotal = Math.max(1, currentWorld.actors.length);
        const atExitCount = currentWorld.metrics.actorsAtExit;
        const totalBarW = Math.min(exit.w - 16, actorTotal * 12);
        const segGap = 3;
        const segW = Math.max(4, (totalBarW - (actorTotal - 1) * segGap) / actorTotal);
        const segStartX = ecx - totalBarW * 0.5;
        for (let i = 0; i < actorTotal; i++) {
          const filled = i < atExitCount;
          const sx = segStartX + i * (segW + segGap);
          ctx.fillStyle = filled ? '#34D399' : '#0B1018';
          ctx.fillRect(sx, exit.y + 3, segW, 4);
          ctx.strokeStyle = filled ? '#A7F3D0' : '#475569';
          ctx.lineWidth = 0.9;
          ctx.strokeRect(sx, exit.y + 3, segW, 4);
        }
        ctx.restore();

        // 4. Platforms (Standard, Moving Lift Carriage, Crystalline Ice, Helical-Spring Bounce Pad, Sprocket Conveyor)
        const smoothAlpha = prefersReducedMotion ? 1 : 1 - Math.exp(-38 * dt);
        const activePlatIds = new Set(currentWorld.platforms.map((p) => p.id));
        for (const pid of platRenderPosRef.current.keys()) {
          if (!activePlatIds.has(pid)) platRenderPosRef.current.delete(pid);
        }

        for (const plat of currentWorld.platforms) {
          if (plat.kind === 'moving') {
            let pRender = platRenderPosRef.current.get(plat.id);
            if (!pRender || Math.hypot(plat.x - pRender.x, plat.y - pRender.y) > 90) {
              pRender = { x: plat.x, y: plat.y };
            } else {
              pRender = {
                x: pRender.x + (plat.x - pRender.x) * smoothAlpha,
                y: pRender.y + (plat.y - pRender.y) * smoothAlpha,
              };
            }
            platRenderPosRef.current.set(plat.id, pRender);
            const px = pRender.x;
            const py = pRender.y;

            const chColor = plat.channel ? CHANNEL_COLORS[plat.channel] : '#38BDF8';
            // Main beveled carriage deck
            ctx.fillStyle = '#1E293B';
            ctx.beginPath();
            ctx.roundRect(px, py, plat.w, plat.h, 4);
            ctx.fill();
            // Top grip tread
            ctx.fillStyle = '#334155';
            ctx.fillRect(px + 6, py, Math.max(4, plat.w - 12), 3);
            ctx.strokeStyle = chColor;
            ctx.lineWidth = 1.7;
            ctx.beginPath();
            ctx.roundRect(px, py, plat.w, plat.h, 4);
            ctx.stroke();

            // Left & right rail guide brackets (clean vertical clamps, zero dots)
            ctx.fillStyle = '#0F172A';
            ctx.fillRect(px + 4, py + 4, 4, Math.max(4, plat.h - 8));
            ctx.fillRect(px + plat.w - 8, py + 4, 4, Math.max(4, plat.h - 8));

            // Flush inlaid channel light strip on carriage chassis
            const liftActive = plat.channel
              ? currentWorld.channels[plat.channel]
              : (plat.linkedIds ?? []).some(isSourceActive);
            if (plat.channel) {
              drawChannelBar(px + plat.w * 0.5 - 10, py + plat.h * 0.5 - 1.5, 20, 3, plat.channel, liftActive);
            } else if (plat.linkedIds && plat.linkedIds.length > 0) {
              drawChannelBar(px + plat.w * 0.5 - 10, py + plat.h * 0.5 - 1.5, 20, 3, 'LINK', liftActive);
            }
          } else if (plat.material === 'ice') {
            // Crystalline frosted ice slab (no "ICE" label)
            const iceGrad = ctx.createLinearGradient(plat.x, plat.y, plat.x, plat.y + plat.h);
            iceGrad.addColorStop(0, 'rgba(165, 243, 252, 0.42)');
            iceGrad.addColorStop(1, 'rgba(14, 116, 144, 0.48)');
            ctx.fillStyle = iceGrad;
            ctx.beginPath();
            ctx.roundRect(plat.x, plat.y, plat.w, plat.h, 3);
            ctx.fill();

            // Diagonal specular crystalline facets
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(plat.x, plat.y, plat.w, plat.h, 3);
            ctx.clip();
            ctx.fillStyle = 'rgba(236, 254, 255, 0.24)';
            for (let sx = plat.x - 10; sx < plat.x + plat.w + 12; sx += 24) {
              ctx.beginPath();
              ctx.moveTo(sx, plat.y + plat.h);
              ctx.lineTo(sx + 9, plat.y);
              ctx.lineTo(sx + 15, plat.y);
              ctx.lineTo(sx + 6, plat.y + plat.h);
              ctx.closePath();
              ctx.fill();
            }
            ctx.restore();

            // Frosted snow/ice rim along top surface
            ctx.fillStyle = '#CFFAFE';
            ctx.fillRect(plat.x + 1, plat.y, Math.max(2, plat.w - 2), 3.5);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(plat.x + 4, plat.y + 0.8, Math.max(2, plat.w - 8), 1.2);
            ctx.strokeStyle = 'rgba(103, 232, 249, 0.78)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(plat.x, plat.y, plat.w, plat.h, 3);
            ctx.stroke();

            // Subtle crystal icicle nubs along underside
            ctx.fillStyle = 'rgba(165, 243, 252, 0.55)';
            for (let ix = plat.x + 10; ix < plat.x + plat.w - 8; ix += 18) {
              const toothH = 3 + ((Math.round(ix) % 3) * 1.3);
              ctx.beginPath();
              ctx.moveTo(ix - 3, plat.y + plat.h);
              ctx.lineTo(ix, plat.y + plat.h + toothH);
              ctx.lineTo(ix + 3, plat.y + plat.h);
              ctx.closePath();
              ctx.fill();
            }
          } else if (plat.material === 'bouncy') {
            // Heavy-duty helical coil spring launcher pad (no "BOUNCE" label)
            const comp = (plat.compression ?? 0) * 6;
            const deckH = Math.max(7, Math.min(10, plat.h * 0.44));
            const baseH = 4;
            const baseY = plat.y + plat.h - baseH;
            const padTop = plat.y + comp;
            const springBottom = baseY;
            const springTop = padTop + deckH - 1;

            // Anchored steel base plate
            ctx.fillStyle = '#1E293B';
            ctx.fillRect(plat.x + 2, baseY, Math.max(4, plat.w - 4), baseH);
            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 1;
            ctx.strokeRect(plat.x + 2, baseY, Math.max(4, plat.w - 4), baseH);

            // Multi-turn shaded helical coil springs
            const springCount = Math.max(2, Math.floor(plat.w / 26));
            const turns = 3;
            for (let si = 0; si < springCount; si++) {
              const sx = plat.x + ((si + 0.5) * plat.w) / springCount;
              const coilW = 5.5;
              const spanY = Math.max(3, springBottom - springTop);
              // Back shadow turns
              ctx.strokeStyle = '#065F46';
              ctx.lineWidth = 2.6;
              ctx.lineCap = 'round';
              ctx.beginPath();
              for (let t = 0; t < turns; t++) {
                const y0 = springBottom - (t / turns) * spanY;
                const y1 = springBottom - ((t + 0.5) / turns) * spanY;
                ctx.moveTo(sx - coilW, y0);
                ctx.lineTo(sx + coilW, y1);
              }
              ctx.stroke();

              // Front metallic/emerald turns
              ctx.strokeStyle = '#6EE7B7';
              ctx.lineWidth = 2;
              ctx.beginPath();
              for (let t = 0; t < turns; t++) {
                const y1 = springBottom - ((t + 0.5) / turns) * spanY;
                const y2 = springBottom - ((t + 1) / turns) * spanY;
                ctx.moveTo(sx + coilW, y1);
                ctx.lineTo(sx - coilW, y2);
              }
              ctx.stroke();
            }

            // Cushioned spring launcher deck
            ctx.fillStyle = '#065F46';
            ctx.beginPath();
            ctx.roundRect(plat.x, padTop, plat.w, deckH, 3);
            ctx.fill();
            ctx.fillStyle = '#34D399';
            ctx.beginPath();
            ctx.roundRect(plat.x, padTop, plat.w, 4, [3, 3, 0, 0]);
            ctx.fill();
            ctx.strokeStyle = '#10B981';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.roundRect(plat.x, padTop, plat.w, deckH, 3);
            ctx.stroke();

            // Molded upward rebound chevrons on deck face
            ctx.strokeStyle = '#A7F3D0';
            ctx.lineWidth = 1.25;
            ctx.lineCap = 'round';
            const chevX = plat.x + plat.w * 0.5;
            ctx.beginPath();
            ctx.moveTo(chevX - 5, padTop + deckH - 2);
            ctx.lineTo(chevX, padTop + 4.5);
            ctx.lineTo(chevX + 5, padTop + deckH - 2);
            ctx.stroke();
          } else if (plat.material === 'conveyor') {
            ctx.fillStyle = '#1E293B';
            ctx.beginPath();
            ctx.roundRect(plat.x, plat.y, plat.w, plat.h, 7);
            ctx.fill();
            ctx.fillStyle = '#F59E0B';
            ctx.fillRect(plat.x + 6, plat.y, Math.max(4, plat.w - 12), 2.5);
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.roundRect(plat.x, plat.y, plat.w, plat.h, 7);
            ctx.stroke();

            // Rotating spoked sprocket rollers
            const speed = plat.conveyorSpeed ?? 115;
            const dir = speed < 0 ? -1 : 1;
            const r = Math.min(6.2, plat.h * 0.36);
            const wheelAngle = prefersReducedMotion ? 0 : now * 0.005 * dir;
            for (const rx of [plat.x + 9, plat.x + plat.w - 9]) {
              const ry = plat.y + plat.h * 0.5 + 0.5;
              ctx.fillStyle = '#0F172A';
              ctx.beginPath();
              ctx.arc(rx, ry, r, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = '#FBBF24';
              ctx.lineWidth = 1.2;
              ctx.stroke();

              // Rotating spokes
              ctx.save();
              ctx.translate(rx, ry);
              ctx.rotate(wheelAngle);
              ctx.strokeStyle = 'rgba(251, 191, 36, 0.7)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(-r + 1.5, 0);
              ctx.lineTo(r - 1.5, 0);
              ctx.moveTo(0, -r + 1.5);
              ctx.lineTo(0, r - 1.5);
              ctx.stroke();
              ctx.restore();
            }

            // Animated belt chevrons matching conveyor direction
            const shift = prefersReducedMotion ? 0 : ((now * 0.06 * dir) % 22 + 22) % 22;
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            for (let cx = plat.x + 15 + shift; cx < plat.x + plat.w - 15; cx += 22) {
              ctx.beginPath();
              ctx.moveTo(cx - 4 * dir, plat.y + 5.5);
              ctx.lineTo(cx + 2 * dir, plat.y + plat.h * 0.5);
              ctx.lineTo(cx - 4 * dir, plat.y + plat.h - 4.5);
              ctx.stroke();
            }
          } else {
            const isBoundaryWall = PROTECTED_IDS.has(plat.id);
            if (!isBoundaryWall) {
              // Soft underside drop shadow for elevated shelves & platforms
              const drop = ctx.createLinearGradient(plat.x, plat.y + plat.h, plat.x, plat.y + plat.h + 10);
              drop.addColorStop(0, 'rgba(3, 7, 14, 0.42)');
              drop.addColorStop(1, 'rgba(3, 7, 14, 0)');
              ctx.fillStyle = drop;
              ctx.fillRect(plat.x + 2, plat.y + plat.h, Math.max(0, plat.w - 4), 10);
            }

            const platGrad = ctx.createLinearGradient(plat.x, plat.y, plat.x, plat.y + plat.h);
            if (isBoundaryWall) {
              platGrad.addColorStop(0, '#1D293B');
              platGrad.addColorStop(1, '#101826');
            } else {
              platGrad.addColorStop(0, '#26354B');
              platGrad.addColorStop(0.25, '#1D293B');
              platGrad.addColorStop(1, '#131C2B');
            }
            ctx.fillStyle = platGrad;
            ctx.fillRect(plat.x, plat.y, plat.w, plat.h);

            // Top tread cap + crisp specular rim
            ctx.fillStyle = '#3B4D68';
            ctx.fillRect(plat.x, plat.y, plat.w, 3);
            ctx.fillStyle = 'rgba(186, 230, 253, 0.16)';
            ctx.fillRect(plat.x, plat.y, plat.w, 1);

            // Bottom recessed shadow bevel
            ctx.fillStyle = 'rgba(6, 10, 18, 0.55)';
            ctx.fillRect(plat.x, plat.y + plat.h - 2, plat.w, 2);

            ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
            ctx.lineWidth = 1;
            ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);

            // Architectural structural panel seams on wide platforms & perimeter walls
            if (plat.w >= 64 && plat.h >= 14) {
              ctx.strokeStyle = 'rgba(10, 15, 25, 0.52)';
              ctx.beginPath();
              for (let sx = plat.x + 96; sx < plat.x + plat.w - 24; sx += 96) {
                ctx.moveTo(sx, plat.y + 3);
                ctx.lineTo(sx, plat.y + plat.h - 2);
              }
              ctx.stroke();
            } else if (plat.h >= 96 && plat.w >= 18) {
              ctx.strokeStyle = 'rgba(10, 15, 25, 0.52)';
              ctx.beginPath();
              for (let sy = plat.y + 72; sy < plat.y + plat.h - 24; sy += 72) {
                ctx.moveTo(plat.x + 2, sy);
                ctx.lineTo(plat.x + plat.w - 2, sy);
              }
              ctx.stroke();
            }
          }
        }

        // 5. Hazards (Crackling Plasma Containment Strips vs Beveled Metallic Spikes)
        for (const haz of currentWorld.hazards) {
          if (haz.kind === 'spikes') {
            ctx.save();
            ctx.fillStyle = '#1E293B';
            ctx.fillRect(haz.x, haz.y + haz.h - 4, haz.w, 4);
            ctx.fillStyle = '#475569';
            ctx.fillRect(haz.x, haz.y + haz.h - 4, haz.w, 1.5);
            const spikeW = 10;
            const count = Math.max(2, Math.floor(haz.w / spikeW));
            const actualW = haz.w / count;
            for (let i = 0; i < count; i++) {
              const sx = haz.x + i * actualW;
              const midX = sx + actualW * 0.5;
              const baseY = haz.y + haz.h - 4;
              // Left bright facet
              ctx.fillStyle = '#E11D48';
              ctx.beginPath();
              ctx.moveTo(sx, baseY);
              ctx.lineTo(midX, haz.y);
              ctx.lineTo(midX, baseY);
              ctx.closePath();
              ctx.fill();
              // Right shaded facet
              ctx.fillStyle = '#9F1239';
              ctx.beginPath();
              ctx.moveTo(midX, baseY);
              ctx.lineTo(midX, haz.y);
              ctx.lineTo(sx + actualW, baseY);
              ctx.closePath();
              ctx.fill();
              // Sharp crimson rim
              ctx.strokeStyle = '#FDA4AF';
              ctx.lineWidth = 0.9;
              ctx.beginPath();
              ctx.moveTo(sx, baseY);
              ctx.lineTo(midX, haz.y);
              ctx.lineTo(sx + actualW, baseY);
              ctx.stroke();
            }
            ctx.restore();
          } else {
            const pulse = 0.65 + 0.35 * Math.sin(now * 0.008);
            ctx.save();
            // Upward plasma ambient wash
            const plasmaWash = ctx.createLinearGradient(haz.x, haz.y + haz.h, haz.x, haz.y - 22);
            plasmaWash.addColorStop(0, `rgba(244, 63, 94, ${0.2 + pulse * 0.12})`);
            plasmaWash.addColorStop(1, 'rgba(244, 63, 94, 0)');
            ctx.fillStyle = plasmaWash;
            ctx.fillRect(haz.x - 4, haz.y - 22, haz.w + 8, haz.h + 22);

            ctx.fillStyle = `rgba(244, 63, 94, ${0.44 + pulse * 0.35})`;
            ctx.fillRect(haz.x, haz.y, haz.w, haz.h);
            ctx.fillStyle = '#FDA4AF';
            ctx.fillRect(haz.x, haz.y, haz.w, 2.5);
            // Side emitter caps
            ctx.fillStyle = '#334155';
            ctx.fillRect(haz.x, haz.y - 1, 4, haz.h + 2);
            ctx.fillRect(haz.x + haz.w - 4, haz.y - 1, 4, haz.h + 2);
            if (!prefersReducedMotion) {
              ctx.strokeStyle = '#FFE4E6';
              ctx.lineWidth = 1.1;
              ctx.beginPath();
              const segs = Math.max(3, Math.floor(haz.w / 14));
              for (let s = 0; s <= segs; s++) {
                const px = haz.x + (s / segs) * haz.w;
                const py =
                  haz.y +
                  haz.h * 0.5 +
                  (s === 0 || s === segs ? 0 : Math.sin(now * 0.03 + s * 2.7) * (haz.h * 0.36));
                if (s === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
              }
              ctx.stroke();
            }
            ctx.restore();
          }
        }

        // 6. Pressure Plates (mechanical spring-plunger floor switch with geometric channel glyph, zero text)
        const activePlateIds = new Set(currentWorld.plates.map((p) => p.id));
        for (const existingId of platePrevRef.current.keys()) {
          if (!activePlateIds.has(existingId)) platePrevRef.current.delete(existingId);
        }
        for (const plate of currentWorld.plates) {
          const chColor = CHANNEL_COLORS[plate.channel];
          const prevPlateActive = platePrevRef.current.get(plate.id);
          if (prevPlateActive === false && plate.active) {
            spawnParticles({
              x: plate.x + plate.w * 0.5,
              y: plate.y + 2,
              count: 8,
              color: chColor,
              spreadVx: 110,
              spreadVy: 70,
              baseVy: -55,
              size: 2.3,
              life: 0.34,
              shape: 'spark',
            });
          }
          platePrevRef.current.set(plate.id, plate.active);

          const sink = plate.active ? 4 : 0;
          // Recessed base collar
          ctx.fillStyle = '#0F172A';
          ctx.beginPath();
          ctx.roundRect(plate.x - 3, plate.y + plate.h - 4, plate.w + 6, 4, 1);
          ctx.fill();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Plunger body
          const padH = Math.max(4, plate.h - sink);
          ctx.fillStyle = plate.active ? chColor : '#273549';
          ctx.beginPath();
          ctx.roundRect(plate.x, plate.y + sink, plate.w, padH, [3, 3, 0, 0]);
          ctx.fill();
          // Flush top contact light bar along plunger face
          ctx.fillStyle = plate.active ? 'rgba(248, 250, 252, 0.72)' : chColor;
          ctx.fillRect(plate.x + 4, plate.y + sink + 1, Math.max(4, plate.w - 8), 2);
          ctx.strokeStyle = chColor;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.roundRect(plate.x, plate.y + sink, plate.w, padH, [3, 3, 0, 0]);
          ctx.stroke();
        }

        // 7. Toggle Switches (industrial lever console with flush channel LED bar & miniature [E] keycap)
        const activeSwitchIds = new Set(currentWorld.switches.map((s) => s.id));
        for (const existingId of switchPrevRef.current.keys()) {
          if (!activeSwitchIds.has(existingId)) switchPrevRef.current.delete(existingId);
        }
        const humanActor = currentWorld.actors.find((a) => a.id === humanIdRef.current);
        for (const sw of currentWorld.switches) {
          const chColor = CHANNEL_COLORS[sw.channel];
          const cx = sw.x + sw.w * 0.5;
          const baseY = sw.y + sw.h;

          const prevSwActive = switchPrevRef.current.get(sw.id);
          if (prevSwActive !== undefined && prevSwActive !== sw.active) {
            spawnParticles({
              x: cx,
              y: baseY - 22,
              count: 10,
              color: chColor,
              spreadVx: 120,
              spreadVy: 110,
              baseVy: -45,
              size: 2.5,
              life: 0.36,
              shape: 'spark',
            });
          }
          switchPrevRef.current.set(sw.id, sw.active);

          // Pedestal housing & pivot bezel
          ctx.fillStyle = '#1E293B';
          ctx.beginPath();
          ctx.roundRect(cx - 11, baseY - 11, 22, 11, [3, 3, 1, 1]);
          ctx.fill();
          ctx.strokeStyle = sw.active ? chColor : '#475569';
          ctx.lineWidth = 1.4;
          ctx.stroke();

          // Flush channel indicator bar on console face (no dot)
          drawChannelBar(cx - 7, baseY - 6.5, 14, 3, sw.channel, sw.active);

          // Pivoting mechanical lever + glowing tip bulb
          ctx.save();
          ctx.translate(cx, baseY - 11);
          ctx.rotate(sw.active ? 0.52 : -0.52);
          ctx.strokeStyle = '#CBD5E1';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -18);
          ctx.stroke();
          ctx.fillStyle = sw.active ? chColor : '#475569';
          ctx.beginPath();
          ctx.arc(0, -19.5, 4.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#0F172A';
          ctx.lineWidth = 1;
          ctx.stroke();
          if (sw.active) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
            ctx.beginPath();
            ctx.arc(-1.2, -20.5, 1.4, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();

          if (humanActor && humanActor.respawnTimer <= 0) {
            const dist = Math.hypot(
              humanActor.x + humanActor.w * 0.5 - cx,
              humanActor.y + humanActor.h * 0.5 - (sw.y + sw.h * 0.5)
            );
            if (dist <= 48) {
              drawKeycapPrompt(cx, sw.y - 16, 'E', '#38BDF8');
            }
          }
        }

        // 8. Doors / Energy Gates (self-descriptive armored shutters & emitter caps, zero "OPEN"/"FREE" text)
        const activeDoorIds = new Set(currentWorld.doors.map((d) => d.id));
        for (const existingId of doorPrevRef.current.keys()) {
          if (!activeDoorIds.has(existingId)) doorPrevRef.current.delete(existingId);
        }
        for (const door of currentWorld.doors) {
          const primaryCh = door.channels[0] ?? 'A';
          const chColor = door.channels.length > 0 ? CHANNEL_COLORS[primaryCh] : '#38BDF8';
          const closedFraction = 1 - door.openProgress;

          const prevDoorOpen = doorPrevRef.current.get(door.id);
          if (prevDoorOpen !== undefined && prevDoorOpen !== door.open) {
            triggerShake(1.8);
            spawnParticles({
              x: door.x + door.w * 0.5,
              y: door.y + door.h * 0.5,
              count: 12,
              color: door.open ? '#10B981' : chColor,
              spreadVx: 90,
              spreadVy: 170,
              baseVy: 0,
              size: 2.6,
              life: 0.38,
              shape: 'spark',
            });
          }
          doorPrevRef.current.set(door.id, door.open);

          if (closedFraction > 0.04) {
            const shutterH = (door.h * closedFraction) / 2;
            ctx.fillStyle = door.open ? 'rgba(16, 185, 129, 0.16)' : 'rgba(244, 63, 94, 0.2)';
            ctx.fillRect(door.x, door.y, door.w, shutterH);
            ctx.fillRect(door.x, door.y + door.h - shutterH, door.w, shutterH);

            // Subtle energy lattice ribs across the shutters
            ctx.strokeStyle = door.open ? 'rgba(52, 211, 153, 0.38)' : 'rgba(251, 113, 133, 0.38)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let ly = 9; ly < shutterH - 2; ly += 10) {
              ctx.moveTo(door.x + 2, door.y + ly);
              ctx.lineTo(door.x + door.w - 2, door.y + ly);
              ctx.moveTo(door.x + 2, door.y + door.h - ly);
              ctx.lineTo(door.x + door.w - 2, door.y + door.h - ly);
            }
            ctx.stroke();

            // Glowing vertical laser containment spine
            ctx.strokeStyle = door.open ? '#34D399' : chColor;
            ctx.lineWidth = 1.8;
            ctx.strokeRect(door.x, door.y, door.w, shutterH);
            ctx.strokeRect(door.x, door.y + door.h - shutterH, door.w, shutterH);

            // Shutter tip clamp bars
            ctx.fillStyle = '#0F172A';
            ctx.fillRect(door.x - 1, door.y + shutterH - 3, door.w + 2, 3);
            ctx.fillRect(door.x - 1, door.y + door.h - shutterH, door.w + 2, 3);
          }

          // Top & bottom emitter housing caps
          ctx.fillStyle = '#1E293B';
          ctx.fillRect(door.x - 4, door.y - 3, door.w + 8, 7);
          ctx.fillRect(door.x - 4, door.y + door.h - 4, door.w + 8, 7);
          ctx.strokeStyle = door.open ? '#10B981' : chColor;
          ctx.lineWidth = 1.25;
          ctx.strokeRect(door.x - 4, door.y - 3, door.w + 8, 7);
          ctx.strokeRect(door.x - 4, door.y + door.h - 4, door.w + 8, 7);

          // Status LED strip on bottom cap
          ctx.fillStyle = door.open ? '#34D399' : chColor;
          ctx.fillRect(door.x + 2, door.y + door.h - 1.5, Math.max(2, door.w - 4), 2);

          // Flush channel indicator bars inlaid on top housing cap when closed (zero dots, zero text)
          if (!door.open && (door.channels.length > 0 || (door.linkedIds?.length ?? 0) > 0)) {
            const reqItems: Array<{ kind: ChannelId | 'LINK'; active: boolean }> = [
              ...door.channels.map((c) => ({ kind: c, active: currentWorld.channels[c] })),
              ...(door.linkedIds ?? []).map((id) => ({ kind: 'LINK' as const, active: isSourceActive(id) })),
            ];
            const barW = Math.min(9, Math.max(4, (door.w + 4 - (reqItems.length - 1) * 2) / reqItems.length));
            const totalW = reqItems.length * barW + (reqItems.length - 1) * 2;
            const startX = door.x + door.w * 0.5 - totalW * 0.5;
            for (let i = 0; i < reqItems.length; i++) {
              drawChannelBar(startX + i * (barW + 2), door.y - 1.5, barW, 3.5, reqItems[i].kind, reqItems[i].active);
            }
          }
        }

        // 9. Dynamic Rigid Bodies (Crafted Wood / Heavy Steel / Polymer Crates & Rubber Kinetic Balls, zero mass labels)
        const heldCrateIds = new Set(
          currentWorld.actors
            .map((a) => a.holdingCrateId)
            .filter((id): id is string => Boolean(id))
        );
        const activeCrateIds = new Set(currentWorld.crates.map((c) => c.id));
        for (const existingId of cratePrevRef.current.keys()) {
          if (!activeCrateIds.has(existingId)) cratePrevRef.current.delete(existingId);
        }

        let nearestGrabCrate: (typeof currentWorld.crates)[number] | null = null;
        let nearestGrabDist = 48;
        const humanCx = humanActor ? humanActor.x + humanActor.w * 0.5 : 0;
        const humanCy = humanActor ? humanActor.y + humanActor.h * 0.5 : 0;

        for (const cid of crateRenderPosRef.current.keys()) {
          if (!activeCrateIds.has(cid)) crateRenderPosRef.current.delete(cid);
        }

        for (const crate of currentWorld.crates) {
          const isHeld = heldCrateIds.has(crate.id);
          const holder = isHeld
            ? currentWorld.actors.find((a) => a.holdingCrateId === crate.id)
            : undefined;
          const holderAnim = holder ? actorAnimsRef.current.get(holder.id) : undefined;
          const targetCrateX = holder && holderAnim ? crate.x + (holderAnim.x - holder.x) : crate.x;
          const targetCrateY = holder && holderAnim ? crate.y + (holderAnim.y - holder.y) : crate.y;

          let cRender = crateRenderPosRef.current.get(crate.id);
          if (
            !cRender ||
            Math.hypot(targetCrateX - cRender.x, targetCrateY - cRender.y) > 90
          ) {
            cRender = { x: targetCrateX, y: targetCrateY };
          } else {
            // A carried crate keeps its own position and catches up to the hands.
            // During the pickup lift it follows more slowly so it visibly rises from the floor.
            const pickupLift = Boolean(holderAnim && holderAnim.pickupTimer > 0);
            const follow = prefersReducedMotion
              ? 1
              : 1 - Math.exp(-(holder ? (pickupLift ? 12 : 40) : 38) * dt);
            cRender = {
              x: cRender.x + (targetCrateX - cRender.x) * follow,
              y: cRender.y + (targetCrateY - cRender.y) * follow,
            };
          }
          crateRenderPosRef.current.set(crate.id, cRender);

          const renderX = cRender.x;
          const renderY = cRender.y;
          const cx = renderX + crate.w * 0.5;
          const cy = renderY + crate.h * 0.5;

          // Crate landing impact feedback (dust/sparks + heavy steel thud)
          const prevCrate = cratePrevRef.current.get(crate.id);
          if (!isHeld && prevCrate && !prevCrate.grounded && crate.grounded && prevCrate.vy > 140) {
            const dustColor =
              crate.material === 'steel'
                ? '#CBD5E1'
                : crate.material === 'polymer'
                  ? '#7DD3FC'
                  : crate.shape === 'ball'
                    ? '#FDA4AF'
                    : '#E7C8A0';
            spawnParticles({
              x: cx,
              y: renderY + crate.h,
              count: crate.mass >= 2 ? 7 : 5,
              color: dustColor,
              spreadVx: 105,
              spreadVy: 55,
              baseVy: -28,
              size: crate.mass >= 2 ? 2.8 : 2.2,
              life: 0.34,
              shape: crate.material === 'steel' || crate.material === 'polymer' ? 'spark' : 'circle',
            });
            if (crate.mass >= 2 && prevCrate.vy > 280) {
              triggerShake(Math.min(3.5, prevCrate.vy / 150));
              soundFX.playLand(Math.min(1, prevCrate.vy / 460));
            }
          }
          cratePrevRef.current.set(crate.id, { vy: crate.vy, grounded: crate.grounded });

          if (humanActor && !humanActor.holdingCrateId && humanActor.respawnTimer <= 0 && !isHeld) {
            const crateCx = crate.x + crate.w * 0.5;
            const crateCy = crate.y + crate.h * 0.5;
            const d = Math.hypot(humanCx - crateCx, humanCy - crateCy);
            if (Math.abs(crateCy - humanCy) <= 46 && d < nearestGrabDist) {
              nearestGrabDist = d;
              nearestGrabCrate = crate;
            }
          }

          // Ground contact shadow when resting on a surface
          if (!isHeld && crate.grounded) {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
            ctx.beginPath();
            ctx.ellipse(cx, renderY + crate.h + 0.5, crate.w * 0.5, 2.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(crate.angle ?? 0);

          if (crate.shape === 'ball') {
            const r = crate.w * 0.5;
            const grad = ctx.createRadialGradient(-r * 0.32, -r * 0.32, r * 0.12, 0, 0, r);
            grad.addColorStop(0, '#FB7185');
            grad.addColorStop(0.6, '#E11D48');
            grad.addColorStop(1, '#881337');
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = '#FDA4AF';
            ctx.stroke();

            // Equatorial seam bands for crisp spin readability
            ctx.beginPath();
            ctx.moveTo(-r + 2.5, 0);
            ctx.lineTo(r - 2.5, 0);
            ctx.moveTo(0, -r + 2.5);
            ctx.lineTo(0, r - 2.5);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
            ctx.lineWidth = 1.6;
            ctx.stroke();

            ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
            ctx.beginPath();
            ctx.arc(-r * 0.34, -r * 0.34, r * 0.18, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const hw = crate.w * 0.5;
            const hh = crate.h * 0.5;

            if (crate.material === 'steel') {
              // Heavy armored gunmetal crate with gradient shading, X-gusset ribs & chamfered frame
              const steelGrad = ctx.createLinearGradient(-hw, -hh, hw, hh);
              steelGrad.addColorStop(0, '#334155');
              steelGrad.addColorStop(1, '#141C2B');
              ctx.fillStyle = steelGrad;
              ctx.beginPath();
              ctx.roundRect(-hw, -hh, crate.w, crate.h, 2.5);
              ctx.fill();

              // Outer thick steel frame
              ctx.strokeStyle = '#64748B';
              ctx.lineWidth = 3.5;
              ctx.strokeRect(-hw + 1.8, -hh + 1.8, crate.w - 3.6, crate.h - 3.6);

              // Recessed inner armor plate
              ctx.fillStyle = '#243246';
              ctx.fillRect(-hw + 4.5, -hh + 4.5, crate.w - 9, crate.h - 9);

              // Embossed X-reinforcement ribs
              ctx.strokeStyle = '#475569';
              ctx.lineWidth = 2.2;
              ctx.beginPath();
              ctx.moveTo(-hw + 5, -hh + 5);
              ctx.lineTo(hw - 5, hh - 5);
              ctx.moveTo(hw - 5, -hh + 5);
              ctx.lineTo(-hw + 5, hh - 5);
              ctx.stroke();

              // Subtle metallic sheen highlight on top edge
              ctx.strokeStyle = '#94A3B8';
              ctx.lineWidth = 1.3;
              ctx.strokeRect(-hw + 0.6, -hh + 0.6, crate.w - 1.2, crate.h - 1.2);
            } else if (crate.material === 'polymer') {
              // Sleek composite cube with shaded casing & glowing cyan core cell
              const polyGrad = ctx.createLinearGradient(-hw, -hh, hw, hh);
              polyGrad.addColorStop(0, '#0E5A8A');
              polyGrad.addColorStop(1, '#082F49');
              ctx.fillStyle = polyGrad;
              ctx.beginPath();
              ctx.roundRect(-hw, -hh, crate.w, crate.h, 4);
              ctx.fill();

              // Inner translucent energy core
              ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
              ctx.beginPath();
              ctx.roundRect(-hw + 5, -hh + 5, crate.w - 10, crate.h - 10, 2.5);
              ctx.fill();
              ctx.fillStyle = '#7DD3FC';
              ctx.beginPath();
              ctx.moveTo(0, -hh * 0.42);
              ctx.lineTo(hw * 0.42, 0);
              ctx.lineTo(0, hh * 0.42);
              ctx.lineTo(-hw * 0.42, 0);
              ctx.closePath();
              ctx.fill();

              // Corner polymer bumpers
              ctx.strokeStyle = '#38BDF8';
              ctx.lineWidth = 1.6;
              ctx.beginPath();
              ctx.roundRect(-hw + 0.8, -hh + 0.8, crate.w - 1.6, crate.h - 1.6, 4);
              ctx.stroke();
            } else {
              // Handcrafted wooden crate: shaded cedar planks, diagonal timber brace & beveled rim
              const woodGrad = ctx.createLinearGradient(-hw, -hh, hw, hh);
              woodGrad.addColorStop(0, '#7E512A');
              woodGrad.addColorStop(1, '#543318');
              ctx.fillStyle = woodGrad;
              ctx.beginPath();
              ctx.roundRect(-hw, -hh, crate.w, crate.h, 2);
              ctx.fill();

              // Horizontal interior plank seams
              ctx.strokeStyle = 'rgba(38, 20, 8, 0.58)';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(-hw + 4, -hh * 0.33);
              ctx.lineTo(hw - 4, -hh * 0.33);
              ctx.moveTo(-hw + 4, hh * 0.33);
              ctx.lineTo(hw - 4, hh * 0.33);
              ctx.stroke();

              // Diagonal timber cross-brace
              ctx.strokeStyle = '#A77242';
              ctx.lineWidth = 3.6;
              ctx.beginPath();
              ctx.moveTo(-hw + 4, hh - 4);
              ctx.lineTo(hw - 4, -hh + 4);
              ctx.stroke();

              // Outer wooden frame planks
              ctx.strokeStyle = '#C28A54';
              ctx.lineWidth = 3.2;
              ctx.strokeRect(-hw + 1.6, -hh + 1.6, crate.w - 3.2, crate.h - 3.2);

              // Crisp warm rim
              ctx.strokeStyle = '#E6B17A';
              ctx.lineWidth = 1;
              ctx.strokeRect(-hw + 0.5, -hh + 0.5, crate.w - 1, crate.h - 1);
            }
          }
          ctx.restore();
        }

        // In-world miniature [Q] keycap prompt on nearest reachable unheld crate (pointer mode)
        if (nearestGrabCrate && sandboxSelRef.current.tool === 'pointer') {
          drawKeycapPrompt(nearestGrabCrate.x + nearestGrabCrate.w * 0.5, nearestGrabCrate.y - 14, 'Q', '#F59E0B');
        }

        // 10. Agent Path & Target Overlay (when enabled)
        if (showPlansRef.current) {
          for (const actor of currentWorld.actors) {
            if (actor.role !== 'agent') continue;
            const path = actor.lastInput.pathPreview;
            if (path && path.length > 1) {
              ctx.save();
              ctx.strokeStyle = actor.color;
              ctx.globalAlpha = 0.34;
              ctx.lineWidth = 1.3;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(actor.x + actor.w * 0.5, actor.y + actor.h * 0.5);
              for (let i = 1; i < path.length; i++) {
                ctx.lineTo(path[i].x, path[i].y - 12);
              }
              ctx.stroke();

              // Crisp crosshair reticle at destination
              const endPt = path[path.length - 1];
              const ex = endPt.x;
              const ey = endPt.y - 12;
              ctx.setLineDash([]);
              ctx.strokeStyle = actor.color;
              ctx.globalAlpha = 0.65;
              ctx.lineWidth = 1.4;
              ctx.beginPath();
              ctx.moveTo(ex - 4, ey);
              ctx.lineTo(ex + 4, ey);
              ctx.moveTo(ex, ey - 4);
              ctx.lineTo(ex, ey + 4);
              ctx.stroke();
              ctx.restore();
            }
          }
        }

        // 11. Actors (Human + Autonomous Agents with procedural animation & archetypes)
        const animMap = actorAnimsRef.current;
        const activeIds = new Set(currentWorld.actors.map((a) => a.id));
        for (const existingId of animMap.keys()) {
          if (!activeIds.has(existingId)) animMap.delete(existingId);
        }

        for (const actor of currentWorld.actors) {
          let anim = animMap.get(actor.id);
          if (!anim) {
            anim = createActorAnimState(actor);
            animMap.set(actor.id, anim);
          } else {
            const feedback = updateActorAnimState(anim, actor, currentWorld.crates, dt, spawnParticles, currentWorld.actors, now);
            if (feedback.bounced) {
              soundFX.playBounce();
              triggerShake(2.2);
            } else if (feedback.landedIntensity > 0.15) {
              soundFX.playLand(feedback.landedIntensity);
              if (feedback.landedIntensity > 0.78) triggerShake(2.8);
            }
            if (feedback.grabbed) soundFX.playGrab();
            if (feedback.threw) soundFX.playThrow();
          }

          drawActorCharacter(ctx, actor, anim, currentWorld.crates, now, showPlansRef.current);

          const latestMessage = (currentWorld.messages ?? []).reduce<AgentMessage | null>(
            (best, message) =>
              message.actorId === actor.id && (!best || message.tick > best.tick)
                ? message
                : best,
            null
          );
          if (latestMessage && currentWorld.tick - latestMessage.tick <= 240) {
            drawChatBubble(ctx, actor, anim, latestMessage, currentWorld.tick);
          }
        }

        // 12. Expanding Impulse Shockwave Rings
        for (const imp of currentWorld.recentImpulses ?? []) {
          const age = currentWorld.tick - imp.tick;
          const prog = Math.min(1, Math.max(0, age / 26));
          const r = 16 + imp.radius * prog;
          ctx.save();
          ctx.strokeStyle = '#38BDF8';
          ctx.globalAlpha = (1 - prog) * 0.7;
          ctx.lineWidth = 3 * (1 - prog) + 0.5;
          ctx.beginPath();
          ctx.arc(imp.x, imp.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 13. Sandbox Interactive Tool Preview, Edit Gizmos & Wire Mode Overlays
      const sel = sandboxSelRef.current;
      const hover = hoverWorldRef.current;
      const drag = flingDragRef.current;

      // Render Selected Entity Highlight & Manipulation Handles whenever an entity is selected in Edit (or any active editor state)
      if (currentWorld && sel.selectedEntityId) {
        const selectedHit = getEntityById(sel.selectedEntityId);
        if (selectedHit) {
          ctx.save();
          ctx.strokeStyle = '#38BDF8';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(selectedHit.x - 3, selectedHit.y - 3, selectedHit.w + 6, selectedHit.h + 6);
          ctx.setLineDash([]);

          if (sel.tool === 'edit') {
            if (selectedHit.resizable) {
              const pts: Array<[number, number]> = [
                [selectedHit.x + selectedHit.w, selectedHit.y + selectedHit.h * 0.5],
                [selectedHit.x, selectedHit.y + selectedHit.h * 0.5],
                [selectedHit.x + selectedHit.w * 0.5, selectedHit.y + selectedHit.h],
                [selectedHit.x + selectedHit.w * 0.5, selectedHit.y],
                [selectedHit.x + selectedHit.w, selectedHit.y + selectedHit.h],
              ];
              for (const [hx, hy] of pts) {
                ctx.fillStyle = '#0F172A';
                ctx.fillRect(hx - 4.5, hy - 4.5, 9, 9);
                ctx.strokeStyle = '#38BDF8';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(hx - 4.5, hy - 4.5, 9, 9);
              }
            }

            if (selectedHit.kind === 'forceZone') {
              const fz = currentWorld.forceZones.find((f) => f.id === selectedHit.id);
              if (fz) {
                const cx = fz.x + fz.w * 0.5;
                const cy = fz.y + fz.h * 0.5;
                const tip = getForceVectorTip(fz);
                ctx.strokeStyle = '#F59E0B';
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(tip.x, tip.y);
                ctx.stroke();

                ctx.fillStyle = '#F59E0B';
                ctx.beginPath();
                ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#0B1018';
                ctx.lineWidth = 1.5;
                ctx.stroke();

                ctx.fillStyle = '#FDE68A';
                ctx.font = '600 9px "JetBrains Mono", monospace';
                ctx.textAlign = 'left';
                ctx.fillText(
                  `F(${Math.round(fz.fx)}, ${Math.round(fz.fy)})`,
                  tip.x + 9,
                  tip.y + 3
                );
              }
            }

            if (selectedHit.kind === 'platform') {
              const plat = currentWorld.platforms.find((p) => p.id === selectedHit.id);
              if (plat && plat.kind === 'moving' && plat.endPos) {
                const endCx = plat.endPos.x + plat.w * 0.5;
                const endCy = plat.endPos.y + plat.h * 0.5;
                ctx.strokeStyle = '#10B981';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([3, 3]);
                ctx.strokeRect(plat.endPos.x, plat.endPos.y, plat.w, plat.h);
                ctx.setLineDash([]);
                ctx.fillStyle = '#10B981';
                ctx.beginPath();
                ctx.arc(endCx, endCy, 6.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#A7F3D0';
                ctx.font = '600 9px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText('END', endCx, endCy - 10);
              }
            }
          }
          ctx.restore();
        }
      }

      // Render Wire Mode source & target connection rings + live rubber-band wire
      if (currentWorld && sel.tool === 'wire') {
        ctx.save();
        for (const sw of currentWorld.switches) {
          ctx.strokeStyle = CHANNEL_COLORS[sw.channel];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sw.x + sw.w * 0.5, sw.y + sw.h * 0.5, 16, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (const pl of currentWorld.plates) {
          ctx.strokeStyle = CHANNEL_COLORS[pl.channel];
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pl.x + pl.w * 0.5, pl.y + pl.h * 0.5, 15, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (const d of currentWorld.doors) {
          ctx.strokeStyle = '#38BDF8';
          ctx.setLineDash([3, 3]);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(d.x - 4, d.y - 4, d.w + 8, d.h + 8);
        }
        for (const p of currentWorld.platforms) {
          if (PROTECTED_IDS.has(p.id)) continue;
          if (p.kind === 'moving' || p.linkedIds?.length || p.channel) {
            ctx.strokeStyle = '#38BDF8';
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1.25;
            ctx.strokeRect(p.x - 3, p.y - 3, p.w + 6, p.h + 6);
          }
        }
        ctx.strokeStyle = '#10B981';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
          currentWorld.exit.x - 3,
          currentWorld.exit.y - 3,
          currentWorld.exit.w + 6,
          currentWorld.exit.h + 6
        );
        ctx.setLineDash([]);

        const activeWire = wireDragRef.current;
        const pendingWire = pendingWireSourceRef.current;
        if (activeWire) {
          ctx.strokeStyle = activeWire.color;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(activeWire.startX, activeWire.startY);
          ctx.lineTo(activeWire.curX, activeWire.curY);
          ctx.stroke();
        } else if (pendingWire && hover) {
          ctx.strokeStyle = pendingWire.color;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(pendingWire.x, pendingWire.y);
          ctx.lineTo(hover.x, hover.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = pendingWire.color;
          ctx.font = '600 10px "JetBrains Mono", monospace';
          ctx.fillText(`WIRE FROM ${pendingWire.sourceLabel}`, hover.x + 12, hover.y - 8);
        }
        ctx.restore();
      }

      if (drag) {
        ctx.save();
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(drag.startX, drag.startY);
        ctx.lineTo(drag.curX, drag.curY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#38BDF8';
        ctx.beginPath();
        ctx.arc(drag.curX, drag.curY, 4.5, 0, Math.PI * 2);
        ctx.fill();
        const speedPreview = Math.round(Math.hypot(drag.curX - drag.startX, drag.curY - drag.startY) * 4.8);
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#E0F2FE';
        ctx.fillText(`Fling ${speedPreview} px/s`, drag.curX + 10, drag.curY - 8);
        ctx.restore();
      } else if (hover && sel.tool !== 'pointer' && sel.tool !== 'edit' && sel.tool !== 'wire') {
        const spec = SANDBOX_TOOLS.find((t) => t.id === sel.tool);
        if (sel.tool === 'blast') {
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
          ctx.setLineDash([5, 5]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hover.x, hover.y, 175, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(56, 189, 248, 0.06)';
          ctx.fill();
          ctx.restore();
        } else if (sel.tool === 'eraser') {
          const rem = findRemovableAt(hover);
          if (rem) {
            ctx.save();
            ctx.strokeStyle = '#F43F5E';
            ctx.lineWidth = 2;
            ctx.strokeRect(rem.rect.x - 3, rem.rect.y - 3, rem.rect.w + 6, rem.rect.h + 6);
            ctx.restore();
          }
        } else if (sel.tool === 'fling') {
          const body = findBodyAt(hover);
          if (body) {
            ctx.save();
            ctx.strokeStyle = '#38BDF8';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(body.cx, body.cy, 22, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        } else if (spec && spec.defaultW > 0) {
          const snapped = snapCoord(hover);
          ctx.save();
          ctx.strokeStyle = '#38BDF8';
          ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.5;
          if (sel.tool === 'ball_rubber') {
            ctx.beginPath();
            ctx.arc(snapped.x, snapped.y, spec.defaultW * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillRect(
              snapped.x - spec.defaultW * 0.5,
              snapped.y - spec.defaultH * 0.5,
              spec.defaultW,
              spec.defaultH
            );
            ctx.strokeRect(
              snapped.x - spec.defaultW * 0.5,
              snapped.y - spec.defaultH * 0.5,
              spec.defaultW,
              spec.defaultH
            );
          }
          ctx.restore();
        }
      } else if (hover && sel.tool === 'edit' && !editDragRef.current) {
        const hoverHit = findSelectableAt(hover);
        if (hoverHit && hoverHit.id !== sel.selectedEntityId) {
          ctx.save();
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(hoverHit.x - 2, hoverHit.y - 2, hoverHit.w + 4, hoverHit.h + 4);
          ctx.restore();
        }
      }

      // 14. Pooled Particles (Circles, Sparks, Squares, Expanding Rings)
      const pool = particlesRef.current;
      for (let i = 0; i < POOL_SIZE; i++) {
        const p = pool[i];
        if (!p.active) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.active = false;
          continue;
        }
        const t = Math.max(0, p.life / p.maxLife);
        p.vy += (currentWorld?.physics?.gravity ?? 1450) * p.gravityScale * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = t;
        if (p.shape === 'ring') {
          const ringR = p.size * (1.2 - t * 0.85);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.8 * t;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1, ringR), 0, Math.PI * 2);
          ctx.stroke();
        } else if (p.shape === 'spark') {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, p.size * 0.65 * t);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
          ctx.stroke();
        } else if (p.shape === 'circle') {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0.8, p.size * (0.4 + 0.6 * t)), 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
        }
      }
      ctx.globalAlpha = 1;

      // Crisp outer chamber bezel inside clip + close clip
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0.5, 0.5, WORLD_WIDTH - 1, WORLD_HEIGHT - 1);
      ctx.restore(); // close interior chamber clip

      ctx.restore();
      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const cursorClass =
    sandboxSelection?.tool === 'fling'
      ? 'cursor-grab'
      : sandboxSelection?.tool === 'edit'
        ? 'cursor-move'
        : sandboxSelection?.tool && sandboxSelection.tool !== 'pointer'
          ? 'cursor-crosshair'
          : 'cursor-default';

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-[360px] bg-[#0D1420] overflow-hidden select-none"
      data-testid="game-canvas-container"
    >
      <canvas
        ref={canvasRef}
        data-testid="game-canvas"
        tabIndex={0}
        aria-label="2D collaborative puzzle platformer arena"
        className={`block w-full h-full outline-none ${cursorClass}`}
      />
    </div>
  );
}
