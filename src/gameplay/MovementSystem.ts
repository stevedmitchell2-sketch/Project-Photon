import { MOVEMENT } from '@/config/movement';
import type { EventBus } from '@/engine/EventBus';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { GROUP_PLAYER, GROUP_WORLD_QUERY } from '@/physics/layers';
import { clamp, damp, groundBasis, speedXZ, type Vec3 } from '@/util/math';
import type { Actor, GameEvents, Stance } from './types';

/**
 * Character movement.
 *
 * Feel model, in order of application each tick:
 *   look -> stance -> mantle -> horizontal accel/friction -> jump/gravity -> collide-and-slide.
 *
 * The horizontal model is Quake-style accelerate/friction rather than a velocity lerp, because
 * that is what produces the crisp direction changes on the ground and the floaty-but-controllable
 * air movement that modern shooters are tuned around. Sprint and slide then layer speed caps and
 * friction overrides on top of it.
 */

const MAX_PITCH = (89 * Math.PI) / 180;
const UP: Vec3 = { x: 0, y: 1, z: 0 };

/** Metres of stride between footsteps, scaled by stance. */
const STRIDE_WALK = 2.1;
const STRIDE_SPRINT = 2.6;

export function stepMovement(
  actor: Actor,
  physics: PhysicsWorld,
  dt: number,
  events: EventBus<GameEvents>,
): void {
  const isLocal = actor.kind === 'local';
  const input = actor.input;

  actor.prevPosition.x = actor.position.x;
  actor.prevPosition.y = actor.position.y;
  actor.prevPosition.z = actor.position.z;
  actor.prevYaw = actor.yaw;
  actor.prevPitch = actor.pitch;

  applyLook(actor, input.lookYaw, input.lookPitch);

  if (!actor.alive) {
    actor.velocity.x = 0;
    actor.velocity.y = 0;
    actor.velocity.z = 0;
    return;
  }

  // --- Mantle overrides everything while it plays out ----------------------
  if (actor.mantleTime > 0) {
    stepMantle(actor, physics, dt);
    return;
  }

  actor.sinceDamage += dt;
  actor.slideCooldown = Math.max(0, actor.slideCooldown - dt);
  if (actor.spawnProtection > 0) actor.spawnProtection = Math.max(0, actor.spawnProtection - dt);

  const wasGrounded = actor.grounded;
  const horizontalSpeed = speedXZ(actor.velocity);

  // --- Stance -------------------------------------------------------------
  const nextStance = resolveStance(actor, physics, horizontalSpeed, dt, events);
  applyStanceHeight(actor, physics, nextStance, dt);

  // --- Wish direction in world space --------------------------------------
  const basis = groundBasis(actor.yaw);
  let wishX = basis.rx * input.moveX + basis.fx * input.moveZ;
  let wishZ = basis.rz * input.moveX + basis.fz * input.moveZ;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1e-4) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }

  const sprinting =
    input.sprint &&
    actor.grounded &&
    actor.stance === 'stand' &&
    input.moveZ > 0.25 &&
    Math.abs(input.moveX) < 0.9;

  const targetSpeed =
    actor.stance === 'slide'
      ? 0
      : actor.stance === 'crouch'
        ? MOVEMENT.crouchSpeed
        : sprinting
          ? MOVEMENT.sprintSpeed
          : MOVEMENT.walkSpeed;

  const wishSpeed = wishLen > 1e-4 ? targetSpeed * Math.min(1, wishLen) : 0;

  if (actor.grounded) {
    if (actor.stance === 'slide') {
      applyFriction(actor.velocity, MOVEMENT.slideFriction, dt);
      // Slides keep almost all of their momentum; steering is deliberately weak so they commit.
      accelerate(actor.velocity, wishX, wishZ, MOVEMENT.sprintSpeed, MOVEMENT.slideSteerAccel, dt);
    } else {
      applyFriction(actor.velocity, MOVEMENT.groundFriction, dt);
      accelerate(actor.velocity, wishX, wishZ, wishSpeed, MOVEMENT.groundAccel, dt);
    }
  } else {
    accelerate(actor.velocity, wishX, wishZ, Math.min(wishSpeed, MOVEMENT.airSpeedCap), MOVEMENT.airAccel, dt);
    const airSpeed = speedXZ(actor.velocity);
    if (airSpeed > MOVEMENT.airSpeedCap * 1.35) {
      const scale = (MOVEMENT.airSpeedCap * 1.35) / airSpeed;
      actor.velocity.x *= scale;
      actor.velocity.z *= scale;
    }
  }

  // --- Jump, coyote time and buffering ------------------------------------
  if (input.jumpPressed) actor.jumpBuffer = MOVEMENT.jumpBufferTime;
  actor.jumpBuffer = Math.max(0, actor.jumpBuffer - dt);

  const canCoyote = actor.airTime <= MOVEMENT.coyoteTime;
  if (actor.jumpBuffer > 0 && canCoyote && actor.mantleTime <= 0) {
    if (tryMantle(actor, physics, events)) {
      actor.jumpBuffer = 0;
      return;
    }
    actor.velocity.y = MOVEMENT.jumpVelocity;
    actor.grounded = false;
    actor.airTime = MOVEMENT.coyoteTime + 0.001;
    actor.jumpBuffer = 0;
    if (actor.stance === 'slide') endSlide(actor);
    events.emit('jump', { actorId: actor.id, position: { ...actor.position }, isLocal });
  } else if (actor.jumpBuffer > 0 && !actor.grounded) {
    // Airborne jump press: still allowed to trigger a mantle onto a ledge.
    if (tryMantle(actor, physics, events)) {
      actor.jumpBuffer = 0;
      return;
    }
  }

  // --- Gravity ------------------------------------------------------------
  if (!actor.grounded) {
    const g = actor.velocity.y < 0 ? MOVEMENT.gravity * MOVEMENT.fallGravityMultiplier : MOVEMENT.gravity;
    actor.velocity.y -= g * dt;
    if (actor.velocity.y < -MOVEMENT.terminalVelocity) actor.velocity.y = -MOVEMENT.terminalVelocity;
  } else if (actor.velocity.y <= 0) {
    // Constant downward bias while grounded. This must be re-applied every tick even after the
    // floor zeroed our vertical velocity: Rapier reports `grounded` from the downward motion it
    // resolved this tick, so a tick with no downward push reads as airborne and the flag
    // oscillates — which in turn breaks coyote time, jump buffering and the landing sound.
    actor.velocity.y = -2;
  }

  // --- Collide and slide ---------------------------------------------------
  const desired: Vec3 = {
    x: actor.velocity.x * dt,
    y: actor.velocity.y * dt,
    z: actor.velocity.z * dt,
  };
  const result = physics.moveCharacter(actor.bodyHandle, desired, GROUP_PLAYER);

  actor.position.x += result.translation.x;
  actor.position.y += result.translation.y;
  actor.position.z += result.translation.z;

  // Blocked motion must be reflected in velocity, or you accumulate phantom speed into walls.
  if (Math.abs(result.translation.x - desired.x) > 1e-6) actor.velocity.x = result.translation.x / dt;
  if (Math.abs(result.translation.z - desired.z) > 1e-6) actor.velocity.z = result.translation.z / dt;
  if (result.translation.y > desired.y + 1e-6 && actor.velocity.y < 0) actor.velocity.y = 0;
  if (result.translation.y < desired.y - 1e-6 && actor.velocity.y > 0) actor.velocity.y = 0;

  syncBody(actor, physics);

  // --- Ground state and landing -------------------------------------------
  const impactSpeed = -actor.velocity.y;
  actor.grounded = result.grounded;
  if (actor.grounded) {
    actor.airTime = 0;
    if (!wasGrounded) {
      actor.fx.landedThisTick = Math.max(0, impactSpeed);
      events.emit('land', {
        actorId: actor.id,
        position: { ...actor.position },
        isLocal,
        impactSpeed: Math.max(0, impactSpeed),
      });
      if (actor.velocity.y < 0) actor.velocity.y = 0;
    }
  } else {
    actor.airTime += dt;
  }

  // --- Footsteps -----------------------------------------------------------
  if (actor.grounded && actor.stance !== 'slide') {
    const moved = Math.hypot(result.translation.x, result.translation.z);
    actor.fx.strideDistance += moved;
    const stride = sprinting ? STRIDE_SPRINT : STRIDE_WALK;
    if (actor.fx.strideDistance >= stride && moved > 1e-4) {
      actor.fx.strideDistance = 0;
      // One short probe per footstep (roughly every 2 m) tells us what we are walking on.
      const under = physics.raycast(
        { x: actor.position.x, y: actor.position.y + 0.25, z: actor.position.z },
        { x: 0, y: -1, z: 0 },
        0.6,
        GROUP_WORLD_QUERY,
      );
      const surface = under ? physics.surfaceForCollider(under.colliderHandle) : 'floor';
      events.emit('footstep', {
        actorId: actor.id,
        position: { ...actor.position },
        isLocal,
        running: sprinting,
        surface,
      });
      // Footsteps are audible to bots. Sprinting carries roughly twice as far as walking.
      events.emit('noise', {
        position: { ...actor.position },
        loudness: sprinting ? 17 : 9,
        sourceId: actor.id,
        team: actor.team,
      });
    }
  }

  // --- Lean ----------------------------------------------------------------
  actor.leanTarget = actor.stance === 'slide' ? 0 : clamp(input.lean, -1, 1);
  if (actor.leanTarget !== 0 && !isLeanClear(actor, physics)) actor.leanTarget = 0;
  actor.lean = damp(actor.lean, actor.leanTarget, MOVEMENT.leanLerpHalfLife, dt);
}

function applyLook(actor: Actor, dYaw: number, dPitch: number): void {
  actor.yaw += dYaw;
  // Keep yaw bounded so long sessions cannot lose float precision.
  if (actor.yaw > Math.PI) actor.yaw -= Math.PI * 2;
  else if (actor.yaw < -Math.PI) actor.yaw += Math.PI * 2;
  actor.pitch = clamp(actor.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
}

/** Quake-style accelerate: only adds speed along the wish direction, up to the wish speed. */
function accelerate(
  velocity: Vec3,
  wishX: number,
  wishZ: number,
  wishSpeed: number,
  accel: number,
  dt: number,
): void {
  if (wishSpeed <= 0) return;
  const currentSpeed = velocity.x * wishX + velocity.z * wishZ;
  const addSpeed = wishSpeed - currentSpeed;
  if (addSpeed <= 0) return;
  const accelSpeed = Math.min(accel * wishSpeed * dt, addSpeed);
  velocity.x += wishX * accelSpeed;
  velocity.z += wishZ * accelSpeed;
}

function applyFriction(velocity: Vec3, friction: number, dt: number): void {
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed < 0.05) {
    velocity.x = 0;
    velocity.z = 0;
    return;
  }
  // A stop-speed floor prevents the long asymptotic tail of pure exponential drag.
  const control = Math.max(speed, 2.5);
  const drop = control * friction * dt;
  const newSpeed = Math.max(0, speed - drop) / speed;
  velocity.x *= newSpeed;
  velocity.z *= newSpeed;
}

function resolveStance(
  actor: Actor,
  physics: PhysicsWorld,
  horizontalSpeed: number,
  dt: number,
  events: EventBus<GameEvents>,
): Stance {
  const input = actor.input;

  if (actor.stance === 'slide') {
    actor.slideTime += dt;
    const tooSlow = horizontalSpeed < MOVEMENT.crouchSpeed * 0.9;
    const expired = actor.slideTime >= MOVEMENT.slideMaxDuration;
    if (expired || tooSlow || !actor.grounded || input.jumpPressed) {
      endSlide(actor);
      return input.crouch && canFit(actor, physics, MOVEMENT.crouchHeight) ? 'crouch' : 'stand';
    }
    return 'slide';
  }

  // Entering a slide requires speed, the ground, and a fresh crouch press.
  if (
    input.crouchPressed &&
    actor.grounded &&
    actor.slideCooldown <= 0 &&
    horizontalSpeed >= MOVEMENT.slideMinEntrySpeed
  ) {
    actor.stance = 'slide';
    actor.slideTime = 0;
    // The slide launch converts a sprint into a burst, which is what makes it worth doing.
    const speed = Math.max(horizontalSpeed, 1e-3);
    const boost = (horizontalSpeed + MOVEMENT.slideStartSpeedBonus) / speed;
    actor.velocity.x *= boost;
    actor.velocity.z *= boost;
    events.emit('slide_start', {
      actorId: actor.id,
      position: { ...actor.position },
      isLocal: actor.kind === 'local',
    });
    return 'slide';
  }

  if (input.crouch) return 'crouch';
  // Standing back up requires headroom; otherwise stay crouched.
  return canFit(actor, physics, MOVEMENT.standHeight) ? 'stand' : 'crouch';
}

function endSlide(actor: Actor): void {
  actor.stance = 'stand';
  actor.slideTime = 0;
  actor.slideCooldown = MOVEMENT.slideCooldown;
}

function applyStanceHeight(actor: Actor, physics: PhysicsWorld, stance: Stance, dt: number): void {
  actor.stance = stance;
  actor.targetHeight =
    stance === 'slide'
      ? MOVEMENT.slideHeight
      : stance === 'crouch'
        ? MOVEMENT.crouchHeight
        : MOVEMENT.standHeight;

  const next = damp(actor.height, actor.targetHeight, MOVEMENT.stanceLerpHalfLife, dt);
  if (Math.abs(next - actor.height) > 1e-4) {
    actor.height = next;
    physics.setCharacterHeight(actor.bodyHandle, actor.height, MOVEMENT.radius);
    syncBody(actor, physics);
  }
}

/** True when there is headroom above the feet for a capsule of the given height. */
function canFit(actor: Actor, physics: PhysicsWorld, height: number): boolean {
  if (height <= actor.height) return true;
  const origin: Vec3 = {
    x: actor.position.x,
    y: actor.position.y + MOVEMENT.radius + 0.05,
    z: actor.position.z,
  };
  const distance = height - MOVEMENT.radius - 0.05;
  const hit = physics.raycast(origin, UP, distance, GROUP_WORLD_QUERY);
  return hit === null;
}

/** Leaning into a wall looks broken and gives free wallhacks; probe before allowing it. */
function isLeanClear(actor: Actor, physics: PhysicsWorld): boolean {
  const basis = groundBasis(actor.yaw);
  const sign = Math.sign(actor.leanTarget);
  const origin: Vec3 = {
    x: actor.position.x,
    y: actor.position.y + actor.height - MOVEMENT.eyeOffsetFromTop,
    z: actor.position.z,
  };
  const dir: Vec3 = { x: basis.rx * sign, y: 0, z: basis.rz * sign };
  const hit = physics.raycast(origin, dir, MOVEMENT.leanOffset + MOVEMENT.radius, GROUP_WORLD_QUERY);
  return hit === null;
}

/**
 * Ledge detection: probe forward at chest height for a wall, then probe down from just past it.
 * If the surface is within the mantle band and there is room to stand, start the mantle.
 */
function tryMantle(actor: Actor, physics: PhysicsWorld, events: EventBus<GameEvents>): boolean {
  const basis = groundBasis(actor.yaw);
  const forward: Vec3 = { x: basis.fx, y: 0, z: basis.fz };

  // Only mantle when actually moving into the surface.
  const intoWall = actor.velocity.x * forward.x + actor.velocity.z * forward.z;
  if (intoWall < 0.8 && actor.input.moveZ < 0.3) return false;

  const chest: Vec3 = {
    x: actor.position.x,
    y: actor.position.y + MOVEMENT.mantleMinHeight,
    z: actor.position.z,
  };
  const wall = physics.raycast(chest, forward, MOVEMENT.mantleReach, GROUP_WORLD_QUERY);
  if (!wall) return false;

  // Probe downward just beyond the wall face for the top surface.
  const probe: Vec3 = {
    x: actor.position.x + forward.x * (wall.distance + MOVEMENT.radius + 0.15),
    y: actor.position.y + MOVEMENT.mantleMaxHeight + 0.5,
    z: actor.position.z + forward.z * (wall.distance + MOVEMENT.radius + 0.15),
  };
  const ledge = physics.raycast(probe, { x: 0, y: -1, z: 0 }, MOVEMENT.mantleMaxHeight + 0.6, GROUP_WORLD_QUERY);
  if (!ledge) return false;

  const rise = ledge.point.y - actor.position.y;
  if (rise < MOVEMENT.mantleMinHeight || rise > MOVEMENT.mantleMaxHeight) return false;
  if (ledge.normal.y < 0.7) return false;

  // Confirm the destination has standing room.
  const headroom = physics.raycast(
    { x: ledge.point.x, y: ledge.point.y + 0.1, z: ledge.point.z },
    UP,
    MOVEMENT.crouchHeight,
    GROUP_WORLD_QUERY,
  );
  if (headroom) return false;

  actor.mantleFrom.x = actor.position.x;
  actor.mantleFrom.y = actor.position.y;
  actor.mantleFrom.z = actor.position.z;
  actor.mantleTo.x = ledge.point.x;
  actor.mantleTo.y = ledge.point.y + 0.02;
  actor.mantleTo.z = ledge.point.z;
  actor.mantleTime = MOVEMENT.mantleDuration;
  actor.velocity.x = 0;
  actor.velocity.y = 0;
  actor.velocity.z = 0;
  actor.grounded = false;
  if (actor.stance === 'slide') endSlide(actor);
  events.emit('mantle', { actorId: actor.id, isLocal: actor.kind === 'local' });
  return true;
}

function stepMantle(actor: Actor, physics: PhysicsWorld, dt: number): void {
  actor.mantleTime = Math.max(0, actor.mantleTime - dt);
  const t = 1 - actor.mantleTime / MOVEMENT.mantleDuration;

  // Up first, then forward — the shape that reads as "pulling yourself over" rather than floating.
  const vertical = Math.min(1, t / 0.55);
  const horizontal = t < 0.45 ? 0 : (t - 0.45) / 0.55;
  const ease = (v: number) => v * v * (3 - 2 * v);

  actor.position.y = actor.mantleFrom.y + (actor.mantleTo.y - actor.mantleFrom.y) * ease(vertical);
  const h = ease(clamp(horizontal, 0, 1));
  actor.position.x = actor.mantleFrom.x + (actor.mantleTo.x - actor.mantleFrom.x) * h;
  actor.position.z = actor.mantleFrom.z + (actor.mantleTo.z - actor.mantleFrom.z) * h;

  syncBody(actor, physics);

  if (actor.mantleTime <= 0) {
    actor.grounded = true;
    actor.airTime = 0;
    // A little forward carry so you exit the mantle already moving.
    const basis = groundBasis(actor.yaw);
    actor.velocity.x = basis.fx * 2.4;
    actor.velocity.z = basis.fz * 2.4;
  }
}

/** Physics stores capsule centres; the sim stores feet. One place converts between them. */
function syncBody(actor: Actor, physics: PhysicsWorld): void {
  physics.setCharacterPosition(actor.bodyHandle, {
    x: actor.position.x,
    y: actor.position.y + actor.height * 0.5,
    z: actor.position.z,
  });
}

/** Eye position in world space, including stance height and lean offset. */
export function eyePosition(actor: Actor, out: Vec3): Vec3 {
  const basis = groundBasis(actor.yaw);
  const leanX = basis.rx * actor.lean * MOVEMENT.leanOffset;
  const leanZ = basis.rz * actor.lean * MOVEMENT.leanOffset;
  out.x = actor.position.x + leanX;
  out.y = actor.position.y + actor.height - MOVEMENT.eyeOffsetFromTop;
  out.z = actor.position.z + leanZ;
  return out;
}
