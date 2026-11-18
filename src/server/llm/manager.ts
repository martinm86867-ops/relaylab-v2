import { createAgentMemory, decideAgentAction, type AgentPlannerMemory } from '../../engine/agentPlanner';
import type {
  ActorInput,
  ActorState,
  AgentMessageKind,
  AgentObservation,
  ChannelId,
  LlmControlMode,
  WorldState,
} from '../../engine/types';
import { buildLlmContext } from './context';
import { parseDecision, LlmDecisionError } from './decision';
import { LlmPilot } from './pilot';
import { buildSystemPrompt, buildUserPrompt, PROMPT_VERSION } from './prompt';
import { getProvider, listProviders, resolveModel } from './providers';
import type {
  LlmDecision,
  LlmProvider,
  LlmProviderInfo,
  LlmRunnerStatus,
  LlmSpawnConfig,
} from './types';

const MAX_LLM_AGENTS = 4;
const MAX_DECISIONS_PER_MINUTE = 30;
const MIN_DECISION_INTERVAL_MS = 2000;
const PROVIDER_TIMEOUT_MS = 9000;
const FALLBACK_MS = 12000;

export interface LlmHost {
  getWorld(): WorldState;
  addActor(opts: { id: string; name: string }): ActorState;
  removeActor(actorId: string): boolean;
  buildObservation(actorId: string): AgentObservation | null;
  setInput(actorId: string, input: ActorInput): void;
  recordMessage(
    actorId: string,
    text: string,
    opts?: { kind?: AgentMessageKind; targetId?: string; channel?: ChannelId }
  ): boolean;
  broadcast(): void;
}

export class LlmSpawnError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = 'LlmSpawnError';
  }
}

function clampText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

function safeError(error: unknown): string {
  const message =
    error instanceof LlmDecisionError
      ? `Decision rejected: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'Unknown provider error';
  return message.replace(/\s+/g, ' ').slice(0, 180);
}

function idle(): ActorInput {
  return { move: 0, jump: false, interact: false, grab: false };
}

class LlmRunner {
  readonly actorId: string;
  readonly provider: LlmProvider;
  readonly model: string;
  readonly controlMode: LlmControlMode;
  readonly persona?: string;
  private readonly pilot = new LlmPilot();
  private readonly fallbackMemory: AgentPlannerMemory = createAgentMemory();
  private status: LlmRunnerStatus['status'] = 'idle';
  private error?: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private deciding = false;
  private abortController: AbortController | null = null;
  private decisions = 0;
  private lastDecisionLatencyMs?: number;
  private lastDecisionAt?: number;
  private nextDecisionAt = 0;
  private fallbackUntil = 0;
  private lastFallbackAt = 0;
  private readonly intervalMs: number;

  constructor(
    private readonly host: LlmHost,
    actor: ActorState,
    private readonly config: LlmSpawnConfig,
    provider: LlmProvider,
    model: string
  ) {
    this.actorId = actor.id;
    this.provider = provider;
    this.model = model;
    this.controlMode = config.controlMode;
    this.persona = clampText(config.persona, 500);
    const envInterval = Number(process.env.RELAYLAB_LLM_DECISION_MS ?? 2200);
    this.intervalMs = Number.isFinite(envInterval)
      ? Math.max(MIN_DECISION_INTERVAL_MS, Math.min(5000, envInterval))
      : 2200;

    actor.controller = 'llm';
    actor.provider = provider.info.id;
    actor.model = model;
    actor.controlMode = config.controlMode;
    actor.agentStatus = 'idle';
    actor.agentError = undefined;
  }

  start(): void {
    this.schedule(500);
  }

  getStatus(): LlmRunnerStatus {
    return {
      actorId: this.actorId,
      name: this.config.name,
      provider: this.provider.info.id,
      model: this.model,
      controlMode: this.controlMode,
      status: this.status,
      error: this.error,
      decisions: this.decisions,
      lastDecisionLatencyMs: this.lastDecisionLatencyMs,
      lastDecisionAt: this.lastDecisionAt,
      fallbackUntil: this.fallbackUntil > Date.now() ? this.fallbackUntil : undefined,
    };
  }

  isStopped(): boolean {
    return this.stopped;
  }

  stop(removeActor: boolean): void {
    if (this.stopped) return;
    this.stopped = true;
    this.status = 'stopped';
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    this.pilot.clear();
    if (removeActor) {
      this.host.removeActor(this.actorId);
    }
    this.host.broadcast();
  }

  private actor(): ActorState | undefined {
    return this.host.getWorld().actors.find((a) => a.id === this.actorId);
  }

  private setActorStatus(status: LlmRunnerStatus['status'], error?: string): void {
    const actor = this.actor();
    if (!actor) return;
    actor.agentStatus = status;
    actor.agentError = error;
    if (this.lastDecisionLatencyMs !== undefined) {
      actor.lastDecisionLatencyMs = this.lastDecisionLatencyMs;
    }
  }

  private schedule(delay = this.intervalMs): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    const remaining = Math.max(0, this.nextDecisionAt - Date.now());
    const wait = Math.max(delay, remaining);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.decide();
    }, wait);
  }

  private async decide(): Promise<void> {
    if (this.stopped || this.deciding) return;
    const world = this.host.getWorld();
    if (world.paused || world.solved) {
      this.schedule(1000);
      return;
    }
    const actor = this.actor();
    const obs = actor ? this.host.buildObservation(this.actorId) : null;
    if (!actor || !obs) {
      if (actor) this.schedule(1000);
      return;
    }

    this.deciding = true;
    this.status = 'thinking';
    this.setActorStatus('thinking');
    this.host.broadcast();
    const started = Date.now();
    this.nextDecisionAt = started + Math.max(
      this.intervalMs,
      Math.ceil(60_000 / MAX_DECISIONS_PER_MINUTE)
    );
    this.abortController = new AbortController();
    const timeout = setTimeout(() => this.abortController?.abort(), PROVIDER_TIMEOUT_MS);

    try {
      const context = buildLlmContext(obs, {
        controlMode: this.controlMode,
        lastAction: actor.lastInput,
        persona: this.persona,
      });
      const raw = await this.provider.complete({
        system: buildSystemPrompt({
          name: actor.name,
          controlMode: this.controlMode,
          persona: this.persona,
        }),
        user: buildUserPrompt(context),
        model: this.model,
        signal: this.abortController.signal,
      });
      const decision = parseDecision(raw, obs, this.controlMode);
      this.applyDecision(decision, obs);
      this.error = undefined;
      this.fallbackUntil = 0;
      this.status = 'acting';
      this.setActorStatus('acting');
    } catch (error) {
      if (this.stopped) return;
      this.error = safeError(error);
      this.fallbackUntil = Date.now() + FALLBACK_MS;
      this.lastFallbackAt = 0;
      this.status = 'error';
      this.setActorStatus('error', this.error);
      this.pilot.clear();
      this.host.setInput(this.actorId, idle());
    } finally {
      clearTimeout(timeout);
      this.abortController = null;
      this.deciding = false;
      this.lastDecisionLatencyMs = Date.now() - started;
      this.lastDecisionAt = Date.now();
      const current = this.actor();
      if (current) {
        current.lastDecisionLatencyMs = this.lastDecisionLatencyMs;
      }
      this.decisions += 1;
      this.host.broadcast();
      this.schedule();
    }
  }

  private applyDecision(decision: LlmDecision, obs: AgentObservation): void {
    const now = Date.now();
    this.pilot.setCommand({
      action: decision.action,
      intent: decision.intent,
      reason: decision.reason,
      claimTargetId: decision.claimTargetId,
      receivedAt: now,
    });

    const actor = this.actor();
    if (!actor) return;
    actor.lastInput = {
      ...actor.lastInput,
      intent: decision.intent,
      reason: decision.reason,
      claimTargetId: decision.claimTargetId,
    };

    if (decision.say) {
      this.host.recordMessage(this.actorId, decision.say.text, {
        kind: decision.say.kind,
        targetId: decision.say.targetId,
        channel: decision.say.channel,
      });
    }

    // Keep the context's own clock usable for tests/debugging.
    void obs;
  }

  tick(now: number): void {
    if (this.stopped) return;
    const actor = this.actor();
    if (!actor) {
      this.stop(false);
      return;
    }
    const world = this.host.getWorld();
    if (world.paused || world.solved) {
      this.host.setInput(this.actorId, idle());
      return;
    }
    const obs = this.host.buildObservation(this.actorId);
    if (!obs) return;

    if (this.fallbackUntil > now) {
      if (now - this.lastFallbackAt >= 250) {
        this.lastFallbackAt = now;
        const input = decideAgentAction(obs, this.fallbackMemory);
        this.host.setInput(this.actorId, { ...input, intent: input.intent ?? 'Fallback planner' });
      }
      return;
    }

    const input = this.pilot.tick(obs, now);
    this.host.setInput(this.actorId, input);
    if (this.status === 'acting' && !this.pilot.active) {
      this.status = 'idle';
      this.setActorStatus('idle');
      this.host.broadcast();
    }
  }
}

export class LlmAgentManager {
  private readonly runners = new Map<string, LlmRunner>();
  private readonly timer: ReturnType<typeof setInterval>;
  private seq = 0;

  constructor(private readonly host: LlmHost) {
    this.timer = setInterval(() => this.tick(), 16);
    this.timer.unref?.();
  }

  providers(): LlmProviderInfo[] {
    return listProviders();
  }

  count(): number {
    return this.runners.size;
  }

  private pickName(requested?: string): string {
    const base = clampText(requested, 32) || 'LLM-Agent';
    const used = new Set(this.host.getWorld().actors.map((a) => a.name));
    if (!used.has(base)) return base;
    for (let i = 2; i < 100; i += 1) {
      const candidate = `${base}-${i}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base}-${this.seq + 1}`;
  }

  spawn(config: LlmSpawnConfig): { actor: ActorState; status: LlmRunnerStatus } {
    if (!['hybrid', 'direct'].includes(config.controlMode)) {
      throw new LlmSpawnError("controlMode must be 'hybrid' or 'direct'");
    }
    if (this.runners.size >= MAX_LLM_AGENTS) {
      throw new LlmSpawnError(`At most ${MAX_LLM_AGENTS} LLM agents can run at once`);
    }
    const provider = getProvider(config.provider);
    if (!provider) {
      throw new LlmSpawnError(`Unknown provider '${config.provider}'`);
    }
    if (!provider.info.configured) {
      throw new LlmSpawnError(
        `Provider '${provider.info.id}' is not configured. ${provider.info.notes ?? ''}`.trim()
      );
    }
    const model = resolveModel(provider.info, config.model);
    if (!model) {
      throw new LlmSpawnError('A model name is required');
    }

    this.seq += 1;
    const actorId = `agent-llm-${this.seq}`;
    const actor = this.host.addActor({ id: actorId, name: this.pickName(config.name) });
    const runner = new LlmRunner(
      this.host,
      actor,
      { ...config, name: actor.name, model },
      provider,
      model
    );
    this.runners.set(actorId, runner);
    runner.start();
    this.host.broadcast();
    return { actor, status: runner.getStatus() };
  }

  getStatus(actorId: string): LlmRunnerStatus | null {
    return this.runners.get(actorId)?.getStatus() ?? null;
  }

  statuses(): LlmRunnerStatus[] {
    return Array.from(this.runners.values()).map((runner) => runner.getStatus());
  }

  stop(actorId: string): boolean {
    const runner = this.runners.get(actorId);
    if (!runner) return false;
    this.runners.delete(actorId);
    runner.stop(true);
    return true;
  }

  stopAll(): void {
    for (const runner of this.runners.values()) runner.stop(true);
    this.runners.clear();
  }

  contextFor(actorId: string): {
    actorId: string;
    promptVersion: string;
    provider?: string;
    model?: string;
    controlMode: LlmControlMode;
    systemPrompt: string;
    context: ReturnType<typeof buildLlmContext>;
  } | null {
    const actor = this.host.getWorld().actors.find((a) => a.id === actorId);
    if (!actor) return null;
    const obs = this.host.buildObservation(actorId);
    if (!obs) return null;
    const runner = this.runners.get(actorId);
    const controlMode = actor.controlMode ?? runner?.controlMode ?? 'hybrid';
    const persona = runner?.persona;
    return {
      actorId,
      promptVersion: PROMPT_VERSION,
      provider: actor.provider,
      model: actor.model,
      controlMode,
      systemPrompt: buildSystemPrompt({ name: actor.name, controlMode, persona }),
      context: buildLlmContext(obs, {
        controlMode,
        lastAction: actor.lastInput,
        persona,
      }),
    };
  }

  tick(): void {
    const now = Date.now();
    for (const [actorId, runner] of this.runners) {
      if (runner.isStopped()) {
        this.runners.delete(actorId);
        continue;
      }
      try {
        runner.tick(now);
      } catch {
        // A runner must never take down the simulation loop.
      }
    }
  }
}
