import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  StepForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { GameCanvas } from './components/GameCanvas';
import { StatusModal } from './components/StatusModal';
import { SpawnAiAgentModal, type SpawnAiAgentConfig } from './components/SpawnAiAgentModal';
import { TelemetryDock, type InspectorTab } from './components/TelemetryDock';
import { TitleScreen } from './components/TitleScreen';
import { LEVELS } from './engine/levels';
import { SANDBOX_TOOLS, type SandboxCanvasSelection } from './engine/sandboxTools';
import type { ActorInput, PhysicsConfig, SandboxAction } from './engine/types';
import { useEngineSocket } from './hooks/useEngineSocket';
import { soundFX } from './utils/sound';

type AppShellState = 'title' | 'playing' | 'paused' | 'gameover';

const LEVEL_SHORT_LABELS: Record<string, string> = {
  'level-1': '01. Relay',
  'level-2': '02. Crate',
  'level-3': '03. Lift',
  'level-4': '04. Vault',
  'level-5': '05. Cascade',
  sandbox: '06. Sandbox',
};

export default function App() {
  const {
    world,
    worldRef,
    connected,
    assignedActorId,
    role,
    latencyMs,
    registerRole,
    sendInput,
    sendControl,
    sendSandbox,
    sendMessage,
  } = useEngineSocket();

  const [shellState, setShellState] = useState<AppShellState>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        return 'playing';
      }
    }
    return 'title';
  });

  const [showAgentPlans, setShowAgentPlans] = useState(true);
  const [aiSpawnOpen, setAiSpawnOpen] = useState(false);
  const [muted, setMuted] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('relaylab-muted') === '1';
    } catch {
      return false;
    }
  });
  const [activeDockTab, setActiveDockTab] = useState<InspectorTab>('agents');
  const [dockOpen, setDockOpen] = useState(true);
  const [sandboxSelection, setSandboxSelection] = useState<SandboxCanvasSelection>({
    tool: 'pointer',
    channel: 'A',
    snapToGrid: true,
    selectedEntityId: null,
  });

  const keysRef = useRef<Set<string>>(new Set());
  const lastSentInputRef = useRef<string>('');
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const autoStartedRef = useRef(false);
  const awaitingResetRef = useRef(false);

  // Sync game state machine to document.body.dataset.state & soundFX mute state
  useEffect(() => {
    document.body.dataset.state = shellState;
  }, [shellState]);

  useEffect(() => {
    soundFX.muted = muted;
  }, [muted]);

  // Handle ?autostart=1 (& optional ?level=sandbox) once connected
  useEffect(() => {
    if (!connected || autoStartedRef.current) return;
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      autoStartedRef.current = true;
      const observeOnly = params.get('observe') === '1';
      const requestedLevel = params.get('level');
      awaitingResetRef.current = true;
      registerRole(observeOnly ? 'observer' : 'human', observeOnly ? undefined : 'Operator');
      if (requestedLevel) {
        sendControl('load_level', requestedLevel);
      } else {
        sendControl('reset');
      }
      sendControl('resume');
    }
  }, [connected, registerRole, sendControl]);

  // Transition to 'gameover' when puzzle solves during active play
  useEffect(() => {
    if (!world) return;
    if (awaitingResetRef.current) {
      if (!world.solved) {
        awaitingResetRef.current = false;
      }
      return;
    }
    if (world.solved && shellState === 'playing') {
      setShellState('gameover');
    }
  }, [world, shellState]);

  // Play procedural Web Audio FX on authoritative server events
  useEffect(() => {
    if (!world || shellState === 'title') return;
    for (const ev of world.events) {
      if (seenEventIdsRef.current.has(ev.id)) continue;
      seenEventIdsRef.current.add(ev.id);
      if (seenEventIdsRef.current.size > 200) {
        const first = seenEventIdsRef.current.values().next().value;
        if (first) seenEventIdsRef.current.delete(first);
      }
      if (ev.type === 'plate:activated') soundFX.playPlate();
      else if (ev.type === 'switch:toggled') soundFX.playSwitch();
      else if (ev.type === 'door:opened') soundFX.playDoorOpen();
      else if (ev.type === 'door:closed') soundFX.playDoorClose();
      else if (ev.type === 'actor:respawn') soundFX.playRespawn();
      else if (ev.type === 'puzzle:solved') soundFX.playSolved();
    }
  }, [world, shellState]);

  const humanActorId =
    role === 'human'
      ? assignedActorId ?? world?.actors.find((a) => a.role === 'human')?.id ?? null
      : null;

  const handleSpawnAiAgent = useCallback(async (config: SpawnAiAgentConfig) => {
    const response = await fetch('/api/agents/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error || `Could not spawn AI agent (${response.status})`);
    }
  }, []);

  const handleSendSquadMessage = useCallback(
    (text: string) => {
      if (!humanActorId) return;
      sendMessage(humanActorId, text, 'status');
    },
    [humanActorId, sendMessage]
  );

  const focusCanvas = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur?.();
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="game-canvas"]');
    canvas?.focus();
  }, []);

  const handleStartPlay = useCallback(() => {
    keysRef.current.clear();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    awaitingResetRef.current = true;
    registerRole('human', 'Operator');
    sendControl('reset');
    sendControl('resume');
    setShellState('playing');
    setTimeout(focusCanvas, 30);
  }, [focusCanvas, registerRole, sendControl]);

  const handleStartSandbox = useCallback(() => {
    keysRef.current.clear();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    awaitingResetRef.current = true;
    setSandboxSelection({ tool: 'pointer', channel: 'A', snapToGrid: true, selectedEntityId: null });
    registerRole('human', 'Operator');
    sendControl('load_level', 'sandbox');
    sendControl('resume');
    setShellState('playing');
    setTimeout(focusCanvas, 30);
  }, [focusCanvas, registerRole, sendControl]);

  const handleStartObserve = useCallback(() => {
    keysRef.current.clear();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    awaitingResetRef.current = true;
    registerRole('observer');
    sendControl('toggle_human', false);
    sendControl('reset');
    sendControl('resume');
    setShellState('playing');
  }, [registerRole, sendControl]);

  const handleTogglePause = useCallback(() => {
    if (shellState === 'playing') {
      sendControl('pause');
      setShellState('paused');
    } else if (shellState === 'paused') {
      sendControl('resume');
      setShellState('playing');
      focusCanvas();
    }
  }, [focusCanvas, sendControl, shellState]);

  const handleRestartLevel = useCallback(() => {
    keysRef.current.clear();
    awaitingResetRef.current = true;
    sendControl('reset');
    sendControl('resume');
    setShellState('playing');
    focusCanvas();
  }, [focusCanvas, sendControl]);

  const handleNextLevel = useCallback(() => {
    if (!world) return;
    const nextIdx = Math.min(LEVELS.length - 1, world.levelIndex + 1);
    const nextLevel = LEVELS[nextIdx];
    keysRef.current.clear();
    awaitingResetRef.current = true;
    sendControl('load_level', nextLevel.id);
    sendControl('resume');
    setShellState('playing');
    focusCanvas();
  }, [focusCanvas, sendControl, world]);

  const handleSelectLevel = useCallback(
    (levelId: string) => {
      keysRef.current.clear();
      awaitingResetRef.current = true;
      setSandboxSelection((prev) => ({ ...prev, selectedEntityId: null }));
      sendControl('load_level', levelId);
      sendControl('resume');
      if (shellState !== 'title') {
        setShellState('playing');
      }
      focusCanvas();
    },
    [focusCanvas, sendControl, shellState]
  );

  const handleReturnTitle = useCallback(() => {
    keysRef.current.clear();
    setSandboxSelection((prev) => ({ ...prev, tool: 'pointer', selectedEntityId: null }));
    registerRole('observer');
    sendControl('toggle_human', false);
    sendControl('reset');
    sendControl('resume');
    setShellState('title');
  }, [registerRole, sendControl]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      soundFX.muted = next;
      try {
        window.localStorage.setItem('relaylab-muted', next ? '1' : '0');
      } catch {
        // Ignore storage errors in restricted iframes
      }
      return next;
    });
  }, []);

  const handleExportTrace = useCallback(() => {
    const a = document.createElement('a');
    a.href = '/api/telemetry/export';
    a.download = `relaylab-trace-${world?.levelId ?? 'level-1'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [world?.levelId]);

  const handleSandboxAction = useCallback(
    (action: SandboxAction) => {
      sendSandbox(action);
    },
    [sendSandbox]
  );

  const handleSelectEntity = useCallback((entityId: string | null) => {
    setSandboxSelection((prev) => ({ ...prev, selectedEntityId: entityId }));
    if (entityId) {
      setActiveDockTab('sandbox');
      setDockOpen(true);
    }
  }, []);

  const handleToggleEditMode = useCallback(() => {
    setSandboxSelection((prev) => {
      const entering = prev.tool !== 'edit';
      if (entering) {
        setActiveDockTab('sandbox');
        setDockOpen(true);
      }
      return {
        ...prev,
        tool: entering ? 'edit' : 'pointer',
        selectedEntityId: entering ? prev.selectedEntityId ?? null : null,
      };
    });
  }, []);

  const handleUpdatePhysics = useCallback(
    (partial: Partial<PhysicsConfig>) => {
      sendControl('set_physics', partial);
    },
    [sendControl]
  );

  const handleApplyPhysicsPreset = useCallback(
    (presetId: string) => {
      sendControl('apply_physics_preset', presetId);
    },
    [sendControl]
  );

  const dispatchCurrentKeys = useCallback(() => {
    if (!humanActorId || shellState !== 'playing') return;
    const keys = keysRef.current;
    const left = keys.has('ArrowLeft') || keys.has('KeyA');
    const right = keys.has('ArrowRight') || keys.has('KeyD');
    const jump = keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space');
    const interact = keys.has('KeyE');
    const grab = keys.has('KeyQ');

    const move: -1 | 0 | 1 = left && !right ? -1 : right && !left ? 1 : 0;
    const payload: ActorInput = {
      move,
      jump,
      interact,
      grab,
      intent: grab
        ? 'Grab / Throw'
        : move !== 0 || jump
          ? 'Human Control'
          : 'Human Idle',
    };

    const sig = `${move}|${jump ? 1 : 0}|${interact ? 1 : 0}|${grab ? 1 : 0}`;
    if (sig !== lastSentInputRef.current) {
      lastSentInputRef.current = sig;
      if (jump) soundFX.playJump();
      sendInput(humanActorId, payload);
    }
  }, [humanActorId, sendInput, shellState]);

  // Unified Window Keyboard Listeners
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (shellState === 'title') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartPlay();
        }
        return;
      }

      if (shellState === 'gameover') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          const curWorld = worldRef.current;
          if (curWorld && curWorld.levelIndex < LEVELS.length - 1) {
            handleNextLevel();
          } else {
            handleRestartLevel();
          }
        }
        return;
      }

      if (
        e.code === 'Escape' &&
        (sandboxSelection.tool !== 'pointer' || sandboxSelection.selectedEntityId)
      ) {
        e.preventDefault();
        setSandboxSelection((prev) => ({
          ...prev,
          tool: 'pointer',
          selectedEntityId: null,
        }));
        focusCanvas();
        return;
      }

      if (
        (e.code === 'Delete' || e.code === 'Backspace') &&
        sandboxSelection.tool === 'edit' &&
        sandboxSelection.selectedEntityId &&
        sandboxSelection.selectedEntityId !== worldRef.current?.exit.id
      ) {
        e.preventDefault();
        sendSandbox({ action: 'remove', entityId: sandboxSelection.selectedEntityId });
        setSandboxSelection((prev) => ({ ...prev, selectedEntityId: null }));
        return;
      }

      if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        handleTogglePause();
        return;
      }
      if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleRestartLevel();
        return;
      }
      if (e.code === 'KeyM') {
        e.preventDefault();
        handleToggleMute();
        return;
      }

      if (
        [
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'Space',
          'KeyA',
          'KeyD',
          'KeyW',
          'KeyE',
          'KeyQ',
        ].includes(e.code)
      ) {
        if (['ArrowUp', 'Space', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          e.preventDefault();
        }
        keysRef.current.add(e.code);
        dispatchCurrentKeys();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
      dispatchCurrentKeys();
    };

    const clearHeld = () => {
      if (keysRef.current.size > 0) {
        keysRef.current.clear();
        dispatchCurrentKeys();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);
    document.addEventListener('visibilitychange', clearHeld);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeld);
      document.removeEventListener('visibilitychange', clearHeld);
    };
  }, [
    dispatchCurrentKeys,
    focusCanvas,
    handleNextLevel,
    handleRestartLevel,
    handleStartPlay,
    handleToggleMute,
    handleTogglePause,
    sandboxSelection.selectedEntityId,
    sandboxSelection.tool,
    sendSandbox,
    shellState,
    worldRef,
  ]);

  const handleToggleHuman = useCallback(
    (active: boolean) => {
      if (active) {
        registerRole('human', 'Operator');
        setTimeout(focusCanvas, 30);
      } else {
        registerRole('observer');
        sendControl('toggle_human', false);
      }
    },
    [focusCanvas, registerRole, sendControl]
  );

  const agentCount = world?.actors.filter((a) => a.role === 'agent').length ?? 0;
  const activeToolSpec =
    SANDBOX_TOOLS.find((t) => t.id === sandboxSelection.tool) ?? SANDBOX_TOOLS[0];

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col lg:flex-row bg-[#0B1018] text-slate-100">
      {/* Primary Stage Column */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        {/* Clean Unobstructed Stage Header Bar (shown while playing/paused/gameover) */}
        {shellState !== 'title' && world && (
          <header className="px-4 py-2 bg-[#0F1623] border-b border-slate-800/90 flex items-center justify-between gap-4 shrink-0">
            {/* Level Info + Live Telemetry Readout */}
            <div className="flex items-center gap-4 min-w-0">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-100 flex items-center gap-2 truncate">
                  <span className="truncate">{world.levelName}</span>
                  {world.levelSubtitle && (
                    <>
                      <span className="text-slate-600 hidden lg:inline" aria-hidden="true">·</span>
                      <span className="text-slate-400 font-normal hidden lg:inline truncate">
                        {world.levelSubtitle}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="hidden sm:flex items-center gap-2.5 pl-4 border-l border-slate-800 tabular-nums shrink-0">
                <span className="font-mono text-sm font-semibold text-slate-50">
                  {world.metrics.actorsAtExit}/{world.actors.length}
                </span>
                <span className="text-xs text-slate-400">at exit</span>
                <span className="text-slate-700" aria-hidden="true">·</span>
                <span className="font-mono text-xs text-sky-300">
                  {Math.round(
                    world.solved
                      ? world.solvedAtSeconds ?? world.metrics.elapsedSeconds
                      : world.metrics.elapsedSeconds
                  )}s
                </span>
                <span className="text-slate-700" aria-hidden="true">·</span>
                <span className="font-mono text-xs text-amber-300">
                  {world.metrics.totalKineticEnergy.toFixed(1)} kJ
                </span>
              </div>
            </div>

            {/* Stage Utility Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleToggleEditMode();
                }}
                aria-label={
                  sandboxSelection.tool === 'edit' ? 'Exit level editor' : 'Edit level objects'
                }
                title="Select & edit platforms, wires, crosswinds & conveyors"
                className={`h-8 px-2.5 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  sandboxSelection.tool === 'edit'
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                    : 'bg-[#0B1018] border-slate-700/70 text-slate-300 hover:text-white hover:border-slate-600'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Edit</span>
              </button>

              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  setShowAgentPlans((p) => !p);
                }}
                aria-label={showAgentPlans ? 'Hide agent plans' : 'Show agent plans'}
                title={showAgentPlans ? 'Hide Agent Plans' : 'Show Agent Plans'}
                className={`h-8 px-2.5 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                  showAgentPlans
                    ? 'bg-sky-500/15 border-sky-500/40 text-sky-200'
                    : 'bg-[#0B1018] border-slate-700/70 text-slate-300 hover:text-white hover:border-slate-600'
                }`}
              >
                {showAgentPlans ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline">Plans</span>
              </button>

              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleToggleMute();
                }}
                aria-label={muted ? 'Unmute audio [M]' : 'Mute audio [M]'}
                title="Mute [M]"
                className="w-8 h-8 rounded-md border border-slate-700/70 bg-[#0B1018] hover:bg-slate-800 text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleRestartLevel();
                }}
                aria-label="Restart level [R]"
                title="Restart [R]"
                className="w-8 h-8 rounded-md border border-slate-700/70 bg-[#0B1018] hover:bg-slate-800 text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleTogglePause();
                }}
                aria-label={shellState === 'paused' ? 'Resume [P]' : 'Pause [P]'}
                title="Pause [P]"
                className="w-8 h-8 rounded-md border border-slate-700/70 bg-[#0B1018] hover:bg-slate-800 text-slate-200 flex items-center justify-center transition-colors cursor-pointer"
              >
                {shellState === 'paused' ? (
                  <Play className="w-3.5 h-3.5" />
                ) : (
                  <Pause className="w-3.5 h-3.5" />
                )}
              </button>

              <button
                type="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  setDockOpen((o) => !o);
                }}
                aria-label={dockOpen ? 'Collapse inspector panel' : 'Expand inspector panel'}
                title={dockOpen ? 'Hide Telemetry Dock' : 'Show Telemetry Dock'}
                className="hidden lg:inline-flex h-8 px-2.5 rounded-md border border-slate-700/70 bg-[#0B1018] hover:bg-slate-800 text-slate-200 items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                {dockOpen ? (
                  <PanelRightClose className="w-3.5 h-3.5 text-slate-300" />
                ) : (
                  <PanelRightOpen className="w-3.5 h-3.5 text-sky-400" />
                )}
                <span className="hidden xl:inline">Inspector</span>
              </button>
            </div>
          </header>
        )}

        {/* Unobstructed Game Viewport */}
        <div className="flex-1 relative min-h-[320px]">
          <GameCanvas
            worldRef={worldRef}
            humanActorId={humanActorId}
            showAgentPlans={showAgentPlans}
            sandboxSelection={sandboxSelection}
            onSandboxAction={handleSandboxAction}
            onSelectEntity={handleSelectEntity}
            onCanvasFocus={focusCanvas}
          />
        </div>

        {/* Bottom Engine Control Strip (single row on desktop, hidden on Title Screen) */}
        {shellState !== 'title' && (
          <div className="px-4 py-2 bg-[#0F1623] border-t border-slate-800/90 flex flex-wrap xl:flex-nowrap items-center justify-between gap-2 shrink-0">
            {/* Level Selector */}
            <div className="flex items-center gap-1 overflow-x-auto">
              {LEVELS.map((lvl) => {
                const active = world?.levelId === lvl.id;
                return (
                  <button
                    key={lvl.id}
                    type="button"
                    title={lvl.name}
                    onClick={() => handleSelectLevel(lvl.id)}
                    className={`px-2 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-sky-500 text-slate-950 font-semibold'
                        : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700 hover:text-white'
                    }`}
                  >
                    {LEVEL_SHORT_LABELS[lvl.id] ?? lvl.name}
                  </button>
                );
              })}
            </div>

            {/* Quiet keybind / active tool hint centered on wide screens */}
            {(humanActorId || sandboxSelection.tool !== 'pointer') && (
              <div className="hidden 2xl:block text-[11px] font-mono text-slate-400 truncate px-2">
                {sandboxSelection.tool !== 'pointer'
                  ? `${activeToolSpec.label} · ${activeToolSpec.hint} · Esc`
                  : 'A/D Move · W/Space Jump · E Switch · Q Grab/Throw'}
              </div>
            )}

            {/* Simulation Step, Speed & Export Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (world?.paused) {
                    sendControl('resume');
                    if (shellState === 'paused') setShellState('playing');
                  } else {
                    sendControl('pause');
                    if (shellState === 'playing') setShellState('paused');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                {world?.paused ? (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    Pause
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => sendControl('step')}
                aria-label="Step 1 physics tick"
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono transition-colors cursor-pointer whitespace-nowrap"
              >
                <StepForward className="w-3.5 h-3.5" />
                +1 Tick
              </button>

              <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-[#0B1018] border border-slate-800">
                {[0.5, 1, 2].map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => sendControl('set_timescale', speed)}
                    className={`px-1.5 py-1 rounded text-xs font-mono transition-colors cursor-pointer ${
                      world?.timeScale === speed
                        ? 'bg-slate-700 text-slate-50 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleExportTrace}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Export Trace
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Real-Time Telemetry & Control Dock (hidden on Title Screen, collapsible on lg+) */}
      {shellState !== 'title' && dockOpen && (
        <TelemetryDock
          world={world}
          connected={connected}
          latencyMs={latencyMs}
          humanActorId={humanActorId}
          activeTab={activeDockTab}
          onTabChange={setActiveDockTab}
          sandboxSelection={sandboxSelection}
          onSandboxSelectionChange={setSandboxSelection}
          onSandboxAction={handleSandboxAction}
          onUpdatePhysics={handleUpdatePhysics}
          onApplyPhysicsPreset={handleApplyPhysicsPreset}
          onSpawnAgent={() => sendControl('spawn_agent')}
          onOpenAiAgentModal={() => setAiSpawnOpen(true)}
          onRemoveAgent={(id) => sendControl('remove_agent', id)}
          onToggleHuman={handleToggleHuman}
          onSendMessage={handleSendSquadMessage}
        />
      )}

      <SpawnAiAgentModal
        open={aiSpawnOpen}
        onClose={() => setAiSpawnOpen(false)}
        onSpawn={handleSpawnAiAgent}
      />

      {/* Title Screen Overlay */}
      {shellState === 'title' && (
        <TitleScreen
          onStartPlay={handleStartPlay}
          onStartSandbox={handleStartSandbox}
          onStartObserve={handleStartObserve}
          connected={connected}
          agentCount={agentCount}
        />
      )}

      {/* Pause / Stage Clear Modal */}
      {((shellState === 'paused' && sandboxSelection.tool === 'pointer') ||
        shellState === 'gameover') &&
        world && (
        <StatusModal
          mode={shellState === 'paused' ? 'paused' : 'solved'}
          world={world}
          onResume={() => {
            sendControl('resume');
            setShellState('playing');
            focusCanvas();
          }}
          onRestart={handleRestartLevel}
          onNextLevel={handleNextLevel}
          onExportTrace={handleExportTrace}
          onReturnTitle={handleReturnTitle}
        />
      )}
    </div>
  );
}
