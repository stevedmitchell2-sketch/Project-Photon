import { MOVEMENT } from '@/config/movement';
import { WEAPONS } from '@/config/weapons';
import type { Actor } from '@/gameplay/types';
import type { InputFrame } from '@/input/InputFrame';
import { clamp, speedXZ } from '@/util/math';
import { MAX_INPUT_PACKETS_PER_SECOND, MAX_INPUTS_PER_PACKET } from './protocol';

/**
 * Server-side input validation and anti-cheat.
 *
 * The security model is simple and load-bearing: **the client sends intent, never state.** A client
 * cannot set its position, health, or score because there is no message that carries them. That
 * removes the entire class of "edit a value in memory and win" cheats by construction, and leaves
 * a much smaller surface — lying about *intent* — which is what this module polices.
 *
 * What remains catchable here:
 *   - malformed or out-of-range input values (trivially rejected)
 *   - inputs arriving faster than real time (speed hacks)
 *   - impossible movement outcomes after simulation (teleports, fly hacks)
 *   - firing faster than the weapon permits
 *
 * What is explicitly *not* solved here: aimbots and wallhacks. Those need behavioural analysis and
 * server-side visibility culling respectively, and are noted in NEXT_TASK rather than pretended at.
 */

export interface ValidationConfig {
  /** How much faster than the theoretical maximum we tolerate before flagging. */
  speedTolerance: number;
  /** Position change per tick beyond which we treat it as a teleport. */
  maxTickDisplacement: number;
  /** Strikes before a client is kicked. */
  strikeLimit: number;
  /** Seconds of good behaviour that forgives one strike. */
  strikeDecaySeconds: number;
}

export const defaultValidationConfig = (): ValidationConfig => ({
  speedTolerance: 1.25,
  // Sprint + slide boost is ~11.2 m/s; one tick is 1/64 s. Generous headroom for slope and step.
  maxTickDisplacement: (MOVEMENT.sprintSpeed + MOVEMENT.slideStartSpeedBonus) / 64 * 3,
  strikeLimit: 12,
  strikeDecaySeconds: 10,
});

export type ViolationKind =
  | 'malformed_input'
  | 'input_flood'
  | 'speed_hack'
  | 'teleport'
  | 'fire_rate'
  | 'stale_tick';

export interface Violation {
  kind: ViolationKind;
  detail: string;
  tick: number;
}

/**
 * Per-client validator. One instance per connection; holds the rate-limiting and strike state.
 */
export class ClientValidator {
  private packetTimestamps: number[] = [];
  private strikes = 0;
  private lastStrikeDecay = 0;
  private lastAcceptedTick = -1;
  private lastFireTick = -Infinity;
  readonly violations: Violation[] = [];

  constructor(private readonly config: ValidationConfig = defaultValidationConfig()) {}

  get strikeCount(): number {
    return this.strikes;
  }

  get shouldKick(): boolean {
    return this.strikes >= this.config.strikeLimit;
  }

  /** Rate limit on packets. Cheap, and the first line against a flood. */
  acceptPacket(nowMs: number): boolean {
    this.packetTimestamps.push(nowMs);
    this.packetTimestamps = this.packetTimestamps.filter((t) => nowMs - t < 1000);
    if (this.packetTimestamps.length > MAX_INPUT_PACKETS_PER_SECOND) {
      this.flag('input_flood', `${this.packetTimestamps.length} packets/s`, this.lastAcceptedTick);
      return false;
    }
    return true;
  }

  /**
   * Sanitises a single input frame in place, returning false if it is beyond salvaging.
   *
   * Clamping rather than rejecting is deliberate for continuous axes: a slightly out-of-range stick
   * value is far more likely to be float noise than an attack, and dropping the frame would cost a
   * legitimate player a tick of movement. Structurally impossible values are rejected outright.
   */
  sanitise(input: InputFrame, currentTick: number): boolean {
    if (!Number.isFinite(input.moveX) || !Number.isFinite(input.moveZ)) {
      this.flag('malformed_input', 'non-finite move axis', currentTick);
      return false;
    }
    if (!Number.isFinite(input.lookYaw) || !Number.isFinite(input.lookPitch)) {
      this.flag('malformed_input', 'non-finite look delta', currentTick);
      return false;
    }

    input.moveX = clamp(input.moveX, -1, 1);
    input.moveZ = clamp(input.moveZ, -1, 1);
    input.lean = clamp(input.lean, -1, 1);

    // A single tick's look delta is bounded. Beyond this is a teleporting aimbot, not a flick.
    const MAX_LOOK_PER_TICK = Math.PI;
    input.lookYaw = clamp(input.lookYaw, -MAX_LOOK_PER_TICK, MAX_LOOK_PER_TICK);
    input.lookPitch = clamp(input.lookPitch, -MAX_LOOK_PER_TICK, MAX_LOOK_PER_TICK);

    // Replayed or reordered ticks must never be applied twice.
    if (input.tick <= this.lastAcceptedTick) return false;
    // A client claiming to be far in the future is trying to run the simulation fast.
    if (input.tick > currentTick + MAX_INPUTS_PER_PACKET * 4) {
      this.flag('stale_tick', `input tick ${input.tick} vs server ${currentTick}`, currentTick);
      return false;
    }

    this.lastAcceptedTick = input.tick;
    return true;
  }

  /** Fire-rate check, independent of whatever the client's local weapon state claims. */
  validateFire(actor: Actor, tick: number): boolean {
    const config = WEAPONS[actor.weapon.id];
    const minTicks = Math.floor(config.fireInterval * 64) - 1;
    if (tick - this.lastFireTick < minTicks) {
      this.flag('fire_rate', `${tick - this.lastFireTick} ticks between shots`, tick);
      return false;
    }
    this.lastFireTick = tick;
    return true;
  }

  /**
   * Post-simulation sanity check.
   *
   * Runs *after* the server has stepped movement, comparing the result against what the movement
   * rules physically permit. This catches anything that slipped through input validation, because
   * it checks outcomes rather than intentions.
   */
  validateOutcome(actor: Actor, previous: { x: number; y: number; z: number }, tick: number): boolean {
    const dx = actor.position.x - previous.x;
    const dy = actor.position.y - previous.y;
    const dz = actor.position.z - previous.z;
    const displacement = Math.hypot(dx, dy, dz);

    if (displacement > this.config.maxTickDisplacement) {
      // Mantles legitimately move a character quickly; exclude them.
      if (actor.mantleTime <= 0) {
        this.flag('teleport', `${displacement.toFixed(2)} m in one tick`, tick);
        return false;
      }
    }

    const horizontal = speedXZ(actor.velocity);
    const maxSpeed =
      (MOVEMENT.sprintSpeed + MOVEMENT.slideStartSpeedBonus) * this.config.speedTolerance;
    if (horizontal > maxSpeed) {
      this.flag('speed_hack', `${horizontal.toFixed(2)} m/s`, tick);
      return false;
    }

    return true;
  }

  /** Strikes decay with good behaviour so a laggy client is not slowly kicked for being laggy. */
  tick(nowSeconds: number): void {
    if (this.strikes > 0 && nowSeconds - this.lastStrikeDecay >= this.config.strikeDecaySeconds) {
      this.strikes--;
      this.lastStrikeDecay = nowSeconds;
    }
  }

  private flag(kind: ViolationKind, detail: string, tick: number): void {
    this.strikes++;
    this.violations.push({ kind, detail, tick });
    if (this.violations.length > 32) this.violations.shift();
  }

  reset(): void {
    this.strikes = 0;
    this.violations.length = 0;
    this.packetTimestamps.length = 0;
    this.lastAcceptedTick = -1;
    this.lastFireTick = -Infinity;
  }
}
