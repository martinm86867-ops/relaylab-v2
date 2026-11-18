import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentObservation } from '../../engine/types';
import { buildLlmContext } from './context';
import { LlmDecisionError, parseDecision } from './decision';

function fixture(): AgentObservation {
  return {
    tick: 420,
    levelId: 'level-1',
    isSandbox: false,
    solved: false,
    physics: {} as AgentObservation['physics'],
    self: {
      id: 'agent-llm-1',
      name: 'Nova',
      x: 120,
      y: 430,
      vx: 0,
      vy: 0,
      grounded: true,
      onExit: false,
      facing: 1,
      holdingCrateId: null,
    },
    teammates: [
      {
        id: 'agent-bot-1',
        name: 'Relay-Alpha',
        role: 'agent',
        x: 400,
        y: 300,
        vx: 0,
        vy: 0,
        grounded: true,
        onExit: false,
        intent: 'Hold plate A',
      },
    ],
    channels: { A: false, B: false, C: false },
    plates: [
      {
        id: 'plate-a',
        label: 'Plate A',
        x: 100,
        y: 440,
        w: 60,
        h: 10,
        channel: 'A',
        mode: 'momentary',
        active: false,
        pressedBy: [],
      },
    ],
    switches: [
      {
        id: 'switch-b',
        label: 'Switch B',
        x: 620,
        y: 280,
        w: 24,
        h: 18,
        channel: 'B',
        active: false,
      },
    ],
    doors: [],
    crates: [],
    platforms: [],
    hazards: [],
    forceZones: [],
    messages: [
      {
        id: 'msg-1',
        tick: 400,
        timestamp: 1,
        actorId: 'agent-bot-1',
        actorLabel: 'A1',
        actorName: 'Relay-Alpha',
        actorColor: '#F59E0B',
        text: 'Holding A',
        kind: 'status',
      },
    ],
    exit: {
      id: 'exit-1',
      x: 860,
      y: 420,
      w: 60,
      h: 80,
      requiredChannels: ['A', 'B'],
      unlocked: false,
    },
    level: {
      id: 'level-1',
      name: '01. Dual Gate Relay',
      subtitle: 'Hold A, switch B.',
      hint: 'Coordinate.',
      isSandbox: false,
    },
    clock: { tick: 420, seconds: 7, paused: false, timeScale: 1 },
    metrics: { actorsAtExit: 0, totalActors: 2, decisionsLogged: 3, solvedAtTick: null },
    recentEvents: [],
  };
}

test('hybrid decision accepts a known target and clamps the horizon', () => {
  const obs = fixture();
  const decision = parseDecision(
    JSON.stringify({
      intent: 'Use switch B',
      claimTargetId: 'switch-b',
      say: { text: 'Taking B', kind: 'claim', targetId: 'switch-b' },
      action: { type: 'use', targetId: 'switch-b', durationMs: 99999 },
      reason: 'Channel B is open.',
    }),
    obs,
    'hybrid'
  );
  assert.equal(decision.action.type, 'use');
  assert.equal(decision.action.targetId, 'switch-b');
  assert.equal(decision.action.durationMs, 3000);
  assert.equal(decision.claimTargetId, 'switch-b');
  assert.equal(decision.say?.kind, 'claim');
});

test('fenced JSON is accepted and goto coordinates are clamped', () => {
  const decision = parseDecision(
    '```json\n{"intent":"Go","action":{"type":"goto","x":2000,"y":-50,"durationMs":100},"reason":"Move."}\n```',
    fixture(),
    'hybrid'
  );
  assert.equal(decision.action.type, 'goto');
  assert.equal(decision.action.x, 940);
  assert.equal(decision.action.y, 20);
  assert.equal(decision.action.durationMs, 400);
});

test('unknown entity ids are rejected', () => {
  assert.throws(
    () =>
      parseDecision(
        '{"intent":"Use","action":{"type":"use","targetId":"ghost"},"reason":"x"}',
        fixture(),
        'hybrid'
      ),
    LlmDecisionError
  );
});

test('direct mode rejects higher-level commands', () => {
  assert.throws(
    () =>
      parseDecision(
        '{"intent":"Use","action":{"type":"use","targetId":"switch-b"},"reason":"x"}',
        fixture(),
        'direct'
      ),
    LlmDecisionError
  );
  const raw = parseDecision(
    '{"intent":"Walk","action":{"type":"raw","move":1,"jump":false,"interact":false,"grab":false},"reason":"x"}',
    fixture(),
    'direct'
  );
  assert.equal(raw.action.type, 'raw');
  assert.equal(raw.action.move, 1);
});

test('context carries level metadata and omits server internals', () => {
  const context = buildLlmContext(fixture(), { controlMode: 'hybrid' });
  assert.equal(context.level.name, '01. Dual Gate Relay');
  assert.equal(context.clock.tick, 420);
  assert.equal(context.objective.exit.requiredChannels.join(','), 'A,B');
  assert.equal(context.messages.length, 1);
  assert.equal(context.knownEntityIds.includes('switch-b'), true);
  assert.equal('physics' in context, false);
});
