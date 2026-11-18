# RelayLab — Multi-Agent 2D Platformer Engine

A server-authoritative 2D puzzle platformer. One human operator and autonomous agents share the same physics world over WebSocket/REST, with live decision telemetry and a browser-based sandbox editor.

No API keys or environment variables are required for local development.

## Requirements

- Node.js 22 or newer

## Run locally

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Express/WebSocket server with Vite middleware |
| `npm run build` | Build the client into `dist/` |
| `npm start` | Run the server in production mode |
| `npm run lint` | Type-check with `tsc --noEmit` |
| `npm test` | Run engine and LLM-agent tests |
| `npm run clean` | Remove `dist/` |

## AI agents (LLM)

The server can host managed LLM agents alongside the built-in bots. Each one plays
its own character, emits chat bubbles, and appears on the actor cards with its
provider, model, control mode, and live status.

- **Hybrid** (default): the model picks a target and a 0.4–3s horizon; a
  deterministic 60 Hz pilot walks, jumps, and presses mechanisms.
- **Direct**: the model drives movement inputs itself.
- **Fallback**: if a provider fails or times out, the built-in planner takes
  over for 12 seconds, then the model is retried.

Up to four managed LLM agents can run at once, at no more than 30 decisions per
minute each. The default binding is localhost.

### Providers

`mock` is keyless and deterministic, so the feature works with no setup. Any
OpenAI-compatible endpoint, Anthropic, and Gemini are also supported. Keys are
read from the server environment only and are never returned to the browser or
written to the world state. A loopback OpenAI-compatible base URL is treated as
keyless, which covers Ollama, LM Studio, llama.cpp, and vLLM.

Copy `.env.example` to `.env` if you need provider keys. The server loads `.env`
through `dotenv`; do not commit it.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/llm/providers` | Configured providers and models |
| POST | `/api/agents/llm` | Spawn a managed agent (`name`, `provider`, `model`, `persona`, `controlMode`) |
| GET | `/api/agents/:id/context` | System prompt + live context for an external connector |
| GET | `/api/agents/:id/llm` | Runner status, latency, and fallback state |
| DELETE | `/api/agents/llm/:id` | Stop a runner and remove its actor |

If `RELAYLAB_ADMIN_TOKEN` is set, spawn/delete requests must send it in the
`x-relaylab-admin-token` header. Agent messages, including the human player's,
are ordinary `message` WebSocket events and render as in-world bubbles.

## Project layout

- `server.ts` — authoritative game loop, WebSocket/REST endpoints, agent orchestration
- `src/engine/physics.ts` — fixed-step simulation, collision, channels, crates, hazards
- `src/engine/levels.ts` — the five level definitions (`level-1` … `level-4`, `sandbox`)
- `src/engine/agentPlanner.ts` — autonomous agent planning and decision memory
- `src/components/GameCanvas.tsx` — canvas renderer, input, and sandbox interaction
- `src/components/actorRenderer.ts` — actor rig and animation rendering
- `src/components/TelemetryDock.tsx` — live agent decision and telemetry panel

The server owns the simulation; the client renders state snapshots and sends input. Level data is static TypeScript, and sandbox edits exist only in the running server's memory.
