import { useState } from 'react';
import {
  Copy,
  Check,
  Plus,
  Trash2,
  UserPlus,
  UserMinus,
  Terminal,
  Grid,
  Eraser,
  RotateCcw,
  Cable,
  ArrowLeftRight,
  ArrowUpDown,
  X,
  MessageSquare,
  Bot,
  Sparkles,
  Send,
} from 'lucide-react';
import { PHYSICS_PRESETS } from '../engine/levels';
import { SANDBOX_TOOLS, type SandboxCanvasSelection, type SandboxToolSpec } from '../engine/sandboxTools';
import type {
  ChannelId,
  DynamicBodyMaterial,
  EditableEntityPatch,
  PhysicsConfig,
  PlatformMaterial,
  SandboxAction,
  WorldState,
} from '../engine/types';
import { ActorAvatar } from './ActorAvatar';

export type InspectorTab = 'agents' | 'sandbox' | 'physics' | 'api';

interface TelemetryDockProps {
  world: WorldState | null;
  connected: boolean;
  latencyMs: number;
  humanActorId: string | null;
  activeTab?: InspectorTab;
  onTabChange?: (tab: InspectorTab) => void;
  sandboxSelection: SandboxCanvasSelection;
  onSandboxSelectionChange: (next: SandboxCanvasSelection) => void;
  onSandboxAction: (action: SandboxAction) => void;
  onUpdatePhysics: (partial: Partial<PhysicsConfig>) => void;
  onApplyPhysicsPreset: (presetId: string) => void;
  onSpawnAgent: () => void;
  onOpenAiAgentModal: () => void;
  onRemoveAgent: (actorId?: string) => void;
  onToggleHuman: (active: boolean) => void;
  onSendMessage: (text: string) => void;
}

const CHANNEL_ACCENT: Record<ChannelId, string> = {
  A: 'text-amber-400',
  B: 'text-emerald-400',
  C: 'text-violet-400',
};

const CHANNEL_BTN_STYLE: Record<ChannelId, string> = {
  A: 'bg-amber-500/20 border-amber-500/50 text-amber-300',
  B: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300',
  C: 'bg-violet-500/20 border-violet-500/50 text-violet-300',
};

const CATEGORY_ORDER: Array<{ key: SandboxToolSpec['category']; title: string }> = [
  { key: 'interact', title: 'Direct Force & Arena' },
  { key: 'body', title: 'Rigid Bodies' },
  { key: 'surface', title: 'Surfaces & Fields' },
  { key: 'logic', title: 'Logic & Hazards' },
];

export function TelemetryDock({
  world,
  connected,
  latencyMs,
  humanActorId,
  activeTab: controlledTab,
  onTabChange,
  sandboxSelection,
  onSandboxSelectionChange,
  onSandboxAction,
  onUpdatePhysics,
  onApplyPhysicsPreset,
  onSpawnAgent,
  onOpenAiAgentModal,
  onRemoveAgent,
  onToggleHuman,
  onSendMessage,
}: TelemetryDockProps) {
  const [internalTab, setInternalTab] = useState<InspectorTab>('agents');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (next: InspectorTab) => {
    setInternalTab(next);
    onTabChange?.(next);
  };
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [apiTestResult, setApiTestResult] = useState<string | null>(null);
  const [apiTestBusy, setApiTestBusy] = useState(false);
  const [chatText, setChatText] = useState('');

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const wsUrl =
    typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
      : 'ws://localhost:3000/ws';

  const copyText = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleTestRestApi = async () => {
    setApiTestBusy(true);
    setApiTestResult(null);
    try {
      const regRes = await fetch('/api/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'REST-Probe', role: 'agent' }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) {
        setApiTestResult(`Error ${regRes.status}: ${regData.error ?? 'Failed'}`);
        return;
      }
      const inRes = await fetch(`/api/agents/${encodeURIComponent(regData.actorId)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          move: 1,
          jump: false,
          interact: false,
          intent: 'REST API Probe',
          reason: 'Verified /api/agents/:id/input dispatch',
        }),
      });
      const inData = await inRes.json();
      const msgRes = await fetch(`/api/agents/${encodeURIComponent(regData.actorId)}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'status',
          text: 'REST probe ready for coordination',
        }),
      });
      const msgData = await msgRes.json();
      setApiTestResult(
        `Registered ${regData.actorId} (${regData.label}), dispatched input at tick ${inData.tick}, and posted squad message (${msgData.ok ? 'ok' : 'failed'}).`
      );
    } catch (err) {
      setApiTestResult(err instanceof Error ? err.message : 'Network error');
    } finally {
      setApiTestBusy(false);
    }
  };

  const agentCount = world?.actors.filter((a) => a.role === 'agent').length ?? 0;
  const llmAgentCount = world?.actors.filter((a) => a.controller === 'llm').length ?? 0;
  const hasHuman = Boolean(world?.actors.some((a) => a.role === 'human'));
  const selectedToolSpec =
    SANDBOX_TOOLS.find((t) => t.id === sandboxSelection.tool) ?? SANDBOX_TOOLS[0];
  const physics = world?.physics;

  return (
    <aside
      className="w-full lg:w-[376px] xl:w-[400px] 2xl:w-[420px] shrink-0 bg-[#101724] border-t lg:border-t-0 lg:border-l border-slate-800/90 flex flex-col h-full overflow-hidden"
      aria-label="Real-time telemetry and control inspector"
    >
      {/* Top sync summary line */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between gap-3">
        <div className="text-xs text-slate-400 font-mono truncate">
          {connected ? 'WS Live' : 'Reconnecting'} · {latencyMs}ms ·{' '}
          {world ? `Tick ${world.tick}` : 'Loading'}
        </div>
        <div className="text-xs font-mono text-slate-400 whitespace-nowrap shrink-0 tabular-nums">
          {world ? `${world.metrics.tickComputeMs.toFixed(2)}ms/step` : '--'}
        </div>
      </div>

      {/* Segmented 4-tab bar */}
      <div className="px-4 py-2.5 border-b border-slate-800/80">
        <div
          className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-[#0B1018] border border-slate-800/80"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'agents'}
            onClick={() => setActiveTab('agents')}
            className={`px-1.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'agents'
                ? 'bg-slate-800 text-slate-50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Agents ({world?.actors.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sandbox'}
            onClick={() => setActiveTab('sandbox')}
            className={`px-1.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'sandbox'
                ? 'bg-slate-800 text-slate-50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Sandbox
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'physics'}
            onClick={() => setActiveTab('physics')}
            className={`px-1.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'physics'
                ? 'bg-slate-800 text-slate-50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Physics
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'api'}
            onClick={() => setActiveTab('api')}
            className={`px-1.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'api'
                ? 'bg-slate-800 text-slate-50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            API
          </button>
        </div>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {activeTab === 'agents' && (
          <>
            {/* Quick Roster Controls */}
            <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-slate-800/70">
              <button
                type="button"
                onClick={onSpawnAgent}
                disabled={agentCount >= 3}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-40 text-amber-300 border border-amber-500/30 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Spawn Bot
              </button>
              <button
                type="button"
                onClick={onOpenAiAgentModal}
                disabled={llmAgentCount >= 4}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500/15 hover:bg-sky-500/25 disabled:opacity-40 text-sky-300 border border-sky-500/30 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Spawn AI Agent
              </button>
              <button
                type="button"
                onClick={() => onToggleHuman(!hasHuman)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                {hasHuman ? (
                  <>
                    <UserMinus className="w-3.5 h-3.5" />
                    Leave Human
                  </>
                ) : (
                  <>
                    <UserPlus className="w-3.5 h-3.5" />
                    Join as Human
                  </>
                )}
              </button>
            </div>

            {/* Connected Actors List */}
            {!world || world.actors.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No active actors in arena. Spawn an agent or join as human to begin.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {world.actors.map((actor) => {
                  const isYou = actor.id === humanActorId;
                  const stateTag = actor.onExit
                    ? 'AT EXIT'
                    : actor.grounded
                      ? actor.groundedMaterial === 'ice'
                        ? 'ICE'
                        : actor.groundedMaterial === 'conveyor'
                          ? 'BELT'
                          : actor.groundedMaterial === 'bouncy'
                            ? 'BOUNCE'
                            : 'GROUND'
                      : 'AIR';
                  return (
                    <div key={actor.id} className="py-3 first:pt-0 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <ActorAvatar
                            name={actor.name}
                            role={actor.role}
                            color={actor.color}
                            mood={
                              actor.onExit
                                ? 'happy'
                                : actor.holdingCrateId
                                  ? 'carrying'
                                  : !actor.grounded
                                    ? 'air'
                                    : 'normal'
                            }
                            size={28}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-slate-100 truncate leading-tight">
                              {actor.name}
                            </div>
                            <div className="font-mono text-[11px] text-slate-400 truncate">
                              {actor.label} · {actor.role === 'human' ? (isYou ? 'You' : 'Human') : 'Agent'}
                            </div>
                            {actor.controller === 'llm' && (
                              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-mono truncate">
                                <span
                                  className={
                                    actor.agentStatus === 'error'
                                      ? 'text-rose-300'
                                      : actor.agentStatus === 'thinking'
                                        ? 'text-amber-300'
                                        : 'text-emerald-300'
                                  }
                                >
                                  {actor.agentStatus ?? 'idle'}
                                </span>
                                <span className="text-slate-500 truncate">
                                  {actor.provider}/{actor.model}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        {actor.role === 'agent' && (
                          <button
                            type="button"
                            onClick={() => onRemoveAgent(actor.id)}
                            aria-label={`Disconnect ${actor.name}`}
                            className="p-1 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Real-time Kinematics */}
                      <div className="grid grid-cols-3 gap-2 text-xs font-mono text-slate-300 tabular-nums">
                        <div>
                          <span className="text-slate-500">POS </span>
                          {Math.round(actor.x)},{Math.round(actor.y)}
                        </div>
                        <div>
                          <span className="text-slate-500">VEL </span>
                          {Math.round(actor.vx)},{Math.round(actor.vy)}
                        </div>
                        <div className="text-right">
                          <span
                            className={
                              actor.onExit
                                ? 'text-emerald-400'
                                : actor.grounded
                                  ? actor.groundedMaterial === 'ice'
                                    ? 'text-cyan-300'
                                    : 'text-slate-300'
                                  : 'text-amber-300'
                            }
                          >
                            {stateTag}
                          </span>
                        </div>
                      </div>

                      {/* Decision & Action Awareness */}
                      <div className="text-xs bg-[#0B1018] rounded-md px-2.5 py-2 border border-slate-800/80 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-200 truncate">
                            {actor.holdingCrateId
                              ? `Holding ${actor.holdingCrateId}`
                              : actor.role === 'agent'
                                ? actor.lastInput.intent || 'Awaiting observation'
                                : actor.lastInput.move !== 0 || actor.lastInput.jump
                                  ? `Input: ${actor.lastInput.move > 0 ? 'Right' : actor.lastInput.move < 0 ? 'Left' : ''}${actor.lastInput.jump ? ' + Jump' : ''}`
                                  : 'Idle (WASD / Arrows / Q)'}
                          </span>
                          <span className="font-mono text-slate-500 shrink-0 tabular-nums">
                            {actor.decisionsCount} dec
                          </span>
                        </div>
                        {actor.lastInput.reason && (
                          <div className="text-slate-400 leading-snug">
                            {actor.lastInput.reason}
                          </div>
                        )}
                        {actor.agentError && (
                          <div className="text-rose-300 leading-snug break-words">
                            {actor.agentError}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Squad Comms (Built-in + Drop-in External AI Agents) */}
            <div className="pt-3 border-t border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                  <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                  <span>Squad Comms</span>
                </div>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {world?.messages.length ?? 0} msg
                </span>
              </div>
              <div className="text-[11px] text-slate-400 leading-snug">
                Shared board for built-in and drop-in agents (Gemini, Claude, DeepSeek) via{' '}
                <code className="text-slate-300 font-mono">/api/agents/:id/message</code> or WS{' '}
                <code className="text-slate-300 font-mono">message</code>.
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = chatText.trim();
                  if (!text || !humanActorId) return;
                  onSendMessage(text);
                  setChatText('');
                }}
                className="flex items-center gap-1.5 pt-1"
              >
                <input
                  value={chatText}
                  onChange={(event) => setChatText(event.target.value)}
                  maxLength={220}
                  disabled={!humanActorId}
                  aria-label="Squad message"
                  placeholder={humanActorId ? 'Message your squad…' : 'Join as human to chat'}
                  className="min-w-0 flex-1 rounded-md border border-slate-800 bg-[#0B1018] px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!humanActorId || !chatText.trim()}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/15 px-2 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-sky-500/25 disabled:opacity-40"
                >
                  <Send className="h-3 w-3" />
                  Send
                </button>
              </form>
              {!world || world.messages.length === 0 ? (
                <div className="bg-[#0B1018] border border-slate-800/80 rounded-md px-2.5 py-3 text-xs text-slate-500 text-center">
                  No coordination messages posted in this chamber yet.
                </div>
              ) : (
                <div className="bg-[#0B1018] border border-slate-800/80 rounded-md divide-y divide-slate-800/70 max-h-[210px] overflow-y-auto">
                  {[...world.messages]
                    .reverse()
                    .slice(0, 8)
                    .map((msg) => {
                      const kindStyle =
                        msg.kind === 'request'
                          ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                          : msg.kind === 'alert'
                            ? 'text-rose-300 bg-rose-500/15 border-rose-500/30'
                            : msg.kind === 'claim'
                              ? 'text-sky-300 bg-sky-500/15 border-sky-500/30'
                              : 'text-slate-300 bg-slate-800/80 border-slate-700';
                      return (
                        <div key={msg.id} className="px-2.5 py-2 space-y-1">
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className="inline-block w-1.5 h-3 rounded-sm shrink-0"
                                style={{ backgroundColor: msg.actorColor }}
                              />
                              <span className="font-mono font-semibold text-slate-200 truncate">
                                {msg.actorLabel}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded border font-mono text-[10px] uppercase leading-none ${kindStyle}`}
                              >
                                {msg.kind}
                              </span>
                            </div>
                            <span className="font-mono text-slate-500 shrink-0 tabular-nums">
                              T{msg.tick}
                            </span>
                          </div>
                          <div className="text-xs text-slate-300 leading-snug break-words">
                            {msg.text}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'sandbox' && (
          <>
            {/* Top Utility Strip: Snap Grid, Logic Channel, Clear Props */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onSandboxSelectionChange({
                      ...sandboxSelection,
                      snapToGrid: !sandboxSelection.snapToGrid,
                    })
                  }
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    sandboxSelection.snapToGrid
                      ? 'bg-sky-500/15 border-sky-500/40 text-sky-300'
                      : 'bg-[#0B1018] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Grid className="w-3.5 h-3.5" />
                  Snap {sandboxSelection.snapToGrid ? '16px' : 'Off'}
                </button>

                <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B1018] border border-slate-800">
                  {(['A', 'B', 'C'] as ChannelId[]).map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() =>
                        onSandboxSelectionChange({ ...sandboxSelection, channel: ch })
                      }
                      aria-label={`Logic channel ${ch}`}
                      className={`px-2 py-1 rounded text-xs font-mono border transition-colors cursor-pointer ${
                        sandboxSelection.channel === ch
                          ? CHANNEL_BTN_STYLE[ch]
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {ch}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onSandboxAction({ action: 'clear_spawned' });
                  onSandboxSelectionChange({ ...sandboxSelection, selectedEntityId: null });
                }}
                title="Restore level's default layout, surfaces, and wiring"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restore Default
              </button>
            </div>

            {/* Selected Entity Inspector (works on any level) */}
            {(() => {
              if (!world || !sandboxSelection.selectedEntityId) return null;
              const sid = sandboxSelection.selectedEntityId;
              const plat = world.platforms.find((p) => p.id === sid);
              const fz = world.forceZones.find((f) => f.id === sid);
              const sw = world.switches.find((s) => s.id === sid);
              const plate = world.plates.find((p) => p.id === sid);
              const door = world.doors.find((d) => d.id === sid);
              const crate = world.crates.find((c) => c.id === sid);
              const hazard = world.hazards.find((h) => h.id === sid);
              const exitZone = world.exit.id === sid ? world.exit : null;
              const target = plat || fz || sw || plate || door || crate || hazard || exitZone;
              if (!target) return null;

              const patchEntity = (patch: EditableEntityPatch) =>
                onSandboxAction({ action: 'update_entity', entityId: sid, patch });

              const entityKindLabel = plat
                ? plat.kind === 'moving'
                  ? 'Moving Lift'
                  : 'Platform'
                : fz
                  ? 'Force Zone'
                  : sw
                    ? 'Toggle Switch'
                    : plate
                      ? 'Pressure Plate'
                      : door
                        ? 'Energy Gate'
                        : crate
                          ? 'Rigid Body'
                          : hazard
                            ? 'Hazard'
                            : 'Exit Zone';

              const resizable = Boolean(plat || fz || plate || door || hazard || exitZone);
              const triggers = [
                ...world.switches.map((s) => ({
                  id: s.id,
                  label: s.label,
                  channel: s.channel,
                  active: s.active,
                })),
                ...world.plates.map((p) => ({
                  id: p.id,
                  label: p.label,
                  channel: p.channel,
                  active: p.active,
                })),
              ];
              const wireTargets = [
                ...world.doors.map((d) => ({
                  id: d.id,
                  label: d.label,
                  channels: d.channels,
                  linkedIds: d.linkedIds ?? [],
                })),
                ...world.platforms
                  .filter((p) => p.kind === 'moving')
                  .map((p) => ({
                    id: p.id,
                    label: `Lift (${p.id})`,
                    channels: p.channel ? [p.channel] : [],
                    linkedIds: p.linkedIds ?? [],
                  })),
                {
                  id: world.exit.id,
                  label: 'Exit Zone',
                  channels: world.exit.requiredChannels,
                  linkedIds: world.exit.linkedIds ?? [],
                },
              ];

              return (
                <div
                  data-testid="entity-inspector"
                  className="bg-[#0B1018] rounded-lg p-3 border border-sky-500/40 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-sky-300 truncate">
                        {entityKindLabel}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate">{sid}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onSandboxSelectionChange({ ...sandboxSelection, tool: 'wire' })
                        }
                        title="Switch to Wire Logic tool"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium cursor-pointer"
                      >
                        <Cable className="w-3 h-3" />
                        Wire
                      </button>
                      {!exitZone && (
                        <>
                          <button
                            type="button"
                            onClick={() => onSandboxAction({ action: 'duplicate', entityId: sid })}
                            title="Duplicate entity"
                            aria-label="Duplicate entity"
                            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              onSandboxAction({ action: 'remove', entityId: sid });
                              onSandboxSelectionChange({
                                ...sandboxSelection,
                                selectedEntityId: null,
                              });
                            }}
                            title="Delete entity"
                            aria-label="Delete entity"
                            className="p-1.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onSandboxSelectionChange({
                            ...sandboxSelection,
                            selectedEntityId: null,
                          })
                        }
                        title="Deselect"
                        aria-label="Deselect entity"
                        className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Position & Size Numeric Controls */}
                  <div className={`grid ${resizable ? 'grid-cols-4' : 'grid-cols-2'} gap-1.5 text-[11px] font-mono`}>
                    <label className="space-y-0.5 text-slate-400">
                      <span>X</span>
                      <input
                        type="number"
                        aria-label="Entity X position"
                        value={Math.round(target.x)}
                        onChange={(e) => patchEntity({ x: Number(e.target.value) })}
                        className="w-full px-1.5 py-1 rounded bg-[#101724] border border-slate-700 text-slate-100 tabular-nums"
                      />
                    </label>
                    <label className="space-y-0.5 text-slate-400">
                      <span>Y</span>
                      <input
                        type="number"
                        aria-label="Entity Y position"
                        value={Math.round(target.y)}
                        onChange={(e) => patchEntity({ y: Number(e.target.value) })}
                        className="w-full px-1.5 py-1 rounded bg-[#101724] border border-slate-700 text-slate-100 tabular-nums"
                      />
                    </label>
                    {resizable && (
                      <>
                        <label className="space-y-0.5 text-slate-400">
                          <span>W</span>
                          <input
                            type="number"
                            aria-label="Entity width"
                            min={24}
                            value={Math.round(target.w)}
                            onChange={(e) => patchEntity({ w: Math.max(24, Number(e.target.value)) })}
                            className="w-full px-1.5 py-1 rounded bg-[#101724] border border-slate-700 text-slate-100 tabular-nums"
                          />
                        </label>
                        <label className="space-y-0.5 text-slate-400">
                          <span>H</span>
                          <input
                            type="number"
                            aria-label="Entity height"
                            min={10}
                            value={Math.round(target.h)}
                            onChange={(e) => patchEntity({ h: Math.max(10, Number(e.target.value)) })}
                            className="w-full px-1.5 py-1 rounded bg-[#101724] border border-slate-700 text-slate-100 tabular-nums"
                          />
                        </label>
                      </>
                    )}
                  </div>

                  {/* Platform Controls */}
                  {plat && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-800/80 text-xs">
                      <div>
                        <div className="text-[11px] text-slate-400 mb-1">Surface Material</div>
                        <div className="grid grid-cols-4 gap-1">
                          {(['standard', 'ice', 'bouncy', 'conveyor'] as PlatformMaterial[]).map(
                            (mat) => (
                              <button
                                key={mat}
                                type="button"
                                onClick={() => patchEntity({ material: mat })}
                                className={`px-1.5 py-1 rounded border text-[11px] font-medium capitalize cursor-pointer ${
                                  plat.material === mat
                                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                                    : 'bg-[#101724] border-slate-800 text-slate-300 hover:border-slate-700'
                                }`}
                              >
                                {mat}
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {plat.material === 'conveyor' && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300">Belt Speed</span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-amber-300 tabular-nums">
                                {Math.round(plat.conveyorSpeed ?? 120)} px/s
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  patchEntity({
                                    conveyorSpeed: -(plat.conveyorSpeed || 120),
                                  })
                                }
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 text-[11px] font-medium cursor-pointer"
                              >
                                <ArrowLeftRight className="w-3 h-3" />
                                Flip
                              </button>
                            </div>
                          </div>
                          <input
                            type="range"
                            aria-label="Conveyor speed"
                            min={-420}
                            max={420}
                            step={10}
                            value={plat.conveyorSpeed ?? 120}
                            onChange={(e) =>
                              patchEntity({ conveyorSpeed: Number(e.target.value) })
                            }
                            className="w-full accent-amber-400 cursor-pointer"
                          />
                        </div>
                      )}

                      {plat.material === 'bouncy' && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300">Bounce Launch</span>
                            <span className="font-mono text-emerald-300 tabular-nums">
                              {Math.round(plat.bounceVelocity ?? 690)} px/s
                            </span>
                          </div>
                          <input
                            type="range"
                            aria-label="Bounce velocity"
                            min={280}
                            max={1200}
                            step={20}
                            value={plat.bounceVelocity ?? 690}
                            onChange={(e) =>
                              patchEntity({ bounceVelocity: Number(e.target.value) })
                            }
                            className="w-full accent-emerald-400 cursor-pointer"
                          />
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400">Motion Mode</span>
                        <div className="flex items-center gap-1">
                          {(['solid', 'moving'] as const).map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => patchEntity({ kind: k })}
                              className={`px-2 py-0.5 rounded border text-[11px] font-medium cursor-pointer ${
                                plat.kind === k
                                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                                  : 'bg-[#101724] border-slate-800 text-slate-400'
                              }`}
                            >
                              {k === 'solid' ? 'Static' : 'Moving Lift'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {plat.kind === 'moving' && (
                        <div className="space-y-2 pt-1.5 border-t border-slate-800/60">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-300">Lift Speed</span>
                              <span className="font-mono text-sky-300 tabular-nums">
                                {(plat.speed ?? 0.55).toFixed(2)} cyc/s
                              </span>
                            </div>
                            <input
                              type="range"
                              aria-label="Lift speed"
                              min={0.1}
                              max={2.5}
                              step={0.05}
                              value={plat.speed ?? 0.55}
                              onChange={(e) => patchEntity({ speed: Number(e.target.value) })}
                              className="w-full accent-sky-400 cursor-pointer"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={Boolean(plat.loopWhenActive)}
                                onChange={(e) =>
                                  patchEntity({ loopWhenActive: e.target.checked })
                                }
                                className="accent-sky-400"
                              />
                              Loop continuously
                            </label>
                            {plat.startPos && plat.endPos && (
                              <button
                                type="button"
                                onClick={() =>
                                  patchEntity({
                                    startPos: { ...plat.endPos! },
                                    endPos: { ...plat.startPos! },
                                  })
                                }
                                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] cursor-pointer"
                              >
                                Swap Start/End
                              </button>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-400">Channel</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => patchEntity({ channel: null })}
                                className={`px-1.5 py-0.5 rounded border text-[11px] font-mono cursor-pointer ${
                                  !plat.channel
                                    ? 'bg-slate-700 border-slate-500 text-white'
                                    : 'border-slate-800 text-slate-400'
                                }`}
                              >
                                None
                              </button>
                              {(['A', 'B', 'C'] as ChannelId[]).map((ch) => (
                                <button
                                  key={ch}
                                  type="button"
                                  onClick={() => patchEntity({ channel: ch })}
                                  className={`px-1.5 py-0.5 rounded border text-[11px] font-mono cursor-pointer ${
                                    plat.channel === ch
                                      ? CHANNEL_BTN_STYLE[ch]
                                      : 'border-slate-800 text-slate-400'
                                  }`}
                                >
                                  {ch}
                                </button>
                              ))}
                            </div>
                          </div>
                          {triggers.length > 0 && (
                            <div className="space-y-1">
                              <div className="text-[11px] text-slate-400">Attached Triggers</div>
                              <div className="flex flex-wrap gap-1.5">
                                {triggers.map((tr) => {
                                  const linked =
                                    Boolean(plat.linkedIds?.includes(tr.id)) ||
                                    plat.channel === tr.channel;
                                  return (
                                    <button
                                      key={tr.id}
                                      type="button"
                                      onClick={() =>
                                        onSandboxAction({
                                          action: 'toggle_wire',
                                          sourceId: tr.id,
                                          targetId: plat.id,
                                          mode: 'toggle',
                                        })
                                      }
                                      className={`px-2 py-0.5 rounded border text-[11px] font-mono cursor-pointer ${
                                        linked
                                          ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                                          : 'bg-[#101724] border-slate-800 text-slate-400'
                                      }`}
                                    >
                                      {linked ? '● ' : '○ '}
                                      {tr.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Force Zone Controls */}
                  {fz && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-800/80 text-xs">
                      <div className="grid grid-cols-4 gap-1">
                        <button
                          type="button"
                          onClick={() => patchEntity({ fx: 0, fy: -2150 })}
                          className="px-1.5 py-1 rounded bg-[#101724] hover:bg-slate-800 border border-slate-700 text-[11px] text-sky-300 cursor-pointer"
                        >
                          Updraft
                        </button>
                        <button
                          type="button"
                          onClick={() => patchEntity({ fx: 950, fy: 0 })}
                          className="px-1.5 py-1 rounded bg-[#101724] hover:bg-slate-800 border border-slate-700 text-[11px] text-violet-300 cursor-pointer"
                        >
                          Wind →
                        </button>
                        <button
                          type="button"
                          onClick={() => patchEntity({ fx: -950, fy: 0 })}
                          className="px-1.5 py-1 rounded bg-[#101724] hover:bg-slate-800 border border-slate-700 text-[11px] text-violet-300 cursor-pointer"
                        >
                          ← Wind
                        </button>
                        <button
                          type="button"
                          onClick={() => patchEntity({ fx: -fz.fx, fy: -fz.fy })}
                          className="px-1.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-[11px] text-amber-300 cursor-pointer"
                        >
                          Invert
                        </button>
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300">Crosswind (fx)</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-violet-300 tabular-nums">
                              {Math.round(fz.fx)} px/s²
                            </span>
                            <button
                              type="button"
                              onClick={() => patchEntity({ fx: -(fz.fx || 900) })}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 cursor-pointer"
                            >
                              <ArrowLeftRight className="w-3 h-3" />
                              Flip X
                            </button>
                          </div>
                        </div>
                        <input
                          type="range"
                          aria-label="Horizontal wind fx"
                          min={-2600}
                          max={2600}
                          step={50}
                          value={fz.fx}
                          onChange={(e) => patchEntity({ fx: Number(e.target.value) })}
                          className="w-full accent-violet-400 cursor-pointer"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300">Vertical Lift (fy)</span>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sky-300 tabular-nums">
                              {Math.round(fz.fy)} px/s²
                            </span>
                            <button
                              type="button"
                              onClick={() => patchEntity({ fy: -(fz.fy || -1800) })}
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-200 cursor-pointer"
                            >
                              <ArrowUpDown className="w-3 h-3" />
                              Flip Y
                            </button>
                          </div>
                        </div>
                        <input
                          type="range"
                          aria-label="Vertical force fy"
                          min={-2800}
                          max={2600}
                          step={50}
                          value={fz.fy}
                          onChange={(e) => patchEntity({ fy: Number(e.target.value) })}
                          className="w-full accent-sky-400 cursor-pointer"
                        />
                      </div>
                    </div>
                  )}

                  {/* Switch or Plate Trigger Controls */}
                  {(sw || plate) && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-800/80 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400">Signal Channel</span>
                        <div className="flex items-center gap-1">
                          {(['A', 'B', 'C'] as ChannelId[]).map((ch) => (
                            <button
                              key={ch}
                              type="button"
                              onClick={() => patchEntity({ channel: ch })}
                              className={`px-2 py-0.5 rounded border text-[11px] font-mono cursor-pointer ${
                                (sw ?? plate)!.channel === ch
                                  ? CHANNEL_BTN_STYLE[ch]
                                  : 'border-slate-800 text-slate-400'
                              }`}
                            >
                              {ch}
                            </button>
                          ))}
                        </div>
                      </div>

                      {sw && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400">Lever State</span>
                          <button
                            type="button"
                            onClick={() => patchEntity({ active: !sw.active })}
                            className={`px-2.5 py-1 rounded border text-[11px] font-mono cursor-pointer ${
                              sw.active
                                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                                : 'bg-slate-800 border-slate-700 text-slate-300'
                            }`}
                          >
                            {sw.active ? 'ON (Click to turn OFF)' : 'OFF (Click to turn ON)'}
                          </button>
                        </div>
                      )}

                      {plate && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400">Plate Mode</span>
                          <div className="flex items-center gap-1">
                            {(['momentary', 'latch'] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => patchEntity({ mode: m })}
                                className={`px-2 py-0.5 rounded border text-[11px] capitalize cursor-pointer ${
                                  plate.mode === m
                                    ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                                    : 'border-slate-800 text-slate-400'
                                }`}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="space-y-1">
                        <div className="text-[11px] text-slate-400">Connected Gates &amp; Lifts</div>
                        <div className="flex flex-wrap gap-1.5">
                          {wireTargets.map((tgt) => {
                            const srcObj = (sw ?? plate)!;
                            const connectedTarget =
                              tgt.linkedIds.includes(srcObj.id) ||
                              tgt.channels.includes(srcObj.channel);
                            return (
                              <button
                                key={tgt.id}
                                type="button"
                                onClick={() =>
                                  onSandboxAction({
                                    action: 'toggle_wire',
                                    sourceId: srcObj.id,
                                    targetId: tgt.id,
                                    mode: 'toggle',
                                  })
                                }
                                className={`px-2 py-0.5 rounded border text-[11px] font-mono cursor-pointer ${
                                  connectedTarget
                                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                                    : 'bg-[#101724] border-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {connectedTarget ? '● ' : '○ '}
                                {tgt.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Gate / Door & Exit Zone Controls */}
                  {(door || exitZone) && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-800/80 text-xs">
                      {(() => {
                        const targetChannels = door
                          ? door.channels
                          : exitZone!.requiredChannels;
                        const targetLinked = (door ?? exitZone!).linkedIds ?? [];
                        const targetLogic = (door ?? exitZone!).logic ?? 'ALL';
                        return (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-400">Channels</span>
                              <div className="flex items-center gap-1">
                                {(['A', 'B', 'C'] as ChannelId[]).map((ch) => {
                                  const has = targetChannels.includes(ch);
                                  return (
                                    <button
                                      key={ch}
                                      type="button"
                                      onClick={() => {
                                        const next = has
                                          ? targetChannels.filter((c) => c !== ch)
                                          : [...targetChannels, ch];
                                        if (door) patchEntity({ channels: next });
                                        else patchEntity({ requiredChannels: next });
                                      }}
                                      className={`px-2 py-0.5 rounded border text-[11px] font-mono cursor-pointer ${
                                        has
                                          ? CHANNEL_BTN_STYLE[ch]
                                          : 'border-slate-800 text-slate-400'
                                      }`}
                                    >
                                      {ch}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-400">Unlock Logic</span>
                              <div className="flex items-center gap-1">
                                {(['ALL', 'ANY'] as const).map((lg) => (
                                  <button
                                    key={lg}
                                    type="button"
                                    onClick={() => patchEntity({ logic: lg })}
                                    className={`px-2 py-0.5 rounded border text-[11px] font-mono cursor-pointer ${
                                      targetLogic === lg
                                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                                        : 'border-slate-800 text-slate-400'
                                    }`}
                                  >
                                    {lg}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="space-y-1">
                              <div className="text-[11px] text-slate-400">Attached Switches &amp; Plates</div>
                              <div className="flex flex-wrap gap-1.5">
                                {triggers.map((tr) => {
                                  const attached =
                                    targetLinked.includes(tr.id) ||
                                    targetChannels.includes(tr.channel);
                                  return (
                                    <button
                                      key={tr.id}
                                      type="button"
                                      onClick={() =>
                                        onSandboxAction({
                                          action: 'toggle_wire',
                                          sourceId: tr.id,
                                          targetId: sid,
                                          mode: 'toggle',
                                        })
                                      }
                                      className={`px-2 py-0.5 rounded border text-[11px] font-mono cursor-pointer ${
                                        attached
                                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
                                          : 'bg-[#101724] border-slate-800 text-slate-400 hover:text-slate-200'
                                      }`}
                                    >
                                      {attached ? '● ' : '○ '}
                                      {tr.label} ({tr.channel})
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* Rigid Body Controls */}
                  {crate && (
                    <div className="space-y-2.5 pt-2 border-t border-slate-800/80 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-400">Shape</span>
                        <div className="flex items-center gap-1">
                          {(['box', 'ball'] as const).map((sh) => (
                            <button
                              key={sh}
                              type="button"
                              onClick={() => patchEntity({ shape: sh })}
                              className={`px-2 py-0.5 rounded border text-[11px] capitalize cursor-pointer ${
                                crate.shape === sh
                                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                                  : 'border-slate-800 text-slate-400'
                              }`}
                            >
                              {sh}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {(['wood', 'steel', 'polymer', 'rubber'] as DynamicBodyMaterial[]).map(
                          (mat) => (
                            <button
                              key={mat}
                              type="button"
                              onClick={() => patchEntity({ material: mat })}
                              className={`px-1 py-1 rounded border text-[11px] capitalize cursor-pointer ${
                                crate.material === mat
                                  ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                                  : 'border-slate-800 text-slate-400'
                              }`}
                            >
                              {mat}
                            </button>
                          )
                        )}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-300">Mass</span>
                          <span className="font-mono text-sky-300 tabular-nums">
                            {crate.mass.toFixed(2)} kg
                          </span>
                        </div>
                        <input
                          type="range"
                          aria-label="Body mass"
                          min={0.3}
                          max={8}
                          step={0.1}
                          value={crate.mass}
                          onChange={(e) => patchEntity({ mass: Number(e.target.value) })}
                          className="w-full accent-sky-400 cursor-pointer"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300">Bounce</span>
                            <span className="font-mono text-sky-300 tabular-nums">
                              {crate.restitution.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            aria-label="Body restitution"
                            min={0}
                            max={0.95}
                            step={0.05}
                            value={crate.restitution}
                            onChange={(e) => patchEntity({ restitution: Number(e.target.value) })}
                            className="w-full accent-sky-400 cursor-pointer"
                          />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-300">Friction</span>
                            <span className="font-mono text-sky-300 tabular-nums">
                              {crate.friction.toFixed(2)}
                            </span>
                          </div>
                          <input
                            type="range"
                            aria-label="Body friction"
                            min={0.05}
                            max={1.5}
                            step={0.05}
                            value={crate.friction}
                            onChange={(e) => patchEntity({ friction: Number(e.target.value) })}
                            className="w-full accent-sky-400 cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Hazard Controls */}
                  {hazard && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-xs">
                      <span className="text-[11px] text-slate-400">Hazard Type</span>
                      <div className="flex items-center gap-1">
                        {(['plasma', 'spikes'] as const).map((hk) => (
                          <button
                            key={hk}
                            type="button"
                            onClick={() => patchEntity({ hazardKind: hk })}
                            className={`px-2 py-0.5 rounded border text-[11px] capitalize cursor-pointer ${
                              hazard.kind === hk
                                ? 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                                : 'border-slate-800 text-slate-400'
                            }`}
                          >
                            {hk}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Active Tool Brief */}
            <div className="bg-[#0B1018] rounded-md px-3 py-2 border border-slate-800/80 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-100">
                  Active Tool: {selectedToolSpec.label}
                </span>
                {sandboxSelection.tool !== 'pointer' && (
                  <button
                    type="button"
                    onClick={() =>
                      onSandboxSelectionChange({ ...sandboxSelection, tool: 'pointer' })
                    }
                    className="text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                  >
                    Return to Play
                  </button>
                )}
              </div>
              <p className="text-slate-400 mt-0.5 leading-snug">{selectedToolSpec.hint}</p>
            </div>

            {/* Categorized Tool Buttons */}
            <div className="space-y-3">
              {CATEGORY_ORDER.map((cat) => {
                const tools = SANDBOX_TOOLS.filter((t) => t.category === cat.key);
                return (
                  <div key={cat.key}>
                    <div className="text-xs font-medium text-slate-400 mb-1.5">
                      {cat.title}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {tools.map((tool) => {
                        const active = sandboxSelection.tool === tool.id;
                        return (
                          <button
                            key={tool.id}
                            type="button"
                            onClick={() =>
                              onSandboxSelectionChange({
                                ...sandboxSelection,
                                tool: tool.id,
                              })
                            }
                            className={`px-2.5 py-2 rounded-md border text-xs font-medium text-left transition-colors cursor-pointer flex items-center justify-between gap-1.5 whitespace-nowrap ${
                              active
                                ? tool.id === 'eraser'
                                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                                  : 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                                : 'bg-[#0B1018] border-slate-800/90 text-slate-300 hover:border-slate-700 hover:text-slate-100'
                            }`}
                          >
                            <span className="truncate">{tool.label}</span>
                            {tool.id === 'eraser' && <Eraser className="w-3 h-3 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {activeTab === 'physics' && world && physics && (
          <>
            {/* Physics Presets */}
            <div className="pb-3 border-b border-slate-800/80">
              <div className="text-xs font-medium text-slate-400 mb-2">
                Environment Presets
              </div>
              <div className="grid grid-cols-5 gap-1">
                {Object.entries(PHYSICS_PRESETS).map(([presetId, preset]) => {
                  const isMatch =
                    Math.abs(physics.gravity - preset.gravity) < 5 &&
                    Math.abs(physics.restitution - preset.restitution) < 0.03 &&
                    Math.abs(physics.surfaceFriction - preset.surfaceFriction) < 0.03;
                  return (
                    <button
                      key={presetId}
                      type="button"
                      onClick={() => onApplyPhysicsPreset(presetId)}
                      className={`px-1.5 py-1.5 rounded-md border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        isMatch
                          ? 'bg-sky-500/20 border-sky-500/50 text-sky-200'
                          : 'bg-[#0B1018] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Live Physics Sliders */}
            <div className="space-y-3 pb-3 border-b border-slate-800/80">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Gravity</span>
                  <span className="font-mono text-sky-300 tabular-nums">
                    {Math.round(physics.gravity)} px/s²
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Gravity"
                  min={0}
                  max={2600}
                  step={10}
                  value={physics.gravity}
                  onChange={(e) => onUpdatePhysics({ gravity: Number(e.target.value) })}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Bounciness (Restitution)</span>
                  <span className="font-mono text-sky-300 tabular-nums">
                    {physics.restitution.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Bounciness"
                  min={0}
                  max={0.95}
                  step={0.05}
                  value={physics.restitution}
                  onChange={(e) => onUpdatePhysics({ restitution: Number(e.target.value) })}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Surface Friction</span>
                  <span className="font-mono text-sky-300 tabular-nums">
                    {physics.surfaceFriction.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Surface Friction"
                  min={0.1}
                  max={2.0}
                  step={0.05}
                  value={physics.surfaceFriction}
                  onChange={(e) => onUpdatePhysics({ surfaceFriction: Number(e.target.value) })}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300">Air Drag</span>
                  <span className="font-mono text-sky-300 tabular-nums">
                    {physics.airDrag.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Air Drag"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={physics.airDrag}
                  onChange={(e) => onUpdatePhysics({ airDrag: Number(e.target.value) })}
                  className="w-full accent-sky-400 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">Push Force</span>
                    <span className="font-mono text-sky-300 tabular-nums">
                      {physics.pushForce.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Push Force"
                    min={0.4}
                    max={2.5}
                    step={0.05}
                    value={physics.pushForce}
                    onChange={(e) => onUpdatePhysics({ pushForce: Number(e.target.value) })}
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">Actor Mass</span>
                    <span className="font-mono text-sky-300 tabular-nums">
                      {physics.actorMass.toFixed(2)}kg
                    </span>
                  </div>
                  <input
                    type="range"
                    aria-label="Actor Mass"
                    min={0.5}
                    max={3.0}
                    step={0.05}
                    value={physics.actorMass}
                    onChange={(e) => onUpdatePhysics({ actorMass: Number(e.target.value) })}
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Live Dynamics Metrics */}
            <div className="grid grid-cols-3 gap-2 pb-3 border-b border-slate-800/80">
              <div className="bg-[#0B1018] rounded-md px-2.5 py-2 border border-slate-800/80">
                <div className="text-[11px] text-slate-400">Kinetic Energy</div>
                <div className="font-mono text-sm font-semibold text-amber-300 tabular-nums mt-0.5">
                  {world.metrics.totalKineticEnergy.toFixed(1)} kJ
                </div>
              </div>
              <div className="bg-[#0B1018] rounded-md px-2.5 py-2 border border-slate-800/80">
                <div className="text-[11px] text-slate-400">Collisions</div>
                <div className="font-mono text-sm font-semibold text-slate-100 tabular-nums mt-0.5">
                  {world.metrics.collisionCount}
                </div>
              </div>
              <div className="bg-[#0B1018] rounded-md px-2.5 py-2 border border-slate-800/80">
                <div className="text-[11px] text-slate-400">Rigid Bodies</div>
                <div className="font-mono text-sm font-semibold text-sky-300 tabular-nums mt-0.5">
                  {world.crates.length}
                </div>
              </div>
            </div>

            {/* Signal Channels & World Mechanisms */}
            <div className="space-y-2.5 pb-3 border-b border-slate-800/80">
              <div className="text-xs font-medium text-slate-400">
                Signal Channels &amp; Mechanisms
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(['A', 'B', 'C'] as ChannelId[]).map((ch) => {
                  const active = world.channels[ch];
                  return (
                    <div
                      key={ch}
                      className="px-2.5 py-1.5 rounded-md bg-[#0B1018] border border-slate-800/80 flex items-center justify-between font-mono text-xs"
                    >
                      <span className={CHANNEL_ACCENT[ch]}>CH-{ch}</span>
                      <span className={active ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
                        {active ? 'ON' : 'OFF'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-1 text-xs font-mono">
                {world.plates.map((plate) => (
                  <div
                    key={plate.id}
                    className="flex items-center justify-between py-0.5 text-slate-300"
                  >
                    <span>
                      {plate.label}{' '}
                      <span className={CHANNEL_ACCENT[plate.channel]}>({plate.channel})</span>
                    </span>
                    <span className={plate.active ? 'text-emerald-400' : 'text-slate-500'}>
                      {plate.active ? `PRESSED (${plate.pressedBy.join(',')})` : 'OPEN'}
                    </span>
                  </div>
                ))}
                {world.switches.map((sw) => (
                  <div
                    key={sw.id}
                    className="flex items-center justify-between py-0.5 text-slate-300"
                  >
                    <span>
                      {sw.label}{' '}
                      <span className={CHANNEL_ACCENT[sw.channel]}>({sw.channel})</span>
                    </span>
                    <span className={sw.active ? 'text-emerald-400' : 'text-slate-500'}>
                      {sw.active ? 'LATCHED' : 'OFF'}
                    </span>
                  </div>
                ))}
                {world.doors.map((door) => {
                  const sep = door.logic === 'ALL' ? '+' : '|';
                  const reqParts: string[] = [];
                  if (door.channels.length > 0) reqParts.push(door.channels.join(sep));
                  if (door.linkedIds?.length) reqParts.push(`${door.linkedIds.length}L`);
                  const reqLabel = reqParts.length > 0 ? reqParts.join(sep) : 'FREE';
                  return (
                    <div
                      key={door.id}
                      className="flex items-center justify-between py-0.5 text-slate-300"
                    >
                      <span>
                        {door.label} ({reqLabel})
                      </span>
                      <span className={door.open ? 'text-emerald-400' : 'text-rose-400'}>
                        {door.open ? 'UNLOCKED' : 'LOCKED'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="text-xs text-slate-300 leading-relaxed bg-[#0B1018] rounded-md p-3 border border-slate-800/80">
              <div className="text-slate-400 font-medium mb-1">Stage Brief</div>
              {world.levelHint}
            </div>
          </>
        )}

        {activeTab === 'api' && (
          <>
            {/* Centralized API Quick Reference & Interactive Probe */}
            <div className="space-y-2.5 pb-3 border-b border-slate-800/80">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">
                  Centralized Real-Time API
                </span>
                <button
                  type="button"
                  onClick={handleTestRestApi}
                  disabled={apiTestBusy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 text-xs font-medium transition-colors cursor-pointer"
                >
                  <Terminal className="w-3 h-3" />
                  {apiTestBusy ? 'Testing...' : 'Test REST Input'}
                </button>
              </div>

              {apiTestResult && (
                <div className="text-xs font-mono text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded p-2">
                  {apiTestResult}
                </div>
              )}

              <div className="bg-[#0B1018] rounded-md p-2.5 border border-slate-800/80 space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-300 truncate">WS {wsUrl}</span>
                  <button
                    type="button"
                    onClick={() => copyText('ws', wsUrl)}
                    aria-label="Copy WebSocket URL"
                    className="text-slate-400 hover:text-slate-200 cursor-pointer shrink-0"
                  >
                    {copiedKey === 'ws' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <div className="text-slate-400 leading-relaxed break-all">
                  GET {origin}/api/state
                  <br />
                  GET {origin}/api/messages
                  <br />
                  POST {origin}/api/agents/register
                  <br />
                  POST {origin}/api/agents/:id/input
                  <br />
                  POST {origin}/api/agents/:id/message
                  <br />
                  POST {origin}/api/sim/physics
                  <br />
                  POST {origin}/api/sandbox/spawn
                  <br />
                  PATCH {origin}/api/sandbox/entity/:id
                  <br />
                  POST {origin}/api/sandbox/wire
                  <br />
                  POST {origin}/api/sandbox/impulse
                  <br />
                  DELETE {origin}/api/sandbox/entity/:id
                  <br />
                  POST {origin}/api/sandbox/clear
                </div>
              </div>

              {/* Copyable Drop-In Agent Input + Message Payload */}
              <div className="bg-[#0B1018] rounded-md p-2.5 border border-slate-800/80 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-300">
                    Drop-In Agent Input &amp; Comms Schema
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        'schema',
                        JSON.stringify(
                          {
                            move: 1,
                            jump: false,
                            interact: false,
                            grab: false,
                            intent: 'Activate Switch B',
                            claimTargetId: 'switch-b',
                            message: 'Heading up to Switch B — hold Plate A',
                            messageKind: 'request',
                            messageChannel: 'A',
                          },
                          null,
                          2
                        )
                      )
                    }
                    aria-label="Copy drop-in agent payload JSON"
                    className="text-slate-400 hover:text-slate-200 cursor-pointer shrink-0"
                  >
                    {copiedKey === 'schema' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-sky-300/90 leading-snug overflow-x-auto">{`{
  "move": 1, "jump": false, "interact": false,
  "claimTargetId": "switch-b",
  "message": "Taking Switch B — hold Plate A",
  "messageKind": "request", "messageChannel": "A"
}`}</pre>
              </div>
            </div>

            {/* Streaming Event Log */}
            <div>
              <div className="text-xs font-medium text-slate-400 mb-2">
                Authoritative Event Stream
              </div>
              <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
                {!world || world.events.length === 0 ? (
                  <div className="text-xs text-slate-500">No events recorded yet.</div>
                ) : (
                  [...world.events]
                    .reverse()
                    .slice(0, 35)
                    .map((ev) => (
                      <div
                        key={ev.id}
                        className="text-xs py-1.5 border-b border-slate-800/60 last:border-0 flex items-start gap-2"
                      >
                        <span className="font-mono text-slate-500 shrink-0 tabular-nums">
                          T{ev.tick}
                        </span>
                        <span className="text-slate-300 leading-snug">{ev.message}</span>
                      </div>
                    ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
