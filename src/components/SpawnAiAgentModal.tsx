import { useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, Sparkles, X } from 'lucide-react';
import type { LlmProviderInfo } from '../server/llm/types';

export interface SpawnAiAgentConfig {
  name: string;
  provider: string;
  model?: string;
  persona?: string;
  controlMode: 'hybrid' | 'direct';
}

interface SpawnAiAgentModalProps {
  open: boolean;
  onClose: () => void;
  onSpawn: (config: SpawnAiAgentConfig) => Promise<void>;
}

export function SpawnAiAgentModal({ open, onClose, onSpawn }: SpawnAiAgentModalProps) {
  const [providers, setProviders] = useState<LlmProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [name, setName] = useState('');
  const [providerId, setProviderId] = useState('mock');
  const [model, setModel] = useState('');
  const [controlMode, setControlMode] = useState<'hybrid' | 'direct'>('hybrid');
  const [persona, setPersona] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingProviders(true);
    setError(null);
    fetch('/api/llm/providers')
      .then(async (response) => {
        const data = (await response.json()) as { providers?: LlmProviderInfo[]; error?: string };
        if (!response.ok) throw new Error(data.error || 'Could not load providers');
        if (!cancelled) {
          const next = data.providers ?? [];
          setProviders(next);
          const defaultProvider = next.find((p) => p.configured) ?? next[0];
          if (defaultProvider) {
            setProviderId(defaultProvider.id);
            setModel(defaultProvider.models[0] ?? '');
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load providers');
      })
      .finally(() => {
        if (!cancelled) setLoadingProviders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selected = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId]
  );

  useEffect(() => {
    if (!selected) return;
    setModel(selected.models[0] ?? '');
  }, [selected]);

  if (!open) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSpawn({
        name: name.trim(),
        provider: providerId,
        model: model.trim() || undefined,
        persona: persona.trim() || undefined,
        controlMode,
      });
      setName('');
      setPersona('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not spawn AI agent');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-[#0B111B] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Sparkles className="h-4 w-4 text-sky-400" />
              Spawn AI agent
            </div>
            <p className="mt-1 text-xs leading-snug text-slate-400">
              A managed LLM plays its own character. Keys stay on the server; the mock provider
              needs none.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close spawn AI agent dialog"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <label className="block text-xs text-slate-400">
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={32}
              placeholder="e.g. Nova"
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#070B12] px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
          </label>

          <label className="block text-xs text-slate-400">
            Provider
            <select
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#070B12] px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
              disabled={loadingProviders}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                  {provider.label}
                  {provider.configured ? '' : ' — not configured'}
                </option>
              ))}
            </select>
            {selected?.notes && (
              <span className="mt-1 block text-[11px] leading-snug text-slate-500">
                {selected.notes}
              </span>
            )}
          </label>

          <label className="block text-xs text-slate-400">
            Model
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={selected?.models[0] ?? 'model name'}
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#070B12] px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
          </label>

          <label className="block text-xs text-slate-400">
            Control mode
            <select
              value={controlMode}
              onChange={(event) => setControlMode(event.target.value as 'hybrid' | 'direct')}
              className="mt-1 w-full rounded-md border border-slate-700 bg-[#070B12] px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
            >
              <option value="hybrid">Hybrid — model picks targets, pilot handles movement</option>
              <option value="direct">Direct — model drives movement inputs</option>
            </select>
          </label>

          <label className="block text-xs text-slate-400">
            Persona (optional)
            <textarea
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Terse scout, calls out hazards, never gives up."
              className="mt-1 w-full resize-none rounded-md border border-slate-700 bg-[#070B12] px-2.5 py-2 text-sm text-slate-100 outline-none focus:border-sky-500"
            />
          </label>

          {error && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 text-xs text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-5 py-3">
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <Bot className="h-3.5 w-3.5" /> Up to 4 managed LLM agents
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !providerId || !selected?.configured}
              className="inline-flex items-center gap-1.5 rounded-md border border-sky-500/40 bg-sky-500/20 px-3 py-1.5 text-xs font-medium text-sky-200 hover:bg-sky-500/30 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Spawn
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
