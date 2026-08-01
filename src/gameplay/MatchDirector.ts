import { BOT_NAMES, BOT_PROFILES } from '@/ai/botDifficulty';
import { BotBrain, createBlackboard } from '@/ai/BotBrain';
import type { NavGraph } from '@/ai/NavGraph';
import { COMBAT } from '@/config/combat';
import { GAME_MODES, type MatchSettings } from '@/config/gameModes';
import { MOVEMENT } from '@/config/movement';
import { TEAMS, type TeamId } from '@/config/teams';
import { DEFAULT_WEAPON } from '@/config/weapons';
import type { EventBus } from '@/engine/EventBus';
import { Telemetry } from '@/engine/Telemetry';
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
import { LagCompensator } from '@/net/LagCompensation';
import { createGameMode, type GameMode } from './modes';
import { SpawnSystem } from './SpawnSystem';
import { TriggerSystem } from './TriggerSystem';
import { stepWeapon } from './WeaponSystem';
import type { Actor, GameEvents, MatchState } from './types';

/**
 * Interpolation delay clients render at, in milliseconds.
 *
 * Must match `Interpolator`'s default. The shooter aims at a world this far in the past, so the
 * server must rewind by the same amount — the two constants are halves of one decision.
 */
const INTERPOLATION_DELAY_MS = 75;

/**
 * Ticks between movement telemetry samples — 16 ticks is four samples a second at 64 Hz.
 *
 * Movement is smooth, so consecutive ticks carry nearly identical information. Sampling every tick
 * would fill the event ring with redundant positions and evict the discrete events (tags, deaths,
 * objective flips) that only happen a handful of times a match.
 */
const MOVEMENT_SAMPLE_TICKS = 16;

/**
 * Debounce windows for objective callouts, in seconds.
 *
 * `controllingTeam` drops to null the instant any enemy steps inside, so the raw signal flickers
 * several times during a single fight over the room. Announcing every flicker is unusable — a first
 * pass with a single 1.5 s window produced 17 callouts in 120 s, one every seven seconds, and half
 * of them were "lost" immediately followed by "held".
 *
 * The two directions are not symmetric, because they do not mean the same thing. **Taking** a room
 * is decisive and should be called quickly. **Losing** one is usually just a contested moment
 * mid-fight, and only matters if it lasts — so it waits more than twice as long, and a room that
 * changes hands cleanly never announces the neutral state in between at all.
 */
const OBJECTIVE_TAKEN_DELAY = 1.5;
const OBJECTIVE_LOST_DELAY = 4;

/** Keeps the physics capsule aligned with a rewound actor position. */
const syncActor =
  (physics: PhysicsWorld) =>
  (actor: Actor): void => {
    physics.setCharacterPosition(actor.bodyHandle, {
      x: actor.position.x,
      y: actor.position.y + actor.height * 0.5,
      z: actor.position.z,
    });
  };

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
  /**
   * Server-side rewind history. Enabled only when this director is authoritative — a client
   * rewinding its own predicted world would fight its own reconciliation.
   */
  readonly lagCompensator = new LagCompensator();
  /**
   * Match telemetry. Disabled by default — enabling it costs one branch per event.
   * Groundwork for Photon Director; nothing reads it back into gameplay.
   */
  readonly telemetry = new Telemetry();
  private lagCompensationEnabled = false;
  /** Per-actor round-trip time in ms, supplied by the server session. */
  private readonly actorRtt = new Map<number, number>();
  /** Actors whose input has not arrived for this tick; their movement is held. */
  private readonly starvedActors = new Set<number>();
  readonly triggers: TriggerSystem;
  /** Mode strategy. Owns scoring and win conditions; never touches movement or physics. */
  readonly gameMode: GameMode;
  private readonly spawns: SpawnSystem;
  private readonly bots: BotBrain[] = [];
  private readonly rng: Rng;
  private nextActorId = 1;
  private nextCountdown = 0;
  /** Last announced holder per objective, so a callout fires once per genuine change. */
  private readonly objectiveHolders = new Map<string, TeamId | null>();
  /** Candidate holder awaiting the debounce window. */
  private readonly objectivePending = new Map<string, { team: TeamId | null; since: number }>();

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
    this.telemetry.createHeatmap('deaths', arena.bounds);
    this.telemetry.createHeatmap('shots', arena.bounds);
    // Where players actually go, as opposed to where they die. The two together are what makes a
    // map readable in review: deaths show the fights, occupancy shows the routes nobody uses.
    this.telemetry.createHeatmap('occupancy', arena.bounds);
    this.wireTelemetry();

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
      killFeedSequence: 0,
      winner: null,
    };
  }

  /**
   * Subscribes telemetry to the event stream.
   *
   * Deliberately driven by events rather than by calls sprinkled through the systems: gameplay code
   * stays unaware telemetry exists, and adding a new metric never means editing a system.
   */
  private wireTelemetry(): void {
    const t = this.telemetry;

    this.events.on('shot_fired', (e) => {
      t.recordAt(
        { tick: this.state.tick, time: this.state.time, category: 'weapon', type: 'fired', actorId: e.actorId, team: e.team },
        e.origin,
        'shots',
      );
    });

    this.events.on('damage_dealt', (e) => {
      t.record({
        tick: this.state.tick,
        time: this.state.time,
        category: 'combat',
        type: e.headshot ? 'headshot' : 'hit',
        actorId: e.attackerId,
        target: e.victimId,
        value: e.amount,
      });
    });

    this.events.on('actor_died', (e) => {
      t.recordAt(
        { tick: this.state.tick, time: this.state.time, category: 'combat', type: 'death', actorId: e.actorId, target: e.killerId },
        e.position,
        'deaths',
      );
    });

    this.events.on('actor_spawned', (e) => {
      t.recordAt(
        { tick: this.state.tick, time: this.state.time, category: 'match', type: 'respawn', actorId: e.actorId, team: e.team },
        e.position,
      );
    });

    this.events.on('weapon_recharge_start', (e) => {
      t.record({ tick: this.state.tick, time: this.state.time, category: 'weapon', type: 'recharge', actorId: e.actorId });
    });

    this.events.on('score_changed', (e) => {
      t.record({ tick: this.state.tick, time: this.state.time, category: 'objective', type: 'score', team: e.team, value: e.score });
    });

    this.events.on('match_ended', (e) => {
      t.record({ tick: this.state.tick, time: this.state.time, category: 'match', type: 'ended', team: e.winner ?? undefined });
      t.flush();
    });
  }

  /**
   * Calls out changes of objective control.
   *
   * The reactive lighting in the central room already shows who holds it, but only to a player
   * looking at it. A venue tells you. This is the audio half of the same signal, and it is emitted
   * from the simulation rather than the renderer so it is deterministic, replicated to every client
   * and present in a replay — the announcement is part of what happened, not part of the drawing.
   *
   * Only sustained changes are announced. `controllingTeam` flickers to null every time an enemy
   * steps into the volume, and a callout on each of those would be constant noise, so a team must
   * hold uncontested for `OBJECTIVE_CALLOUT_DELAY` before it counts as having taken the room.
   */
  private announceObjectiveControl(): void {
    for (const volume of this.triggers.volumes) {
      if (volume.kind !== 'hill') continue;

      const holder: TeamId | null = volume.contested ? null : volume.controllingTeam;
      const previous = this.objectiveHolders.get(volume.id) ?? null;
      if (holder === previous) continue;

      // Debounce: require the new state to persist rather than firing on the transition itself.
      const pending = this.objectivePending.get(volume.id);
      if (!pending || pending.team !== holder) {
        this.objectivePending.set(volume.id, { team: holder, since: this.state.time });
        continue;
      }
      const delay = holder ? OBJECTIVE_TAKEN_DELAY : OBJECTIVE_LOST_DELAY;
      if (this.state.time - pending.since < delay) continue;

      this.objectiveHolders.set(volume.id, holder);
      this.objectivePending.delete(volume.id);

      this.events.emit('announcement', {
        text: holder ? `${TEAMS[holder].name.toUpperCase()} HOLDS CENTRAL` : 'CENTRAL ROOM LOST',
        priority: holder ? 'high' : 'low',
      });
    }
  }

  /**
   * Samples where everyone is, for the occupancy heatmap and movement-path analysis.
   *
   * Rate-limited to four samples a second rather than sixty-four. Position is heavily correlated
   * between adjacent ticks, so the extra sixty samples add almost no information and would dominate
   * the event ring, evicting the discrete events that are actually scarce. Costs one modulo per
   * tick when telemetry is off.
   */
  private sampleMovementTelemetry(): void {
    if (!this.telemetry.enabled) return;
    if (this.state.tick % MOVEMENT_SAMPLE_TICKS !== 0) return;

    const occupancy = this.telemetry.heatmaps.get('occupancy');
    for (const actor of this.orderedActors()) {
      if (!actor.alive) continue;
      occupancy?.add(actor.position.x, actor.position.z);
      this.telemetry.record({
        tick: this.state.tick,
        time: this.state.time,
        category: 'movement',
        type: 'sample',
        actorId: actor.id,
        team: actor.team,
        x: actor.position.x,
        y: actor.position.y,
        z: actor.position.z,
        // Horizontal speed, which is what distinguishes a route from a camping spot.
        value: Math.hypot(actor.velocity.x, actor.velocity.z),
      });
    }
  }

  /** Turns on rewind-based hit validation. Called by NetServer; never by a client. */
  enableLagCompensation(enabled: boolean): void {
    this.lagCompensationEnabled = enabled;
    if (!enabled) this.lagCompensator.clear();
  }

  /**
   * Marks an actor as awaiting input.
   *
   * A starved actor's movement is skipped for the tick rather than re-simulated with its previous
   * input. Repeating the input advances it by a step the owning client never predicted, which is a
   * systematic source of prediction drift; holding position is the honest alternative.
   */
  setInputStarved(actorId: number, starved: boolean): void {
    if (starved) this.starvedActors.add(actorId);
    else this.starvedActors.delete(actorId);
  }

  /** Reports a client's measured RTT so its shots can be rewound by the right amount. */
  setActorLatency(actorId: number, rttMs: number): void {
    this.actorRtt.set(actorId, rttMs);
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

    this.sampleMovementTelemetry();

    // 2. Movement and weapons for every actor, in stable id order for determinism.
    for (const actor of this.orderedActors()) {
      // A starved actor holds position rather than replaying stale input. Weapons, regeneration
      // and respawn timers still advance — only locomotion waits.
      if (!this.starvedActors.has(actor.id)) stepMovement(actor, this.physics, dt, this.events);
      stepWeapon(actor, dt, this.projectiles, this.events, this.rng);
      stepRegeneration(actor, dt);
      this.stepRespawn(actor, dt);
    }

    // 3. Projectiles resolve after movement so they hit where actors actually ended up.
    //    On the server, each shooter's bolts are tested against the world as that shooter saw it.
    if (this.lagCompensationEnabled) this.lagCompensator.record(state);

    const onDamage = (attacker: Actor, victim: Actor, amount: number, headshot: boolean) => {
      const result = applyDamage(state, attacker, victim, amount, headshot, this.events);
      if (result.killed) this.awardKill(attacker, victim);
    };

    this.projectiles.step(
      state,
      this.physics,
      dt,
      this.events,
      this.settings.friendlyFire,
      onDamage,
      this.lagCompensationEnabled ? this.rewindForOwner : undefined,
    );

    // 3b. Trigger volumes, so objective occupancy is current before the mode reads it.
    this.triggers.step(state, dt, this.events);
    this.announceObjectiveControl();

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

  /**
   * Rewinds the world to a shooter's view time, runs their bolt resolution, and restores.
   *
   * Bots have no latency, so they are resolved against the present tick — rewinding for them would
   * only introduce error. A human client is rewound by `rtt/2 + interpolationDelay`, capped inside
   * LagCompensator so a client cannot claim arbitrary latency.
   */
  private rewindForOwner = (ownerId: number, resolve: () => void): void => {
    const owner = this.state.actors.get(ownerId);
    if (!owner || owner.kind === 'bot') {
      resolve();
      return;
    }

    const rtt = this.actorRtt.get(ownerId) ?? 0;
    const viewTick = LagCompensator.viewTickFor(this.state.tick, rtt, INTERPOLATION_DELAY_MS);
    this.lagCompensator.withRewind(this.state, viewTick, syncActor(this.physics), resolve);
  };

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

  /**
   * Re-keys the local player onto the actor id the server assigned it.
   *
   * A networked client builds its world in two stages: it creates a local player so the match is
   * playable while connecting, then the server hands back the id that player will actually have.
   * Until those two identities are merged the client is holding *two* notions of "me" — the local
   * one that the camera, HUD and input all follow, and the server one that snapshots are addressed
   * to — and nothing reconciles them.
   *
   * Left unmerged that is not a cosmetic problem, it is fatal, in two different ways depending on
   * what the server's id counter happens to be:
   *
   *   - if no actor exists at the local id, the snapshot reaper deletes the local player as a
   *     departed peer, and the client is left driving an actor that is no longer in the world;
   *   - if an actor *does* exist at that id — a bot, on any server with bots — every snapshot
   *     overwrites the local player with that bot's state, and the camera rides the bot.
   *
   * Both were live. Neither had been seen, because the only multi-client testing was a harness whose
   * locally-allocated ids coincidentally matched the server's on a freshly started server, and
   * stopped matching the moment the server's counter advanced past them. That coincidence is what
   * three sprints of "the server degrades after a disconnect" and "the client limit is four" were
   * actually measuring.
   *
   * Re-keying rather than recreating keeps the physics body, weapon state and score the local
   * simulation has already accumulated.
   */
  adoptLocalActorId(serverId: number): void {
    const currentId = this.state.localActorId;
    if (serverId < 0 || serverId === currentId) return;

    const actor = this.state.actors.get(currentId);
    if (!actor) {
      // Nothing to re-key; just point at the id the server gave us so the snapshot path can
      // materialise it normally.
      this.state.localActorId = serverId;
      this.nextActorId = Math.max(this.nextActorId, serverId + 1);
      return;
    }

    // An id collision means a replicated actor already occupies our new identity. It is a stale
    // mirror of ourselves — the server only ever assigns this id to one actor — so it goes.
    const occupant = this.state.actors.get(serverId);
    if (occupant && occupant !== actor) this.removeActor(serverId);

    this.state.actors.delete(currentId);
    actor.id = serverId;
    this.physics.setCharacterActorId(actor.bodyHandle, serverId);
    this.state.actors.set(serverId, actor);
    this.state.localActorId = serverId;
    this.nextActorId = Math.max(this.nextActorId, serverId + 1);
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
