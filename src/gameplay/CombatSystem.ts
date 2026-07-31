import { COMBAT } from '@/config/combat';
import type { EventBus } from '@/engine/EventBus';
import type { Actor, GameEvents, MatchState } from './types';

/**
 * Health, shields, damage application and death.
 *
 * Shields absorb first and regenerate quickly; health regenerates slowly and only after a long
 * lull. That split gives skirmishes a fast reset but makes sustained pressure meaningful, which is
 * what keeps arena fights moving instead of turning into attrition standoffs.
 */

export function stepRegeneration(actor: Actor, dt: number): void {
  if (!actor.alive) return;
  if (actor.sinceDamage >= COMBAT.shieldRegenDelay && actor.shield < COMBAT.maxShield) {
    actor.shield = Math.min(COMBAT.maxShield, actor.shield + COMBAT.shieldRegenRate * dt);
  }
  if (actor.sinceDamage >= COMBAT.healthRegenDelay && actor.health < COMBAT.maxHealth) {
    actor.health = Math.min(COMBAT.maxHealth, actor.health + COMBAT.healthRegenRate * dt);
  }
}

export interface DamageResult {
  applied: number;
  killed: boolean;
}

export function applyDamage(
  state: MatchState,
  attacker: Actor,
  victim: Actor,
  amount: number,
  headshot: boolean,
  events: EventBus<GameEvents>,
): DamageResult {
  if (!victim.alive || amount <= 0) return { applied: 0, killed: false };
  if (victim.spawnProtection > 0) return { applied: 0, killed: false };

  let remaining = amount;
  const shieldAbsorbed = Math.min(victim.shield, remaining);
  victim.shield -= shieldAbsorbed;
  remaining -= shieldAbsorbed;
  victim.health -= remaining;
  victim.sinceDamage = 0;

  // Track contributions so assists can be awarded on death.
  const prior = victim.damageContributions.get(attacker.id) ?? 0;
  victim.damageContributions.set(attacker.id, prior + amount);

  const killed = victim.health <= 0;
  // Same yaw convention as the camera (0 looks down -Z), so the HUD can subtract view yaw directly.
  const fromYaw = Math.atan2(
    -(attacker.position.x - victim.position.x),
    -(attacker.position.z - victim.position.z),
  );

  events.emit('damage_dealt', {
    attackerId: attacker.id,
    victimId: victim.id,
    amount,
    headshot,
    killed,
    attackerIsLocal: attacker.kind === 'local',
    victimIsLocal: victim.kind === 'local',
    fromYaw,
  });

  if (killed) killActor(state, victim, attacker, headshot, events);

  return { applied: amount, killed };
}

export function killActor(
  state: MatchState,
  victim: Actor,
  killer: Actor | null,
  headshot: boolean,
  events: EventBus<GameEvents>,
): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.health = 0;
  victim.shield = 0;
  victim.deaths += 1;
  victim.velocity.x = 0;
  victim.velocity.y = 0;
  victim.velocity.z = 0;
  victim.stance = 'stand';
  victim.mantleTime = 0;

  const selfInflicted = killer === null || killer.id === victim.id;
  if (!selfInflicted && killer) {
    killer.kills += 1;
    // Assists to everyone else who contributed meaningfully before the kill.
    for (const [contributorId, damage] of victim.damageContributions) {
      if (contributorId === killer.id) continue;
      if (damage < COMBAT.maxHealth * 0.25) continue;
      const contributor = state.actors.get(contributorId);
      if (contributor && contributor.team === killer.team) contributor.assists += 1;
    }
  }
  victim.damageContributions.clear();

  state.killFeed.unshift({
    id: state.tick,
    killer: selfInflicted ? victim.name : (killer?.name ?? 'Arena'),
    killerTeam: selfInflicted ? victim.team : (killer?.team ?? victim.team),
    victim: victim.name,
    victimTeam: victim.team,
    headshot,
    selfInflicted,
    time: state.time,
  });
  if (state.killFeed.length > COMBAT.killFeedMax) state.killFeed.length = COMBAT.killFeedMax;

  events.emit('actor_died', {
    actorId: victim.id,
    killerId: killer?.id ?? -1,
    isLocal: victim.kind === 'local',
    position: { ...victim.position },
  });
}

export function resetActorVitals(actor: Actor): void {
  actor.health = COMBAT.maxHealth;
  actor.shield = COMBAT.maxShield;
  actor.sinceDamage = COMBAT.healthRegenDelay;
  actor.alive = true;
  actor.spawnProtection = COMBAT.spawnProtection;
  actor.damageContributions.clear();
  actor.velocity.x = 0;
  actor.velocity.y = 0;
  actor.velocity.z = 0;
  actor.stance = 'stand';
  actor.slideTime = 0;
  actor.slideCooldown = 0;
  actor.mantleTime = 0;
  actor.lean = 0;
  actor.leanTarget = 0;
  actor.grounded = false;
  actor.airTime = 0;
  actor.jumpBuffer = 0;
  actor.weapon.charge = 6;
  actor.weapon.recharging = false;
  actor.weapon.rechargeProgress = 1;
  actor.weapon.cooldown = 0;
  actor.weapon.spread = 0;
  actor.weapon.recoilPitch = 0;
  actor.weapon.recoilYaw = 0;
  actor.weapon.adsBlend = 0;
}
