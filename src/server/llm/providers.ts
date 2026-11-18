import type { LlmCompletionRequest, LlmProvider, LlmProviderInfo } from './types';

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

function isLocalUrl(value: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?:\/|$)/i.test(value);
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function openAiConfig() {
  const explicitBase = env('RELAYLAB_LLM_BASE_URL') || env('OPENAI_BASE_URL');
  const deepseekKey = env('DEEPSEEK_API_KEY');
  const base = explicitBase || (deepseekKey ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1');
  const key = env('RELAYLAB_LLM_API_KEY') || env('OPENAI_API_KEY') || deepseekKey;
  const model =
    env('RELAYLAB_LLM_MODEL') ||
    env('OPENAI_MODEL') ||
    (deepseekKey ? 'deepseek-chat' : 'gpt-4o-mini');
  return { base: trimSlash(base), key, model, local: isLocalUrl(base) };
}

function openAiInfo(): LlmProviderInfo {
  const cfg = openAiConfig();
  return {
    id: 'openai',
    label: cfg.local ? 'Local OpenAI-compatible endpoint' : 'OpenAI-compatible',
    models: [cfg.model],
    configured: Boolean(cfg.base && (cfg.key || cfg.local)),
    keyRequired: !cfg.local,
    notes: cfg.local
      ? 'Keyless local endpoint (Ollama, LM Studio, llama.cpp, vLLM).'
      : 'Set OPENAI_API_KEY or DEEPSEEK_API_KEY, optionally OPENAI_BASE_URL.',
  };
}

function anthropicInfo(): LlmProviderInfo {
  return {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    models: [env('ANTHROPIC_MODEL') || 'claude-sonnet-4-5'],
    configured: Boolean(env('ANTHROPIC_API_KEY')),
    keyRequired: true,
    notes: 'Set ANTHROPIC_API_KEY on the server.',
  };
}

function geminiInfo(): LlmProviderInfo {
  return {
    id: 'gemini',
    label: 'Gemini (Google)',
    models: [env('GEMINI_MODEL') || env('GOOGLE_MODEL') || 'gemini-2.5-flash'],
    configured: Boolean(env('GEMINI_API_KEY') || env('GOOGLE_API_KEY')),
    keyRequired: true,
    notes: 'Set GEMINI_API_KEY on the server.',
  };
}

function mockInfo(): LlmProviderInfo {
  return {
    id: 'mock',
    label: 'Mock demo agent (keyless)',
    models: ['relay-mock-v1'],
    configured: true,
    keyRequired: false,
    notes: 'Deterministic local decision loop for demos and tests. No key or network.',
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error(`Provider returned HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

const openai: LlmProvider = {
  get info() {
    return openAiInfo();
  },
  async complete({ system, user, model, signal }: LlmCompletionRequest) {
    const cfg = openAiConfig();
    const response = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}),
      },
      body: JSON.stringify({
        model: model || cfg.model,
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal,
    });
    const data = await readJson(response);
    const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Provider returned no text content');
    return content;
  },
};

const anthropic: LlmProvider = {
  get info() {
    return anthropicInfo();
  },
  async complete({ system, user, model, signal }: LlmCompletionRequest) {
    const key = env('ANTHROPIC_API_KEY');
    if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-5',
        max_tokens: 400,
        temperature: 0.4,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal,
    });
    const data = await readJson(response);
    const content = data.content as Array<{ type?: string; text?: unknown }> | undefined;
    const text = content?.find((part) => part.type === 'text')?.text;
    if (typeof text !== 'string') throw new Error('Provider returned no text content');
    return text;
  },
};

const gemini: LlmProvider = {
  get info() {
    return geminiInfo();
  },
  async complete({ system, user, model, signal }: LlmCompletionRequest) {
    const key = env('GEMINI_API_KEY') || env('GOOGLE_API_KEY');
    if (!key) throw new Error('GEMINI_API_KEY is not configured');
    const selected = model || 'gemini-2.5-flash';
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selected)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 400,
            responseMimeType: 'application/json',
          },
        }),
        signal,
      }
    );
    const data = await readJson(response);
    const candidates = data.candidates as
      | Array<{ content?: { parts?: Array<{ text?: unknown }> } }>
      | undefined;
    const text = candidates?.[0]?.content?.parts?.map((p) => p.text).find((v) => typeof v === 'string');
    if (typeof text !== 'string') throw new Error('Provider returned no text content');
    return text;
  },
};

interface MockContext {
  me?: { x?: number; y?: number; name?: string };
  controlMode?: 'hybrid' | 'direct';
  objective?: { exit?: { id?: string; x?: number; y?: number; w?: number; h?: number } };
  switches?: Array<{ id: string; label: string; x: number; w: number; active: boolean }>;
  plates?: Array<{ id: string; label: string; x: number; w: number; channel: string; active: boolean; mode?: string }>;
  channels?: Record<string, boolean>;
  messages?: Array<{ from?: string; label?: string; text?: string }>;
  clock?: { tick?: number };
}

function pickMockTarget(ctx: MockContext): { id: string; label: string; x: number; kind: 'switch' | 'plate' } | null {
  const switchTarget = (ctx.switches ?? []).find((s) => !s.active);
  if (switchTarget) {
    return { id: switchTarget.id, label: switchTarget.label, x: switchTarget.x + switchTarget.w / 2, kind: 'switch' };
  }
  const plateTarget = (ctx.plates ?? []).find((p) => !p.active && p.mode !== 'latch');
  if (plateTarget) {
    return { id: plateTarget.id, label: plateTarget.label, x: plateTarget.x + plateTarget.w / 2, kind: 'plate' };
  }
  return null;
}

const mock: LlmProvider = {
  get info() {
    return mockInfo();
  },
  async complete({ user }: LlmCompletionRequest) {
    let ctx: MockContext = {};
    try {
      ctx = JSON.parse(user) as MockContext;
    } catch {
      // The mock is deliberately tolerant of a missing context.
    }
    const me = ctx.me ?? {};
    const tick = ctx.clock?.tick ?? 0;
    const target = pickMockTarget(ctx);
    const exit = ctx.objective?.exit;
    const alreadySpoke = (ctx.messages ?? []).some((message) => message.from === me.name);
    const say = alreadySpoke
      ? null
      : {
          text: target ? `Moving to ${target.label}.` : 'Heading for the exit.',
          kind: 'status' as const,
        };

    if (ctx.controlMode === 'direct') {
      const goalX = target ? target.x : (exit?.x ?? 0) + (exit?.w ?? 0) / 2;
      const dx = goalX - (me.x ?? 0);
      const move = dx > 6 ? 1 : dx < -6 ? -1 : 0;
      return JSON.stringify({
        intent: target ? `Walk to ${target.label}` : 'Walk to the exit',
        claimTargetId: target?.id ?? null,
        say,
        action: {
          type: 'raw',
          move,
          jump: false,
          interact: false,
          grab: false,
          durationMs: 1200,
        },
        reason: 'Mock direct pilot closing distance.',
      });
    }

    if (target) {
      return JSON.stringify({
        intent: target.kind === 'plate' ? `Hold ${target.label}` : `Activate ${target.label}`,
        claimTargetId: target.id,
        say,
        action:
          target.kind === 'plate'
            ? { type: 'hold', targetId: target.id, durationMs: 2400 }
            : { type: 'use', targetId: target.id, durationMs: 2000 },
        reason: `Channel control ${target.label} is not active.`,
      });
    }

    return JSON.stringify({
      intent: 'Move to the exit',
      claimTargetId: null,
      say,
      action: {
        type: 'goto',
        x: (exit?.x ?? 0) + (exit?.w ?? 0) / 2,
        y: (exit?.y ?? 0) + (exit?.h ?? 0),
        durationMs: 2600,
      },
      reason: 'All visible channels are active; regrouping at the exit.',
    });
  },
};

const PROVIDERS: Record<string, LlmProvider> = {
  mock,
  openai,
  anthropic,
  gemini,
};

const ORDER = ['mock', 'openai', 'anthropic', 'gemini'];

export function listProviders(): LlmProviderInfo[] {
  return ORDER.map((id) => PROVIDERS[id].info);
}

export function getProvider(id: string): LlmProvider | null {
  return PROVIDERS[id] ?? null;
}

export function resolveModel(info: LlmProviderInfo, requested?: string): string {
  const clean = requested?.trim();
  if (clean) return clean.slice(0, 120);
  return info.models[0] ?? '';
}
