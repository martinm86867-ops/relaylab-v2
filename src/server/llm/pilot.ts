import { buildWalkSegments, findPathToPoint } from '../../engine/agentPlanner';
import type { ActorInput, AgentObservation, Vec2 } from '../../engine/types';
import type { LlmPilotCommand } from './types';

const ACTOR_W = 26;
const ACTOR_H = 34;
const INTERACT_RANGE = 44;

interface Goal {
  id: string;
  point: Vec2;
  kind: 'switch' | 'plate' | 'crate' | 'exit' | 'point';
}

function idleInput(command: LlmPilotCommand | null): ActorInput {
  return {
    move: 0,
    jump: false,
    interact: false,
    grab: false,
    intent: command ? 'Waiting' : 'Idle',
    reason: command?.reason,
    claimTargetId: command?.claimTargetId,
    targetPos: command?.targetPos,
  };
}

/**
 * Deterministic 60 Hz executor for hybrid commands.
 *
 * The LLM chooses a target and a horizon; this class turns that into walking,
 * jumping, and interacting. It is deliberately conservative: if the navigation
 * graph has no path, it falls back to a straight approach and a stuck-jump.
 */
export class LlmPilot {
  private command: LlmPilotCommand | null = null;
  private jumpPulse = 0;
  private interactPulse = 0;
  private grabPulse = 0;
  private stuckTicks = 0;
  private lastX = 0;
  private lastY = 0;
  private hasLast = false;

  setCommand(command: LlmPilotCommand): void {
    this.command = command;
    this.jumpPulse = 0;
    this.interactPulse = 0;
    this.grabPulse = 0;
    this.stuckTicks = 0;
    this.hasLast = false;
  }

  clear(): void {
    this.command = null;
    this.jumpPulse = 0;
    this.interactPulse = 0;
    this.grabPulse = 0;
  }

  get active(): boolean {
    return this.command !== null;
  }

  private resolveGoal(obs: AgentObservation): Goal | null {
    const action = this.command?.action;
    if (!action) return null;

    if (action.type === 'goto') {
      return { id: 'goto', point: { x: action.x, y: action.y }, kind: 'point' };
    }

    if (action.type === 'use') {
      const switchTarget = obs.switches.find((s) => s.id === action.targetId);
      if (switchTarget) {
        return {
          id: switchTarget.id,
          point: {
            x: switchTarget.x + switchTarget.w / 2,
            y: switchTarget.y + switchTarget.h,
          },
          kind: 'switch',
        };
      }
      const plateTarget = obs.plates.find((p) => p.id === action.targetId);
      if (plateTarget) {
        return {
          id: plateTarget.id,
          point: { x: plateTarget.x + plateTarget.w / 2, y: plateTarget.y },
          kind: 'plate',
        };
      }
      if (obs.exit.id === action.targetId) {
        return {
          id: obs.exit.id,
          point: { x: obs.exit.x + obs.exit.w / 2, y: obs.exit.y + obs.exit.h },
          kind: 'exit',
        };
      }
      return null;
    }

    if (action.type === 'hold') {
      const plate = obs.plates.find((p) => p.id === action.targetId);
      if (plate) {
        return {
          id: plate.id,
          point: { x: plate.x + plate.w / 2, y: plate.y },
          kind: 'plate',
        };
      }
      const switchTarget = obs.switches.find((s) => s.id === action.targetId);
      if (switchTarget) {
        return {
          id: switchTarget.id,
          point: {
            x: switchTarget.x + switchTarget.w / 2,
            y: switchTarget.y + switchTarget.h,
          },
          kind: 'switch',
        };
      }
      return null;
    }

    if (action.type === 'grab') {
      const crate = action.targetId
        ? obs.crates.find((c) => c.id === action.targetId)
        : obs.crates[0];
      if (crate) {
        return {
          id: crate.id,
          point: { x: crate.x + crate.w / 2, y: crate.y + crate.h },
          kind: 'crate',
        };
      }
      return null;
    }

    return null;
  }

  tick(obs: AgentObservation, now: number): ActorInput {
    const command = this.command;
    if (!command) return idleInput(null);

    const age = now - command.receivedAt;
    if (age > command.action.durationMs + 300) {
      this.command = null;
      return idleInput(null);
    }

    const action = command.action;
    const base = {
      intent: command.intent,
      reason: command.reason,
      claimTargetId: command.claimTargetId,
    };

    if (action.type === 'wait') {
      return { ...idleInput(command), ...base };
    }

    if (action.type === 'raw') {
      if (action.jump && this.jumpPulse <= 0 && obs.self.grounded) this.jumpPulse = 6;
      if (action.interact && this.interactPulse <= 0) this.interactPulse = 3;
      if (action.grab && this.grabPulse <= 0) this.grabPulse = 3;
      const input: ActorInput = {
        ...base,
        move: action.move,
        jump: this.jumpPulse > 0,
        interact: this.interactPulse > 0,
        grab: this.grabPulse > 0,
      };
      this.jumpPulse = Math.max(0, this.jumpPulse - 1);
      this.interactPulse = Math.max(0, this.interactPulse - 1);
      this.grabPulse = Math.max(0, this.grabPulse - 1);
      return input;
    }

    const goal = this.resolveGoal(obs);
    if (!goal) return { ...idleInput(command), ...base };

    const selfCx = obs.self.x + ACTOR_W / 2;
    const selfBottom = obs.self.y + ACTOR_H;
    const selfPt: Vec2 = { x: selfCx, y: selfBottom };
    const dxToGoal = goal.point.x - selfCx;
    const dist = Math.hypot(goal.point.x - selfCx, goal.point.y - selfBottom);

    // Close enough to press / grab: stop and pulse the action.
    if (action.type === 'use' && dist <= INTERACT_RANGE) {
      if (this.interactPulse <= 0) this.interactPulse = 3;
      const input: ActorInput = {
        ...base,
        move: 0,
        jump: false,
        interact: this.interactPulse > 0,
        grab: false,
        targetPos: goal.point,
      };
      this.interactPulse = Math.max(0, this.interactPulse - 1);
      return input;
    }

    if (action.type === 'grab' && dist <= INTERACT_RANGE) {
      if (this.grabPulse <= 0) this.grabPulse = 3;
      const input: ActorInput = {
        ...base,
        move: 0,
        jump: false,
        interact: false,
        grab: this.grabPulse > 0,
        targetPos: goal.point,
      };
      this.grabPulse = Math.max(0, this.grabPulse - 1);
      return input;
    }

    // Standing on the plate is already a successful hold.
    if (action.type === 'hold' && goal.kind === 'plate' && Math.abs(dxToGoal) < 13 && obs.self.grounded) {
      const input: ActorInput = { ...base, move: 0, jump: false, interact: false, grab: false, targetPos: goal.point };
      if (Math.abs(dxToGoal) > 5) input.move = dxToGoal > 0 ? 1 : -1;
      return input;
    }

    let pathPreview: Vec2[] = [];
    let next: Vec2 & { mode?: string } = goal.point;
    try {
      const path = findPathToPoint(obs, buildWalkSegments(obs), selfPt, goal.point);
      if (path.reachable && path.waypoints.length > 1) {
        const wp = path.waypoints[1] as Vec2 & { mode?: string };
        next = wp;
        pathPreview = path.waypoints.slice(1, 9).map((w) => ({ x: w.x, y: w.y }));
      }
    } catch {
      // Navigation is best-effort; the direct approach below still works.
    }

    const targetCx = next.x;
    const dx = targetCx - selfCx;
    let move: -1 | 0 | 1 = dx > 5 ? 1 : dx < -5 ? -1 : 0;
    if (next.mode === 'wait') move = 0;

    // Stuck detection: walking into a wall/closed door should trigger a hop.
    if (this.hasLast && obs.self.grounded && move !== 0) {
      const moved = Math.abs(obs.self.x - this.lastX) + Math.abs(obs.self.y - this.lastY);
      if (moved < 0.28) this.stuckTicks += 1;
      else this.stuckTicks = 0;
    } else {
      this.stuckTicks = 0;
    }
    this.lastX = obs.self.x;
    this.lastY = obs.self.y;
    this.hasLast = true;

    const needsJump =
      (next.mode === 'jump' && obs.self.grounded) ||
      (goal.point.y < selfBottom - 22 && Math.abs(dxToGoal) < 26 && obs.self.grounded) ||
      (this.stuckTicks > 14 && obs.self.grounded);
    if (needsJump && this.jumpPulse <= 0) {
      this.jumpPulse = 7;
      this.stuckTicks = 0;
    }

    // If the goal is vertically above and we are already under it, keep
    // pushing toward the edge while the jump pulse runs.
    const jump = this.jumpPulse > 0;
    this.jumpPulse = Math.max(0, this.jumpPulse - 1);
    this.interactPulse = Math.max(0, this.interactPulse - 1);
    this.grabPulse = Math.max(0, this.grabPulse - 1);

    return {
      ...base,
      move,
      jump,
      interact: this.interactPulse > 0,
      grab: this.grabPulse > 0,
      targetPos: goal.point,
      pathPreview,
    };
  }
}
