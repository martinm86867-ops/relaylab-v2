import type { ActorState, CrateState, Vec2 } from '../engine/types';
import { getActorArchetype } from './ActorAvatar';

export type EmoteKind = 'exit' | 'alert' | 'bounce' | 'strain' | 'spark';

export interface ActorAnimState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  wasGrounded: boolean;
  prevVy: number;
  prevOnExit: boolean;
  prevHoldingId: string | null;
  prevIntent: string | undefined;
  prevRespawnTimer: number;
  walkPhase: number;
  stepDustCooldown: number;
  thrusterCooldown: number;
  leanAngle: number;
  antennaAngle: number;
  antennaVel: number;
  blinkTimer: number;
  isBlinking: boolean;
  scarfNodes: Vec2[];
  trail: Array<{ x: number; y: number; alpha: number }>;
  idleSeconds: number;
  emote: { kind: EmoteKind; ttl: number; maxTtl: number } | null;
}

export interface ParticleSpawnFn {
  (opts: {
    x: number;
    y: number;
    count: number;
    color: string;
    spreadVx?: number;
    spreadVy?: number;
    baseVx?: number;
    baseVy?: number;
    size?: number;
    life?: number;
    shape?: 'circle' | 'square' | 'spark' | 'ring';
    gravityScale?: number;
  }): void;
}

export function createActorAnimState(actor: ActorState): ActorAnimState {
  const cx = actor.x + actor.w * 0.5;
  const neckY = actor.y + 18;
  return {
    x: actor.x,
    y: actor.y,
    vx: actor.vx,
    vy: actor.vy,
    wasGrounded: actor.grounded,
    prevVy: actor.vy,
    prevOnExit: actor.onExit,
    prevHoldingId: actor.holdingCrateId,
    prevIntent: actor.lastInput.intent,
    prevRespawnTimer: actor.respawnTimer,
    walkPhase: Math.random() * Math.PI * 2,
    stepDustCooldown: 0,
    thrusterCooldown: 0,
    leanAngle: 0,
    antennaAngle: 0,
    antennaVel: 0,
    blinkTimer: 1.5 + Math.random() * 2.8,
    isBlinking: false,
    scarfNodes: [
      { x: cx, y: neckY },
      { x: cx - actor.facing * 5, y: neckY + 2 },
      { x: cx - actor.facing * 10, y: neckY + 4 },
      { x: cx - actor.facing * 14, y: neckY + 6 },
    ],
    trail: [],
    idleSeconds: 0,
    emote: null,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function updateActorAnimState(
  anim: ActorAnimState,
  actor: ActorState,
  crates: CrateState[],
  dt: number,
  spawnParticles: ParticleSpawnFn
): { landedIntensity: number; bounced: boolean; grabbed: boolean; threw: boolean } {
  const dist = Math.hypot(actor.x - anim.x, actor.y - anim.y);
  let teleported = false;
  if (dist > 85) {
    anim.x = actor.x;
    anim.y = actor.y;
    teleported = true;
  } else {
    const lerp = Math.min(1, 26 * dt);
    anim.x += (actor.x - anim.x) * lerp;
    anim.y += (actor.y - anim.y) * lerp;
  }

  const prevVx = anim.vx;
  anim.vx += (actor.vx - anim.vx) * Math.min(1, 22 * dt);
  anim.vy += (actor.vy - anim.vy) * Math.min(1, 22 * dt);

  let landedIntensity = 0;
  let bounced = false;
  let grabbed = false;
  let threw = false;

  const footX = anim.x + actor.w * 0.5;
  const footY = anim.y + actor.h;

  // Jump / Bounce / Landing particle feedback
  if (anim.wasGrounded && !actor.grounded && actor.vy < -140) {
    const isBounce = actor.vy < -590;
    bounced = isBounce;
    spawnParticles({
      x: footX,
      y: footY,
      count: isBounce ? 11 : 6,
      color: isBounce ? '#34D399' : actor.color,
      spreadVx: isBounce ? 120 : 75,
      spreadVy: isBounce ? 140 : 65,
      size: isBounce ? 3.5 : 2.6,
      shape: isBounce ? 'spark' : 'circle',
      gravityScale: 0.25,
    });
    spawnParticles({
      x: footX,
      y: footY - 2,
      count: 1,
      color: isBounce ? '#34D399' : actor.color,
      spreadVx: 0,
      spreadVy: 0,
      baseVy: 0,
      size: isBounce ? 16 : 11,
      life: 0.24,
      shape: 'ring',
      gravityScale: 0,
    });
    if (isBounce) {
      anim.emote = { kind: 'bounce', ttl: 0.75, maxTtl: 0.75 };
      anim.antennaVel -= actor.facing * 9;
    }
  } else if (!anim.wasGrounded && actor.grounded) {
    const impact = Math.abs(anim.prevVy);
    if (impact > 110) {
      landedIntensity = clamp((impact - 110) / 650, 0.1, 1);
      const dustColor =
        actor.groundedMaterial === 'ice'
          ? '#A5F3FC'
          : actor.groundedMaterial === 'conveyor'
            ? '#FCD34D'
            : '#CBD5E1';
      spawnParticles({
        x: footX,
        y: footY,
        count: Math.round(4 + landedIntensity * 7),
        color: dustColor,
        spreadVx: 70 + landedIntensity * 85,
        spreadVy: 35 + landedIntensity * 50,
        size: 2.2 + landedIntensity * 1.5,
        shape: 'circle',
        gravityScale: 0.2,
      });
      anim.antennaVel += (Math.random() > 0.5 ? 1 : -1) * (5 + landedIntensity * 10);
    }
  }

  // Respawn teleport shimmer
  if (actor.respawnTimer > anim.prevRespawnTimer + 0.1 || (teleported && actor.respawnTimer > 0)) {
    spawnParticles({
      x: anim.x + actor.w * 0.5,
      y: anim.y + actor.h * 0.5,
      count: 14,
      color: '#F43F5E',
      spreadVx: 130,
      spreadVy: 130,
      size: 3,
      shape: 'spark',
      gravityScale: 0.1,
    });
    anim.emote = { kind: 'spark', ttl: 0.85, maxTtl: 0.85 };
  }
  anim.prevRespawnTimer = actor.respawnTimer;

  // Grab / throw detection
  if (!anim.prevHoldingId && actor.holdingCrateId) {
    grabbed = true;
    spawnParticles({
      x: anim.x + actor.w * 0.5 + actor.facing * 12,
      y: anim.y + 4,
      count: 6,
      color: '#7DD3FC',
      spreadVx: 60,
      spreadVy: 60,
      size: 2.5,
      shape: 'spark',
      gravityScale: 0.05,
    });
  } else if (anim.prevHoldingId && !actor.holdingCrateId) {
    threw = true;
  }
  anim.prevHoldingId = actor.holdingCrateId;

  // Exit celebration emote
  if (!anim.prevOnExit && actor.onExit) {
    anim.emote = { kind: 'exit', ttl: 1.2, maxTtl: 1.2 };
    spawnParticles({
      x: anim.x + actor.w * 0.5,
      y: anim.y + 6,
      count: 9,
      color: '#34D399',
      spreadVx: 85,
      spreadVy: 110,
      size: 3,
      shape: 'spark',
      gravityScale: 0.15,
    });
  }
  anim.prevOnExit = actor.onExit;

  // Intent change ping for autonomous agents
  if (actor.role === 'agent' && actor.lastInput.intent && actor.lastInput.intent !== anim.prevIntent) {
    if (!anim.emote && actor.lastInput.intent !== 'Human Idle') {
      anim.emote = { kind: 'alert', ttl: 0.65, maxTtl: 0.65 };
    }
    anim.antennaVel -= actor.facing * 4.5;
  }
  anim.prevIntent = actor.lastInput.intent;

  // Walk cycle & footstep dust
  const speedX = Math.abs(actor.vx);
  if (actor.grounded && speedX > 18) {
    anim.walkPhase += (speedX / 28) * dt;
    anim.stepDustCooldown -= dt;
    if (anim.stepDustCooldown <= 0) {
      anim.stepDustCooldown = clamp(0.24 - speedX * 0.00045, 0.1, 0.22);
      const stepColor =
        actor.groundedMaterial === 'ice'
          ? 'rgba(165, 243, 252, 0.75)'
          : actor.groundedMaterial === 'conveyor'
            ? 'rgba(251, 191, 36, 0.7)'
            : 'rgba(148, 163, 184, 0.55)';
      spawnParticles({
        x: footX - actor.facing * 4,
        y: footY - 1,
        count: 2,
        color: stepColor,
        baseVx: -actor.vx * 0.18,
        baseVy: -22,
        spreadVx: 24,
        spreadVy: 16,
        size: 2.3,
        life: 0.24,
        shape: 'circle',
        gravityScale: 0.05,
      });
    }
  } else if (actor.grounded) {
    // Gently settle walk phase toward neutral stance
    anim.walkPhase += (Math.round(anim.walkPhase / Math.PI) * Math.PI - anim.walkPhase) * Math.min(1, 12 * dt);
  }

  // Aero-bot thruster micro-sparks when airborne and rising
  const archetype = getActorArchetype(actor.role, actor.color);
  if (archetype === 'beta' && !actor.grounded && actor.vy < -40) {
    anim.thrusterCooldown -= dt;
    if (anim.thrusterCooldown <= 0) {
      anim.thrusterCooldown = 0.055;
      spawnParticles({
        x: anim.x + actor.w * 0.5 - actor.facing * 7,
        y: anim.y + actor.h - 10,
        count: 1,
        color: '#34D399',
        baseVx: -actor.facing * 35,
        baseVy: 55,
        spreadVx: 18,
        spreadVy: 18,
        size: 2.4,
        life: 0.2,
        shape: 'spark',
        gravityScale: 0.05,
      });
    }
  }

  // Velocity lean angle
  const targetLean = actor.grounded
    ? clamp(actor.vx * 0.00045, -0.11, 0.11)
    : clamp(actor.vx * 0.00055, -0.16, 0.16);
  anim.leanAngle += (targetLean - anim.leanAngle) * Math.min(1, 16 * dt);

  // Secondary spring motion for antenna / ear fins
  const accelX = (anim.vx - prevVx) / Math.max(0.001, dt);
  const targetAntenna = clamp(-actor.vx * 0.0015 - accelX * 0.00018, -0.55, 0.55);
  const springForce = (targetAntenna - anim.antennaAngle) * 140;
  const dampingForce = -anim.antennaVel * 9.5;
  anim.antennaVel += (springForce + dampingForce) * dt;
  anim.antennaAngle = clamp(anim.antennaAngle + anim.antennaVel * dt, -0.75, 0.75);

  // Scarf / Ribbon chain physics (anchored at neck/back)
  const anchorX = anim.x + actor.w * 0.5 - actor.facing * 6;
  const anchorY = anim.y + 18;
  anim.scarfNodes[0].x = anchorX;
  anim.scarfNodes[0].y = anchorY;
  const segLen = 5.2;
  for (let i = 1; i < anim.scarfNodes.length; i++) {
    const prev = anim.scarfNodes[i - 1];
    const curr = anim.scarfNodes[i];
    // Wind + trailing drag + gentle gravity droop
    curr.x += (-actor.vx * 0.028 - actor.facing * 18) * dt;
    curr.y += (32 - actor.vy * 0.015) * dt;
    const dx = curr.x - prev.x;
    const dy = curr.y - prev.y;
    const d = Math.hypot(dx, dy) || 0.001;
    if (d > segLen) {
      curr.x = prev.x + (dx / d) * segLen;
      curr.y = prev.y + (dy / d) * segLen;
    }
  }

  // Natural blinking
  anim.blinkTimer -= dt;
  if (anim.isBlinking) {
    if (anim.blinkTimer <= 0) {
      anim.isBlinking = false;
      anim.blinkTimer = 2.2 + Math.random() * 3.2;
    }
  } else if (anim.blinkTimer <= 0) {
    anim.isBlinking = true;
    anim.blinkTimer = 0.11;
  }

  // Heavy pushing strain check
  const pushingCrate = isActorPushingCrate(actor, crates);
  if (pushingCrate && Math.random() < 0.06) {
    spawnParticles({
      x: anim.x + actor.w * 0.5 + actor.facing * (actor.w * 0.5 + 2),
      y: anim.y + actor.h - 4,
      count: 1,
      color: '#FDE68A',
      baseVx: -actor.facing * 25,
      baseVy: -40,
      spreadVx: 20,
      spreadVy: 20,
      size: 2,
      life: 0.22,
      shape: 'spark',
      gravityScale: 0.4,
    });
  }

  // High-speed motion afterimage trail
  const speedMag = Math.hypot(actor.vx, actor.vy);
  for (let i = anim.trail.length - 1; i >= 0; i--) {
    anim.trail[i].alpha -= dt * 5.2;
    if (anim.trail[i].alpha <= 0) anim.trail.splice(i, 1);
  }
  if (speedMag > 390 && !teleported) {
    const last = anim.trail[0];
    if (!last || Math.hypot(anim.x - last.x, anim.y - last.y) > 9) {
      anim.trail.unshift({ x: anim.x, y: anim.y, alpha: 0.34 });
      if (anim.trail.length > 4) anim.trail.pop();
    }
  }

  // Idle timer for subtle personality glances
  if (actor.grounded && Math.abs(actor.vx) < 12 && !actor.holdingCrateId) {
    anim.idleSeconds += dt;
  } else {
    anim.idleSeconds = 0;
  }

  if (anim.emote) {
    anim.emote.ttl -= dt;
    if (anim.emote.ttl <= 0) anim.emote = null;
  }

  anim.wasGrounded = actor.grounded;
  anim.prevVy = actor.vy;

  return { landedIntensity, bounced, grabbed, threw };
}

function isActorPushingCrate(actor: ActorState, crates: CrateState[]): boolean {
  if (actor.lastInput.move === 0 || actor.holdingCrateId) return false;
  for (const c of crates) {
    const verticalOverlap = actor.y + actor.h > c.y + 4 && actor.y < c.y + c.h - 4;
    if (!verticalOverlap) continue;
    if (actor.lastInput.move > 0 && Math.abs(actor.x + actor.w - c.x) <= 6) return true;
    if (actor.lastInput.move < 0 && Math.abs(actor.x - (c.x + c.w)) <= 6) return true;
  }
  return false;
}

export function drawActorCharacter(
  ctx: CanvasRenderingContext2D,
  actor: ActorState,
  anim: ActorAnimState,
  crates: CrateState[],
  now: number,
  showPlans: boolean
): void {
  const archetype = getActorArchetype(actor.role, actor.color);
  const cx = anim.x + actor.w * 0.5;
  const bottomY = anim.y + actor.h;
  const speedX = Math.abs(actor.vx);
  const isMoving = actor.grounded && speedX > 18;
  const isHolding = Boolean(actor.holdingCrateId);
  const isPushing = isActorPushingCrate(actor, crates);
  const isAirborne = !actor.grounded;

  const heldCrate = isHolding ? crates.find((c) => c.id === actor.holdingCrateId) : undefined;

  // Draw glowing magnetic cradle tether if carrying a crate
  if (heldCrate) {
    const hcx = heldCrate.x + heldCrate.w * 0.5;
    const hcy = heldCrate.y + heldCrate.h * 0.5;
    ctx.save();
    ctx.strokeStyle = actor.color;
    ctx.globalAlpha = 0.55 + 0.2 * Math.sin(now * 0.015);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(cx - 5, anim.y + 4);
    ctx.lineTo(hcx - 4, hcy);
    ctx.moveTo(cx + 5, anim.y + 4);
    ctx.lineTo(hcx + 4, hcy);
    ctx.stroke();
    ctx.restore();
  }

  // Draw Operator's trailing scarf (in world space behind the body)
  if (archetype === 'operator') {
    ctx.save();
    if (actor.respawnTimer > 0) {
      ctx.globalAlpha = Math.sin(now * 0.04) > 0 ? 0.9 : 0.3;
    }
    ctx.strokeStyle = '#0EA5E9';
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(anim.scarfNodes[0].x, anim.scarfNodes[0].y);
    for (let i = 1; i < anim.scarfNodes.length; i++) {
      ctx.lineTo(anim.scarfNodes[i].x, anim.scarfNodes[i].y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#BAE6FD';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  // High-speed afterimage echoes
  if (anim.trail.length > 0) {
    ctx.save();
    for (const ghost of anim.trail) {
      ctx.globalAlpha = ghost.alpha;
      ctx.fillStyle = actor.color;
      ctx.beginPath();
      ctx.roundRect(ghost.x + 2, ghost.y + 4, actor.w - 4, actor.h - 8, 6);
      ctx.fill();
    }
    ctx.restore();
  }

  // Ground contact shadow + subtle human player spotlight ring
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
  const shadowScale = actor.grounded ? 1 : 0.72;
  ctx.beginPath();
  ctx.ellipse(cx, bottomY, actor.w * 0.46 * shadowScale, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();

  if (actor.role === 'human' && actor.grounded) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.48)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(cx, bottomY + 0.5, actor.w * 0.58, 3.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Main articulated body transform
  ctx.save();
  ctx.translate(cx, bottomY);
  ctx.rotate(anim.leanAngle);
  ctx.scale(actor.squashX, actor.squashY);

  if (actor.respawnTimer > 0) {
    ctx.globalAlpha = Math.sin(now * 0.04) > 0 ? 1 : 0.32;
  }

  const idleBob = !isMoving && !isAirborne ? Math.sin(now * 0.005 + actor.spawnIndex * 1.7) * 0.8 : 0;
  const runBounce = isMoving ? Math.abs(Math.sin(anim.walkPhase)) * -1.8 : 0;
  const bodyOffsetY = idleBob + runBounce;

  const stride = isMoving ? Math.sin(anim.walkPhase) : 0;
  const liftL = isMoving ? Math.max(0, Math.cos(anim.walkPhase)) * 3.5 : 0;
  const liftR = isMoving ? Math.max(0, -Math.cos(anim.walkPhase)) * 3.5 : 0;

  // --- 1. Back Arm (behind torso, at front/far shoulder) ---
  drawArm(ctx, actor.facing * 9, -13 + bodyOffsetY, actor.facing, stride, isHolding, isPushing, isAirborne, actor.vy, actor.color, true);

  // --- 2. Articulated Legs & Boots ---
  const legSpread = isAirborne ? (actor.vy < 0 ? 3.5 : 5.5) : 4.8;
  const leftFootX = -legSpread + stride * 5.2;
  const rightFootX = legSpread - stride * 5.2;
  const airTuckL = isAirborne ? (actor.vy < 0 ? -3.5 : -1) : -liftL;
  const airTuckR = isAirborne ? (actor.vy < 0 ? -1.5 : -2.5) : -liftR;

  drawFoot(ctx, leftFootX, airTuckL, actor.facing, archetype, actor.color, true);
  drawFoot(ctx, rightFootX, airTuckR, actor.facing, archetype, actor.color, false);

  // --- 3. Torso & Head Silhouette ---
  const bodyTop = -actor.h + 4 + bodyOffsetY;
  const bodyH = actor.h - 8;
  const bodyW = actor.w;

  // Soft outer aura when at exit (radial gradient, zero heavy shadowBlur)
  if (actor.onExit) {
    ctx.save();
    const exitAura = ctx.createRadialGradient(0, bodyTop + bodyH * 0.5, 4, 0, bodyTop + bodyH * 0.5, bodyW * 0.95);
    exitAura.addColorStop(0, 'rgba(16, 185, 129, 0.34)');
    exitAura.addColorStop(1, 'rgba(16, 185, 129, 0)');
    ctx.fillStyle = exitAura;
    ctx.beginPath();
    ctx.arc(0, bodyTop + bodyH * 0.5, bodyW * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Compact archetype back pack / thruster nozzle behind torso
  if (archetype === 'operator') {
    ctx.fillStyle = '#1E293B';
    ctx.beginPath();
    ctx.roundRect(-actor.facing * (bodyW * 0.5 + 2.5) - 2, bodyTop + 11, 4.5, 11, 1.5);
    ctx.fill();
    ctx.strokeStyle = '#0B1120';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  } else if (archetype === 'beta') {
    ctx.fillStyle = '#064E3B';
    ctx.beginPath();
    ctx.roundRect(-actor.facing * (bodyW * 0.5 + 1.5) - 2.5, bodyTop + 13, 5, 9, 2);
    ctx.fill();
    ctx.strokeStyle = '#0B1120';
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }

  // Secondary Headgear (behind or atop chassis)
  drawHeadgear(ctx, archetype, bodyTop, actor.facing, anim.antennaAngle, actor.color, actor.onExit, now);

  // Main Chassis with directional sculptural shading
  const defineChassisPath = () => {
    ctx.beginPath();
    if (archetype === 'beta') {
      ctx.roundRect(-bodyW * 0.5, bodyTop, bodyW, bodyH, [11, 11, 5, 5]);
    } else if (archetype === 'alpha') {
      ctx.roundRect(-bodyW * 0.5 - 0.5, bodyTop, bodyW + 1, bodyH, 4.5);
    } else {
      ctx.roundRect(-bodyW * 0.5, bodyTop, bodyW, bodyH, 6);
    }
  };

  ctx.fillStyle = actor.color;
  defineChassisPath();
  ctx.fill();

  // Subtle vertical shading overlay so silhouette reads crisply at 2x scale
  const bodyShade = ctx.createLinearGradient(0, bodyTop, 0, bodyTop + bodyH);
  bodyShade.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
  bodyShade.addColorStop(0.38, 'rgba(255, 255, 255, 0.0)');
  bodyShade.addColorStop(1, 'rgba(8, 12, 22, 0.34)');
  ctx.fillStyle = bodyShade;
  defineChassisPath();
  ctx.fill();

  // Subtle top highlight bevel for 3D tactile depth
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.beginPath();
  ctx.roundRect(-bodyW * 0.5 + 3, bodyTop + 1.5, bodyW - 6, 3.2, 1.6);
  ctx.fill();

  // Horizontal chassis collar seam
  ctx.strokeStyle = 'rgba(11, 17, 32, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-bodyW * 0.5 + 2, bodyTop + 16.5);
  ctx.lineTo(bodyW * 0.5 - 2, bodyTop + 16.5);
  ctx.stroke();

  // Crisp dark outline
  ctx.strokeStyle = '#0B1120';
  ctx.lineWidth = 1.6;
  defineChassisPath();
  ctx.stroke();

  // Chest Core / Suit Trim
  drawChestDetail(ctx, archetype, bodyTop + bodyH - 8, actor.facing, actor.color, actor.onExit, isPushing || isHolding, now);

  // --- 4. Expressive Faceplate & Eyes ---
  let lookOffsetX = actor.facing * 3.6 + clamp(actor.vx * 0.008, -1.5, 1.5);
  if (actor.role === 'agent' && actor.lastInput.targetPos && Math.abs(actor.vx) < 25) {
    lookOffsetX += clamp((actor.lastInput.targetPos.x - cx) * 0.02, -2.2, 2.2);
  } else if (anim.idleSeconds > 1.2) {
    lookOffsetX += Math.sin(now * 0.0016 + actor.spawnIndex * 2.1) * 1.6;
  }
  const eyeShiftY = clamp(actor.vy * 0.003, -1.2, 1.4);
  const visorX = -9.5 + lookOffsetX * 0.42;
  const visorY = bodyTop + 5;
  const visorW = 19;
  const visorH = 10;
  const visorR = archetype === 'beta' ? 4.5 : 3;

  // Visor recess with deep indigo gradient
  const visorGrad = ctx.createLinearGradient(visorX, visorY, visorX, visorY + visorH);
  visorGrad.addColorStop(0, '#070B12');
  visorGrad.addColorStop(1, '#121B2B');
  ctx.fillStyle = visorGrad;
  ctx.beginPath();
  ctx.roundRect(visorX, visorY, visorW, visorH, visorR);
  ctx.fill();

  drawEyes(
    ctx,
    archetype,
    visorX + visorW * 0.5 + lookOffsetX * 0.42,
    visorY + visorH * 0.5 + eyeShiftY,
    actor.color,
    {
      isBlinking: anim.isBlinking,
      isHappy: actor.onExit,
      isRespawning: actor.respawnTimer > 0,
      isStraining: isPushing || isHolding,
      isStartled: isAirborne && Math.abs(actor.vy) > 380,
      facing: actor.facing,
    }
  );

  // Subtle diagonal glass glare across visor corner
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(visorX, visorY, visorW, visorH, visorR);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
  ctx.beginPath();
  ctx.moveTo(visorX + 2, visorY);
  ctx.lineTo(visorX + 7.5, visorY);
  ctx.lineTo(visorX + 3.5, visorY + visorH);
  ctx.lineTo(visorX - 1, visorY + visorH);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.roundRect(visorX, visorY, visorW, visorH, visorR);
  ctx.stroke();

  // --- 5. Front Arm (foreground, anchored at back shoulder below visor) ---
  drawArm(
    ctx,
    isPushing ? actor.facing * 10 : -actor.facing * 5,
    -13 + bodyOffsetY,
    actor.facing,
    -stride,
    isHolding,
    isPushing,
    isAirborne,
    actor.vy,
    actor.color,
    false
  );

  ctx.restore();

  // --- 6. Minimal Floating Markers & Optional Agent Plans ---
  ctx.save();
  ctx.textAlign = 'center';

  // Micro Emote Bubble
  if (anim.emote) {
    const p = 1 - anim.emote.ttl / anim.emote.maxTtl;
    const floatY = anim.y - 20 - p * 10;
    const alpha = p < 0.2 ? p / 0.2 : p > 0.75 ? (1 - p) / 0.25 : 1;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    const emoteMeta = getEmoteVisual(anim.emote.kind, actor.color);
    ctx.font = '700 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = emoteMeta.color;
    ctx.fillText(emoteMeta.text, cx + 15, floatY);
    ctx.globalAlpha = 1;
  }

  if (actor.role === 'human') {
    if (actor.holdingCrateId) {
      // Compact [Q] throw keycap above held crate
      const ky = anim.y - 34;
      ctx.fillStyle = '#0B1018';
      ctx.beginPath();
      ctx.roundRect(cx - 8, ky - 7, 16, 15, 3.5);
      ctx.fill();
      ctx.fillStyle = '#1E293B';
      ctx.beginPath();
      ctx.roundRect(cx - 7.5, ky - 7, 15, 13, 3);
      ctx.fill();
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.fillStyle = '#E0F2FE';
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.fillText('Q', cx, ky + 2.5);
    } else {
      // Crisp downward player indicator chevron
      const bob = Math.sin(now * 0.005) * 1.4;
      const py = anim.y - 12 + bob;
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.moveTo(cx - 4, py - 4);
      ctx.lineTo(cx + 4, py - 4);
      ctx.lineTo(cx, py + 1);
      ctx.closePath();
      ctx.fill();
    }
  } else if (showPlans) {
    // Clean unboxed agent callsign + lightweight intent readout when Plans are enabled
    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(11, 16, 24, 0.75)';
    ctx.fillText(actor.label, cx + 1, anim.y - 9);
    ctx.fillStyle = actor.color;
    ctx.fillText(actor.label, cx, anim.y - 10);

    if (actor.lastInput.intent) {
      const tag = actor.lastInput.intent;
      const isWaiting = /wait|hold|yield/i.test(tag);
      ctx.font = '500 9px "Plus Jakarta Sans", sans-serif';
      const metrics = ctx.measureText(tag);
      const padW = Math.min(148, metrics.width + 12);
      ctx.fillStyle = 'rgba(11, 16, 24, 0.78)';
      ctx.beginPath();
      ctx.roundRect(cx - padW * 0.5, anim.y - 36, padW, 14, 4);
      ctx.fill();
      ctx.strokeStyle = isWaiting ? 'rgba(245, 158, 11, 0.42)' : 'rgba(148, 163, 184, 0.24)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#E2E8F0';
      ctx.fillText(tag, cx, anim.y - 26, 140);
    }
  }
  ctx.restore();
}

function getEmoteVisual(kind: EmoteKind, actorColor: string): { text: string; color: string } {
  switch (kind) {
    case 'exit':
      return { text: '✓', color: '#34D399' };
    case 'bounce':
      return { text: '▲', color: '#6EE7B7' };
    case 'strain':
      return { text: '⚡', color: '#FDE68A' };
    case 'spark':
      return { text: '✦', color: '#FB7185' };
    default:
      return { text: '!', color: actorColor };
  }
}

function drawFoot(
  ctx: CanvasRenderingContext2D,
  x: number,
  yOffset: number,
  facing: 1 | -1,
  archetype: ReturnType<typeof getActorArchetype>,
  color: string,
  isBack: boolean
): void {
  ctx.save();
  ctx.translate(x, -3 + yOffset);
  if (archetype === 'alpha') {
    // Sturdy rover tread shoe
    ctx.fillStyle = isBack ? '#1E293B' : '#334155';
    ctx.beginPath();
    ctx.roundRect(-4.5, -2.5, 9, 5.5, 2);
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(facing > 0 ? 1.5 : -4.5, -1, 3, 2);
  } else {
    // Sleek articulated boot
    ctx.fillStyle = isBack ? '#0F172A' : '#1E293B';
    ctx.beginPath();
    ctx.roundRect(-3.8, -2, 7.6, 5, 2.2);
    ctx.fill();
    ctx.fillStyle = isBack ? '#475569' : color;
    ctx.fillRect(facing > 0 ? 1 : -3.5, -1.5, 2.8, 2.2);
  }
  ctx.restore();
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  shoulderX: number,
  shoulderY: number,
  facing: 1 | -1,
  swing: number,
  isHolding: boolean,
  isPushing: boolean,
  isAirborne: boolean,
  vy: number,
  color: string,
  isBack: boolean
): void {
  ctx.save();
  ctx.translate(shoulderX, shoulderY);
  let handX = swing * 4.5;
  let handY = 6.5;
  let elbowX: number | null = null;
  let elbowY: number | null = null;

  if (isHolding) {
    // Route arms cleanly outside the head/visor up toward the overhead crate
    if (isBack) {
      elbowX = facing * 6;
      elbowY = -8;
      handX = facing * 3;
      handY = -20;
    } else {
      elbowX = -facing * 7;
      elbowY = -9;
      handX = facing * 1;
      handY = -20;
    }
  } else if (isPushing) {
    handX = facing * 7.5;
    handY = -1;
  } else if (isAirborne) {
    if (isBack) {
      handX = facing * 6;
      handY = vy < 0 ? -5 : -2;
    } else {
      handX = -facing * 5.5;
      handY = vy < 0 ? -4 : -7;
    }
  }

  ctx.strokeStyle = isBack ? '#1E293B' : '#0F172A';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  if (elbowX !== null && elbowY !== null) {
    ctx.lineTo(elbowX, elbowY);
  }
  ctx.lineTo(handX, handY);
  ctx.stroke();

  ctx.strokeStyle = isBack ? '#475569' : color;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  // Glove / gripper tip
  ctx.fillStyle = isBack ? '#64748B' : '#F8FAFC';
  ctx.beginPath();
  ctx.arc(handX, handY, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHeadgear(
  ctx: CanvasRenderingContext2D,
  archetype: ReturnType<typeof getActorArchetype>,
  bodyTop: number,
  facing: 1 | -1,
  antennaAngle: number,
  color: string,
  onExit: boolean,
  now: number
): void {
  ctx.save();
  ctx.translate(0, bodyTop);

  if (archetype === 'operator') {
    // Field engineer helmet crest + headlamp nub
    ctx.fillStyle = '#E0F2FE';
    ctx.beginPath();
    ctx.roundRect(-7, -4.5, 14, 5, [3, 3, 1, 1]);
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Little headlamp lens
    ctx.fillStyle = onExit ? '#34D399' : '#BAE6FD';
    ctx.beginPath();
    ctx.arc(facing * 4.5, -2.2, 1.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (archetype === 'alpha') {
    // Springy twin-coil antenna
    ctx.rotate(antennaAngle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.lineTo(-2, -3);
    ctx.lineTo(2, -6);
    ctx.lineTo(0, -10);
    ctx.stroke();
    const glow = onExit ? '#34D399' : 0.7 + 0.3 * Math.sin(now * 0.01) > 0.85 ? '#FEF3C7' : '#FDE68A';
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, -10.5, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (archetype === 'beta') {
    // Dual swept aero-fins that flex with velocity
    ctx.save();
    ctx.translate(-8, 3);
    ctx.rotate(-0.25 + antennaAngle * 0.7);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-5, -8);
    ctx.lineTo(3, -3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(8, 3);
    ctx.rotate(0.25 + antennaAngle * 0.7);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, -8);
    ctx.lineTo(-3, -3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  } else if (archetype === 'gamma') {
    // Dual sensor ears
    ctx.rotate(antennaAngle * 0.6);
    for (const sx of [-6, 6]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sx, 1);
      ctx.lineTo(sx * 1.15, -6);
      ctx.stroke();
      ctx.fillStyle = '#FCE7F3';
      ctx.beginPath();
      ctx.arc(sx * 1.15, -7, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Prism crest
    ctx.rotate(antennaAngle * 0.5);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(5, 1);
    ctx.lineTo(-5, 1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  ctx.restore();
}

function drawChestDetail(
  ctx: CanvasRenderingContext2D,
  archetype: ReturnType<typeof getActorArchetype>,
  y: number,
  facing: 1 | -1,
  color: string,
  onExit: boolean,
  activeEffort: boolean,
  now: number
): void {
  const pulse = 0.65 + 0.35 * Math.sin(now * 0.008);
  const coreColor = onExit ? '#34D399' : activeEffort ? '#FDE68A' : '#F8FAFC';

  if (archetype === 'operator') {
    // Utility belt / buckle
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(-11, y - 1, 22, 3.2);
    ctx.fillStyle = coreColor;
    ctx.fillRect(facing * 2 - 2, y - 1, 4, 3.2);
  } else if (archetype === 'alpha') {
    // Chest telemetry core bar
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.roundRect(-6, y - 2, 12, 4.5, 2);
    ctx.fill();
    ctx.fillStyle = coreColor;
    ctx.globalAlpha = pulse;
    ctx.fillRect(-4, y - 0.8, 8, 2);
    ctx.globalAlpha = 1;
  } else {
    // Circular chest node
    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(facing * 2, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = onExit ? '#34D399' : color;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(facing * 2, y, 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawEyes(
  ctx: CanvasRenderingContext2D,
  archetype: ReturnType<typeof getActorArchetype>,
  cx: number,
  cy: number,
  color: string,
  state: {
    isBlinking: boolean;
    isHappy: boolean;
    isRespawning: boolean;
    isStraining: boolean;
    isStartled: boolean;
    facing: 1 | -1;
  }
): void {
  const eyeColor =
    archetype === 'operator'
      ? '#F8FAFC'
      : archetype === 'alpha'
        ? '#FDE68A'
        : archetype === 'beta'
          ? '#A7F3D0'
          : '#F8FAFC';

  ctx.save();
  ctx.strokeStyle = eyeColor;
  ctx.fillStyle = eyeColor;
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';

  if (state.isRespawning) {
    // Dizzy X X eyes
    for (const ox of [-4, 4]) {
      ctx.beginPath();
      ctx.moveTo(cx + ox - 1.8, cy - 1.8);
      ctx.lineTo(cx + ox + 1.8, cy + 1.8);
      ctx.moveTo(cx + ox + 1.8, cy - 1.8);
      ctx.lineTo(cx + ox - 1.8, cy + 1.8);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (state.isHappy) {
    // Happy ^ ^ crescent eyes
    for (const ox of [-4.2, 4.2]) {
      ctx.beginPath();
      ctx.arc(cx + ox, cy + 1.2, 2.6, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (state.isBlinking) {
    ctx.beginPath();
    ctx.moveTo(cx - 6.2, cy);
    ctx.lineTo(cx - 2, cy);
    ctx.moveTo(cx + 2, cy);
    ctx.lineTo(cx + 6.2, cy);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (archetype === 'beta') {
    // Sleek panoramic cyclops eye with animated pupil
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(cx - 6.5, cy - 2.2, 13, 4.4, 2.2);
    ctx.fill();
    ctx.fillStyle = '#ECFEFF';
    ctx.beginPath();
    ctx.arc(cx + state.facing * 2.2, cy, state.isStartled ? 2 : 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  if (state.isStraining) {
    // Focused > < determined eyes
    ctx.beginPath();
    ctx.moveTo(cx - 5.5, cy - 1.8);
    ctx.lineTo(cx - 2.5, cy);
    ctx.lineTo(cx - 5.5, cy + 1.8);
    ctx.moveTo(cx + 5.5, cy - 1.8);
    ctx.lineTo(cx + 2.5, cy);
    ctx.lineTo(cx + 5.5, cy + 1.8);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (state.isStartled) {
    // Wide surprised O O eyes
    for (const ox of [-4, 4]) {
      ctx.beginPath();
      ctx.arc(cx + ox, cy, 2.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  // Default expressive crisp eyes
  for (const ox of [-4, 4]) {
    ctx.beginPath();
    ctx.roundRect(cx + ox - 1.8, cy - 2.4, 3.6, 4.8, 1.2);
    ctx.fill();
  }
  ctx.restore();
}
