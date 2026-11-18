import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevelById } from './levels';
import {
  applyPhysicsPreset,
  applySandboxAction,
  buildAgentObservation,
  createWorld,
  FIXED_DT,
  recordAgentMessage,
  stepWorld,
} from './physics';
import {
  buildNavigationGraph,
  buildShortestPathTree,
  buildWalkSegments,
  createAgentMemory,
  decideAgentAction,
  findPathToPoint,
  resolvePathFromTree,
} from './agentPlanner';
import type { ActorInput } from './types';

test('collaborating autonomous agents coordinate and solve Level 1 Dual Gate Relay', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [
    { id: 'agent-1', name: 'Relay-Alpha', role: 'agent' },
    { id: 'agent-2', name: 'Relay-Beta', role: 'agent' },
  ]);

  const mem1 = createAgentMemory();
  const mem2 = createAgentMemory();

  for (let tick = 0; tick < 1500 && !world.solved; tick++) {
    const obs1 = buildAgentObservation(world, 'agent-1')!;
    const obs2 = buildAgentObservation(world, 'agent-2')!;
    const in1: ActorInput = decideAgentAction(obs1, mem1);
    const in2: ActorInput = decideAgentAction(obs2, mem2);
    stepWorld(world, level, { 'agent-1': in1, 'agent-2': in2 }, FIXED_DT);
  }

  assert.equal(world.channels.B, true, 'Agents should collaborate to toggle Switch B');
  assert.equal(world.solved, true, 'Two autonomous agents should solve Level 1 collaboratively');
});

test('autonomous agents coordinate and fully solve Level 2 Crate Counterweight without oscillation loops', () => {
  const level = getLevelById('level-2');
  const world = createWorld(level, [
    { id: 'agent-1', name: 'Crate-Master', role: 'agent' },
    { id: 'agent-2', name: 'Lever-Operator', role: 'agent' },
  ]);

  const mem1 = createAgentMemory();
  const mem2 = createAgentMemory();

  for (let tick = 0; tick < 2000 && !world.solved; tick++) {
    const obs1 = buildAgentObservation(world, 'agent-1')!;
    const obs2 = buildAgentObservation(world, 'agent-2')!;
    const in1: ActorInput = decideAgentAction(obs1, mem1);
    const in2: ActorInput = decideAgentAction(obs2, mem2);
    stepWorld(world, level, { 'agent-1': in1, 'agent-2': in2 }, FIXED_DT);
  }

  assert.equal(world.channels.B, true, 'Lift Lever B should be activated');
  assert.equal(world.channels.A, true, 'Crate 1 should weight Plate A open');
  assert.equal(world.solved, true, 'Two autonomous agents should solve Level 2 completely');
  assert.equal(world.metrics.respawns, 0, 'Agents must not walk or jump into the plasma strip');
});

test('autonomous agents ride shaft lift and collaborate to solve Level 3 Lift & Boost', () => {
  const level = getLevelById('level-3');
  const world = createWorld(level, [
    { id: 'agent-1', name: 'Lift-Pilot', role: 'agent' },
    { id: 'agent-2', name: 'Switch-Runner', role: 'agent' },
  ]);

  const mem1 = createAgentMemory();
  const mem2 = createAgentMemory();

  for (let tick = 0; tick < 2400 && !world.solved; tick++) {
    const obs1 = buildAgentObservation(world, 'agent-1')!;
    const obs2 = buildAgentObservation(world, 'agent-2')!;
    const in1: ActorInput = decideAgentAction(obs1, mem1);
    const in2: ActorInput = decideAgentAction(obs2, mem2);
    stepWorld(world, level, { 'agent-1': in1, 'agent-2': in2 }, FIXED_DT);
  }

  assert.equal(world.channels.A, true, 'Crate 1 should activate Plate A for shaft lift');
  assert.equal(world.channels.C, true, 'Switch C should be toggled on upper deck');
  assert.equal(world.solved, true, 'Two autonomous agents should solve Level 3 completely');
});

test('autonomous agents coordinate dual crates and ferry to solve Level 4 Tri-Channel Vault', () => {
  const level = getLevelById('level-4');
  const world = createWorld(level, [
    { id: 'agent-1', name: 'Ferry-Lead', role: 'agent' },
    { id: 'agent-2', name: 'Vault-Tech', role: 'agent' },
  ]);

  const mem1 = createAgentMemory();
  const mem2 = createAgentMemory();

  for (let tick = 0; tick < 2400 && !world.solved; tick++) {
    const obs1 = buildAgentObservation(world, 'agent-1')!;
    const obs2 = buildAgentObservation(world, 'agent-2')!;
    const in1: ActorInput = decideAgentAction(obs1, mem1);
    const in2: ActorInput = decideAgentAction(obs2, mem2);
    stepWorld(world, level, { 'agent-1': in1, 'agent-2': in2 }, FIXED_DT);
  }

  assert.equal(world.channels.A, true, 'Channel A should remain weighted by Crate 1');
  assert.equal(world.channels.C, true, 'Channel C should be weighted by Crate 2');
  assert.equal(world.solved, true, 'Two autonomous agents should solve Level 4 completely');
});

test('agent switches intent to Exit immediately when exit unlocks', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [
    { id: 'agent-1', name: 'Relay-Alpha', role: 'agent' },
  ]);
  world.switches[0].active = true;
  world.channels.B = true;
  stepWorld(world, level, {}, FIXED_DT);

  const obs = buildAgentObservation(world, 'agent-1')!;
  const decision = decideAgentAction(obs, createAgentMemory());

  assert.equal(decision.intent, 'Move to Exit Pad');
  assert.equal(decision.targetId, world.exit.id);
});

test('autonomous agents adapt and solve level when gate and exit are wired directly via linkedIds without channels', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [
    { id: 'agent-1', name: 'Wire-Alpha', role: 'agent' },
    { id: 'agent-2', name: 'Wire-Beta', role: 'agent' },
  ]);

  // Strip channels from all doors and exit, then wire Plate A + Switch B directly via linkedIds (ANY on Gate A, ALL on Gate B & Exit)
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: 'door-a',
    patch: { channels: [], linkedIds: [], logic: 'ANY' },
  });
  applySandboxAction(world, level, {
    action: 'toggle_wire',
    sourceId: 'plate-a',
    targetId: 'door-a',
    mode: 'attach',
  });
  applySandboxAction(world, level, {
    action: 'toggle_wire',
    sourceId: 'switch-b',
    targetId: 'door-a',
    mode: 'attach',
  });
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: 'door-b',
    patch: { channels: [], linkedIds: [] },
  });
  applySandboxAction(world, level, {
    action: 'toggle_wire',
    sourceId: 'switch-b',
    targetId: 'door-b',
    mode: 'attach',
  });
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: 'exit-1',
    patch: { requiredChannels: [], linkedIds: [] },
  });
  applySandboxAction(world, level, {
    action: 'toggle_wire',
    sourceId: 'switch-b',
    targetId: 'exit-1',
    mode: 'attach',
  });

  const mem1 = createAgentMemory();
  const mem2 = createAgentMemory();

  for (let tick = 0; tick < 1600 && !world.solved; tick++) {
    const obs1 = buildAgentObservation(world, 'agent-1')!;
    const obs2 = buildAgentObservation(world, 'agent-2')!;
    const in1: ActorInput = decideAgentAction(obs1, mem1);
    const in2: ActorInput = decideAgentAction(obs2, mem2);
    stepWorld(world, level, { 'agent-1': in1, 'agent-2': in2 }, FIXED_DT);
  }

  assert.equal(world.doors.find((d) => d.id === 'door-a')!.open, true);
  assert.equal(world.doors.find((d) => d.id === 'door-b')!.open, true);
  assert.equal(world.solved, true, 'Agents should adapt to direct linkedIds gate & exit wiring and solve');
});

test('agents respect exit.linkedIds momentary plate safety and wait for crate or teammate hold', () => {
  const level = getLevelById('level-2');
  const world = createWorld(level, [
    { id: 'agent-1', name: 'Relay-Alpha', role: 'agent' },
    { id: 'agent-2', name: 'Relay-Beta', role: 'agent' },
  ]);

  // Wire Plate A (momentary) directly to Exit via linkedIds without requiredChannels
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: world.exit.id,
    patch: { requiredChannels: [], linkedIds: ['plate-a'], logic: 'ALL' },
  });

  // Agent 1 stands on Plate A directly (no crate on it yet) -> exit is temporarily unlocked,
  // but Agent 1 must NOT leave Plate A un-weighted by a crate to walk to the exit.
  const plateA = world.plates.find((p) => p.id === 'plate-a')!;
  world.actors[0].x = plateA.x + 12;
  world.actors[0].y = plateA.y - world.actors[0].h;
  world.actors[0].grounded = true;
  stepWorld(world, level, {}, FIXED_DT);

  const obs1 = buildAgentObservation(world, 'agent-1')!;
  assert.equal(obs1.exit.unlocked, true);
  const d1 = decideAgentAction(obs1, createAgentMemory());
  assert.notEqual(
    d1.intent,
    'Move to Exit Pad',
    'Agent must not abandon directly wired momentary Plate A to head to Exit'
  );
});

test('standing-wall splitting prevents walking straight through narrow walls and routes jump over wall top', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [{ id: 'agent-1', name: 'Wall-Jumper', role: 'agent' }]);

  // Add a standing 20x52 divider wall in open floor space (left of step-1 at x=240)
  world.platforms.push({
    id: 'test-standing-wall',
    x: 110,
    y: 440,
    w: 20,
    h: 52,
    kind: 'solid',
    material: 'standard',
    progress: 0,
    direction: 1,
    vx: 0,
    vy: 0,
    compression: 0,
  });
  stepWorld(world, level, {}, FIXED_DT);

  const obs = buildAgentObservation(world, 'agent-1')!;
  const segments = buildWalkSegments(obs);
  const floorSplits = segments.filter((s) => s.sourceId === 'floor-main');
  assert.ok(
    floorSplits.length >= 2,
    `Standing wall must split floor-main into separate walk segments (found ${floorSplits.length})`
  );

  const graph = buildNavigationGraph(obs);
  const path = findPathToPoint(obs, graph, { x: 60, y: 492 }, { x: 180, y: 492 });
  assert.equal(path.reachable, true, 'Target on opposite side of jumpable wall should remain reachable');
  assert.ok(
    path.waypoints.some((w) => w.mode === 'jump' || w.y <= 442),
    'Path around standing wall must include jump transition or wall-top waypoint'
  );
});

test('physics-aware trajectory validator adapts reachability to Moon vs Heavy gravity and supports upward crate carrying', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [{ id: 'agent-1', name: 'Astro-Bot', role: 'agent' }]);

  // Spawn an elevated shelf 175px above main floor and 115px above step-1 — impossible in 1350g, reachable in 260g Moon preset
  const shelfRes = applySandboxAction(world, level, {
    action: 'spawn',
    kind: 'platform_solid',
    x: 76,
    y: 325,
    w: 80,
  });
  assert.equal(shelfRes.ok, true);
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: shelfRes.entityId!,
    patch: { x: 36, y: 317, w: 80, h: 16 },
  });
  stepWorld(world, level, {}, FIXED_DT);

  const obsEarth = buildAgentObservation(world, 'agent-1')!;
  const graphEarth = buildNavigationGraph(obsEarth);
  const earthPath = findPathToPoint(obsEarth, graphEarth, { x: 76, y: 492 }, { x: 76, y: 317 });
  assert.equal(earthPath.reachable, false, '175px vertical ledge must be unreachable under standard gravity');

  // Switch to Moon low-gravity preset (gravity=260)
  applyPhysicsPreset(world, 'moon');
  stepWorld(world, level, {}, FIXED_DT);
  const obsMoon = buildAgentObservation(world, 'agent-1')!;
  const graphMoon = buildNavigationGraph(obsMoon);
  const moonPath = findPathToPoint(obsMoon, graphMoon, { x: 76, y: 492 }, { x: 76, y: 317 });
  assert.equal(moonPath.reachable, true, '175px vertical ledge becomes reachable under Moon gravity');

  // Restore Earth gravity and verify agent carries floor crate UP onto an elevated Plate A
  applyPhysicsPreset(world, 'earth');
  const plateA = world.plates.find((p) => p.id === 'plate-a')!;
  const step1 = world.platforms.find((p) => p.id === 'step-1')!;
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: plateA.id,
    patch: { x: step1.x + 12, y: step1.y - 12 },
  });
  const crateRes = applySandboxAction(world, level, {
    action: 'spawn',
    kind: 'crate_wood',
    x: 140,
    y: 455,
  });
  assert.equal(crateRes.ok, true);

  const mem = createAgentMemory();
  for (let tick = 0; tick < 600 && !plateA.active; tick++) {
    const obs = buildAgentObservation(world, 'agent-1')!;
    const input = decideAgentAction(obs, mem);
    stepWorld(world, level, { 'agent-1': input }, FIXED_DT);
  }
  assert.equal(plateA.active, true, 'Agent should carry floor crate upward onto elevated Plate A');
});

test('built-in agent honors external drop-in agent claim & request messages in obs.messages', () => {
  const level = getLevelById('level-2');
  const world = createWorld(level, [
    { id: 'ext-gemini', name: 'Gemini-Lead', role: 'agent' },
    { id: 'bot-1', name: 'Relay-Alpha', role: 'agent' },
  ]);

  // Place external Gemini closer to Crate 1 and broadcast a claim message for crate-1
  const crate1 = world.crates.find((c) => c.id === 'crate-1')!;
  world.actors[0].x = crate1.x - 16;
  world.actors[0].y = 492 - world.actors[0].h;
  world.actors[0].grounded = true;
  world.actors[1].x = 420;
  world.actors[1].y = 492 - world.actors[1].h;
  world.actors[1].grounded = true;

  recordAgentMessage(world, 'ext-gemini', 'Claiming Crate 1 for Plate A', {
    kind: 'claim',
    targetId: 'crate-1',
    channel: 'A',
  });
  recordAgentMessage(world, 'ext-gemini', 'Need Channel B lift lever toggled', {
    kind: 'request',
    targetId: 'switch-b',
    channel: 'B',
  });

  stepWorld(
    world,
    level,
    {
      'ext-gemini': {
        move: -1,
        jump: false,
        interact: false,
        intent: 'Take Crate 1',
        claimTargetId: 'crate-1',
      },
    },
    FIXED_DT
  );

  const obsBot = buildAgentObservation(world, 'bot-1')!;
  const dBot = decideAgentAction(obsBot, createAgentMemory());
  assert.notEqual(
    dBot.targetId,
    'crate-1',
    'Built-in bot must defer crate-1 claimed by external drop-in Gemini agent'
  );
  assert.equal(
    dBot.targetId,
    'switch-b',
    'Built-in bot should pick up the unblocked Channel B request target'
  );
});




test('sandbox navigation reaches Switch B and Plate A via updraft edges', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [{ id: 'agent-1', name: 'Scout', role: 'agent' }]);
  const obs = buildAgentObservation(world, 'agent-1')!;
  const graph = buildNavigationGraph(obs);
  const tree = buildShortestPathTree(graph, { x: obs.self.x + 13, y: obs.self.y + 34 });
  const switchB = obs.switches.find((s) => s.label === 'Switch B')!;
  const switchPath = resolvePathFromTree(obs, tree, {
    x: switchB.x + switchB.w * 0.5,
    y: switchB.y + switchB.h,
  });
  assert.equal(switchPath.reachable, true, 'Switch B should be reachable through the sandbox updraft route');
  const plateA = obs.plates.find((p) => p.label === 'Plate A')!;
  const platePath = resolvePathFromTree(obs, tree, {
    x: plateA.x + plateA.w * 0.5,
    y: plateA.y + plateA.h,
  });
  assert.equal(platePath.reachable, true, 'Plate A should be reachable on the sandbox floor');
});


test('autonomous agents solve Physics Sandbox using the updraft and stacked crate route', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [
    { id: 'agent-1', name: 'Sandbox-A', role: 'agent' },
    { id: 'agent-2', name: 'Sandbox-B', role: 'agent' },
  ]);
  const mem1 = createAgentMemory();
  const mem2 = createAgentMemory();

  for (let tick = 0; tick < 2200 && !world.solved; tick++) {
    const obs1 = buildAgentObservation(world, 'agent-1')!;
    const obs2 = buildAgentObservation(world, 'agent-2')!;
    stepWorld(
      world,
      level,
      {
        'agent-1': decideAgentAction(obs1, mem1),
        'agent-2': decideAgentAction(obs2, mem2),
      },
      FIXED_DT
    );
  }

  assert.equal(world.solved, true, 'Two autonomous agents should solve the sandbox');
  assert.equal(world.channels.A, true);
  assert.equal(world.channels.B, true);
});


test('autonomous agents solve Level 5 Cascade Foundry', () => {
  const level = getLevelById('level-5');
  const world = createWorld(level, [
    { id: 'agent-1', name: 'Foundry-A', role: 'agent' },
    { id: 'agent-2', name: 'Foundry-B', role: 'agent' },
  ]);
  const mem1 = createAgentMemory();
  const mem2 = createAgentMemory();

  for (let tick = 0; tick < 1500 && !world.solved; tick++) {
    const obs1 = buildAgentObservation(world, 'agent-1')!;
    const obs2 = buildAgentObservation(world, 'agent-2')!;
    stepWorld(
      world,
      level,
      {
        'agent-1': decideAgentAction(obs1, mem1),
        'agent-2': decideAgentAction(obs2, mem2),
      },
      FIXED_DT
    );
  }

  assert.equal(world.solved, true, 'Two autonomous agents should solve Cascade Foundry');
  assert.equal(world.channels.A, true);
  assert.equal(world.channels.B, true);
  assert.equal(world.channels.C, true);
  assert.equal(world.metrics.respawns, 0, 'Agents must not jump into the foundry plasma');
});
