import { LEVELS } from '../engine/levels';
import type { WorldState } from '../engine/types';
import { ActorAvatar } from './ActorAvatar';

interface StatusModalProps {
  mode: 'paused' | 'solved';
  world: WorldState;
  onResume: () => void;
  onRestart: () => void;
  onNextLevel: () => void;
  onExportTrace: () => void;
  onReturnTitle: () => void;
}

export function StatusModal({
  mode,
  world,
  onResume,
  onRestart,
  onNextLevel,
  onExportTrace,
  onReturnTitle,
}: StatusModalProps) {
  const hasNextLevel = world.levelIndex < LEVELS.length - 1;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6 pointer-events-auto"
      style={{ backgroundColor: 'rgba(8, 12, 19, 0.82)' }}
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'paused' ? 'Simulation Paused' : 'Puzzle Solved'}
    >
      <div className="w-full max-w-lg rounded-xl bg-[#131C2B] border border-slate-700/80 p-7 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <div className="text-xs font-mono text-slate-400 mb-1">
              {world.levelName}
            </div>
            <h2 className="font-display text-2xl font-bold text-slate-50">
              {mode === 'paused' ? 'Simulation Paused' : 'Puzzle Solved'}
            </h2>
          </div>

          {world.actors.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0">
              {world.actors.map((a) => (
                <ActorAvatar
                  key={a.id}
                  name={a.name}
                  role={a.role}
                  color={a.color}
                  mood={mode === 'solved' ? 'happy' : a.holdingCrateId ? 'carrying' : 'normal'}
                  size={32}
                />
              ))}
            </div>
          )}
        </div>
        <p className="text-sm text-slate-300 mb-6">
          {mode === 'paused'
            ? 'Physics ticks are frozen. Step forward frame-by-frame from the toolbar or resume real-time sync.'
            : 'All active collaborators reached the unlocked extraction pad.'}
        </p>

        <div className="grid grid-cols-3 gap-4 py-4 mb-6 border-y border-slate-800">
          <div>
            <div className="text-xs text-slate-400">Clear Time</div>
            <div className="font-mono text-lg font-semibold text-slate-100 mt-0.5 tabular-nums">
              {(mode === 'solved'
                ? world.solvedAtSeconds ?? world.metrics.elapsedSeconds
                : world.metrics.elapsedSeconds
              ).toFixed(1)}s
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Sync Ticks</div>
            <div className="font-mono text-lg font-semibold text-slate-100 mt-0.5 tabular-nums">
              {mode === 'solved' ? world.solvedAtTick ?? world.tick : world.tick}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Decisions</div>
            <div className="font-mono text-lg font-semibold text-slate-100 mt-0.5 tabular-nums">
              {world.metrics.decisionsLogged}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {mode === 'paused' ? (
            <button
              type="button"
              onClick={onResume}
              className="px-5 py-2.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Resume
            </button>
          ) : hasNextLevel ? (
            <button
              type="button"
              data-start="true"
              onClick={onNextLevel}
              className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Next Level
            </button>
          ) : (
            <button
              type="button"
              data-start="true"
              onClick={onRestart}
              className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Play Again
            </button>
          )}

          <button
            type="button"
            onClick={onRestart}
            className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Restart Level
          </button>

          {mode === 'solved' && (
            <button
              type="button"
              onClick={onExportTrace}
              className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              Export Trace
            </button>
          )}

          <button
            type="button"
            onClick={onReturnTitle}
            className="px-3 py-2.5 text-slate-400 hover:text-slate-200 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Title
          </button>
        </div>

        <div className="mt-4 text-[11px] font-mono text-slate-500">
          {mode === 'solved'
            ? hasNextLevel
              ? 'Enter / Space: Next Level · R: Restart · M: Mute'
              : 'Enter / Space: Play Again · R: Restart · M: Mute'
            : 'P / Esc: Resume · R: Restart · M: Mute'}
        </div>
      </div>
    </div>
  );
}
