import { COMBAT } from '@/config/combat';
import type { TeamId } from '@/config/teams';
import { WEAPONS, type WeaponId } from '@/config/weapons';
import { ObjectPool } from '@/engine/ObjectPool';
import type { EventBus } from '@/engine/EventBus';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { GROUP_PROJECTILE_QUERY } from '@/physics/layers';
import { clamp, type Vec3 } from '@/util/math';
import type { Actor, GameEvents, MatchState } from './types';

/**
 * Travelling photon bolts.
 *
 * Bolts are real entities, not hitscan: they take time to cross the arena, which is the whole
 * visual identity of laser tag and also makes leading a moving target a real skill. Collision is a
 * swept segment cast per tick rather than a sphere overlap, so a bolt at 132 m/s (2 m per tick)
 * can never tunnel through a wall.
 */

export interface Projectile {
  active: boolean;
  id: number;
  ownerId: number;
  team: TeamId;
  weapon: WeaponId;
  position: Vec3;
  prevPosition: Vec3;
  /** Where it was rendered last frame, so trails interpolate rather than pop. */
  renderPosition: Vec3;
  velocity: Vec3;
  life: number;
  distanceTravelled: number;
  damage: number;
}

const MAX_PROJECTILES = 256;

export class ProjectileSystem {
  private nextId = 1;
  readonly pool: ObjectPool<Projectile>;

  constructor() {
    this.pool = new ObjectPool<Projectile>(
      MAX_PROJECTILES,
      () => ({
        active: false,
        id: 0,
        ownerId: -1,
        team: 'red',
        weapon: 'photon_rifle',
        position: { x: 0, y: 0, z: 0 },
        prevPosition: { x: 0, y: 0, z: 0 },
        renderPosition: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        life: 0,
        distanceTravelled: 0,
        damage: 0,
      }),
      (p) => {
        p.active = true;
        p.life = 0;
        p.distanceTravelled = 0;
      },
    );
  }

  get active(): readonly Projectile[] {
    return this.pool.active;
  }

  spawn(
    owner: Actor,
    origin: Vec3,
    direction: Vec3,
    weaponId: WeaponId,
  ): Projectile | null {
    let projectile = this.pool.acquire();
    if (!projectile) {
      // Steal the oldest rather than dropping the shot — a missing bolt is worse than a short one.
      const oldest = this.pool.active.reduce((a, b) => (a.life > b.life ? a : b));
      this.pool.release(oldest);
      projectile = this.pool.acquire();
      if (!projectile) return null;
    }
    const config = WEAPONS[weaponId];

    projectile.id = this.nextId++;
    projectile.ownerId = owner.id;
    projectile.team = owner.team;
    projectile.weapon = weaponId;
    projectile.damage = config.damage;
    projectile.position.x = origin.x;
    projectile.position.y = origin.y;
    projectile.position.z = origin.z;
    projectile.prevPosition.x = origin.x;
    projectile.prevPosition.y = origin.y;
    projectile.prevPosition.z = origin.z;
    projectile.renderPosition.x = origin.x;
    projectile.renderPosition.y = origin.y;
    projectile.renderPosition.z = origin.z;
    projectile.velocity.x = direction.x * config.projectileSpeed;
    projectile.velocity.y = direction.y * config.projectileSpeed;
    projectile.velocity.z = direction.z * config.projectileSpeed;
    return projectile;
  }

  /**
   * Advances every bolt and resolves collisions.
   *
   * `rewind` is the lag-compensation hook. When supplied, bolts are resolved in owner order and the
   * world is rewound to each shooter's view of it before their bolts are tested — so a hit is
   * judged against what that player actually saw, not against where the target has since moved.
   * Passing `undefined` resolves everything against the present tick, which is correct offline.
   */
  step(
    state: MatchState,
    physics: PhysicsWorld,
    dt: number,
    events: EventBus<GameEvents>,
    friendlyFire: boolean,
    onDamage: (attacker: Actor, victim: Actor, amount: number, headshot: boolean) => void,
    rewind?: (ownerId: number, resolve: () => void) => void,
  ): void {
    if (rewind) {
      // Group by owner so the world is rewound once per shooter rather than once per bolt.
      const byOwner = new Map<number, Projectile[]>();
      for (const p of this.pool.active) {
        let list = byOwner.get(p.ownerId);
        if (!list) {
          list = [];
          byOwner.set(p.ownerId, list);
        }
        list.push(p);
      }
      // Stable owner order keeps resolution deterministic across client and server.
      for (const ownerId of [...byOwner.keys()].sort((a, b) => a - b)) {
        const owned = byOwner.get(ownerId)!;
        rewind(ownerId, () => {
          this.advance(owned, state, physics, dt, events, friendlyFire, onDamage);
        });
      }
      return;
    }
    this.advance([...this.pool.active], state, physics, dt, events, friendlyFire, onDamage);
  }

  /** Advances a specific set of bolts. Split out so lag compensation can batch by shooter. */
  private advance(
    actives: Projectile[],
    state: MatchState,
    physics: PhysicsWorld,
    dt: number,
    events: EventBus<GameEvents>,
    friendlyFire: boolean,
    onDamage: (attacker: Actor, victim: Actor, amount: number, headshot: boolean) => void,
  ): void {
    for (let i = actives.length - 1; i >= 0; i--) {
      const p = actives[i];
      const config = WEAPONS[p.weapon];

      p.prevPosition.x = p.position.x;
      p.prevPosition.y = p.position.y;
      p.prevPosition.z = p.position.z;

      if (config.projectileGravity !== 0) p.velocity.y -= config.projectileGravity * dt;

      const stepX = p.velocity.x * dt;
      const stepY = p.velocity.y * dt;
      const stepZ = p.velocity.z * dt;
      const stepLen = Math.hypot(stepX, stepY, stepZ);

      if (stepLen > 1e-6) {
        const dir: Vec3 = { x: stepX / stepLen, y: stepY / stepLen, z: stepZ / stepLen };
        // Sweep the bolt's radius by extending the cast slightly past the step.
        const hit = physics.raycast(
          p.prevPosition,
          dir,
          stepLen + config.projectileRadius,
          GROUP_PROJECTILE_QUERY,
        );

        if (hit) {
          const actorId = physics.actorIdForCollider(hit.colliderHandle);
          const victim = actorId !== null ? state.actors.get(actorId) : undefined;

          if (victim && victim.id !== p.ownerId && victim.alive) {
            const attacker = state.actors.get(p.ownerId);
            const sameTeam = attacker !== undefined && attacker.team === victim.team;
            if (!sameTeam || friendlyFire) {
              const headshot = isHeadshot(victim, hit.point.y);
              const damage = computeDamage(config, p.distanceTravelled + hit.distance, headshot);
              if (attacker) onDamage(attacker, victim, damage, headshot);
            }
            events.emit('projectile_impact', {
              position: hit.point,
              normal: hit.normal,
              team: p.team,
              hitActor: true,
              surface: 'barrier',
              incidence: 1,
            });
            this.pool.release(p);
            continue;
          }

          if (victim && victim.id === p.ownerId) {
            // Own capsule on the way out — push through instead of self-detonating.
            p.position.x += stepX;
            p.position.y += stepY;
            p.position.z += stepZ;
          } else {
            p.position.x = hit.point.x + hit.normal.x * 0.02;
            p.position.y = hit.point.y + hit.normal.y * 0.02;
            p.position.z = hit.point.z + hit.normal.z * 0.02;
            // Grazing angles ricochet; a square-on hit just splashes. dot of travel vs normal.
            const incidence = Math.abs(
              dir.x * hit.normal.x + dir.y * hit.normal.y + dir.z * hit.normal.z,
            );
            events.emit('projectile_impact', {
              position: hit.point,
              normal: hit.normal,
              team: p.team,
              hitActor: false,
              surface: physics.surfaceForCollider(hit.colliderHandle),
              incidence,
            });
            this.pool.release(p);
            continue;
          }
        } else {
          p.position.x += stepX;
          p.position.y += stepY;
          p.position.z += stepZ;
        }
      }

      p.distanceTravelled += stepLen;
      p.life += dt;
      if (p.life >= config.projectileLifetime) this.pool.release(p);
    }
  }

  clear(): void {
    this.pool.releaseAll();
  }
}

/** Damage falloff is linear between the two range markers, then flat. */
export function computeDamage(
  config: (typeof WEAPONS)[WeaponId],
  distance: number,
  headshot: boolean,
): number {
  let scale = 1;
  if (distance > config.falloffStart) {
    const t = clamp(
      (distance - config.falloffStart) / (config.falloffEnd - config.falloffStart),
      0,
      1,
    );
    scale = 1 + (config.minDamageScale - 1) * t;
  }
  const base = config.damage * scale;
  return headshot ? base * config.headshotMultiplier : base;
}

function isHeadshot(victim: Actor, hitY: number): boolean {
  const local = hitY - victim.position.y;
  return local >= victim.height * COMBAT.headshotHeightFraction;
}
