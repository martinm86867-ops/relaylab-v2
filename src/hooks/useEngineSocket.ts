import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActorInput,
  ActorRole,
  AgentMessageKind,
  ClientWsMessage,
  PhysicsConfig,
  SandboxAction,
  ServerWsMessage,
  WorldState,
} from '../engine/types';

export interface EngineConnectionState {
  world: WorldState | null;
  worldRef: React.RefObject<WorldState | null>;
  connected: boolean;
  clientId: string | null;
  assignedActorId: string | null;
  role: ActorRole | 'observer';
  latencyMs: number;
  registerRole: (role: ActorRole | 'observer', name?: string) => void;
  sendInput: (actorId: string, input: ActorInput) => void;
  sendControl: (
    command: Extract<ClientWsMessage, { type: 'control' }>['command'],
    value?: number | string | boolean | Partial<PhysicsConfig>
  ) => void;
  sendSandbox: (payload: SandboxAction) => void;
  sendMessage: (actorId: string | null | undefined, text: string, kind?: AgentMessageKind) => void;
}

export function useEngineSocket(): EngineConnectionState {
  const [world, setWorld] = useState<WorldState | null>(null);
  const worldRef = useRef<WorldState | null>(null);
  const lastUiSyncRef = useRef<number>(0);
  const lastDiscreteSigRef = useRef<string>('');

  const [connected, setConnected] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [assignedActorId, setAssignedActorId] = useState<string | null>(null);
  const [role, setRole] = useState<ActorRole | 'observer'>('observer');
  const [latencyMs, setLatencyMs] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const desiredRoleRef = useRef<{ role: ActorRole | 'observer'; name?: string }>({
    role: 'observer',
  });
  const reconnectTimerRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<number | null>(null);

  const applyWorldFrame = useCallback((nextWorld: WorldState, forceSync = false) => {
    worldRef.current = nextWorld;
    const doorSig = nextWorld.doors.map((d) => (d.open ? '1' : '0')).join('');
    const lastMsgId = nextWorld.messages?.[nextWorld.messages.length - 1]?.id ?? '';
    const discreteSig = `${nextWorld.levelId}|${nextWorld.tick === 0 ? 0 : 1}|${nextWorld.paused}|${nextWorld.solved}|${nextWorld.solvedAtTick ?? ''}|${nextWorld.channels.A ? 1 : 0}${nextWorld.channels.B ? 1 : 0}${nextWorld.channels.C ? 1 : 0}|${doorSig}|${nextWorld.actors.length}|${nextWorld.crates.length}|${nextWorld.platforms.length}|${nextWorld.forceZones?.length ?? 0}|${nextWorld.physics?.gravity ?? 0}|${nextWorld.physics?.restitution ?? 0}|${nextWorld.physics?.surfaceFriction ?? 0}|${nextWorld.timeScale}|${nextWorld.events.length}|${nextWorld.messages?.length ?? 0}:${lastMsgId}`;
    const now = performance.now();
    if (
      forceSync ||
      discreteSig !== lastDiscreteSigRef.current ||
      now - lastUiSyncRef.current >= 100
    ) {
      lastDiscreteSigRef.current = discreteSig;
      lastUiSyncRef.current = now;
      setWorld(nextWorld);
    }
  }, []);

  const sendRaw = useCallback((msg: ClientWsMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (desiredRoleRef.current.role !== 'observer') {
        ws.send(
          JSON.stringify({
            type: 'register',
            role: desiredRoleRef.current.role,
            name: desiredRoleRef.current.name,
          } satisfies ClientWsMessage)
        );
      }
      if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', clientTime: Date.now() } satisfies ClientWsMessage));
        }
      }, 2000);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as ServerWsMessage;
        if (msg.type === 'welcome') {
          setClientId(msg.clientId);
          setAssignedActorId(msg.assignedActorId);
          setRole(msg.role);
          applyWorldFrame(msg.world, true);
        } else if (msg.type === 'state') {
          applyWorldFrame(msg.world, false);
        } else if (msg.type === 'pong') {
          setLatencyMs(Math.max(0, Date.now() - msg.clientTime));
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingIntervalRef.current) {
        window.clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, 1000);
    };
  }, [applyWorldFrame]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (pingIntervalRef.current) window.clearInterval(pingIntervalRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const registerRole = useCallback(
    (nextRole: ActorRole | 'observer', name?: string) => {
      desiredRoleRef.current = { role: nextRole, name };
      setRole(nextRole);
      sendRaw({ type: 'register', role: nextRole, name });
    },
    [sendRaw]
  );

  const sendInput = useCallback(
    (actorId: string, input: ActorInput) => {
      sendRaw({ type: 'input', actorId, input });
    },
    [sendRaw]
  );

  const sendControl = useCallback(
    (
      command: Extract<ClientWsMessage, { type: 'control' }>['command'],
      value?: number | string | boolean | Partial<PhysicsConfig>
    ) => {
      sendRaw({ type: 'control', command, value });
    },
    [sendRaw]
  );

  const sendSandbox = useCallback(
    (payload: SandboxAction) => {
      sendRaw({ type: 'sandbox', payload });
    },
    [sendRaw]
  );

  const sendMessage = useCallback(
    (actorId: string | null | undefined, text: string, kind?: AgentMessageKind) => {
      const clean = text.trim();
      if (!clean) return;
      sendRaw({ type: 'message', actorId: actorId ?? undefined, text: clean, kind });
    },
    [sendRaw]
  );

  return {
    world,
    worldRef,
    connected,
    clientId,
    assignedActorId,
    role,
    latencyMs,
    registerRole,
    sendInput,
    sendControl,
    sendSandbox,
    sendMessage,
  };
}
