import type { EventBus } from '@/engine/EventBus';
import type { GameEvents } from './types';

/**
 * Match lifecycle state machine.
 *
 * Lobby → Ready → Warmup → Countdown → Active → (Sudden Death) → Ended → Scoreboard → Lobby
 *
 * This lives inside the simulation, not the UI, for one reason: every client must agree on which
 * phase the match is in and when it changed. Driving the flow from a UI screen would make the phase
 * a client opinion. Instead the server owns the machine, replicates `phase` and `phaseRemaining` in
 * every snapshot, and clients render whatever they are told.
 *
 * Phase durations are data so a competitive ruleset can lengthen warmup or drop sudden death
 * without touching this file.
 */

export type MatchPhaseId =
  | 'lobby'
  | 'warmup'
  | 'countdown'
  | 'active'
  | 'sudden_death'
  | 'ended'
  | 'scoreboard';

export interface MatchFlowConfig {
  /** Players needed before the lobby will start counting down. */
  minPlayers: number;
  /** Fraction of connected players who must be ready. */
  readyFraction: number;
  warmupSeconds: number;
  countdownSeconds: number;
  /** Extra time played when scores are level at the final whistle. 0 disables sudden death. */
  suddenDeathSeconds: number;
  scoreboardSeconds: number;
  /** Skip warmup entirely when the match is offline or against bots only. */
  skipWarmupOffline: boolean;
}

export const defaultMatchFlowConfig = (): MatchFlowConfig => ({
  minPlayers: 2,
  readyFraction: 0.6,
  warmupSeconds: 30,
  countdownSeconds: 5,
  suddenDeathSeconds: 90,
  scoreboardSeconds: 15,
  skipWarmupOffline: true,
});

export interface MatchFlowState {
  phase: MatchPhaseId;
  /** Seconds left in the current phase, or Infinity for phases that wait on a condition. */
  phaseRemaining: number;
  /** Incremented on every transition, so clients can detect one they missed. */
  phaseSequence: number;
  /** True once the match has been played at least once this session. */
  playedOnce: boolean;
}

export interface FlowInputs {
  connectedPlayers: number;
  readyPlayers: number;
  /** Whether the mode's win condition has been met. */
  modeComplete: boolean;
  /** Whether the match clock has expired. */
  timeExpired: boolean;
  /** Scores are level between the top two — used to decide on sudden death. */
  tied: boolean;
  /** Offline or bots-only, which skips the lobby ready gate entirely. */
  offline: boolean;
}

export class MatchFlow {
  readonly state: MatchFlowState = {
    phase: 'lobby',
    phaseRemaining: Infinity,
    phaseSequence: 0,
    playedOnce: false,
  };

  constructor(
    private readonly config: MatchFlowConfig = defaultMatchFlowConfig(),
    private readonly events?: EventBus<GameEvents>,
  ) {}

  get phase(): MatchPhaseId {
    return this.state.phase;
  }

  /** True while the simulation should be running combat. */
  get isPlaying(): boolean {
    return this.state.phase === 'active' || this.state.phase === 'sudden_death';
  }

  /** True while players can move but scoring is disabled. */
  get isWarmup(): boolean {
    return this.state.phase === 'warmup' || this.state.phase === 'countdown';
  }

  step(dt: number, inputs: FlowInputs): void {
    if (Number.isFinite(this.state.phaseRemaining)) {
      this.state.phaseRemaining = Math.max(0, this.state.phaseRemaining - dt);
    }

    switch (this.state.phase) {
      case 'lobby':
        this.stepLobby(inputs);
        break;

      case 'warmup':
        // Warmup ends early once everyone is ready — no reason to make a full lobby wait it out.
        if (this.state.phaseRemaining <= 0 || this.everyoneReady(inputs)) {
          this.transition('countdown', this.config.countdownSeconds);
        }
        break;

      case 'countdown':
        if (this.state.phaseRemaining <= 0) {
          this.transition('active', Infinity);
          this.announce('Match start', 'high');
        }
        break;

      case 'active':
        if (inputs.modeComplete) {
          this.endMatch();
        } else if (inputs.timeExpired) {
          // A tie at the whistle goes to sudden death rather than being called a draw.
          if (inputs.tied && this.config.suddenDeathSeconds > 0) {
            this.transition('sudden_death', this.config.suddenDeathSeconds);
            this.announce('Sudden death', 'high');
          } else {
            this.endMatch();
          }
        }
        break;

      case 'sudden_death':
        // First score wins outright; otherwise the clock decides and a draw stands.
        if (inputs.modeComplete || !inputs.tied || this.state.phaseRemaining <= 0) {
          this.endMatch();
        }
        break;

      case 'ended':
        if (this.state.phaseRemaining <= 0) {
          this.transition('scoreboard', this.config.scoreboardSeconds);
        }
        break;

      case 'scoreboard':
        if (this.state.phaseRemaining <= 0) {
          this.transition('lobby', Infinity);
        }
        break;
    }
  }

  private stepLobby(inputs: FlowInputs): void {
    if (inputs.offline) {
      // Offline play has nobody to wait for. Skip straight in if configured to.
      this.transition(
        this.config.skipWarmupOffline ? 'countdown' : 'warmup',
        this.config.skipWarmupOffline ? this.config.countdownSeconds : this.config.warmupSeconds,
      );
      return;
    }

    if (inputs.connectedPlayers < this.config.minPlayers) return;
    const required = Math.max(1, Math.ceil(inputs.connectedPlayers * this.config.readyFraction));
    if (inputs.readyPlayers >= required) {
      this.transition('warmup', this.config.warmupSeconds);
      this.announce('Warmup', 'low');
    }
  }

  private everyoneReady(inputs: FlowInputs): boolean {
    return inputs.connectedPlayers > 0 && inputs.readyPlayers >= inputs.connectedPlayers;
  }

  private endMatch(): void {
    this.state.playedOnce = true;
    this.transition('ended', 5);
  }

  /** Forces a phase. Used by an admin command and when a client joins mid-match. */
  forcePhase(phase: MatchPhaseId, duration = Infinity): void {
    this.transition(phase, duration);
  }

  private transition(phase: MatchPhaseId, duration: number): void {
    if (this.state.phase === phase) return;
    this.state.phase = phase;
    this.state.phaseRemaining = duration;
    this.state.phaseSequence++;
  }

  private announce(text: string, priority: 'low' | 'high'): void {
    this.events?.emit('announcement', { text, priority });
  }

  /** Compact form for replication — phase index plus remaining seconds. */
  serialize(): { phase: number; remaining: number; sequence: number } {
    return {
      phase: PHASE_ORDER.indexOf(this.state.phase),
      remaining: Number.isFinite(this.state.phaseRemaining)
        ? Math.round(this.state.phaseRemaining)
        : 0xffff,
      sequence: this.state.phaseSequence,
    };
  }

  applySerialized(data: { phase: number; remaining: number; sequence: number }): void {
    const phase = PHASE_ORDER[data.phase];
    if (!phase) return;
    this.state.phase = phase;
    this.state.phaseRemaining = data.remaining === 0xffff ? Infinity : data.remaining;
    this.state.phaseSequence = data.sequence;
  }
}

export const PHASE_ORDER: MatchPhaseId[] = [
  'lobby',
  'warmup',
  'countdown',
  'active',
  'sudden_death',
  'ended',
  'scoreboard',
];

/** Human-readable label for the HUD. */
export const PHASE_LABEL: Record<MatchPhaseId, string> = {
  lobby: 'Waiting for players',
  warmup: 'Warmup',
  countdown: 'Get ready',
  active: '',
  sudden_death: 'Sudden death',
  ended: 'Match over',
  scoreboard: 'Results',
};
