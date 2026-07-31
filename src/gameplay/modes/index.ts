import { GAME_MODES, type GameModeId, type MatchSettings } from '@/config/gameModes';
import type { TeamId } from '@/config/teams';
import type { EventBus } from '@/engine/EventBus';
import type { TriggerSystem } from '../TriggerSystem';
import type { Actor, GameEvents, MatchState } from '../types';
import { BaseGameMode, type GameMode, type ObjectiveStatus } from './GameMode';

export type { GameMode, ObjectiveStatus } from './GameMode';

/** Team Deathmatch and Free For All: identical rules, different score keys. */
class DeathmatchMode extends BaseGameMode {}

/**
 * King of the Hill: the controlling team banks a point per tick while holding the hill uncontested.
 * Reads the trigger volume directly, which is exactly what TriggerSystem was built to provide.
 */
class KingOfTheHillMode extends BaseGameMode {
  private accumulator = 0;

  tick(state: MatchState, triggers: TriggerSystem, dt: number, events: EventBus<GameEvents>): void {
    const hill = triggers.get('central_hill');
    if (!hill || hill.contested || !hill.controllingTeam) return;

    // Score at a whole point per second rather than per tick, so the number on screen is readable.
    this.accumulator += dt;
    while (this.accumulator >= 1) {
      this.accumulator -= 1;
      const points = this.config.points.hold_tick ?? 1;
      state.scores[hill.controllingTeam] = (state.scores[hill.controllingTeam] ?? 0) + points;
      events.emit('score_changed', {
        team: hill.controllingTeam,
        score: state.scores[hill.controllingTeam],
      });
    }
  }

  objectiveStatus(state: MatchState, triggers: TriggerSystem): ObjectiveStatus {
    const hill = triggers.get('central_hill');
    return {
      label: 'THE HILL',
      detail: hill?.contested
        ? 'Contested'
        : hill?.controllingTeam
          ? `${hill.controllingTeam.toUpperCase()} holding`
          : 'Neutral — take the centre',
      controllingTeam: hill?.controllingTeam ?? null,
      contested: hill?.contested ?? false,
      progress:
        this.settings.scoreLimit > 0
          ? Math.max(...Object.values(state.scores), 0) / this.settings.scoreLimit
          : -1,
    };
  }
}

/**
 * Domination: three capture nodes, each banking points per second for whoever holds it.
 * Capturing requires sole occupancy for a short dwell, so a node cannot flip by running through it.
 */
class DominationMode extends BaseGameMode {
  private static readonly NODES = ['cap_a', 'cap_b', 'cap_c'];
  private static readonly CAPTURE_SECONDS = 3;
  private readonly owners = new Map<string, TeamId>();
  private accumulator = 0;

  start(): void {
    this.owners.clear();
  }

  tick(state: MatchState, triggers: TriggerSystem, dt: number, events: EventBus<GameEvents>): void {
    for (const id of DominationMode.NODES) {
      const node = triggers.get(id);
      if (!node || node.contested || !node.controllingTeam) continue;
      if (node.heldSeconds < DominationMode.CAPTURE_SECONDS) continue;
      if (this.owners.get(id) === node.controllingTeam) continue;

      this.owners.set(id, node.controllingTeam);
      const points = this.config.points.capture ?? 5;
      state.scores[node.controllingTeam] = (state.scores[node.controllingTeam] ?? 0) + points;
      events.emit('notification', {
        text: `${node.controllingTeam.toUpperCase()} CAPTURED ${id.slice(-1).toUpperCase()}`,
        tone: 'info',
      });
    }

    this.accumulator += dt;
    while (this.accumulator >= 1) {
      this.accumulator -= 1;
      for (const team of this.owners.values()) {
        state.scores[team] = (state.scores[team] ?? 0) + (this.config.points.hold_tick ?? 1);
      }
    }
  }

  objectiveStatus(state: MatchState, _triggers: TriggerSystem): ObjectiveStatus {
    const held = [...this.owners.values()];
    const counts = held.reduce<Partial<Record<TeamId, number>>>((acc, team) => {
      acc[team] = (acc[team] ?? 0) + 1;
      return acc;
    }, {});
    const leader = (Object.entries(counts).sort((a, b) => b[1]! - a[1]!)[0]?.[0] ?? null) as TeamId | null;
    return {
      label: 'DOMINATION',
      detail: `${this.owners.size}/3 nodes held`,
      controllingTeam: leader,
      contested: new Set(held).size > 1,
      progress:
        this.settings.scoreLimit > 0
          ? Math.max(...Object.values(state.scores), 0) / this.settings.scoreLimit
          : -1,
    };
  }
}

/**
 * Capture the Flag.
 *
 * Carrier state lives on the mode rather than on Actor, because it is mode-specific and Actor is
 * replicated to every client every snapshot. Keeping it here means CTF costs zero bytes of
 * bandwidth in the six modes that do not use it.
 */
class CaptureTheFlagMode extends BaseGameMode {
  /** actorId -> the flag they are carrying. */
  private readonly carriers = new Map<number, string>();
  /** flagId -> dropped position and the timer until it returns home. */
  private readonly dropped = new Map<string, { x: number; y: number; z: number; timer: number }>();
  private static readonly RETURN_SECONDS = 20;

  start(): void {
    this.carriers.clear();
    this.dropped.clear();
  }

  tick(state: MatchState, triggers: TriggerSystem, dt: number, events: EventBus<GameEvents>): void {
    // Pick-ups: an actor standing on an enemy flag that nobody is carrying.
    for (const flagId of ['flag_red', 'flag_blue']) {
      const volume = triggers.get(flagId);
      if (!volume) continue;
      const flagTeam = flagId === 'flag_red' ? 'red' : 'blue';
      if ([...this.carriers.values()].includes(flagId)) continue;

      for (const actorId of volume.occupants) {
        const actor = state.actors.get(actorId);
        if (!actor || !actor.alive) continue;
        if (actor.team === flagTeam) {
          // Own flag: returning it if it was dropped.
          if (this.dropped.delete(flagId)) {
            events.emit('notification', { text: `${flagTeam.toUpperCase()} FLAG RETURNED`, tone: 'info' });
          }
          continue;
        }
        this.carriers.set(actor.id, flagId);
        this.dropped.delete(flagId);
        events.emit('notification', { text: `${actor.name} TOOK THE FLAG`, tone: 'info' });
        break;
      }
    }

    // Captures: a carrier standing on their own base flag.
    for (const [actorId, flagId] of [...this.carriers]) {
      const actor = state.actors.get(actorId);
      if (!actor || !actor.alive) continue;
      const homeFlag = actor.team === 'red' ? 'flag_red' : 'flag_blue';
      if (flagId === homeFlag) continue;
      const home = triggers.get(homeFlag);
      if (!home || !home.occupants.includes(actorId)) continue;
      // Cannot capture while your own flag is away from base.
      if (this.dropped.has(homeFlag) || [...this.carriers.values()].includes(homeFlag)) continue;

      this.carriers.delete(actorId);
      const points = this.config.points.capture ?? 1;
      state.scores[actor.team] = (state.scores[actor.team] ?? 0) + points;
      events.emit('score_changed', { team: actor.team, score: state.scores[actor.team] });
      events.emit('announcement', { text: `${actor.team.toUpperCase()} scores`, priority: 'high' });
    }

    // Dropped flags return home after a timer.
    for (const [flagId, drop] of [...this.dropped]) {
      drop.timer -= dt;
      if (drop.timer <= 0) {
        this.dropped.delete(flagId);
        events.emit('notification', { text: `${flagId.slice(5).toUpperCase()} FLAG RESET`, tone: 'info' });
      }
    }
  }

  onElimination(
    state: MatchState,
    victim: Actor,
    killer: Actor | null,
    events: EventBus<GameEvents>,
  ): number {
    const carried = this.carriers.get(victim.id);
    if (carried) {
      this.carriers.delete(victim.id);
      this.dropped.set(carried, {
        x: victim.position.x,
        y: victim.position.y,
        z: victim.position.z,
        timer: CaptureTheFlagMode.RETURN_SECONDS,
      });
    }
    return super.onElimination(state, victim, killer, events);
  }

  isCarrying(actorId: number): boolean {
    return this.carriers.has(actorId);
  }

  objectiveStatus(state: MatchState, _triggers: TriggerSystem): ObjectiveStatus {
    const carrierCount = this.carriers.size;
    return {
      label: 'CAPTURE THE FLAG',
      detail: carrierCount > 0 ? 'Flag in transit' : 'Flags secure',
      controllingTeam: null,
      contested: carrierCount > 0,
      progress:
        this.settings.scoreLimit > 0
          ? Math.max(...Object.values(state.scores), 0) / this.settings.scoreLimit
          : -1,
    };
  }
}

/**
 * Elimination / Last Team Standing: one life per round, round won by the last team with anyone left.
 */
class EliminationMode extends BaseGameMode {
  private roundOver = false;

  start(): void {
    this.roundOver = false;
  }

  allowsRespawn(): boolean {
    return false;
  }

  tick(
    state: MatchState,
    _triggers: TriggerSystem,
    _dt: number,
    events: EventBus<GameEvents>,
  ): void {
    if (this.roundOver) return;
    const alive = this.aliveTeams(state);
    if (alive.length > 1) return;

    this.roundOver = true;
    const winner = alive[0];
    if (winner) {
      state.scores[winner] = (state.scores[winner] ?? 0) + (this.config.points.objective ?? 1);
      events.emit('announcement', { text: `${winner.toUpperCase()} wins the round`, priority: 'high' });
    }
  }

  isComplete(state: MatchState): boolean {
    return super.isComplete(state);
  }

  objectiveStatus(state: MatchState, _triggers: TriggerSystem): ObjectiveStatus {
    const alive = this.aliveTeams(state);
    return {
      label: 'ELIMINATION',
      detail: `${alive.length} team${alive.length === 1 ? '' : 's'} remaining`,
      controllingTeam: alive.length === 1 ? alive[0] : null,
      contested: alive.length > 1,
      progress: -1,
    };
  }

  private aliveTeams(state: MatchState): TeamId[] {
    const teams = new Set<TeamId>();
    for (const actor of state.actors.values()) {
      if (actor.alive) teams.add(actor.team);
    }
    return [...teams];
  }
}

/** Training: no scoring, no clock, infinite respawns. */
class TrainingMode extends BaseGameMode {
  isComplete(): boolean {
    return false;
  }

  objectiveStatus(_state: MatchState, _triggers: TriggerSystem): ObjectiveStatus {
    return {
      label: 'TRAINING',
      detail: 'Free practice',
      controllingTeam: null,
      contested: false,
      progress: -1,
    };
  }
}

/**
 * Factory. Adding a mode means adding a case here and a config entry — no changes to the director,
 * the netcode, or any gameplay system.
 */
export function createGameMode(settings: MatchSettings): GameMode {
  const config = GAME_MODES[settings.mode];
  const id: GameModeId = settings.mode;

  switch (id) {
    case 'king_of_the_hill':
      return new KingOfTheHillMode(config, settings);
    case 'domination':
      return new DominationMode(config, settings);
    case 'capture_the_flag':
      return new CaptureTheFlagMode(config, settings);
    case 'elimination':
    case 'last_team_standing':
      return new EliminationMode(config, settings);
    case 'training':
      return new TrainingMode(config, settings);
    case 'team_deathmatch':
    case 'free_for_all':
    case 'bot_practice':
    default:
      return new DeathmatchMode(config, settings);
  }
}
