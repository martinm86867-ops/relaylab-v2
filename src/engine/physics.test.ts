import test from 'node:test';
import assert from 'node:assert/strict';
import { getLevelById } from './levels';
import {
  buildAgentObservation,
  createWorld,
  FIXED_DT,
  softResetWorld,
  stepWorld,
  applyPhysicsPreset,
  applySandboxAction,
  recordAgentMessage,
} from './physics';
import type { ActorInput } from './types';

test('actors fall under gravity and land solidly on floor', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);
  const startY = world.actors[0].y;

  for (let i = 0; i < 60; i++) {
    stepWorld(world, level, {}, FIXED_DT);
  }

  const actor = world.actors[0];
  assert.ok(actor.y > startY, 'Actor should fall downward onto floor');
  assert.equal(actor.grounded, true, 'Actor should be grounded after landing');
  assert.equal(Math.round(actor.y + actor.h), 492, 'Actor feet should rest on floor y=492');
});

test('pressure plate opens linked door and channels update in real time', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [
    { id: 'a1', name: 'Agent-1', role: 'agent' },
    { id: 'a2', name: 'Agent-2', role: 'agent' },
  ]);

  // Initially Gate A is closed
  const doorA = world.doors.find((d) => d.id === 'door-a')!;
  assert.equal(doorA.open, false);
  assert.equal(world.channels.A, false);

  // Move Agent-1 onto Plate A (x=130..194, y=480)
  const plateA = world.plates.find((p) => p.id === 'plate-a')!;
  world.actors[0].x = plateA.x + 10;
  world.actors[0].y = plateA.y - world.actors[0].h;

  stepWorld(world, level, {}, FIXED_DT);

  assert.equal(plateA.active, true);
  assert.equal(world.channels.A, true);
  assert.equal(doorA.open, true);
});

test('pushing crate onto plate activates channel and frees actor', () => {
  const level = getLevelById('level-2');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);

  const crate = world.crates[0];
  const plateA = world.plates[0];

  // Place crate and actor on floor just to the left of Plate A
  crate.x = plateA.x - crate.w - 4;
  crate.y = 492 - crate.h;
  world.actors[0].x = crate.x - world.actors[0].w - 2;
  world.actors[0].y = 492 - world.actors[0].h;

  const inputs: Record<string, ActorInput> = {
    p1: { move: 1, jump: false, interact: false },
  };

  for (let i = 0; i < 20; i++) {
    stepWorld(world, level, inputs, FIXED_DT);
  }

  assert.equal(plateA.active, true, 'Crate pushed onto Plate A should activate it');
  assert.equal(world.channels.A, true);
});

test('landing on a kinetic ball transfers momentum and rolls it', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);
  const ball = world.crates.find((c) => c.shape === 'ball')!;
  const actor = world.actors[0];

  ball.x = 300;
  ball.y = 492 - ball.h;
  ball.vx = 0;
  ball.vy = 0;
  ball.angle = 0;
  ball.angularVel = 0;
  actor.x = ball.x + ball.w / 2 - actor.w / 2;
  actor.y = ball.y - 120;
  actor.vx = 0;
  actor.vy = 0;
  actor.grounded = false;
  const startX = ball.x;
  let peakSpeed = 0;
  let minActorVy = 0;

  for (let i = 0; i < 90; i++) {
    stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: false } }, FIXED_DT);
    peakSpeed = Math.max(peakSpeed, Math.abs(ball.vx));
    minActorVy = Math.min(minActorVy, actor.vy);
  }

  assert.ok(Math.abs(ball.x - startX) > 8, 'Ball should roll away from the landing point');
  assert.ok(peakSpeed > 80, 'Landing should impart a meaningful horizontal impulse to the ball');
  assert.ok(world.metrics.collisionCount >= 1, 'Landing should count as a collision');
  assert.ok(minActorVy < -80, 'Rubber ball should bounce the actor back upward');
});

test('a rolling ball shoves an idle actor instead of passing through', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);
  const ball = world.crates.find((c) => c.shape === 'ball')!;
  const actor = world.actors[0];

  // Clear the floor for a clean ground-level collision test.
  for (const p of world.platforms) {
    if (!['floor-main', 'wall-left', 'wall-right', 'ceil-top'].includes(p.id)) {
      p.x = 4000;
      p.y = 2000;
    }
  }
  for (const c of world.crates) {
    if (c.id !== ball.id) {
      c.x = 4000;
      c.y = 2000;
    }
  }

  ball.x = 300;
  ball.y = 492 - ball.h;
  ball.vx = 260;
  ball.vy = 0;
  ball.grounded = true;
  actor.x = 360;
  actor.y = 492 - actor.h;
  actor.vx = 0;
  actor.vy = 0;
  actor.grounded = true;
  const startActorX = actor.x;

  for (let i = 0; i < 25; i++) {
    stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: false } }, FIXED_DT);
  }

  assert.ok(actor.x > startActorX + 8, 'Rolling ball should shove the idle actor sideways');
  assert.ok(ball.vx < 260, 'Shoving the actor should slow the ball');
  assert.ok(
    !(actor.x < ball.x + ball.w && actor.x + actor.w > ball.x && actor.y < ball.y + ball.h && actor.y + actor.h > ball.y),
    'Actor and ball must not remain overlapped'
  );
});

test('sandbox level loads with multiple materials, force zones, and kinetic ball', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);

  assert.equal(world.isSandbox, true);
  assert.ok(world.crates.length >= 4);
  assert.ok(world.forceZones.length >= 1);

  // Test spawning a new crate via sandbox action
  const res = applySandboxAction(world, level, {
    action: 'spawn',
    kind: 'crate_steel',
    x: 500,
    y: 300,
  });
  assert.equal(res.ok, true);
  assert.ok(world.crates.some((c) => c.material === 'steel'));
});

test('physics presets update world gravity and restitution correctly', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, []);

  applyPhysicsPreset(world, 'moon');
  assert.equal(world.physics.gravity, 260);
  assert.equal(world.physics.restitution, 0.45);

  applyPhysicsPreset(world, 'earth');
  assert.equal(world.physics.gravity, 1450);
});

test('puzzle solves only when exit channel active and all actors occupy exit zone', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [
    { id: 'p1', name: 'Human', role: 'human' },
    { id: 'a1', name: 'Agent-1', role: 'agent' },
  ]);

  // Put both actors inside exit zone, but Switch B is OFF
  for (const actor of world.actors) {
    actor.x = world.exit.x + 10;
    actor.y = world.exit.y + 10;
  }
  stepWorld(world, level, {}, FIXED_DT);
  assert.equal(world.solved, false, 'Exit should remain locked without Channel B');

  // Move both out, toggle Switch B via actor 0 interaction
  world.actors[1].x = 100;
  world.actors[1].y = 458;
  const swB = world.switches.find((s) => s.id === 'switch-b')!;
  world.actors[0].x = swB.x;
  world.actors[0].y = swB.y;
  stepWorld(
    world,
    level,
    { p1: { move: 0, jump: false, interact: true } },
    FIXED_DT
  );
  assert.equal(world.channels.B, true, 'Switch B interaction should activate Channel B');

  // Put only actor 0 on exit -> not solved yet
  world.actors[0].x = world.exit.x + 10;
  world.actors[0].y = world.exit.y + 10;
  stepWorld(world, level, {}, FIXED_DT);
  assert.equal(world.solved, false, 'Requires all actors on exit');

  // Both on exit -> solved
  world.actors[1].x = world.exit.x + 24;
  world.actors[1].y = world.exit.y + 10;
  stepWorld(world, level, {}, FIXED_DT);
  assert.equal(world.solved, true, 'Puzzle should solve when all actors reach unlocked exit');
});

test('buildAgentObservation omits hidden server internals and reflects live state', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [
    { id: 'p1', name: 'Human', role: 'human' },
    { id: 'a1', name: 'Agent-1', role: 'agent' },
  ]);
  stepWorld(world, level, {}, FIXED_DT);
  const obs = buildAgentObservation(world, 'a1');
  assert.ok(obs !== null);
  assert.equal(obs.self.id, 'a1');
  assert.equal(obs.teammates.length, 1);
  assert.equal(obs.teammates[0].id, 'p1');
  assert.equal(obs.doors.length, 2);
});

test('grab toggle picks up crate, gently drops when stationary, and throws when moving', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);
  const crate = world.crates[0];
  world.actors[0].x = crate.x - 10;
  world.actors[0].y = 492 - world.actors[0].h;
  world.actors[0].grounded = true;

  // Grab crate
  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: true } }, FIXED_DT);
  assert.equal(world.actors[0].holdingCrateId, crate.id, 'Should hold nearest crate');

  // Release grab edge, then drop while stationary on ground -> gentle drop
  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: false } }, FIXED_DT);
  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: true } }, FIXED_DT);
  assert.equal(world.actors[0].holdingCrateId, null, 'Should release crate');
  assert.ok(Math.abs(crate.vx) < 25, 'Stationary drop should not fling crate horizontally');

  // Pick up again and throw while running right
  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: false } }, FIXED_DT);
  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: true } }, FIXED_DT);
  const reHeld = world.crates.find((c) => c.id === world.actors[0].holdingCrateId)!;
  stepWorld(world, level, { p1: { move: 1, jump: false, interact: false, grab: false } }, FIXED_DT);
  stepWorld(world, level, { p1: { move: 1, jump: false, interact: false, grab: true } }, FIXED_DT);
  assert.ok(reHeld.vx > 120, 'Moving throw should impart strong forward velocity');
});

test('picked crate is centered above the actor and set down on the floor ahead', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);
  const crate = world.crates[0];
  const actor = world.actors[0];
  actor.x = crate.x - 10;
  actor.y = 492 - actor.h;
  actor.grounded = true;

  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: true } }, FIXED_DT);
  assert.equal(actor.holdingCrateId, crate.id, 'Should pick up the nearby crate');
  assert.ok(
    Math.abs(crate.x + crate.w * 0.5 - (actor.x + actor.w * 0.5)) < 0.6,
    'Carried crate must be horizontally centered on the actor'
  );
  assert.ok(
    crate.y + crate.h <= actor.y - 5,
    'Carried crate must sit above the actor crown with visible hand clearance'
  );

  // Second press with no movement sets it down.
  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: false } }, FIXED_DT);
  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: true } }, FIXED_DT);
  assert.equal(actor.holdingCrateId, null, 'Second press releases the crate');
  assert.ok(
    Math.abs(crate.y + crate.h - (actor.y + actor.h)) < 0.6,
    'Stationary release should set the crate on the floor'
  );
  assert.ok(crate.x > actor.x, 'Stationary release should set the crate down ahead of the actor');
});

test('grab reach rejects a crate too far above the actor', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);
  const crate = world.crates[0];
  world.crates = [crate];
  const actor = world.actors[0];
  actor.x = crate.x;
  actor.y = 458;
  actor.grounded = true;
  crate.x = actor.x;
  crate.y = actor.y - 90;

  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: true } }, FIXED_DT);
  assert.equal(actor.holdingCrateId, null, 'Crate 90 px above must be out of grab reach');
});

test('sandbox bounce pad, ice strip, updraft wind zone, and perimeter blast containment work reliably', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);
  const actor = world.actors[0];

  // Test bounce pad upward launch
  const bouncePad = world.platforms.find((p) => p.material === 'bouncy')!;
  actor.x = bouncePad.x + 15;
  actor.y = bouncePad.y - actor.h - 4;
  actor.vy = 180;
  for (let i = 0; i < 6; i++) stepWorld(world, level, {}, FIXED_DT);
  assert.ok(actor.vy < -400, 'Bounce pad should launch actor skyward');

  // Test updraft forceZone lift
  const updraft = world.forceZones[0];
  actor.x = updraft.x + 20;
  actor.y = updraft.y + 120;
  actor.vy = 0;
  for (let i = 0; i < 20; i++) stepWorld(world, level, {}, FIXED_DT);
  assert.ok(actor.vy < -50, 'Updraft should overcome gravity and accelerate body upward');

  // Test max-strength blast keeps all bodies safely inside arena perimeter bounds
  const blastRes = applySandboxAction(world, level, {
    action: 'blast',
    x: 40,
    y: 470,
    radius: 360,
    strength: 1800,
  });
  assert.equal(blastRes.ok, true);
  for (let i = 0; i < 30; i++) stepWorld(world, level, {}, FIXED_DT);
  for (const a of world.actors) {
    assert.ok(a.x >= 24 && a.x + a.w <= world.width - 24, 'Actor must stay inside horizontal arena walls');
    assert.ok(a.y >= 24 && a.y + a.h <= world.height - 48, 'Actor must stay above floor and below ceiling');
  }
  for (const c of world.crates) {
    assert.ok(c.x >= 24 && c.x + c.w <= world.width - 24, 'Crate must stay inside horizontal arena walls');
    assert.ok(c.y >= 24 && c.y + c.h <= world.height - 48, 'Crate must stay inside floor/ceiling bounds');
  }

  // Test clear_spawned restores defaults
  applySandboxAction(world, level, { action: 'spawn', kind: 'crate_steel', x: 300, y: 200 });
  assert.ok(world.crates.length > level.crates.length);
  applySandboxAction(world, level, { action: 'clear_spawned' });
  assert.equal(world.crates.length, level.crates.length);
});

test('update_entity edits platform geometry/material, reverses conveyor direction, and reverses crosswind vector', () => {
  const level = getLevelById('sandbox');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);

  // 1. Reverse conveyor belt speed & verify actor & crate resting on it are driven left
  const conveyor = world.platforms.find((p) => p.material === 'conveyor')!;
  const origConveyorW = level.platforms.find((p) => p.id === conveyor.id)!.w;
  const revRes = applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: conveyor.id,
    patch: { conveyorSpeed: -220, w: origConveyorW + 40 },
  });
  assert.equal(revRes.ok, true);
  assert.equal(conveyor.conveyorSpeed, -220);
  assert.equal(conveyor.w, origConveyorW + 40);

  const actor = world.actors[0];
  const actorStartX = conveyor.x + conveyor.w * 0.7;
  actor.x = actorStartX;
  actor.y = conveyor.y - actor.h;
  actor.vx = 0;
  actor.vy = 0;
  actor.grounded = true;

  const crate = world.crates[0];
  crate.x = conveyor.x + conveyor.w * 0.5;
  crate.y = conveyor.y - crate.h;
  crate.vx = 0;
  crate.vy = 0;
  crate.grounded = true;

  for (let i = 0; i < 15; i++) stepWorld(world, level, {}, FIXED_DT);
  assert.ok(actor.x < actorStartX - 20, 'Negative conveyor speed should carry actor left');
  assert.ok(crate.vx < -50, 'Negative conveyor speed should accelerate crate left');

  // 2. Flip crosswind force zone direction & verify airborne actor blows left
  const updraft = world.forceZones[0];
  const windRes = applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: updraft.id,
    patch: { fx: -1400, fy: 0 },
  });
  assert.equal(windRes.ok, true);
  actor.x = updraft.x + updraft.w * 0.5;
  actor.y = updraft.y + 40;
  actor.vx = 0;
  actor.vy = 0;
  actor.grounded = false;
  for (let i = 0; i < 15; i++) stepWorld(world, level, {}, FIXED_DT);
  assert.ok(actor.vx < -100, 'Flipped horizontal force zone should push actor left');

  // 3. Convert static platform to moving lift
  const solidPlat = world.platforms.find((p) => p.kind === 'solid' && !p.id.startsWith('wall-') && !p.id.startsWith('floor-') && !p.id.startsWith('ceil-'))!;
  const liftRes = applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: solidPlat.id,
    patch: { kind: 'moving', channel: 'A', speed: 0.9 },
  });
  assert.equal(liftRes.ok, true);
  assert.equal(solidPlat.kind, 'moving');
  assert.ok(solidPlat.startPos && solidPlat.endPos);
});

test('toggle_wire attaches/detaches switches directly to gates and softResetWorld preserves level edits', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [
    { id: 'p1', name: 'Human', role: 'human' },
    { id: 'a1', name: 'Agent-1', role: 'agent' },
  ]);

  const doorA = world.doors.find((d) => d.id === 'door-a')!;
  const swB = world.switches.find((s) => s.id === 'switch-b')!;

  // Detach Plate A and Switch B from Door A, then re-wire Switch B directly via linkedIds
  const detachA = applySandboxAction(world, level, {
    action: 'toggle_wire',
    sourceId: 'plate-a',
    targetId: 'door-a',
    mode: 'detach',
  });
  assert.equal(detachA.ok, true);
  assert.deepEqual(doorA.channels, ['B']);

  const detachB = applySandboxAction(world, level, {
    action: 'toggle_wire',
    sourceId: 'switch-b',
    targetId: 'door-a',
    mode: 'detach',
  });
  assert.equal(detachB.ok, true);
  assert.equal(doorA.channels.length, 0);

  const attachRes = applySandboxAction(world, level, {
    action: 'toggle_wire',
    sourceId: 'switch-b',
    targetId: 'door-a',
    mode: 'attach',
  });
  assert.equal(attachRes.ok, true);
  assert.ok(doorA.linkedIds?.includes('switch-b'));

  // Toggling Switch B ON should now directly open Door A
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: swB.id,
    patch: { active: true },
  });
  stepWorld(world, level, {}, FIXED_DT);
  assert.equal(doorA.open, true, 'Directly wired Switch B should unlock Door A');

  // Edit a platform position & move actor away from spawn, then softResetWorld
  const midPlat = world.platforms.find((p) => p.id === 'step-2')!;
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: midPlat.id,
    patch: { x: 420, material: 'ice' },
  });
  world.actors[0].x = 800;

  softResetWorld(world, level);
  assert.equal(world.tick, 0);
  assert.equal(Math.round(world.actors[0].x), level.spawns[0].x, 'Actor resets to spawn');
  assert.equal(midPlat.x, 420, 'softResetWorld must preserve edited platform X');
  assert.equal(midPlat.material, 'ice', 'softResetWorld must preserve edited platform material');
  assert.ok(doorA.linkedIds?.includes('switch-b'), 'softResetWorld must preserve direct wire links');
});

test('stepWorld freezes tick, elapsedSeconds, solvedAtSeconds, and decisions once puzzle is solved', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [{ id: 'a1', name: 'Agent-1', role: 'agent' }]);

  const swB = world.switches.find((s) => s.id === 'switch-b')!;
  swB.active = true;
  world.channels.B = true;
  world.actors[0].x = world.exit.x + 12;
  world.actors[0].y = world.exit.y + 10;

  stepWorld(world, level, {}, FIXED_DT);
  assert.equal(world.solved, true);
  const solvedTick = world.tick;
  const solvedSec = world.metrics.elapsedSeconds;
  assert.equal(world.solvedAtTick, solvedTick);
  assert.equal(world.solvedAtSeconds, solvedSec);

  // Stepping 120 more frames after solve must leave tick, clear time, and positions completely frozen
  for (let i = 0; i < 120; i++) {
    const events = stepWorld(
      world,
      level,
      { a1: { move: 1, jump: true, interact: false, intent: 'Should Freeze' } },
      FIXED_DT
    );
    assert.equal(events.length, 0);
  }
  assert.equal(world.tick, solvedTick, 'tick must stay frozen after puzzle solve');
  assert.equal(world.metrics.totalTicks, solvedTick);
  assert.equal(world.metrics.elapsedSeconds, solvedSec, 'elapsedSeconds must stay frozen after solve');
  assert.equal(world.solvedAtTick, solvedTick);
  assert.equal(world.solvedAtSeconds, solvedSec);
  assert.equal(world.metrics.decisionsLogged, 0);

  softResetWorld(world, level);
  assert.equal(world.solved, false);
  assert.equal(world.solvedAtTick, null);
  assert.equal(world.solvedAtSeconds, null);
});

test('idle actor on conveyor stops solidly at closed door and removed triggers prune orphaned wire IDs', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);

  // Spawn conveyor pushing right directly into closed Door A
  const convRes = applySandboxAction(world, level, {
    action: 'spawn',
    kind: 'platform_conveyor',
    x: 280,
    y: 484,
    w: 220,
    h: 16,
  });
  assert.equal(convRes.ok, true);
  const conv = world.platforms.find((p) => p.id === convRes.entityId!)!;
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: conv.id,
    patch: { y: 476, conveyorSpeed: 280 },
  });

  const doorA = world.doors.find((d) => d.id === 'door-a')!;
  const actor = world.actors[0];
  actor.x = doorA.x - actor.w - 4;
  actor.y = 476 - actor.h;
  actor.vx = 0;
  actor.vy = 0;
  actor.grounded = true;

  // Step 40 ticks with NO horizontal input (vx === 0); actor must stay left of closed doorA.x
  for (let i = 0; i < 40; i++) {
    stepWorld(world, level, {}, FIXED_DT);
  }
  assert.equal(doorA.open, false);
  assert.ok(
    actor.x + actor.w <= doorA.x + 0.5,
    `Idle actor carried by conveyor (${actor.x + actor.w}) must not tunnel through closed gate (${doorA.x})`
  );

  // Strip channel B from Door A, wire Switch B explicitly to Door A, then remove Switch B -> Door A linkedIds must be pruned cleanly
  applySandboxAction(world, level, {
    action: 'update_entity',
    entityId: 'door-a',
    patch: { channels: ['A'] },
  });
  applySandboxAction(world, level, {
    action: 'toggle_wire',
    sourceId: 'switch-b',
    targetId: 'door-a',
    mode: 'attach',
  });
  assert.ok(doorA.linkedIds?.includes('switch-b'));
  applySandboxAction(world, level, { action: 'remove', entityId: 'switch-b' });
  assert.ok(!doorA.linkedIds?.includes('switch-b'), 'Removing switch must prune dangling linkedIds');
});

test('closing gate ejects idle overlapping crate horizontally instead of snapping vertically to wall top', () => {
  const level = getLevelById('level-4');
  const world = createWorld(level);
  const doorVault = world.doors.find((d) => d.id === 'door-vault')!;
  const crate2 = world.crates.find((c) => c.id === 'crate-2')!;

  // Place idle crate partially across the closed Vault Gate threshold on the floor
  crate2.x = doorVault.x - crate2.w + 5;
  crate2.y = 492 - crate2.h;
  crate2.vx = 0;
  crate2.vy = 0;
  crate2.grounded = true;

  for (let i = 0; i < 10; i++) {
    stepWorld(world, level, {}, FIXED_DT);
  }

  assert.equal(doorVault.open, false);
  assert.equal(crate2.y, 492 - crate2.h, 'Crate must remain on the floor and never snap atop gate/vault wall');
  assert.ok(crate2.x + crate2.w <= doorVault.x + 0.5, 'Crate must be pushed cleanly left of closed Vault Gate');
});

test('recordAgentMessage & stepWorld broadcast agent messages, deduplicate spam within 120 ticks, and clear on softResetWorld', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [
    { id: 'ext-gemini', name: 'Gemini-3', role: 'agent' },
    { id: 'ext-claude', name: 'Claude-4', role: 'agent' },
  ]);

  const first = recordAgentMessage(world, 'ext-gemini', 'Claiming   Switch   B  ', {
    kind: 'claim',
    targetId: 'switch-b',
    channel: 'B',
  });
  assert.ok(first, 'First message should be recorded');
  assert.equal(first!.text, 'Claiming Switch B');
  assert.equal(first!.kind, 'claim');
  assert.equal(first!.targetId, 'switch-b');
  assert.equal(first!.channel, 'B');

  // Same message within 120 ticks is deduplicated
  const dup = recordAgentMessage(world, 'ext-gemini', 'Claiming Switch B', {
    kind: 'claim',
    targetId: 'switch-b',
    channel: 'B',
  });
  assert.equal(dup, null, 'Duplicate message within 120 ticks should be suppressed');

  // Sending a message via ActorInput during stepWorld emits agent:message event and exposes it in obs.messages
  const events = stepWorld(
    world,
    level,
    {
      'ext-claude': {
        move: 0,
        jump: false,
        interact: false,
        intent: 'Hold Plate A',
        claimTargetId: 'plate-a',
        message: 'Holding Plate A, switch B open requested',
        messageKind: 'request',
        messageTargetId: undefined,
        messageChannel: 'B',
      } as ActorInput,
    },
    FIXED_DT
  );

  assert.ok(
    events.some((e) => e.type === 'agent:message' && e.actorId === 'ext-claude'),
    'stepWorld must emit agent:message telemetry event'
  );
  assert.equal(world.messages.length, 2);

  const obsGemini = buildAgentObservation(world, 'ext-gemini')!;
  assert.equal(obsGemini.messages.length, 2, 'obs.messages must include shared squad messages');
  const claudeMate = obsGemini.teammates.find((t) => t.id === 'ext-claude')!;
  assert.equal(claudeMate.claimTargetId, 'plate-a');
  assert.equal(claudeMate.message, 'Holding Plate A, switch B open requested');

  softResetWorld(world, level);
  assert.equal(world.messages.length, 0, 'softResetWorld must clear squad messages');
});

test('velocity-adaptive crate/ball sub-stepping prevents tunneling through closed gates and safe crate release avoids walls', () => {
  const level = getLevelById('level-1');
  const world = createWorld(level, [{ id: 'p1', name: 'Human', role: 'human' }]);

  // Spawn rubber ball left of closed Door A and fling it rightward at vx=1050 (17.5px/tick vs 22px door)
  const spawnRes = applySandboxAction(world, level, {
    action: 'spawn',
    kind: 'ball_rubber',
    x: 340,
    y: 455,
  });
  assert.equal(spawnRes.ok, true);
  const ballId = spawnRes.entityId!;
  const doorA = world.doors.find((d) => d.id === 'door-a')!;
  const flingRes = applySandboxAction(world, level, {
    action: 'fling',
    entityId: ballId,
    vx: 1050,
    vy: 0,
  });
  assert.equal(flingRes.ok, true);

  for (let i = 0; i < 20; i++) {
    stepWorld(world, level, {}, FIXED_DT);
  }
  const ball = world.crates.find((c) => c.id === ballId)!;
  assert.ok(
    ball.x + ball.w <= doorA.x + 1,
    `High-speed rubber ball (${ball.x + ball.w}) must rebound cleanly off closed Gate A (${doorA.x}) without tunneling`
  );

  // Also verify holding & releasing a crate pressed flush against closed Gate A stays outside Door A
  const crateRes = applySandboxAction(world, level, {
    action: 'spawn',
    kind: 'crate_wood',
    x: doorA.x - 40,
    y: 460,
  });
  const crate = world.crates.find((c) => c.id === crateRes.entityId!)!;
  const actor = world.actors[0];
  actor.x = doorA.x - actor.w - 1;
  actor.y = 492 - actor.h;
  actor.facing = 1;
  actor.grounded = true;
  actor.holdingCrateId = crate.id;

  // Release crate while facing right into closed Gate A
  stepWorld(world, level, { p1: { move: 0, jump: false, interact: false, grab: true } }, FIXED_DT);
  assert.equal(actor.holdingCrateId, null);
  const overlapsGate =
    crate.x < doorA.x + doorA.w &&
    crate.x + crate.w > doorA.x &&
    crate.y < doorA.y + doorA.h &&
    crate.y + crate.h > doorA.y;
  assert.equal(
    overlapsGate,
    false,
    `Released crate (${crate.x},${crate.y}) must never spawn inside closed gate (${doorA.x},${doorA.y})`
  );
});




test('teammate stacking tags both actors and distinguishes deliberate from accidental', () => {
  const level = getLevelById('level-1');
  const place = (world: ReturnType<typeof createWorld>, jumped: boolean) => {
    const bottom = world.actors[0];
    const top = world.actors[1];
    bottom.x = 700;
    bottom.y = 458;
    bottom.vx = 0;
    bottom.vy = 0;
    bottom.grounded = true;
    top.x = 700;
    top.y = bottom.y - top.h - 2;
    top.vx = 0;
    top.vy = 120;
    top.grounded = false;
    top.lastJumpTick = jumped ? world.tick - 12 : -500;
  };

  const deliberateWorld = createWorld(level, [
    { id: 'bottom', name: 'Bottom', role: 'agent' },
    { id: 'top', name: 'Top', role: 'agent' },
  ]);
  place(deliberateWorld, true);
  for (let i = 0; i < 4; i++) stepWorld(deliberateWorld, level, {}, FIXED_DT);
  assert.equal(deliberateWorld.actors[1].standingOnActorId, 'bottom');
  assert.equal(deliberateWorld.actors[0].supportingActorId, 'top');
  assert.equal(deliberateWorld.actors[1].stackKind, 'deliberate');

  const accidentalWorld = createWorld(level, [
    { id: 'bottom', name: 'Bottom', role: 'agent' },
    { id: 'top', name: 'Top', role: 'agent' },
  ]);
  place(accidentalWorld, false);
  for (let i = 0; i < 4; i++) stepWorld(accidentalWorld, level, {}, FIXED_DT);
  assert.equal(accidentalWorld.actors[1].standingOnActorId, 'bottom');
  assert.equal(accidentalWorld.actors[1].stackKind, 'accidental');
});
