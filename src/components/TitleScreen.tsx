import { ActorAvatar } from './ActorAvatar';

interface TitleScreenProps {
  onStartPlay: () => void;
  onStartSandbox: () => void;
  onStartObserve: () => void;
  connected: boolean;
  agentCount: number;
}

export function TitleScreen({
  onStartPlay,
  onStartSandbox,
  onStartObserve,
  connected,
  agentCount,
}: TitleScreenProps) {
  return (
    <div
      className="fixed inset-0 z-30 flex flex-col p-8 md:p-14 pointer-events-auto"
      style={{
        background:
          'radial-gradient(circle at 38% 45%, rgba(11, 16, 24, 0.70) 0%, rgba(11, 16, 24, 0.92) 72%)',
      }}
    >
      <div className="max-w-5xl w-full mx-auto flex-1 flex flex-col justify-between">
        <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
          <span>{connected ? 'Server Sync Ready' : 'Connecting to Sync Server'}</span>
          <span>{agentCount} Autonomous Agents Online · 60 Hz Physics</span>
        </div>

        <div className="max-w-xl my-auto">
          {/* Custom inline SVG Title Emblem */}
          <div className="flex items-center gap-4 mb-5">
            <svg
              viewBox="0 0 48 48"
              className="w-12 h-12 shrink-0"
              aria-hidden="true"
            >
              <rect
                x="3"
                y="3"
                width="42"
                height="42"
                rx="8"
                fill="#131C2B"
                stroke="#38BDF8"
                strokeWidth="2"
              />
              <rect x="11" y="13" width="10" height="14" rx="2.5" fill="#38BDF8" />
              <rect x="27" y="19" width="10" height="14" rx="2.5" fill="#F59E0B" />
              <path
                d="M21 20 L27 26"
                stroke="#10B981"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <line
                x1="10"
                y1="37"
                x2="38"
                y2="37"
                stroke="#475569"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <div>
              <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-slate-50 leading-none">
                RelayLab
              </h1>
              <p className="text-sm text-slate-400 mt-1.5">
                Multi-Agent 2D Physics &amp; Collaborative Puzzle Engine
              </p>
            </div>
          </div>

          <p className="text-base text-slate-300 leading-relaxed max-w-lg mb-6">
            Play alongside autonomous agents, test rigid-body dynamics in the
            real-time sandbox, or connect external bots over WebSocket and REST.
            Every impulse, material surface, gate, and decision syncs at 60 Hz.
          </p>

          {/* Active Squad Archetypes */}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-7 text-xs">
            <div className="flex items-center gap-2.5">
              <ActorAvatar name="Operator" role="human" color="#38BDF8" size={32} />
              <div>
                <div className="font-semibold text-slate-100">Operator</div>
                <div className="text-slate-400">Field Engineer · You</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <ActorAvatar name="Relay-Alpha" role="agent" color="#F59E0B" size={32} />
              <div>
                <div className="font-semibold text-slate-100">Relay-Alpha</div>
                <div className="text-slate-400">Rover · Heavy Push</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <ActorAvatar name="Relay-Beta" role="agent" color="#10B981" size={32} />
              <div>
                <div className="font-semibold text-slate-100">Relay-Beta</div>
                <div className="text-slate-400">Aero Recon · Scout</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-start="true"
              onClick={onStartPlay}
              className="px-6 py-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
            >
              Play with Agents
            </button>
            <button
              type="button"
              onClick={onStartSandbox}
              className="px-5 py-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/40 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400"
            >
              Open Sandbox
            </button>
            <button
              type="button"
              onClick={onStartObserve}
              className="px-5 py-3 rounded-lg bg-slate-800/90 hover:bg-slate-700 text-slate-100 border border-slate-700 font-medium text-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
            >
              Observe Agents Only
            </button>
          </div>
        </div>

        <div className="text-xs text-slate-400 font-mono tracking-wide">
          A / D or Arrows Move · W / Space Jump · E Switch · Q Grab / Throw · P Pause · R Reset
        </div>
      </div>
    </div>
  );
}
