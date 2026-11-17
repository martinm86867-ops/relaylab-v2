import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import { getLevelById, LEVELS } from './src/engine/levels';
import {
  addActorToWorld,
  applyPhysicsPreset,
  applySandboxAction,
  buildAgentObservation,
  createWorld,
  FIXED_DT,
  recordAgentMessage,
  removeActorFromWorld,
  softResetWorld,
  stepWorld,
  updateWorldPhysics,
} from './src/engine/physics';
import { createAgentMemory, decideAgentAction, type AgentPlannerMemory } from './src/engine/agentPlanner';
import type {
  ActorInput,
  ActorRole,
  AgentMessageKind,
  ChannelId,
  ClientWsMessage,
  LevelDefinition,
  PhysicsConfig,
  SandboxAction,
  ServerWsMessage,
  TraceRecord,
  WorldState,
} from './src/engine/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

interface ConnectedClient {
  id: string;
  ws: WebSocket;
  role: ActorRole | 'observer';
  actorId: string | null;
  name: string;
  isLocalAgent?: boolean;
}

interface LocalAgentBot {
  actorId: string;
  name: string;
  ws: WebSocket;
  memory: AgentPlannerMemory;
}

const AGENT_NAMES = ['Relay-Alpha', 'Relay-Beta', 'Relay-Gamma', 'Relay-Delta'];

class CentralizedEngineServer {
  currentLevel: LevelDefinition = getLevelById('level-1');
  world: WorldState;
  inputs: Record<string, ActorInput> = {};
  clients = new Map<string, ConnectedClient>();
  localBots = new Map<string, LocalAgentBot>();
  traceHistory: TraceRecord[] = [];
  clientSeq = 0;
  botSeq = 0;
  simAccumulator = 0;
  lastStepTime = performance.now();

  constructor() {
    this.world = createWorld(this.currentLevel, []);
  }

  recordTrace(): void {
    if (this.world.tick % 3 !== 0 && !this.world.solved) return;
    this.traceHistory.push({
      tick: this.world.tick,
      elapsedSeconds: this.world.metrics.elapsedSeconds,
      channels: { ...this.world.channels },
      totalKineticEnergy: this.world.metrics.totalKineticEnergy,
      actors: this.world.actors.map((a) => ({
        id: a.id,
        role: a.role,
        x: Math.round(a.x * 10) / 10,
        y: Math.round(a.y * 10) / 10,
        vx: Math.round(a.vx * 10) / 10,
        vy: Math.round(a.vy * 10) / 10,
        intent: a.lastInput.intent,
        move: a.lastInput.move,
        jump: a.lastInput.jump,
      })),
      events: this.world.events.slice(-4),
    });
    if (this.traceHistory.length > 2400) {
      this.traceHistory.splice(0, this.traceHistory.length - 2400);
    }
  }

  loadLevel(levelId: string, preserveActors = true, preservePhysics = false): void {
    const nextLevel = getLevelById(levelId);
    const prevActors = preserveActors
      ? this.world.actors.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          connected: a.connected,
        }))
      : [{ id: 'human-1', name: 'Operator', role: 'human' as ActorRole, connected: false }];
    const prevPhysics = preservePhysics ? { ...this.world.physics } : undefined;

    this.currentLevel = nextLevel;
    this.world = createWorld(nextLevel, prevActors, prevPhysics);
    this.inputs = {};
    this.traceHistory = [];
    for (const bot of this.localBots.values()) {
      bot.memory = createAgentMemory();
    }
    this.broadcastState();
  }

  resetLevel(): void {
    softResetWorld(this.world, this.currentLevel);
    this.inputs = {};
    this.traceHistory = [];
    for (const bot of this.localBots.values()) {
      bot.memory = createAgentMemory();
    }
    this.broadcastState();
  }

  spawnLocalAgent(customName?: string): { actorId: string; name: string } {
    this.botSeq += 1;
    const actorId = `agent-bot-${this.botSeq}`;
    const existingNames = new Set(this.world.actors.map((a) => a.name));
    const defaultName =
      AGENT_NAMES.find((n) => !existingNames.has(n)) ?? `Relay-${this.botSeq}`;
    const name = customName || defaultName;

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    const memory = createAgentMemory();
    const bot: LocalAgentBot = { actorId, name, ws, memory };
    this.localBots.set(actorId, bot);

    ws.on('open', () => {
      const regMsg: ClientWsMessage = {
        type: 'register',
        role: 'agent',
        name,
        actorId,
      };
      ws.send(JSON.stringify(regMsg));
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ServerWsMessage;
        if (msg.type === 'state' && msg.observation && !msg.world.paused && !msg.world.solved) {
          const decision = decideAgentAction(msg.observation, bot.memory);
          const reply: ClientWsMessage = {
            type: 'input',
            actorId: bot.actorId,
            input: decision,
          };
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(reply));
          }
        }
      } catch {
        // Ignore malformed frame
      }
    });

    ws.on('close', () => {
      this.localBots.delete(actorId);
    });

    return { actorId, name };
  }

  removeAgent(actorId?: string): boolean {
    let targetId = actorId;
    if (!targetId) {
      const agents = this.world.actors.filter((a) => a.role === 'agent');
      if (agents.length === 0) return false;
      targetId = agents[agents.length - 1].id;
    }

    const bot = this.localBots.get(targetId);
    if (bot) {
      try {
        bot.ws.close();
      } catch {
        // ignore
      }
      this.localBots.delete(targetId);
    }

    // Close external WS client if tied to this actor
    for (const client of this.clients.values()) {
      if (client.actorId === targetId && client.role === 'agent') {
        client.actorId = null;
      }
    }

    delete this.inputs[targetId];
    const removed = removeActorFromWorld(this.world, targetId);
    if (removed) {
      this.broadcastState();
    }
    return removed;
  }

  toggleHuman(active: boolean): void {
    const existing = this.world.actors.find((a) => a.role === 'human');
    if (active && !existing) {
      addActorToWorld(this.world, this.currentLevel, {
        id: 'human-1',
        name: 'Operator',
        role: 'human',
        connected: true,
      });
      this.broadcastState();
    } else if (active && existing) {
      existing.connected = true;
      this.broadcastState();
    } else if (!active && existing) {
      delete this.inputs[existing.id];
      removeActorFromWorld(this.world, existing.id);
      this.broadcastState();
    }
  }

  handleControl(
    command: ClientWsMessage & { type: 'control' } extends { command: infer C } ? C : string,
    value?: number | string | boolean | Partial<PhysicsConfig>
  ): void {
    switch (command) {
      case 'pause':
        this.world.paused = true;
        this.broadcastState();
        break;
      case 'resume':
        this.world.paused = false;
        this.broadcastState();
        break;
      case 'step': {
        this.world.paused = true;
        if (this.world.solved) {
          this.broadcastState();
          break;
        }
        const t0 = performance.now();
        stepWorld(this.world, this.currentLevel, this.inputs, FIXED_DT);
        this.world.metrics.tickComputeMs = Number((performance.now() - t0).toFixed(3));
        this.recordTrace();
        this.broadcastState();
        break;
      }
      case 'reset':
        this.resetLevel();
        break;
      case 'set_timescale': {
        const ts = Number(value);
        if (Number.isFinite(ts) && ts >= 0.25 && ts <= 3) {
          this.world.timeScale = ts;
          this.broadcastState();
        }
        break;
      }
      case 'load_level':
        if (typeof value === 'string') {
          this.loadLevel(value, true, false);
        }
        break;
      case 'spawn_agent':
        if (this.world.actors.filter((a) => a.role === 'agent').length < 3) {
          this.spawnLocalAgent(typeof value === 'string' ? value : undefined);
        }
        break;
      case 'remove_agent':
        this.removeAgent(typeof value === 'string' ? value : undefined);
        break;
      case 'toggle_human':
        this.toggleHuman(Boolean(value));
        break;
      case 'set_physics':
        if (value && typeof value === 'object') {
          updateWorldPhysics(this.world, value);
          this.broadcastState();
        }
        break;
      case 'apply_physics_preset':
        if (typeof value === 'string') {
          applyPhysicsPreset(this.world, value);
          this.broadcastState();
        }
        break;
    }
  }

  handleSandbox(payload: SandboxAction): { ok: boolean; entityId?: string; message: string } {
    const result = applySandboxAction(this.world, this.currentLevel, payload);
    if (result.ok) {
      this.broadcastState();
    }
    return result;
  }

  tick(): void {
    const now = performance.now();
    const rawDt = Math.min((now - this.lastStepTime) / 1000, 0.05);
    this.lastStepTime = now;

    if (this.world.paused || this.world.solved) return;

    this.simAccumulator += rawDt * this.world.timeScale;
    let stepped = false;
    let subSteps = 0;

    while (this.simAccumulator >= FIXED_DT && subSteps < 4) {
      const t0 = performance.now();
      stepWorld(this.world, this.currentLevel, this.inputs, FIXED_DT);
      this.world.metrics.tickComputeMs = Number((performance.now() - t0).toFixed(3));
      this.recordTrace();
      this.simAccumulator -= FIXED_DT;
      stepped = true;
      subSteps += 1;
    }

    if (stepped) {
      this.broadcastState();
    }
  }

  broadcastState(): void {
    let sharedStateJson: string | null = null;
    for (const client of this.clients.values()) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.role === 'agent' && client.actorId) {
        const obs = buildAgentObservation(this.world, client.actorId) ?? undefined;
        const msg: ServerWsMessage = {
          type: 'state',
          world: this.world,
          observation: obs,
        };
        client.ws.send(JSON.stringify(msg));
      } else {
        if (sharedStateJson === null) {
          const msg: ServerWsMessage = {
            type: 'state',
            world: this.world,
          };
          sharedStateJson = JSON.stringify(msg);
        }
        client.ws.send(sharedStateJson);
      }
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const engine = new CentralizedEngineServer();
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    engine.clientSeq += 1;
    const clientId = `ws-${engine.clientSeq}`;
    const client: ConnectedClient = {
      id: clientId,
      ws,
      role: 'observer',
      actorId: null,
      name: `Observer-${engine.clientSeq}`,
    };
    engine.clients.set(clientId, client);

    const welcome: ServerWsMessage = {
      type: 'welcome',
      clientId,
      assignedActorId: null,
      role: 'observer',
      world: engine.world,
    };
    ws.send(JSON.stringify(welcome));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientWsMessage;
        if (msg.type === 'register') {
          client.role = msg.role;
          client.name = msg.name || client.name;
          if (msg.role === 'human') {
            const actor = addActorToWorld(engine.world, engine.currentLevel, {
              id: msg.actorId || 'human-1',
              name: msg.name || 'Operator',
              role: 'human',
              connected: true,
            });
            client.actorId = actor.id;
          } else if (msg.role === 'agent') {
            const actor = addActorToWorld(engine.world, engine.currentLevel, {
              id: msg.actorId,
              name: msg.name || `Agent-${engine.clientSeq}`,
              role: 'agent',
              connected: true,
            });
            client.actorId = actor.id;
          } else {
            client.actorId = null;
          }
          const ack: ServerWsMessage = {
            type: 'welcome',
            clientId,
            assignedActorId: client.actorId,
            role: client.role,
            world: engine.world,
          };
          ws.send(JSON.stringify(ack));
          engine.broadcastState();
        } else if (msg.type === 'input') {
          const targetId = msg.actorId || client.actorId;
          if (targetId) {
            engine.inputs[targetId] = msg.input;
            const actor = engine.world.actors.find((a) => a.id === targetId);
            if (actor) {
              actor.lastDecisionAt = Date.now();
              if ((engine.world.paused || engine.world.solved) && typeof msg.input.message === 'string' && msg.input.message.trim()) {
                const recorded = recordAgentMessage(engine.world, targetId, msg.input.message, {
                  kind: msg.input.messageKind,
                  targetId: msg.input.claimTargetId ?? msg.input.targetId,
                  channel: msg.input.messageChannel,
                });
                if (recorded) engine.broadcastState();
              }
            }
          }
        } else if (msg.type === 'message') {
          const senderId = msg.actorId || client.actorId;
          if (senderId && typeof msg.text === 'string') {
            const recorded = recordAgentMessage(engine.world, senderId, msg.text, {
              kind: msg.kind,
              targetId: msg.targetId,
              channel: msg.channel,
            });
            if (recorded) {
              engine.broadcastState();
            }
          }
        } else if (msg.type === 'control') {
          engine.handleControl(msg.command, msg.value);
        } else if (msg.type === 'sandbox') {
          engine.handleSandbox(msg.payload);
        } else if (msg.type === 'ping') {
          const pong: ServerWsMessage = {
            type: 'pong',
            clientTime: msg.clientTime,
            serverTime: Date.now(),
          };
          ws.send(JSON.stringify(pong));
          if (client.actorId) {
            const actor = engine.world.actors.find((a) => a.id === client.actorId);
            if (actor) actor.latencyMs = Math.max(0, Date.now() - msg.clientTime);
          }
        }
      } catch (err) {
        const errMsg: ServerWsMessage = {
          type: 'error',
          message: err instanceof Error ? err.message : 'Invalid WebSocket message',
        };
        ws.send(JSON.stringify(errMsg));
      }
    });

    ws.on('close', () => {
      engine.clients.delete(clientId);
      if (client.role === 'agent' && client.actorId) {
        const otherAgentsConnected = Array.from(engine.clients.values()).some(
          (c) => c.role === 'agent' && c.actorId === client.actorId
        );
        if (!otherAgentsConnected) {
          engine.removeAgent(client.actorId);
        }
      } else if (client.role === 'human' && client.actorId) {
        const otherHumansConnected = Array.from(engine.clients.values()).some(
          (c) => c.role === 'human' && c.actorId === client.actorId
        );
        if (!otherHumansConnected) {
          delete engine.inputs[client.actorId];
          removeActorFromWorld(engine.world, client.actorId);
          engine.broadcastState();
        }
      }
    });
  });

  // Centralized REST API Routes
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      tick: engine.world.tick,
      tickRateHz: 60,
      connections: engine.clients.size,
      actors: engine.world.actors.length,
    });
  });

  app.get('/api/levels', (_req, res) => {
    res.json({
      levels: LEVELS.map((l) => ({
        id: l.id,
        index: l.index,
        name: l.name,
        subtitle: l.subtitle,
        hint: l.hint,
        isSandbox: Boolean(l.isSandbox),
      })),
    });
  });

  app.get('/api/state', (req, res) => {
    const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : undefined;
    res.json({
      world: engine.world,
      observation: actorId ? buildAgentObservation(engine.world, actorId) : undefined,
      connections: engine.clients.size,
    });
  });

  app.get('/api/agents', (_req, res) => {
    res.json({
      actors: engine.world.actors.map((a) => ({
        id: a.id,
        name: a.name,
        label: a.label,
        role: a.role,
        connected: a.connected,
        position: { x: Math.round(a.x), y: Math.round(a.y) },
        velocity: { vx: Math.round(a.vx), vy: Math.round(a.vy) },
        grounded: a.grounded,
        onExit: a.onExit,
        lastInput: a.lastInput,
        decisionsCount: a.decisionsCount,
        actionCount: a.actionCount,
      })),
      wsConnections: engine.clients.size,
    });
  });

  app.post('/api/agents/register', (req, res) => {
    const name = typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim()
      : `ExternalAgent-${engine.world.actors.length + 1}`;
    const role: ActorRole = req.body?.role === 'human' ? 'human' : 'agent';
    const rawId = typeof req.body?.actorId === 'string' ? req.body.actorId.trim() : '';
    const existingWithId = rawId ? engine.world.actors.find((a) => a.id === rawId) : undefined;
    if (existingWithId && existingWithId.role !== role) {
      res.status(409).json({ error: `Actor ID '${rawId}' is already registered with role '${existingWithId.role}'` });
      return;
    }
    const actor = addActorToWorld(engine.world, engine.currentLevel, {
      id: rawId || undefined,
      name,
      role,
      connected: true,
    });
    engine.broadcastState();
    res.status(201).json({
      actorId: actor.id,
      label: actor.label,
      role: actor.role,
      wsPath: '/ws',
      stateUrl: `/api/state?actorId=${encodeURIComponent(actor.id)}`,
      inputUrl: `/api/agents/${encodeURIComponent(actor.id)}/input`,
      messageUrl: `/api/agents/${encodeURIComponent(actor.id)}/message`,
      observation: buildAgentObservation(engine.world, actor.id),
    });
  });

  app.post('/api/agents/:id/input', (req, res) => {
    const actorId = req.params.id;
    const actor = engine.world.actors.find((a) => a.id === actorId);
    if (!actor) {
      res.status(404).json({ error: `Actor '${actorId}' not found` });
      return;
    }
    const moveRaw = Number(req.body?.move ?? 0);
    const move: -1 | 0 | 1 = moveRaw > 0 ? 1 : moveRaw < 0 ? -1 : 0;
    const validKinds: AgentMessageKind[] = ['status', 'claim', 'request', 'alert'];
    const validChannels: ChannelId[] = ['A', 'B', 'C'];
    const input: ActorInput = {
      move,
      jump: Boolean(req.body?.jump),
      interact: Boolean(req.body?.interact),
      grab: Boolean(req.body?.grab),
      intent: typeof req.body?.intent === 'string' ? req.body.intent : 'REST API Command',
      reason: typeof req.body?.reason === 'string' ? req.body.reason : 'Submitted via /api/agents/:id/input',
      targetId: typeof req.body?.targetId === 'string' ? req.body.targetId : undefined,
      claimTargetId: typeof req.body?.claimTargetId === 'string' ? req.body.claimTargetId : undefined,
      message: typeof req.body?.message === 'string' ? req.body.message : undefined,
      messageKind: validKinds.includes(req.body?.messageKind) ? req.body.messageKind : undefined,
      messageChannel: validChannels.includes(req.body?.messageChannel) ? req.body.messageChannel : undefined,
    };
    engine.inputs[actorId] = input;
    actor.lastDecisionAt = Date.now();
    if ((engine.world.paused || engine.world.solved) && input.message && input.message.trim()) {
      const recorded = recordAgentMessage(engine.world, actorId, input.message, {
        kind: input.messageKind,
        targetId: input.claimTargetId ?? input.targetId,
        channel: input.messageChannel,
      });
      if (recorded) engine.broadcastState();
    }
    res.json({
      accepted: true,
      actorId,
      tick: engine.world.tick,
      observation: buildAgentObservation(engine.world, actorId),
    });
  });

  app.get('/api/messages', (_req, res) => {
    res.json({
      tick: engine.world.tick,
      messages: engine.world.messages,
      claims: engine.world.actors.map((a) => ({
        actorId: a.id,
        name: a.name,
        label: a.label,
        intent: a.lastInput.intent,
        claimTargetId: a.lastInput.claimTargetId ?? a.lastInput.targetId,
      })),
    });
  });

  app.post('/api/agents/:id/message', (req, res) => {
    const actorId = req.params.id;
    const actor = engine.world.actors.find((a) => a.id === actorId);
    if (!actor) {
      res.status(404).json({ error: `Actor '${actorId}' not found` });
      return;
    }
    const rawText = typeof req.body?.text === 'string' ? req.body.text : req.body?.message;
    if (typeof rawText !== 'string' || !rawText.trim()) {
      res.status(400).json({ error: 'Requires non-empty text (or message) field' });
      return;
    }
    const validKinds: AgentMessageKind[] = ['status', 'claim', 'request', 'alert'];
    const kind: AgentMessageKind = validKinds.includes(req.body?.kind) ? req.body.kind : 'status';
    const targetId = typeof req.body?.targetId === 'string' ? req.body.targetId : undefined;
    const validChannels: ChannelId[] = ['A', 'B', 'C'];
    const channel: ChannelId | undefined = validChannels.includes(req.body?.channel) ? req.body.channel : undefined;

    const recorded = recordAgentMessage(engine.world, actorId, rawText, { kind, targetId, channel });
    actor.lastDecisionAt = Date.now();
    if (recorded) {
      engine.broadcastState();
    }
    res.status(201).json({
      ok: true,
      deduped: recorded === null,
      tick: engine.world.tick,
      message: recorded,
      messages: engine.world.messages,
    });
  });

  app.delete('/api/agents/:id', (req, res) => {
    const removed = engine.removeAgent(req.params.id);
    if (!removed) {
      res.status(404).json({ error: `Actor '${req.params.id}' not found` });
      return;
    }
    res.json({ removed: true, actorId: req.params.id });
  });

  app.post('/api/level/load', (req, res) => {
    const levelId = typeof req.body?.levelId === 'string' ? req.body.levelId : 'level-1';
    if (!LEVELS.some((l) => l.id === levelId)) {
      res.status(404).json({ error: `Unknown level '${levelId}'` });
      return;
    }
    engine.loadLevel(levelId, true, false);
    res.json({ loaded: true, levelId: engine.currentLevel.id, world: engine.world });
  });

  app.post('/api/sim/control', (req, res) => {
    const command = req.body?.command;
    if (typeof command !== 'string') {
      res.status(400).json({ error: 'Missing command' });
      return;
    }
    engine.handleControl(command as never, req.body?.value);
    res.json({ ok: true, tick: engine.world.tick, paused: engine.world.paused, timeScale: engine.world.timeScale });
  });

  app.post('/api/sim/physics', (req, res) => {
    if (typeof req.body?.preset === 'string') {
      const ok = applyPhysicsPreset(engine.world, req.body.preset);
      if (!ok) {
        res.status(400).json({ error: `Unknown preset '${req.body.preset}'` });
        return;
      }
      engine.broadcastState();
    } else {
      updateWorldPhysics(engine.world, req.body ?? {});
      engine.broadcastState();
    }
    res.json({ ok: true, physics: engine.world.physics, tick: engine.world.tick });
  });

  app.post('/api/sandbox/spawn', (req, res) => {
    const kind = req.body?.kind;
    const x = Number(req.body?.x ?? 480);
    const y = Number(req.body?.y ?? 200);
    if (typeof kind !== 'string' || !Number.isFinite(x) || !Number.isFinite(y)) {
      res.status(400).json({ error: 'Invalid spawn payload (requires kind, x, y)' });
      return;
    }
    const result = engine.handleSandbox({
      action: 'spawn',
      kind: kind as never,
      x,
      y,
      w: typeof req.body?.w === 'number' ? req.body.w : undefined,
      h: typeof req.body?.h === 'number' ? req.body.h : undefined,
      channel: req.body?.channel,
      vx: typeof req.body?.vx === 'number' ? req.body.vx : undefined,
      vy: typeof req.body?.vy === 'number' ? req.body.vy : undefined,
    });
    res.status(result.ok ? 201 : 400).json({ ...result, tick: engine.world.tick });
  });

  app.post('/api/sandbox/impulse', (req, res) => {
    if (typeof req.body?.entityId === 'string') {
      const result = engine.handleSandbox({
        action: 'fling',
        entityId: req.body.entityId,
        vx: Number(req.body?.vx ?? 0),
        vy: Number(req.body?.vy ?? -300),
      });
      res.status(result.ok ? 200 : 404).json({ ...result, tick: engine.world.tick });
      return;
    }
    const x = Number(req.body?.x ?? 480);
    const y = Number(req.body?.y ?? 420);
    const result = engine.handleSandbox({
      action: 'blast',
      x,
      y,
      radius: typeof req.body?.radius === 'number' ? req.body.radius : undefined,
      strength: typeof req.body?.strength === 'number' ? req.body.strength : undefined,
    });
    res.json({ ...result, tick: engine.world.tick });
  });

  app.patch('/api/sandbox/entity/:id', (req, res) => {
    const result = engine.handleSandbox({
      action: 'update_entity',
      entityId: req.params.id,
      patch: req.body ?? {},
    });
    res.status(result.ok ? 200 : 400).json({ ...result, tick: engine.world.tick });
  });

  app.post('/api/sandbox/update', (req, res) => {
    const entityId = typeof req.body?.entityId === 'string' ? req.body.entityId : '';
    if (!entityId) {
      res.status(400).json({ error: 'Missing entityId' });
      return;
    }
    const result = engine.handleSandbox({
      action: 'update_entity',
      entityId,
      patch: req.body?.patch ?? {},
    });
    res.status(result.ok ? 200 : 400).json({ ...result, tick: engine.world.tick });
  });

  app.post('/api/sandbox/wire', (req, res) => {
    const sourceId = typeof req.body?.sourceId === 'string' ? req.body.sourceId : '';
    const targetId = typeof req.body?.targetId === 'string' ? req.body.targetId : '';
    if (!sourceId || !targetId) {
      res.status(400).json({ error: 'Requires sourceId and targetId' });
      return;
    }
    const mode = req.body?.mode === 'attach' || req.body?.mode === 'detach' ? req.body.mode : 'toggle';
    const result = engine.handleSandbox({ action: 'toggle_wire', sourceId, targetId, mode });
    res.status(result.ok ? 200 : 400).json({ ...result, tick: engine.world.tick });
  });

  app.post('/api/sandbox/duplicate', (req, res) => {
    const entityId = typeof req.body?.entityId === 'string' ? req.body.entityId : '';
    if (!entityId) {
      res.status(400).json({ error: 'Missing entityId' });
      return;
    }
    const result = engine.handleSandbox({ action: 'duplicate', entityId });
    res.status(result.ok ? 201 : 400).json({ ...result, tick: engine.world.tick });
  });

  app.delete('/api/sandbox/entity/:id', (req, res) => {
    const result = engine.handleSandbox({ action: 'remove', entityId: req.params.id });
    res.status(result.ok ? 200 : 404).json(result);
  });

  app.post('/api/sandbox/clear', (_req, res) => {
    const result = engine.handleSandbox({ action: 'clear_spawned' });
    res.json({ ...result, tick: engine.world.tick });
  });

  app.get('/api/telemetry/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="relaylab-trace-${engine.world.levelId}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      level: {
        id: engine.currentLevel.id,
        name: engine.currentLevel.name,
      },
      summary: engine.world.metrics,
      events: engine.world.events,
      trace: engine.traceHistory,
    });
  });

  // Vite middleware in development, static files in production
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Drift-compensated fixed-rate simulation loop (60Hz)
  const tickIntervalMs = FIXED_DT * 1000;
  let nextTickAt = performance.now() + tickIntervalMs;
  const runTickLoop = () => {
    engine.tick();
    const now = performance.now();
    nextTickAt += tickIntervalMs;
    if (nextTickAt < now - 100) {
      nextTickAt = now + tickIntervalMs;
    }
    setTimeout(runTickLoop, Math.max(1, nextTickAt - now));
  };
  setTimeout(runTickLoop, tickIntervalMs);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`RelayLab centralized server listening on http://0.0.0.0:${PORT}`);
    // Spawn two real WebSocket collaborative agents by default so the arena is alive on first arrival
    setTimeout(() => {
      engine.spawnLocalAgent('Relay-Alpha');
      engine.spawnLocalAgent('Relay-Beta');
    }, 250);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
