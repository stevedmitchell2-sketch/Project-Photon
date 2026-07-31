import { COMBAT } from '@/config/combat';
import { WEAPONS } from '@/config/weapons';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { resetInputFrame } from '@/input/InputFrame';
import type { Actor, MatchState } from '@/gameplay/types';
import {
  angleDelta,
  clamp,
  DEG2RAD,
  dist3,
  distSq3,
  groundBasis,
  type Vec3,
} from '@/util/math';
import type { Rng } from '@/util/rng';
import {
  Action,
  Condition,
  ReactiveSequence,
  Selector,
  type BtNode,
  type NodeStatus,
} from './BehaviorTree';
import type { BotProfile } from './botDifficulty';
import type { NavGraph } from './NavGraph';

/**
 * A bot is an InputFrame source, nothing more.
 *
 * It runs the exact same movement, weapon and combat code as a human player — it cannot strafe
 * faster, fire faster, or shoot through walls, because it does not have access to any of that. All
 * difficulty tuning happens in perception and aim, which is where it belongs.
 */

export interface BotBlackboard {
  actor: Actor;
  state: MatchState;
  physics: PhysicsWorld;
  nav: NavGraph;
  profile: BotProfile;
  rng: Rng;

  target: Actor | null;
  /** Where the target was last seen; searched when contact is lost. */
  lastKnownPosition: Vec3;
  timeSinceSeen: number;
  /** Counts up while a target is visible; firing unlocks once it passes reactionTime. */
  acquisitionTime: number;

  /** A noise worth walking toward, and how long it stays interesting. Separate from sight memory:
   *  a heard cue must never let a bot shoot at something it has not actually seen. */
  heardPosition: Vec3;
  investigateTimer: number;

  path: number[];
  pathIndex: number;
  /** Nav node index the current path was built toward. */
  pathGoal: number;
  repathTimer: number;

  /** Desired world-space heading this tick, consumed by the steering step. */
  desiredMove: Vec3;
  wantsSprint: boolean;
  wantsCrouch: boolean;
  wantsJump: boolean;
  wantsFire: boolean;
  /** Yaw/pitch the bot is trying to look at. */
  aimYaw: number;
  aimPitch: number;

  strafeDirection: number;
  strafeTimer: number;
  decisionTimer: number;
  stuckTimer: number;
  lastPosition: Vec3;
  /** Randomized aim error, resampled on each decision tick. */
  aimErrorYaw: number;
  aimErrorPitch: number;
}

export function createBlackboard(
  actor: Actor,
  state: MatchState,
  physics: PhysicsWorld,
  nav: NavGraph,
  profile: BotProfile,
  rng: Rng,
): BotBlackboard {
  return {
    actor,
    state,
    physics,
    nav,
    profile,
    rng,
    target: null,
    lastKnownPosition: { x: 0, y: 0, z: 0 },
    heardPosition: { x: 0, y: 0, z: 0 },
    investigateTimer: 0,
    timeSinceSeen: Infinity,
    acquisitionTime: 0,
    path: [],
    pathIndex: 0,
    pathGoal: -1,
    repathTimer: 0,
    desiredMove: { x: 0, y: 0, z: 0 },
    wantsSprint: false,
    wantsCrouch: false,
    wantsJump: false,
    wantsFire: false,
    aimYaw: actor.yaw,
    aimPitch: 0,
    strafeDirection: 1,
    strafeTimer: 0,
    decisionTimer: rng.range(0, 0.2),
    stuckTimer: 0,
    lastPosition: { ...actor.position },
    aimErrorYaw: 0,
    aimErrorPitch: 0,
  };
}

/** Eye height used for perception — matches where the sim puts the actual eye. */
const eyeOf = (a: Actor, out: Vec3): Vec3 => {
  out.x = a.position.x;
  out.y = a.position.y + a.height - 0.16;
  out.z = a.position.z;
  return out;
};

const scratchEyeA: Vec3 = { x: 0, y: 0, z: 0 };
const scratchEyeB: Vec3 = { x: 0, y: 0, z: 0 };

// --- Perception --------------------------------------------------------------

function updatePerception(bb: BotBlackboard, dt: number, freeForAll: boolean): void {
  const { actor, state, physics, profile } = bb;
  bb.timeSinceSeen += dt;

  let best: Actor | null = null;
  let bestScore = Infinity;
  const selfEye = eyeOf(actor, scratchEyeA);

  for (const other of state.actors.values()) {
    if (other.id === actor.id || !other.alive) continue;
    if (!freeForAll && other.team === actor.team) continue;
    if (other.spawnProtection > 0) continue;

    const d = dist3(actor.position, other.position);
    if (d > profile.engageRange) continue;

    // Field of view: bots cannot see behind themselves.
    const toX = other.position.x - actor.position.x;
    const toZ = other.position.z - actor.position.z;
    const basis = groundBasis(actor.yaw);
    const facing = (basis.fx * toX + basis.fz * toZ) / Math.max(d, 1e-3);
    const inFov = facing > -0.15; // ~190 degrees, generous but not omniscient.
    // Very close enemies are noticed regardless of facing — footsteps and peripheral vision.
    if (!inFov && d > 7) continue;

    const otherEye = eyeOf(other, scratchEyeB);
    if (!physics.hasLineOfSight(selfEye, otherEye)) continue;

    // Prefer close, already-damaged targets.
    const score = d * (other.health < COMBAT.maxHealth * 0.5 ? 0.65 : 1);
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  }

  if (best) {
    if (bb.target?.id !== best.id) bb.acquisitionTime = 0;
    bb.target = best;
    bb.timeSinceSeen = 0;
    bb.acquisitionTime += dt;
    bb.lastKnownPosition.x = best.position.x;
    bb.lastKnownPosition.y = best.position.y;
    bb.lastKnownPosition.z = best.position.z;
  } else {
    bb.acquisitionTime = 0;
    if (bb.timeSinceSeen > profile.memoryDuration) bb.target = null;
  }
}

// --- Navigation --------------------------------------------------------------

function ensurePath(bb: BotBlackboard, goal: Vec3, force = false): boolean {
  bb.repathTimer -= 1 / 64;
  const goalNode = bb.nav.nearestNode(goal);
  if (goalNode < 0) return false;
  if (!force && goalNode === bb.pathGoal && bb.pathIndex < bb.path.length && bb.repathTimer > 0) {
    return true;
  }
  const startNode = bb.nav.nearestNode(bb.actor.position);
  if (startNode < 0) return false;

  const length = bb.nav.findPath(startNode, goalNode, bb.path);
  bb.pathIndex = 0;
  bb.pathGoal = goalNode;
  // Re-plan on a cadence rather than every tick: this is the AI time-slicing budget in practice.
  bb.repathTimer = 0.6 + bb.rng.range(0, 0.4);
  return length > 0;
}

/** Advances along the current path and writes a world-space heading into `desiredMove`. */
function followPath(bb: BotBlackboard): boolean {
  const { actor, nav } = bb;
  while (bb.pathIndex < bb.path.length) {
    const node = nav.nodes[bb.path[bb.pathIndex]];
    const dx = node.x - actor.position.x;
    const dz = node.z - actor.position.z;
    const dy = node.y - actor.position.y;
    const horizontal = Math.hypot(dx, dz);
    // Node reached when we are close horizontally and roughly on its level.
    if (horizontal < 1.1 && Math.abs(dy) < 1.2) {
      bb.pathIndex++;
      continue;
    }
    const inv = 1 / Math.max(horizontal, 1e-4);
    bb.desiredMove.x = dx * inv;
    bb.desiredMove.z = dz * inv;
    // Step up onto ledges and ramps the path implies.
    if (dy > 0.5 && horizontal < 2.2) bb.wantsJump = true;
    return true;
  }
  bb.desiredMove.x = 0;
  bb.desiredMove.z = 0;
  return false;
}

// --- Behaviors ---------------------------------------------------------------

function aimAtTarget(bb: BotBlackboard, target: Actor): void {
  const { actor, profile } = bb;
  const eye = eyeOf(actor, scratchEyeA);
  const targetEye = eyeOf(target, scratchEyeB);
  const distance = dist3(eye, targetEye);

  // Lead the shot by the bolt's travel time, scaled by how good this difficulty is at it.
  const speed = WEAPONS[actor.weapon.id].projectileSpeed;
  const travel = distance / speed;
  const lead = profile.leadAccuracy * travel;
  const px = targetEye.x + target.velocity.x * lead;
  const py = targetEye.y + target.velocity.y * lead;
  const pz = targetEye.z + target.velocity.z * lead;

  const dx = px - eye.x;
  const dy = py - eye.y;
  const dz = pz - eye.z;
  const horizontal = Math.hypot(dx, dz);

  bb.aimYaw = Math.atan2(-dx, -dz) + bb.aimErrorYaw;
  bb.aimPitch = Math.atan2(dy, horizontal) + bb.aimErrorPitch;
}

function combatMovement(bb: BotBlackboard, target: Actor, dt: number): void {
  const { actor, profile, rng } = bb;
  const distance = dist3(actor.position, target.position);

  bb.strafeTimer -= dt;
  if (bb.strafeTimer <= 0) {
    bb.strafeTimer = rng.range(0.5, 1.4);
    bb.strafeDirection = rng.next() < 0.5 ? -1 : 1;
  }

  const toX = target.position.x - actor.position.x;
  const toZ = target.position.z - actor.position.z;
  const inv = 1 / Math.max(Math.hypot(toX, toZ), 1e-4);
  const fx = toX * inv;
  const fz = toZ * inv;
  // Perpendicular in the ground plane.
  const sx = -fz * bb.strafeDirection;
  const sz = fx * bb.strafeDirection;

  // Close the gap when far, back off when uncomfortably close, circle in the sweet spot.
  const approach = distance > 22 ? 1 : distance < 7 ? -0.8 : 0.15;

  const strafeWeight = rng.next() < profile.strafeChance ? 1 : 0.35;
  bb.desiredMove.x = fx * approach + sx * strafeWeight;
  bb.desiredMove.z = fz * approach + sz * strafeWeight;
  const len = Math.hypot(bb.desiredMove.x, bb.desiredMove.z);
  if (len > 1e-4) {
    bb.desiredMove.x /= len;
    bb.desiredMove.z /= len;
  }

  bb.wantsSprint = distance > 20;
  // Occasional jumps and slides so bots are not flat targets, scaled by difficulty.
  if (rng.next() < 0.012 * profile.movementFlair) bb.wantsJump = true;
  if (distance < 14 && rng.next() < 0.008 * profile.movementFlair) bb.wantsCrouch = true;
}

function buildTree(freeForAll: boolean): BtNode<BotBlackboard> {
  const dead = new ReactiveSequence<BotBlackboard>('dead', [
    new Condition('is-dead', (bb) => !bb.actor.alive),
    new Action('wait-respawn', (bb) => {
      bb.desiredMove.x = 0;
      bb.desiredMove.z = 0;
      bb.wantsFire = false;
      return 'running' as NodeStatus;
    }),
  ]);

  const retreat = new ReactiveSequence<BotBlackboard>('retreat', [
    new Condition('is-hurt', (bb) => {
      const total = bb.actor.health + bb.actor.shield;
      const max = COMBAT.maxHealth + COMBAT.maxShield;
      return bb.target !== null && total / max < bb.profile.retreatThreshold;
    }),
    new Action('find-cover', (bb, dt) => {
      const threat = bb.target ? eyeOf(bb.target, scratchEyeB) : bb.lastKnownPosition;
      // Only look for a fresh cover node when the current plan has run out.
      if (bb.pathIndex >= bb.path.length || bb.repathTimer <= 0) {
        const coverNode = bb.nav.findCoverNode(bb.physics, bb.actor.position, threat, 18);
        if (coverNode >= 0) {
          const node = bb.nav.nodes[coverNode];
          ensurePath(bb, { x: node.x, y: node.y, z: node.z }, true);
        }
      }
      const moving = followPath(bb);
      bb.wantsSprint = true;
      // Keep shooting back while disengaging if the target is still visible.
      if (bb.target && bb.target.alive && bb.timeSinceSeen < 0.2) {
        aimAtTarget(bb, bb.target);
        bb.wantsFire = bb.acquisitionTime > bb.profile.reactionTime && bb.rng.next() < 0.4;
      }
      void dt;
      return moving ? ('running' as NodeStatus) : ('success' as NodeStatus);
    }),
  ]);

  const engage = new ReactiveSequence<BotBlackboard>('engage', [
    new Condition(
      'has-visible-target',
      (bb) => bb.target !== null && bb.target.alive && bb.timeSinceSeen < 0.15,
    ),
    new Action('fight', (bb, dt) => {
      // The guard above re-checks every tick, but a target can also die inside this same tick
      // (another bot's bolt lands first), so the action stays defensive rather than asserting.
      const target = bb.target;
      if (!target || !target.alive) return 'failure' as NodeStatus;
      aimAtTarget(bb, target);
      combatMovement(bb, target, dt);

      // Fire only once reaction time has elapsed and the aim is actually near the target.
      const aimError = Math.abs(angleDelta(bb.actor.yaw, bb.aimYaw));
      const ready = bb.acquisitionTime >= bb.profile.reactionTime;
      const onTarget = aimError < 0.12 + bb.profile.aimErrorDegrees * DEG2RAD;
      bb.wantsFire = ready && onTarget && !bb.actor.weapon.recharging;
      return 'running' as NodeStatus;
    }),
  ]);

  const search = new ReactiveSequence<BotBlackboard>('search', [
    new Condition(
      'has-memory',
      (bb) => bb.target !== null && bb.timeSinceSeen < bb.profile.memoryDuration,
    ),
    new Action('move-to-last-known', (bb) => {
      ensurePath(bb, bb.lastKnownPosition);
      const moving = followPath(bb);
      bb.wantsSprint = true;
      // Look where we are going so we are not caught aiming at nothing.
      if (Math.hypot(bb.desiredMove.x, bb.desiredMove.z) > 0.1) {
        bb.aimYaw = Math.atan2(-bb.desiredMove.x, -bb.desiredMove.z);
        bb.aimPitch = 0;
      }
      return moving ? ('running' as NodeStatus) : ('failure' as NodeStatus);
    }),
  ]);

  // Walk toward a noise. Sits below `search` (a seen enemy always outranks a heard one) and above
  // `roam`, so an idle bot investigates gunfire instead of wandering past it.
  const investigate = new ReactiveSequence<BotBlackboard>('investigate', [
    new Condition('heard-something', (bb) => bb.investigateTimer > 0),
    new Action('move-to-noise', (bb) => {
      ensurePath(bb, bb.heardPosition);
      const moving = followPath(bb);
      bb.wantsSprint = true;
      if (Math.hypot(bb.desiredMove.x, bb.desiredMove.z) > 0.1) {
        bb.aimYaw = Math.atan2(-bb.desiredMove.x, -bb.desiredMove.z);
        bb.aimPitch = 0;
      }
      // Arrived and found nothing: drop the cue rather than loitering on it.
      if (!moving) {
        bb.investigateTimer = 0;
        return 'failure' as NodeStatus;
      }
      return 'running' as NodeStatus;
    }),
  ]);

  const roam = new Action<BotBlackboard>('roam', (bb) => {
    if (bb.pathIndex >= bb.path.length || bb.repathTimer <= 0) {
      // Head for a random well-connected node, biased toward the arena centre where fights happen.
      const nodes = bb.nav.nodes;
      let bestNode = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < 12; i++) {
        const candidate = nodes[bb.rng.int(0, nodes.length)];
        if (!candidate) continue;
        const centreBias = -Math.hypot(candidate.x, candidate.z) * 0.08;
        const away = Math.min(30, dist3(bb.actor.position, candidate)) * 0.12;
        const score = centreBias + away + candidate.openness * 0.2 + bb.rng.range(0, 2);
        if (score > bestScore) {
          bestScore = score;
          bestNode = candidate.index;
        }
      }
      if (bestNode >= 0) {
        const node = nodes[bestNode];
        ensurePath(bb, { x: node.x, y: node.y, z: node.z }, true);
      }
    }
    followPath(bb);
    bb.wantsSprint = true;
    if (Math.hypot(bb.desiredMove.x, bb.desiredMove.z) > 0.1) {
      bb.aimYaw = Math.atan2(-bb.desiredMove.x, -bb.desiredMove.z);
      bb.aimPitch = 0;
    }
    return 'running' as NodeStatus;
  });

  void freeForAll;
  return new Selector<BotBlackboard>('root', [dead, retreat, engage, search, investigate, roam]);
}

export class BotBrain {
  private readonly tree: BtNode<BotBlackboard>;

  constructor(
    readonly blackboard: BotBlackboard,
    freeForAll: boolean,
  ) {
    this.tree = buildTree(freeForAll);
  }

  /**
   * Reports a noise the bot may have heard.
   *
   * Hearing deliberately does not create a target — it writes a last-known position, which drops
   * the bot into its existing `search` branch. The result is a bot that walks toward gunfire it
   * cannot see and clears the corner, rather than one that snaps onto an unseen enemy. Walls do
   * not block it, but distance does, and a nearer noise always wins.
   */
  hear(position: Vec3, loudness: number, sourceId: number, hostile: boolean): void {
    const bb = this.blackboard;
    const actor = bb.actor;
    if (!actor.alive || sourceId === actor.id || !hostile) return;

    const distance = dist3(actor.position, position);
    if (distance > loudness) return;

    // A bot already engaging someone does not get distracted by a noise behind it.
    if (bb.target && bb.timeSinceSeen < 0.3) return;
    // Keep the closest cue while one is already being investigated.
    if (bb.investigateTimer > 0 && dist3(actor.position, bb.heardPosition) < distance) return;

    bb.heardPosition.x = position.x;
    bb.heardPosition.y = position.y;
    bb.heardPosition.z = position.z;
    // Louder cues are worth investigating for longer; gunfire pulls a bot much further than a step.
    bb.investigateTimer = 2.5 + (loudness / 42) * 3.5;
    // Force a re-plan so the bot actually starts walking toward it this tick.
    bb.repathTimer = 0;
    bb.pathGoal = -1;
  }

  /** Produces this tick's InputFrame on the bot's actor. */
  step(dt: number, freeForAll: boolean): void {
    const bb = this.blackboard;
    const actor = bb.actor;
    const input = resetInputFrame(actor.input);

    updatePerception(bb, dt, freeForAll);
    bb.investigateTimer = Math.max(0, bb.investigateTimer - dt);
    // Seeing someone supersedes any noise we were walking toward.
    if (bb.target && bb.timeSinceSeen < 0.15) bb.investigateTimer = 0;

    bb.decisionTimer -= dt;
    if (bb.decisionTimer <= 0) {
      bb.decisionTimer = bb.profile.decisionInterval;
      // Resample aim error so the bot's shots scatter over time rather than sitting at a fixed bias.
      const err = bb.profile.aimErrorDegrees * DEG2RAD;
      bb.aimErrorYaw = bb.rng.spread(err);
      bb.aimErrorPitch = bb.rng.spread(err * 0.6);
    }

    bb.wantsJump = false;
    bb.wantsCrouch = false;
    bb.wantsSprint = false;
    bb.wantsFire = false;
    bb.desiredMove.x = 0;
    bb.desiredMove.z = 0;

    this.tree.tick(bb, dt);

    if (!actor.alive) {
      input.tick = bb.state.tick;
      return;
    }

    this.detectStuck(bb, dt);
    this.writeInput(bb, dt);
    input.tick = bb.state.tick;
  }

  /** A bot pinned against geometry jumps and side-steps rather than grinding into a wall forever. */
  private detectStuck(bb: BotBlackboard, dt: number): void {
    const moved = distSq3(bb.actor.position, bb.lastPosition);
    const wantsToMove = Math.hypot(bb.desiredMove.x, bb.desiredMove.z) > 0.2;
    if (wantsToMove && moved < 0.0009) {
      bb.stuckTimer += dt;
    } else {
      bb.stuckTimer = 0;
    }
    bb.lastPosition.x = bb.actor.position.x;
    bb.lastPosition.y = bb.actor.position.y;
    bb.lastPosition.z = bb.actor.position.z;

    if (bb.stuckTimer > 0.45) {
      bb.wantsJump = true;
      // Rotate the heading away from whatever we are jammed against.
      const angle = bb.rng.range(1.0, 2.2) * (bb.rng.next() < 0.5 ? -1 : 1);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const nx = bb.desiredMove.x * cos - bb.desiredMove.z * sin;
      const nz = bb.desiredMove.x * sin + bb.desiredMove.z * cos;
      bb.desiredMove.x = nx;
      bb.desiredMove.z = nz;
      if (bb.stuckTimer > 1.2) {
        bb.repathTimer = 0;
        bb.pathGoal = -1;
        bb.stuckTimer = 0;
      }
    }
  }

  /** Converts blackboard intent into the same InputFrame a keyboard would produce. */
  private writeInput(bb: BotBlackboard, dt: number): void {
    const actor = bb.actor;
    const input = actor.input;

    // Look: turn toward the aim target at the profile's turn rate, never instantly.
    const maxTurn = bb.profile.turnRate * dt;
    const yawDelta = clamp(angleDelta(actor.yaw, bb.aimYaw), -maxTurn, maxTurn);
    const pitchDelta = clamp(bb.aimPitch - actor.pitch, -maxTurn, maxTurn);
    input.lookYaw = yawDelta;
    input.lookPitch = pitchDelta;

    // Movement: project the world-space heading onto the bot's own facing axes.
    const basis = groundBasis(actor.yaw + yawDelta);
    const mx = bb.desiredMove.x;
    const mz = bb.desiredMove.z;
    input.moveX = clamp(mx * basis.rx + mz * basis.rz, -1, 1);
    input.moveZ = clamp(mx * basis.fx + mz * basis.fz, -1, 1);

    input.sprint = bb.wantsSprint && input.moveZ > 0.4;
    input.crouch = bb.wantsCrouch;
    input.crouchPressed = bb.wantsCrouch;
    input.jump = bb.wantsJump;
    input.jumpPressed = bb.wantsJump;
    input.fire = bb.wantsFire;
    input.firePressed = bb.wantsFire;
    // Vent proactively when out of a fight rather than being caught empty.
    input.reloadPressed =
      !bb.wantsFire &&
      actor.weapon.charge <= 2 &&
      !actor.weapon.recharging &&
      bb.timeSinceSeen > 1.5;
    input.reload = input.reloadPressed;
  }
}

