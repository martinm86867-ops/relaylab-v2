import type { ActorInput, AgentObservation, LlmControlMode } from '../../engine/types';
import { PROMPT_VERSION } from './prompt';

export interface BuildLlmContextOptions {
  controlMode: LlmControlMode;
  lastAction?: ActorInput;
  persona?: string;
}

function round(value: number, digits = 1): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function entityIdSet(obs: AgentObservation): Set<string> {
  const ids = new Set<string>();
  ids.add(obs.exit.id);
  for (const p of obs.plates) ids.add(p.id);
  for (const s of obs.switches) ids.add(s.id);
  for (const d of obs.doors) ids.add(d.id);
  for (const c of obs.crates) ids.add(c.id);
  for (const p of obs.platforms) ids.add(p.id);
  for (const h of obs.hazards) ids.add(h.id);
  for (const f of obs.forceZones) ids.add(f.id);
  for (const t of obs.teammates) ids.add(t.id);
  for (const m of obs.messages) if (m.targetId) ids.add(m.targetId);
  return ids;
}

/**
 * Compact, public-only view of the world for an LLM turn.
 *
 * The observation is already free of server internals; this strips engine-ish
 * noise, rounds coordinates, and keeps only the fields a player can see.
 */
export function buildLlmContext(obs: AgentObservation, opts: BuildLlmContextOptions) {
  const level = obs.level ?? {
    id: obs.levelId,
    name: obs.levelId,
    subtitle: '',
    hint: '',
    isSandbox: obs.isSandbox,
  };
  const clock = obs.clock ?? {
    tick: obs.tick,
    seconds: 0,
    paused: false,
    timeScale: 1,
  };
  const metrics = obs.metrics ?? {
    actorsAtExit: 0,
    totalActors: 0,
    decisionsLogged: 0,
    solvedAtTick: null,
  };
  const messages = (obs.messages ?? []).slice(-8).map((m) => ({
    from: m.actorName,
    label: m.actorLabel,
    kind: m.kind,
    text: m.text,
    channel: m.channel,
    targetId: m.targetId,
    ageTicks: Math.max(0, obs.tick - m.tick),
  }));
  const recentEvents = (obs.recentEvents ?? []).slice(-8).map((e) => ({
    tick: e.tick,
    type: e.type,
    message: e.message,
    actorId: e.actorId,
    entityId: e.entityId,
  }));

  return {
    promptVersion: PROMPT_VERSION,
    controlMode: opts.controlMode,
    persona: opts.persona,
    level: {
      id: level.id,
      name: level.name,
      subtitle: level.subtitle,
      hint: level.hint,
      isSandbox: level.isSandbox,
    },
    clock: {
      tick: clock.tick,
      seconds: round(clock.seconds, 2),
      paused: clock.paused,
      timeScale: clock.timeScale,
    },
    arena: { width: 960, height: 540 },
    me: {
      id: obs.self.id,
      name: obs.self.name,
      x: round(obs.self.x),
      y: round(obs.self.y),
      vx: round(obs.self.vx),
      vy: round(obs.self.vy),
      grounded: obs.self.grounded,
      facing: obs.self.facing,
      holdingCrateId: obs.self.holdingCrateId,
      onExit: obs.self.onExit,
      lastIntent: opts.lastAction?.intent,
      lastReason: opts.lastAction?.reason,
    },
    teammates: obs.teammates.map((t) => ({
      id: t.id,
      name: t.name,
      role: t.role,
      x: round(t.x),
      y: round(t.y),
      vx: round(t.vx),
      vy: round(t.vy),
      grounded: t.grounded,
      onExit: t.onExit,
      intent: t.intent,
      claimTargetId: t.claimTargetId ?? t.targetId,
      message: t.message,
    })),
    objective: {
      exit: {
        id: obs.exit.id,
        x: obs.exit.x,
        y: obs.exit.y,
        w: obs.exit.w,
        h: obs.exit.h,
        unlocked: obs.exit.unlocked,
        requiredChannels: [...obs.exit.requiredChannels],
        linkedIds: [...(obs.exit.linkedIds ?? [])],
        logic: obs.exit.logic ?? 'ALL',
        arrived: metrics.actorsAtExit,
        total: metrics.totalActors,
      },
    },
    channels: { ...obs.channels },
    plates: obs.plates.map((p) => ({
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
    switches: obs.switches.map((s) => ({
      id: s.id,
      label: s.label,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      channel: s.channel,
      active: s.active,
    })),
    doors: obs.doors.map((d) => ({
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
    crates: obs.crates.map((c) => ({
      id: c.id,
      label: c.label,
      x: round(c.x),
      y: round(c.y),
      w: c.w,
      h: c.h,
      shape: c.shape,
      material: c.material,
      mass: c.mass,
      vx: round(c.vx),
      vy: round(c.vy),
    })),
    platforms: obs.platforms.map((p) => ({
      id: p.id,
      x: round(p.x),
      y: round(p.y),
      w: p.w,
      h: p.h,
      kind: p.kind,
      material: p.material,
      conveyorSpeed: p.conveyorSpeed,
      bounceVelocity: p.bounceVelocity,
      channel: p.channel,
      linkedIds: p.linkedIds ? [...p.linkedIds] : [],
      logic: p.logic,
      startPos: p.startPos,
      endPos: p.endPos,
      loopWhenActive: p.loopWhenActive,
    })),
    hazards: obs.hazards.map((h) => ({ ...h })),
    forceZones: obs.forceZones.map((f) => ({ ...f })),
    messages,
    recentEvents,
    knownEntityIds: [...entityIdSet(obs)],
  };
}
