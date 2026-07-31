import type { GameModeConfig, MatchSettings } from '@/config/gameModes';
import type { TeamId } from '@/config/teams';
import type { EventBus } from '@/engine/EventBus';
import type { TriggerSystem } from '../TriggerSystem';
import type { Actor, GameEvents, MatchState } from '../types';

/**
 * A game mode is a strategy object over the same simulation.
 *
 * Modes never touch movement, weapons or physics — those are identical in every mode, and that is
 * the point. A mode only decides three things: what scores, when the match ends, and where players
 * spawn. Everything else is shared, so adding a mode cannot destabilise combat.
 *
 * All hooks are called from inside the fixed-step tick and must obey the same rules as the rest of
 * the simulation: deterministic, no allocation in the hot path, no presentation state.
 */
export interface GameMode {
  readonly config: GameModeConfig;

  /** Called once when the match enters the active phase. */
  start(state: MatchState, triggers: TriggerSystem, events: EventBus<GameEvents>): void;

  /** Called every tick while the match is active. */
  tick(
    state: MatchState,
    triggers: TriggerSystem,
    dt: number,
    events: EventBus<GameEvents>,
  ): void;

  /**
   * Called when an actor is eliminated. Returns points awarded to the killer's score key, which
   * the director applies — the mode does not mutate scores directly, so all scoring flows through
   * one place and stays easy to audit.
   */
  onElimination(
    state: MatchState,
    victim: Actor,
    killer: Actor | null,
    events: EventBus<GameEvents>,
  ): number;

  onSpawn?(state: MatchState, actor: Actor): void;

  /** Score key an actor contributes to: team id normally, actor id in free-for-all. */
  scoreKey(actor: Actor): string;

  /** True when the mode's win condition has been met. */
  isComplete(state: MatchState): boolean;

  /** Winner when complete, or null for a draw. */
  winner(state: MatchState): TeamId | null;

  /** Human-readable objective line for the HUD tracker. */
  objectiveStatus(state: MatchState, triggers: TriggerSystem): ObjectiveStatus;

  /** Whether eliminated players respawn. Elimination modes say no until the round ends. */
  allowsRespawn(state: MatchState, actor: Actor): boolean;
}

export interface ObjectiveStatus {
  label: string;
  detail: string;
  controllingTeam: TeamId | null;
  contested: boolean;
  /** 0..1 progress toward the current objective, for a HUD bar. -1 when not applicable. */
  progress: number;
}

/**
 * Shared behaviour every mode inherits. Subclasses override only what differs, which keeps each
 * concrete mode down to the handful of rules that actually distinguish it.
 */
export abstract class BaseGameMode implements GameMode {
  constructor(
    readonly config: GameModeConfig,
    protected readonly settings: MatchSettings,
  ) {}

  // Base implementations keep the full signature even though they ignore it: an override with a
  // narrower parameter list is not assignable, so trimming these breaks every subclass.
  start(_state: MatchState, _triggers: TriggerSystem, _events: EventBus<GameEvents>): void {
    /* Most modes need no setup. */
  }

  tick(
    _state: MatchState,
    _triggers: TriggerSystem,
    _dt: number,
    _events: EventBus<GameEvents>,
  ): void {
    /* Most modes score only on elimination. */
  }

  onElimination(
    _state: MatchState,
    victim: Actor,
    killer: Actor | null,
    _events: EventBus<GameEvents>,
  ): number {
    if (!killer || killer.id === victim.id) return 0;
    return this.config.points.elimination ?? 0;
  }

  scoreKey(actor: Actor): string {
    return this.config.freeForAll ? String(actor.id) : actor.team;
  }

  isComplete(state: MatchState): boolean {
    if (this.settings.scoreLimit <= 0) return false;
    return Object.values(state.scores).some((score) => score >= this.settings.scoreLimit);
  }

  winner(state: MatchState): TeamId | null {
    let best: string | null = null;
    let bestScore = -Infinity;
    let tied = false;
    for (const [key, score] of Object.entries(state.scores)) {
      if (score > bestScore) {
        bestScore = score;
        best = key;
        tied = false;
      } else if (score === bestScore) {
        tied = true;
      }
    }
    return tied || best === null ? null : (best as TeamId);
  }

  objectiveStatus(_state: MatchState, _triggers: TriggerSystem): ObjectiveStatus {
    return {
      label: this.config.name.toUpperCase(),
      detail: `First to ${this.settings.scoreLimit}`,
      controllingTeam: null,
      contested: false,
      progress: -1,
    };
  }

  allowsRespawn(_state: MatchState, _actor: Actor): boolean {
    return this.config.respawnEnabled;
  }

  /** Highest and second-highest scores, for sudden-death and margin checks. */
  protected topScores(state: MatchState): { leader: string | null; top: number; second: number } {
    let leader: string | null = null;
    let top = -Infinity;
    let second = -Infinity;
    for (const [key, score] of Object.entries(state.scores)) {
      if (score > top) {
        second = top;
        top = score;
        leader = key;
      } else if (score > second) {
        second = score;
      }
    }
    return { leader, top, second: second === -Infinity ? 0 : second };
  }
}
