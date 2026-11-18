import type { AgentMessageKind, AgentObservation, ChannelId, LlmControlMode } from '../../engine/types';
import type { LlmAction, LlmDecision, LlmSay } from './types';

export class LlmDecisionError extends Error {}

const VALID_KINDS: AgentMessageKind[] = ['status', 'claim', 'request', 'alert'];
const VALID_CHANNELS: ChannelId[] = ['A', 'B', 'C'];

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function entityIds(obs: AgentObservation): Set<string> {
  const ids = new Set<string>([obs.exit.id]);
  for (const p of obs.plates) ids.add(p.id);
  for (const s of obs.switches) ids.add(s.id);
  for (const d of obs.doors) ids.add(d.id);
  for (const c of obs.crates) ids.add(c.id);
  for (const p of obs.platforms) ids.add(p.id);
  for (const h of obs.hazards) ids.add(h.id);
  for (const f of obs.forceZones) ids.add(f.id);
  for (const t of obs.teammates) ids.add(t.id);
  return ids;
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new LlmDecisionError('Response did not contain a JSON object');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced.slice(first, last + 1));
  } catch {
    throw new LlmDecisionError('Response JSON was malformed');
  }
  const obj = asRecord(parsed);
  if (!obj) throw new LlmDecisionError('Response JSON was not an object');
  return obj;
}

function parseSay(value: unknown, ids: Set<string>): LlmSay | undefined {
  const obj = asRecord(value);
  if (!obj) return undefined;
  const text = cleanText(obj.text, 140);
  if (!text) return undefined;
  const rawKind = typeof obj.kind === 'string' ? obj.kind : 'status';
  const kind: AgentMessageKind = VALID_KINDS.includes(rawKind as AgentMessageKind)
    ? (rawKind as AgentMessageKind)
    : 'status';
  const targetId = typeof obj.targetId === 'string' && ids.has(obj.targetId) ? obj.targetId : undefined;
  const channel = VALID_CHANNELS.includes(obj.channel as ChannelId)
    ? (obj.channel as ChannelId)
    : undefined;
  return { text, kind, targetId, channel };
}

function parseAction(
  value: unknown,
  obs: AgentObservation,
  mode: LlmControlMode,
  ids: Set<string>
): LlmAction {
  const obj = asRecord(value);
  if (!obj) throw new LlmDecisionError('Missing action object');
  const type = typeof obj.type === 'string' ? obj.type : '';
  const durationMs = clamp(finite(obj.durationMs, 1400), 400, 3000);

  if (type === 'raw' || type === 'move') {
    const moveRaw = finite(obj.move ?? obj.direction, 0);
    const move: -1 | 0 | 1 = moveRaw > 0 ? 1 : moveRaw < 0 ? -1 : 0;
    return {
      type: 'raw',
      move,
      jump: Boolean(obj.jump),
      interact: Boolean(obj.interact),
      grab: Boolean(obj.grab),
      durationMs,
    };
  }

  if (mode === 'direct') {
    throw new LlmDecisionError('Direct mode accepts only the raw action type');
  }

  if (type === 'goto') {
    const x = clamp(finite(obj.x, obs.self.x), 20, 940);
    const y = clamp(finite(obj.y, obs.self.y), 20, 520);
    return { type: 'goto', x, y, durationMs };
  }

  if (type === 'use' || type === 'hold') {
    const targetId = typeof obj.targetId === 'string' ? obj.targetId : '';
    if (!targetId || !ids.has(targetId)) {
      throw new LlmDecisionError(`Action '${type}' needs a valid targetId`);
    }
    return { type, targetId, durationMs };
  }

  if (type === 'grab') {
    const targetId = typeof obj.targetId === 'string' && ids.has(obj.targetId)
      ? obj.targetId
      : undefined;
    return { type: 'grab', targetId, durationMs };
  }

  if (type === 'wait') {
    return { type: 'wait', durationMs };
  }

  throw new LlmDecisionError(`Unsupported action type '${type}'`);
}

export function parseDecision(
  raw: string,
  obs: AgentObservation,
  mode: LlmControlMode
): LlmDecision {
  const obj = extractJsonObject(raw);
  const ids = entityIds(obs);
  const action = parseAction(obj.action, obs, mode, ids);
  const intent = cleanText(obj.intent, 60) || 'Executing command';
  const reason = cleanText(obj.reason, 180) || undefined;
  const claimTargetId = typeof obj.claimTargetId === 'string' && ids.has(obj.claimTargetId)
    ? obj.claimTargetId
    : undefined;
  const say = parseSay(obj.say, ids);
  return { intent, reason, claimTargetId, say, action, raw };
}
