import type {
  ActorInput,
  AgentMessageKind,
  AgentObservation,
  ChannelId,
  LlmControlMode,
  Vec2,
} from '../../engine/types';

export interface LlmProviderInfo {
  id: string;
  label: string;
  models: string[];
  configured: boolean;
  keyRequired: boolean;
  notes?: string;
}

export interface LlmCompletionRequest {
  system: string;
  user: string;
  model: string;
  signal: AbortSignal;
}

export interface LlmProvider {
  info: LlmProviderInfo;
  complete(request: LlmCompletionRequest): Promise<string>;
}

export type LlmAction =
  | { type: 'goto'; x: number; y: number; durationMs: number }
  | { type: 'use'; targetId: string; durationMs: number }
  | { type: 'hold'; targetId: string; durationMs: number }
  | { type: 'grab'; targetId?: string; durationMs: number }
  | { type: 'wait'; durationMs: number }
  | {
      type: 'raw';
      move: -1 | 0 | 1;
      jump: boolean;
      interact: boolean;
      grab: boolean;
      durationMs: number;
    };

export interface LlmSay {
  text: string;
  kind: AgentMessageKind;
  targetId?: string;
  channel?: ChannelId;
}

export interface LlmDecision {
  intent: string;
  claimTargetId?: string;
  say?: LlmSay;
  action: LlmAction;
  reason?: string;
  raw?: string;
}

export interface LlmSpawnConfig {
  name: string;
  provider: string;
  model?: string;
  persona?: string;
  controlMode: LlmControlMode;
}

export interface LlmRunnerStatus {
  actorId: string;
  name: string;
  provider: string;
  model: string;
  controlMode: LlmControlMode;
  status: 'idle' | 'thinking' | 'acting' | 'error' | 'stopped';
  error?: string;
  decisions: number;
  lastDecisionLatencyMs?: number;
  lastDecisionAt?: number;
  fallbackUntil?: number;
}

export interface LlmContextData {
  promptVersion: string;
  controlMode: LlmControlMode;
  objective: {
    exit: {
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      unlocked: boolean;
      requiredChannels: ChannelId[];
      linkedIds: string[];
      logic: 'ALL' | 'ANY';
      arrived: number;
      total: number;
    };
  };
  [key: string]: unknown;
}

export interface LlmDecisionInput {
  text: string;
  observation: AgentObservation;
  mode: LlmControlMode;
}

export interface LlmPilotCommand {
  action: LlmAction;
  intent: string;
  reason?: string;
  claimTargetId?: string;
  targetPos?: Vec2;
  receivedAt: number;
}

export type LlmInput = ActorInput;
