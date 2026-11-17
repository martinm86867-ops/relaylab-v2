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
| `npm run clean` | Remove `dist/` |

## Tests

The engine tests are plain Node test files and are not wired to an npm script:

```bash
npx tsx --test src/engine/*.test.ts
```

## Project layout

- `server.ts` — authoritative game loop, WebSocket/REST endpoints, agent orchestration
- `src/engine/physics.ts` — fixed-step simulation, collision, channels, crates, hazards
- `src/engine/levels.ts` — the five level definitions (`level-1` … `level-4`, `sandbox`)
- `src/engine/agentPlanner.ts` — autonomous agent planning and decision memory
- `src/components/GameCanvas.tsx` — canvas renderer, input, and sandbox interaction
- `src/components/actorRenderer.ts` — actor rig and animation rendering
- `src/components/TelemetryDock.tsx` — live agent decision and telemetry panel

The server owns the simulation; the client renders state snapshots and sends input. Level data is static TypeScript, and sandbox edits exist only in the running server's memory.
