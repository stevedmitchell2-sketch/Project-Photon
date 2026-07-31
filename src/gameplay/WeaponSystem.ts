import { WEAPONS } from '@/config/weapons';
import type { EventBus } from '@/engine/EventBus';
import { clamp, damp, DEG2RAD, forwardFromLook, speedXZ, type Vec3 } from '@/util/math';
import type { Rng } from '@/util/rng';
import { eyePosition } from './MovementSystem';
import type { ProjectileSystem } from './ProjectileSystem';
import type { Actor, GameEvents } from './types';

/**
 * The PH-6 photon rifle.
 *
 * Six shots, then a forced recharge cycle — the core rhythm of the game. Two details make it feel
 * like equipment rather than a magazine: a partially drained cell trickles back on its own if you
 * stop shooting, and venting early (manual recharge) costs less than a full cycle proportional to
 * the charge you throw away. Both reward trigger discipline without punishing it with dead time.
 */

const MUZZLE_FORWARD = 0.42;
const MUZZLE_DOWN = 0.14;

export function stepWeapon(
  actor: Actor,
  dt: number,
  projectiles: ProjectileSystem,
  events: EventBus<GameEvents>,
  rng: Rng,
): void {
  const w = actor.weapon;
  const config = WEAPONS[w.id];
  const isLocal = actor.kind === 'local';
  actor.fx.firedThisTick = false;

  // ADS blend drives both FOV and sensitivity scaling on the presentation side.
  const adsTarget = actor.input.ads && actor.alive && actor.stance !== 'slide' ? 1 : 0;
  w.adsBlend = approach(w.adsBlend, adsTarget, dt / config.adsTime);

  // Recoil always recovers, even mid-recharge.
  w.recoilPitch = damp(w.recoilPitch, 0, config.recoilRecoveryHalfLife, dt);
  w.recoilYaw = damp(w.recoilYaw, 0, config.recoilRecoveryHalfLife, dt);

  w.cooldown = Math.max(0, w.cooldown - dt);
  w.sinceLastShot += dt;

  // Spread recovers toward the stance-appropriate floor.
  const floor = spreadFloor(actor, config);
  w.spread = Math.max(floor, w.spread - config.spreadRecovery * dt);

  if (!actor.alive) {
    w.recharging = false;
    return;
  }

  // --- Recharge cycle -----------------------------------------------------
  if (w.recharging) {
    w.rechargeProgress = Math.min(1, w.rechargeProgress + dt / config.rechargeDuration);
    if (w.rechargeProgress >= 1) {
      w.recharging = false;
      w.charge = config.cellCapacity;
      w.rechargeProgress = 1;
      events.emit('weapon_recharge_end', { actorId: actor.id, isLocal });
    }
    return;
  }

  // Manual vent: cheaper the emptier the cell, so topping off mid-fight is a real option.
  if (actor.input.reloadPressed && w.charge < config.cellCapacity) {
    startRecharge(actor, events, w.charge * config.ventCostPerShot);
    return;
  }

  // Idle trickle recovers a partially drained cell without a full cycle.
  if (w.charge < config.cellCapacity && w.sinceLastShot >= config.trickleDelay) {
    w.charge = Math.min(config.cellCapacity, w.charge + config.trickleRate * dt);
  }

  // --- Firing -------------------------------------------------------------
  if (!actor.input.fire || w.cooldown > 0) return;

  if (w.charge < 1) {
    startRecharge(actor, events, 0);
    return;
  }

  fire(actor, config, projectiles, events, rng);
}

function fire(
  actor: Actor,
  config: (typeof WEAPONS)[keyof typeof WEAPONS],
  projectiles: ProjectileSystem,
  events: EventBus<GameEvents>,
  rng: Rng,
): void {
  const w = actor.weapon;
  w.charge -= 1;
  w.cooldown = config.fireInterval;
  w.sinceLastShot = 0;
  actor.fx.firedThisTick = true;
  actor.spawnProtection = 0; // Shooting forfeits spawn protection.

  const eye = eyePosition(actor, { x: 0, y: 0, z: 0 });
  const aim = forwardFromLook(actor.yaw + w.recoilYaw, actor.pitch + w.recoilPitch);

  // Cone spread: random yaw/pitch offsets inside the current half-angle.
  const halfAngle = w.spread * DEG2RAD;
  const spreadYaw = rng.spread(halfAngle);
  const spreadPitch = rng.spread(halfAngle);
  const direction = forwardFromLook(
    actor.yaw + w.recoilYaw + spreadYaw,
    clamp(actor.pitch + w.recoilPitch + spreadPitch, -1.55, 1.55),
  );

  // Muzzle sits slightly forward and below the eye so the bolt reads as leaving the weapon.
  const origin: Vec3 = {
    x: eye.x + aim.x * MUZZLE_FORWARD,
    y: eye.y + aim.y * MUZZLE_FORWARD - MUZZLE_DOWN,
    z: eye.z + aim.z * MUZZLE_FORWARD,
  };

  projectiles.spawn(actor, origin, direction, config.id);

  // Recoil kicks the aim itself, not just the camera — what you see is what you shoot.
  const adsScale = 1 - w.adsBlend * 0.35;
  w.recoilPitch += config.recoilPitch * DEG2RAD * adsScale;
  w.recoilYaw += rng.spread(config.recoilYaw * DEG2RAD) * adsScale;
  w.spread = Math.min(config.spreadMax, w.spread + config.spreadPerShot);

  events.emit('shot_fired', {
    actorId: actor.id,
    team: actor.team,
    origin,
    direction,
    isLocal: actor.kind === 'local',
  });
  // Firing gives your position away. This is the loudest thing in the game by design: it is what
  // makes trigger discipline matter against bots that can hear.
  events.emit('noise', {
    position: { x: origin.x, y: origin.y, z: origin.z },
    loudness: 42,
    sourceId: actor.id,
    team: actor.team,
  });

  if (w.charge < 1) startRecharge(actor, events, 0);
}

function startRecharge(actor: Actor, events: EventBus<GameEvents>, headStart: number): void {
  const w = actor.weapon;
  if (w.recharging) return;
  w.recharging = true;
  w.rechargeProgress = clamp(headStart, 0, 0.85);
  w.charge = 0;
  events.emit('weapon_recharge_start', { actorId: actor.id, isLocal: actor.kind === 'local' });
}

function spreadFloor(actor: Actor, config: (typeof WEAPONS)[keyof typeof WEAPONS]): number {
  if (!actor.grounded) return config.spreadAir;
  const speed = speedXZ(actor.velocity);
  const moving = clamp(speed / 5, 0, 1);
  const base = config.spreadBase + (config.spreadMoving - config.spreadBase) * moving;
  // ADS collapses the cone, which is the reason to use it at range.
  return base + (config.spreadAds - base) * actor.weapon.adsBlend;
}

function approach(current: number, target: number, rate: number): number {
  if (current < target) return Math.min(target, current + rate);
  return Math.max(target, current - rate);
}

/** Field-of-view multiplier for the current ADS blend — read by the camera. */
export function weaponFovScale(actor: Actor): number {
  const config = WEAPONS[actor.weapon.id];
  return 1 + (config.adsFovScale - 1) * actor.weapon.adsBlend;
}

/** Aim sensitivity multiplier for the current ADS blend — applied by the input pipeline. */
export function weaponSensitivityScale(actor: Actor): number {
  const config = WEAPONS[actor.weapon.id];
  return 1 + (config.adsSensitivityScale - 1) * actor.weapon.adsBlend;
}
