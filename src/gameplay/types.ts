import type { TeamId } from '@/config/teams';
import type { WeaponId } from '@/config/weapons';
import type { SurfaceKind } from '@/maps/MapTypes';
import type { InputFrame } from '@/input/InputFrame';
import type { Vec3 } from '@/util/math';

export type ActorKind = 'local' | 'bot' | 'remote';

export type Stance = 'stand' | 'crouch' | 'slide';

export interface WeaponState {
  id: WeaponId;
  /** Shots remaining in the cell. */
  charge: number;
  /** 0..1 progress through a recharge cycle; 1 means idle. */
  rechargeProgress: number;
  recharging: boolean;
  cooldown: number;
  /** Seconds since the last shot, drives the idle trickle. */
  sinceLastShot: number;
  /** Current cone half-angle in degrees. */
  spread: number;
  /** Accumulated recoil offsets in radians, decaying toward zero. */
  recoilPitch: number;
  recoilYaw: number;
  /** 0..1 aim-down-sights blend. */
  adsBlend: number;
}

export interface Actor {
  id: number;
  kind: ActorKind;
  name: string;
  team: TeamId;

  /** Feet position — the capsule base, which is what spawn points and nav nodes describe. */
  position: Vec3;
  velocity: Vec3;
  /** Previous tick's position, for render interpolation. */
  prevPosition: Vec3;

  yaw: number;
  pitch: number;
  prevYaw: number;
  prevPitch: number;

  stance: Stance;
  /** Smoothed capsule height, driving both physics and the eye position. */
  height: number;
  targetHeight: number;
  /** Smoothed lean, -1..1. */
  lean: number;
  leanTarget: number;

  grounded: boolean;
  /** Seconds since last grounded, for coyote time. */
  airTime: number;
  /** Seconds remaining in which a buffered jump may fire. */
  jumpBuffer: number;
  slideTime: number;
  slideCooldown: number;
  mantleTime: number;
  mantleFrom: Vec3;
  mantleTo: Vec3;

  health: number;
  shield: number;
  sinceDamage: number;
  alive: boolean;
  respawnTimer: number;
  spawnProtection: number;

  weapon: WeaponState;

  score: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Damage dealt to each other actor since their last death, for assist attribution. */
  damageContributions: Map<number, number>;

  /** Physics handle. Not serialized — rebuilt on the receiving side. */
  bodyHandle: number;

  /** Filled by the input source (player peripheral, bot brain, or network) each tick. */
  input: InputFrame;

  /** Presentation-only, written by the sim and read by renderers. */
  fx: {
    /** Impulse added when firing, decayed by the view model. */
    firedThisTick: boolean;
    landedThisTick: number;
    /** Distance travelled on the ground, drives footstep cadence and view bob. */
    strideDistance: number;
    lastFootstep: number;
  };
}

export interface KillFeedEntry {
  id: number;
  killer: string;
  killerTeam: TeamId;
  victim: string;
  victimTeam: TeamId;
  headshot: boolean;
  selfInflicted: boolean;
  time: number;
}

export type MatchPhase = 'warmup' | 'active' | 'ended';

export interface MatchState {
  tick: number;
  time: number;
  phase: MatchPhase;
  timeRemaining: number;
  scores: Record<string, number>;
  actors: Map<number, Actor>;
  localActorId: number;
  killFeed: KillFeedEntry[];
  /**
   * Monotonic id source for kill feed entries.
   *
   * Not the tick. Two eliminations resolving on the same tick — a bolt that kills two players, or
   * simply a busy fight — produced duplicate ids, and the HUD renders the feed as a keyed list, so
   * React silently duplicated or dropped rows. Deterministic because it advances only in the
   * simulation, so server and client agree and a replay reproduces the same feed.
   */
  killFeedSequence: number;
  winner: TeamId | null;
}

/** Events the simulation emits. Presentation subscribes; the sim never reads them back. */
export interface GameEvents {
  shot_fired: { actorId: number; team: TeamId; origin: Vec3; direction: Vec3; isLocal: boolean };
  weapon_recharge_start: { actorId: number; isLocal: boolean };
  weapon_recharge_end: { actorId: number; isLocal: boolean };
  projectile_impact: {
    position: Vec3;
    normal: Vec3;
    team: TeamId;
    hitActor: boolean;
    surface: SurfaceKind;
    /** Grazing hits ricochet; a square-on hit does not. Cosine of the incidence angle. */
    incidence: number;
  };
  damage_dealt: {
    attackerId: number;
    victimId: number;
    amount: number;
    headshot: boolean;
    killed: boolean;
    attackerIsLocal: boolean;
    victimIsLocal: boolean;
    /** Direction from victim to attacker, for the directional damage indicator. */
    fromYaw: number;
  };
  actor_died: { actorId: number; killerId: number; isLocal: boolean; position: Vec3 };
  actor_spawned: { actorId: number; isLocal: boolean; position: Vec3; team: TeamId };
  footstep: {
    actorId: number;
    position: Vec3;
    isLocal: boolean;
    running: boolean;
    surface: SurfaceKind;
  };
  jump: { actorId: number; position: Vec3; isLocal: boolean };
  land: { actorId: number; position: Vec3; isLocal: boolean; impactSpeed: number };
  slide_start: { actorId: number; position: Vec3; isLocal: boolean };
  mantle: { actorId: number; isLocal: boolean };
  trigger_entered: { volumeId: string; actorId: number };
  trigger_exited: { volumeId: string; actorId: number };
  /** A noise an actor made, for bot hearing. `loudness` is an audible radius in metres. */
  noise: { position: Vec3; loudness: number; sourceId: number; team: TeamId };
  ricochet: { position: Vec3; surface: SurfaceKind };
  notification: { text: string; tone: 'info' | 'good' | 'bad' };
  score_changed: { team: TeamId; score: number };
  match_ended: { winner: TeamId | null };
  announcement: { text: string; priority: 'low' | 'high' };
}
