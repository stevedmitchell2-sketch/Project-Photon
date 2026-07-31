import { BOT_NAMES, BOT_PROFILES } from '@/ai/botDifficulty';
import { BotBrain, createBlackboard } from '@/ai/BotBrain';
import type { NavGraph } from '@/ai/NavGraph';
import { COMBAT } from '@/config/combat';
import { GAME_MODES, type MatchSettings } from '@/config/gameModes';
import { MOVEMENT } from '@/config/movement';
import type { TeamId } from '@/config/teams';
import { DEFAULT_WEAPON } from '@/config/weapons';
import type { EventBus } from '@/engine/EventBus';
import { createInputFrame } from '@/input/InputFrame';
import type { ArenaDefinition } from '@/maps/MapTypes';
import { resolveSpawns } from '@/maps/resolveSpawns';
import { GROUP_BOT, GROUP_PLAYER } from '@/physics/layers';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { Rng } from '@/util/rng';
import { applyDamage, resetActorVitals, stepRegeneration } from './CombatSystem';
import { stepMovement } from './MovementSystem';
import { ProjectileSystem } from './ProjectileSystem';
import { PropSystem } from './PropSystem';
import { createGameMode, type GameMode } from './modes';
import { SpawnSystem } from './SpawnSystem';
import { TriggerSystem } from './TriggerSystem';
import { stepWeapon } from './WeaponSystem';
import type { Actor, GameEvents, MatchState } from './types';

/** Match-clock callouts, in the order they fire. */
const COUNTDOWNS: Array<{ at: number; text: string; priority: 'low' | 'high' }> = [
  { at: 60, text: 'One minute remaining', priority: 'high' },
  { at: 30, text: 'Thirty seconds', priority: 'low' },
  { at: 10, text: 'Ten seconds', priority: 'high' },
  { at: 5, text: 'Five', priority: 'low' },
  { at: 3, text: 'Three', priority: 'low' },
  { at: 2, text: 'Two', priority: 'low' },
  { at: 1, text: 'One', priority: 'low' },
];

/**
 * Owns the match: actors, scoring, respawn, phase, and the ordering of every system per tick.
 *
 * `step()` is the whole simulation. It takes a fixed dt and mutates MatchState and the physics
 * world, and it touches nothing else — no React, no Three.js, no DOM. That is the property the
 * authoritative-server milestone depends on, so it is worth defending in review.
 */
export class MatchDirector {
  readonly state: MatchState;
  readonly projectiles = new ProjectileSystem();
  readonly props: PropSystem;
  readonly triggers: TriggerSystem;
  /** Mode strategy. Owns scoring and win conditions; never touches movement or physics. */
  readonly gameMode: GameMode;
  private readonly spawns: SpawnSystem;
  private readonly bots: BotBrain[] = [];
  private readonly rng: Rng;
  private nextActorId = 1;
  private nextCountdown = 0;

  constructor(
    readonly settings: MatchSettings,
    arena: ArenaDefinition,
    private readonly physics: PhysicsWorld,
    private readonly nav: NavGraph,
    private readonly events: EventBus<GameEvents>,
  ) {
    this.rng = new Rng(settings.seed);
    // Spawns are validated against the built geometry before the match sees them, so a buried
    // authored point can never strand a player inside a crate.
    const resolution = resolveSpawns(arena, physics, nav);
    this.spawns = new SpawnSystem(arena, this.rng, resolution.spawns);
    this.props = new PropSystem(arena, physics);
    this.triggers = new TriggerSystem(arena);
    this.gameMode = createGameMode(settings);

    // Route noises to bots that can hear them. Subscribing once here keeps the emitters
    // (weapons, movement) unaware that hearing exists at all.
    events.on('noise', ({ position, loudness, sourceId, team }) => {
      const source = this.state.actors.get(sourceId);
      for (const bot of this.bots) {
        const listener = bot.blackboard.actor;
        const hostile = this.mode.freeForAll || listener.team !== team;
        void source;
        bot.hear(position, loudness, sourceId, hostile);
      }
    });

    const scores: Record<string, number> = {};
    for (const team of settings.teams) scores[team] = 0;

    this.state = {
      tick: 0,
      time: 0,
      phase: 'active',
      timeRemaining: settings.timeLimitSeconds,
      scores,
      actors: new Map(),
      localActorId: -1,
      killFeed: [],
      winner: null,
    };
  }

  get mode() {
    return GAME_MODES[this.settings.mode];
  }

  // --- Setup ---------------------------------------------------------------

  createLocalPlayer(name: string): Actor {
    const actor = this.createActor(name, this.settings.playerTeam, 'local');
    this.state.localActorId = actor.id;
    this.respawn(actor, true);
    return actor;
  }

  populateBots(): void {
    if (!this.settings.botsEnabled) return;
    const profile = BOT_PROFILES[this.settings.botDifficulty];
    let nameIndex = 0;

    for (const team of this.settings.teams) {
      const isPlayerTeam = team === this.settings.playerTeam;
      const count = this.settings.botsPerTeam - (isPlayerTeam ? 1 : 0);
      for (let i = 0; i < Math.max(0, count); i++) {
        const name = BOT_NAMES[nameIndex++ % BOT_NAMES.length];
        const actor = this.createActor(name, team, 'bot');
        this.respawn(actor, true);
        const blackboard = createBlackboard(
          actor,
          this.state,
          this.physics,
          this.nav,
          profile,
          new Rng(this.settings.seed + actor.id * 7919),
        );
        this.bots.push(new BotBrain(blackboard, this.mode.freeForAll));
      }
    }
  }

  private createActor(name: string, team: TeamId, kind: Actor['kind']): Actor {
    const id = this.nextActorId++;
    const group = kind === 'bot' ? GROUP_BOT : GROUP_PLAYER;
    const bodyHandle = this.physics.createCharacter(
      id,
      { x: 0, y: 100, z: 0 },
      MOVEMENT.standHeight,
      MOVEMENT.radius,
      group,
    );
    const actor = this.buildActor(id, name, team, kind, bodyHandle);
    this.state.actors.set(id, actor);
    return actor;
  }

  private buildActor(
    id: number,
    name: string,
    team: TeamId,
    kind: Actor['kind'],
    bodyHandle: number,
  ): Actor {
    const actor: Actor = {
      id,
      kind,
      name,
      team,
      position: { x: 0, y: 100, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      prevPosition: { x: 0, y: 100, z: 0 },
      yaw: 0,
      pitch: 0,
      prevYaw: 0,
      prevPitch: 0,
      stance: 'stand',
      height: MOVEMENT.standHeight,
      targetHeight: MOVEMENT.standHeight,
      lean: 0,
      leanTarget: 0,
      grounded: false,
      airTime: 0,
      jumpBuffer: 0,
      slideTime: 0,
      slideCooldown: 0,
      mantleTime: 0,
      mantleFrom: { x: 0, y: 0, z: 0 },
      mantleTo: { x: 0, y: 0, z: 0 },
      health: COMBAT.maxHealth,
      shield: COMBAT.maxShield,
      sinceDamage: 999,
      alive: true,
      respawnTimer: 0,
      spawnProtection: 0,
      weapon: {
        id: DEFAULT_WEAPON,
        charge: 6,
        rechargeProgress: 1,
        recharging: false,
        cooldown: 0,
        sinceLastShot: 999,
        spread: 0,
        recoilPitch: 0,
        recoilYaw: 0,
        adsBlend: 0,
      },
      score: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      damageContributions: new Map(),
      bodyHandle,
      input: createInputFrame(),
      fx: { firedThisTick: false, landedThisTick: 0, strideDistance: 0, lastFootstep: 0 },
    };
    return actor;
  }

  // --- Tick ----------------------------------------------------------------

  step(dt: number): void {
    const state = this.state;
    state.tick++;
    state.time += dt;

    if (state.phase === 'active' && this.mode.timeLimitSeconds > 0) {
      state.timeRemaining = Math.max(0, state.timeRemaining - dt);
      this.announceCountdown(state.timeRemaining);
      if (state.timeRemaining <= 0) this.endMatch();
    }

    // 1. Bots produce their input frames. Human input was already written by the input pipeline.
    if (state.phase === 'active') {
      for (const bot of this.bots) bot.step(dt, this.mode.freeForAll);
    }

    // 2. Movement and weapons for every actor, in stable id order for determinism.
    for (const actor of this.orderedActors()) {
      stepMovement(actor, this.physics, dt, this.events);
      stepWeapon(actor, dt, this.projectiles, this.events, this.rng);
      stepRegeneration(actor, dt);
      this.stepRespawn(actor, dt);
    }

    // 3. Projectiles resolve after movement so they hit where actors actually ended up.
    this.projectiles.step(
      state,
      this.physics,
      dt,
      this.events,
      this.settings.friendlyFire,
      (attacker, victim, amount, headshot) => {
        const result = applyDamage(state, attacker, victim, amount, headshot, this.events);
        if (result.killed) this.awardKill(attacker, victim);
      },
    );

    // 3b. Trigger volumes, so objective occupancy is current before the mode reads it.
    this.triggers.step(state, dt, this.events);

    // 3c. Mode rules. Runs after triggers and before props so objective scoring sees this tick's
    // occupancy rather than last tick's.
    if (state.phase === 'active') {
      this.gameMode.tick(state, this.triggers, dt, this.events);
      if (this.gameMode.isComplete(state)) this.endMatch();
    }

    // 4. Interactive props, then the physics substep. Doors move before the step so their new
    // collider position is what the next tick's character sweeps resolve against.
    this.props.step(state, this.physics, dt);
    this.physics.step();

    // 5. Trim the killfeed.
    if (state.killFeed.length > 0) {
      const cutoff = state.time - COMBAT.killFeedDuration;
      while (state.killFeed.length > 0 && state.killFeed[state.killFeed.length - 1].time < cutoff) {
        state.killFeed.pop();
      }
    }
  }

  /**
   * Match-clock callouts. Each threshold fires once, tracked by index rather than a boolean per
   * line so adding a callout is a one-line change to the table.
   */
  private announceCountdown(remaining: number): void {
    for (let i = this.nextCountdown; i < COUNTDOWNS.length; i++) {
      const cue = COUNTDOWNS[i];
      if (remaining > cue.at) break;
      this.nextCountdown = i + 1;
      this.events.emit('announcement', { text: cue.text, priority: cue.priority });
    }
  }

  /** Deterministic iteration order — Map insertion order is stable, but be explicit about it. */
  private *orderedActors(): Generator<Actor> {
    for (const actor of this.state.actors.values()) yield actor;
  }

  private stepRespawn(actor: Actor, dt: number): void {
    if (actor.alive) return;
    if (!this.gameMode.allowsRespawn(this.state, actor)) return;
    actor.respawnTimer -= dt;
    if (actor.respawnTimer <= 0) this.respawn(actor, false);
  }

  private awardKill(killer: Actor, victim: Actor): void {
    victim.respawnTimer = Math.max(COMBAT.minDeathTime, this.settings.respawnSeconds);

    // The mode decides what an elimination is worth; the director is the only thing that mutates
    // scores, so all scoring stays auditable in one place.
    const points = this.gameMode.onElimination(this.state, victim, killer, this.events);
    if (points === 0) return;

    if (killer.id === victim.id) {
      killer.score -= points;
      return;
    }
    killer.score += points;

    const scoreKey = this.gameMode.scoreKey(killer);
    this.state.scores[scoreKey] = (this.state.scores[scoreKey] ?? 0) + points;
    this.events.emit('score_changed', { team: killer.team, score: this.state.scores[scoreKey] });

    if (this.gameMode.isComplete(this.state)) this.endMatch();
  }

  /**
   * Creates an actor driven by a remote client rather than by peripherals or a bot brain.
   * Its inputs arrive over the network; everything else about it is an ordinary actor.
   */
  createNetworkPlayer(name: string, team: TeamId): Actor {
    const actor = this.createActor(name, team, 'remote');
    this.respawn(actor, true);
    return actor;
  }

  /**
   * Ensures a locally-mirrored actor exists for a server-assigned id.
   *
   * A client learns about other players purely from snapshots, so it must be able to materialise an
   * actor for an id it has never seen. The id comes from the server and is used verbatim — inventing
   * a local id would break every subsequent snapshot referring to that player.
   */
  ensureReplicatedActor(id: number, team: TeamId, name = `PLAYER${id}`): Actor {
    const existing = this.state.actors.get(id);
    if (existing) return existing;

    const bodyHandle = this.physics.createCharacter(
      id,
      { x: 0, y: 100, z: 0 },
      MOVEMENT.standHeight,
      MOVEMENT.radius,
      GROUP_BOT,
    );
    const actor = this.buildActor(id, name, team, 'remote', bodyHandle);
    this.state.actors.set(id, actor);
    // Keep future locally-created ids clear of server-assigned ones.
    this.nextActorId = Math.max(this.nextActorId, id + 1);
    return actor;
  }

  /** Removes an actor and releases its physics body. Used when a client disconnects. */
  removeActor(actorId: number): void {
    const actor = this.state.actors.get(actorId);
    if (!actor) return;
    this.physics.removeCharacter(actor.bodyHandle);
    this.state.actors.delete(actorId);
  }

  respawn(actor: Actor, initial: boolean): void {
    const choice = this.spawns.choose(this.state, actor, this.physics, this.mode.freeForAll);
    resetActorVitals(actor);
    actor.height = MOVEMENT.standHeight;
    actor.targetHeight = MOVEMENT.standHeight;
    this.physics.setCharacterHeight(actor.bodyHandle, actor.height, MOVEMENT.radius);

    actor.position.x = choice.position.x;
    actor.position.y = choice.position.y;
    actor.position.z = choice.position.z;
    actor.prevPosition.x = choice.position.x;
    actor.prevPosition.y = choice.position.y;
    actor.prevPosition.z = choice.position.z;
    actor.yaw = choice.yaw;
    actor.prevYaw = choice.yaw;
    actor.pitch = 0;
    actor.prevPitch = 0;
    actor.respawnTimer = 0;

    this.physics.setCharacterPosition(actor.bodyHandle, {
      x: actor.position.x,
      y: actor.position.y + actor.height * 0.5,
      z: actor.position.z,
    });

    if (!initial) {
      this.events.emit('actor_spawned', {
        actorId: actor.id,
        isLocal: actor.kind === 'local',
        position: { ...actor.position },
        team: actor.team,
      });
    }
  }

  private endMatch(): void {
    if (this.state.phase === 'ended') return;
    this.state.phase = 'ended';

    this.state.winner = this.gameMode.winner(this.state);
    this.events.emit('match_ended', { winner: this.state.winner });
    this.events.emit('announcement', {
      text: this.state.winner ? `${this.state.winner.toUpperCase()} team wins` : 'Match drawn',
      priority: 'high',
    });
  }

  /** Team score for the HUD; in FFA the "team" key is the actor id. */
  scoreFor(actor: Actor): number {
    return this.state.scores[this.mode.freeForAll ? String(actor.id) : actor.team] ?? 0;
  }

  dispose(): void {
    for (const actor of this.state.actors.values()) {
      this.physics.removeCharacter(actor.bodyHandle);
    }
    this.state.actors.clear();
    this.projectiles.clear();
    this.props.dispose(this.physics);
    this.bots.length = 0;
  }
}
