import { NavGraph } from '@/ai/NavGraph';
import { AudioEngine } from '@/audio/AudioEngine';
import { COMBAT, RUMBLE } from '@/config/combat';
import type { MatchSettings } from '@/config/gameModes';
import { GAME_MODES } from '@/config/gameModes';
import { MOVEMENT } from '@/config/movement';
import { TEAMS } from '@/config/teams';
import { MatchDirector } from '@/gameplay/MatchDirector';
import { eyePosition } from '@/gameplay/MovementSystem';
import { weaponFovScale, weaponSensitivityScale } from '@/gameplay/WeaponSystem';
import type { Actor, GameEvents } from '@/gameplay/types';
import { InputManager, type InputSettings } from '@/input/InputManager';
import { buildArena, getArena, type BuiltArena } from '@/maps/MapBuilder';
import { initPhysics, PhysicsWorld } from '@/physics/PhysicsWorld';
import { useSettings } from '@/state/settingsStore';
import { useUi } from '@/state/uiStore';
import { clamp, damp, dist3, forwardFromLook, groundBasis, lerp, speedXZ, type Vec3 } from '@/util/math';
import { NetClient } from '@/net/NetClient';
import { WebSocketTransport } from '@/net/Transport';
import { EventBus } from './EventBus';
import { GameLoop, TICK_DT } from './GameLoop';

/**
 * The presentation-facing view of the camera, recomputed every rendered frame from interpolated
 * simulation state. Renderers read this; nothing writes back into the sim through it.
 */
export interface ViewState {
  position: Vec3;
  yaw: number;
  pitch: number;
  /** Camera roll from lean and strafe, in radians. */
  roll: number;
  fovScale: number;
  /** Weapon view-model sway/bob offsets in view space. */
  bobX: number;
  bobY: number;
  recoilKick: number;
  shake: number;
  speed: number;
  adsBlend: number;
}

export interface GameCallbacks {
  onPause(): void;
}

/**
 * How this Game instance is driven.
 *
 * `offline` simulates locally with bots and no netcode. `client` connects to an authoritative
 * server and runs prediction + interpolation; the local MatchDirector still exists but exists to be
 * corrected, not to be believed.
 */
export type NetworkMode =
  | { kind: 'offline' }
  | { kind: 'client'; url: string; playerName: string; preferredTeam: string | null };

/**
 * Owns every long-lived subsystem and the ordering between them.
 *
 * Construction is async because Rapier's WASM and the navigation bake both have to finish before
 * the first tick. Everything after that is synchronous and allocation-light.
 */
export class Game {
  readonly events = new EventBus<GameEvents>();
  readonly audio = new AudioEngine();

  physics!: PhysicsWorld;
  arena!: BuiltArena;
  nav!: NavGraph;
  match!: MatchDirector;
  input!: InputManager;
  /** Present only in client mode. Null offline. */
  netClient: NetClient | null = null;
  private networkMode: NetworkMode = { kind: 'offline' };

  /** True when an authoritative server owns this match. */
  get isNetworked(): boolean {
    return this.networkMode.kind !== 'offline';
  }
  private loop!: GameLoop;

  readonly view: ViewState = {
    position: { x: 0, y: 2, z: 0 },
    yaw: 0,
    pitch: 0,
    roll: 0,
    fovScale: 1,
    bobX: 0,
    bobY: 0,
    recoilKick: 0,
    shake: 0,
    speed: 0,
    adsBlend: 0,
  };

  /** Renderer counters, published by the render tree and surfaced on the performance overlay. */
  /**
   * Renderer counters and frame budget.
   *
   * `cpuMs` and `gpuMs` are what the 120 FPS target is actually written against. Frames per second
   * cannot answer it on a vsynced display — see `RendererStats` — so `frameBudgetMs` is the number
   * to watch: the frame fits in 8.33 ms or it does not.
   */
  readonly renderStats = {
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    cpuMs: 0,
    gpuMs: 0,
    frameBudgetMs: 0,
    gpuAvailable: false,
  };

  /** Live renderer handles, set once the canvas mounts. Used by the performance overlay and tools. */
  renderer: { gl: unknown; scene: unknown; camera: unknown } | null = null;

  /** Interpolation alpha for the current rendered frame. */
  alpha = 0;
  private bobPhase = 0;
  private landingDip = 0;
  private shakeAmount = 0;
  private combatIntensity = 0;
  private uiPushTimer = 0;
  private reduceShake = false;
  private reduceBob = false;
  private disposed = false;

  constructor(private readonly callbacks: GameCallbacks) {}

  get localActor(): Actor | undefined {
    return this.match?.state.actors.get(this.match.state.localActorId);
  }

  async load(
    settings: MatchSettings,
    inputSettings: InputSettings,
    playerName: string,
    onProgress: (message: string, progress: number) => void,
    networkMode: NetworkMode = { kind: 'offline' },
  ): Promise<void> {
    this.networkMode = networkMode;
    onProgress('Initialising physics', 0.05);
    await initPhysics();
    this.physics = new PhysicsWorld();

    onProgress('Building arena', 0.2);
    const definition = getArena(settings.arena);
    this.arena = buildArena(this.physics, definition);
    // Yield to the browser so the loading screen actually paints between stages.
    await frame();

    onProgress('Baking navigation', 0.45);
    await frame();
    this.nav = NavGraph.build(this.physics, definition);

    onProgress('Spawning combatants', 0.8);
    await frame();
    this.match = new MatchDirector(settings, definition, this.physics, this.nav, this.events);
    this.match.createLocalPlayer(playerName);
    // Bots are a server-side concern. A connected client receives them as ordinary replicated
    // actors and must not simulate its own, or it would fight the server over every one of them.
    if (networkMode.kind === 'offline') this.match.populateBots();

    if (networkMode.kind === 'client') {
      onProgress('Connecting', 0.9);
      await frame();
      const transport = new WebSocketTransport(networkMode.url);
      this.netClient = new NetClient(transport, this.match, this.physics, this.events);
      this.netClient.onKicked = (reason) => {
        console.warn('[photon] disconnected:', reason);
      };
      await this.netClient.connect(networkMode.playerName, networkMode.preferredTeam);
    }

    this.input = new InputManager(inputSettings);
    this.input.onPauseRequested = () => this.callbacks.onPause();

    this.wireAudio();
    this.loop = new GameLoop(this.tick, this.render);

    onProgress('Ready', 1);
  }

  attachInput(target: HTMLElement): void {
    this.input.attach(target);
  }

  updateSettings(inputSettings: InputSettings, reduceShake: boolean, reduceBob: boolean): void {
    this.input?.updateSettings(inputSettings);
    this.reduceShake = reduceShake;
    this.reduceBob = reduceBob;
  }

  start(): void {
    this.loop.start();
    // Dev-only handle. The editor tools in M6 attach here, and it makes the simulation
    // inspectable and steppable from the console without a running render loop.
    if (import.meta.env.DEV) {
      const handle = window as unknown as { __PHOTON__: Game & { probeLighting?: unknown } };
      handle.__PHOTON__ = this as Game & { probeLighting?: unknown };
      // Lighting validation is loaded lazily so the probe's Three.js imports stay out of the
      // production bundle entirely.
      // Graphics settings on the dev handle, so a frame-cost attribution pass can toggle one
      // effect at a time and read the GPU timer back. Doing this through the settings menu works
      // but cannot isolate a single effect — the presets change several at once.
      (handle.__PHOTON__ as unknown as { settings?: unknown }).settings = useSettings;
      void import('@/dev/netProbe').then((module) => {
        (handle.__PHOTON__ as unknown as { probeNet?: unknown }).probeNet = () =>
          module.probeNetcode(this.match.state);
      });
      void import('@/dev/lightingProbe').then((module) => {
        handle.__PHOTON__.probeLighting = (
          position: { x: number; y: number; z: number },
          yaw: number,
          pitch = 0,
          options = {},
        ) => module.probeArenaLighting(this.arena, position, yaw, pitch, options);
      });
      /**
       * Frame capture, for judging visual work on the rendered image.
       *
       * `__PHOTON__.capture('name')` writes `captures/name.png` at the canvas's real backing-store
       * resolution — 1600x1000 here — and returns the size. This exists because the browser pane
       * composites the whole page at roughly 175x105 whatever the canvas is, so a screenshot of the
       * pane cannot resolve a panel seam, a normal-map relief or a bloom threshold. The backing store
       * has the pixels; the compositor is the only thing throwing them away.
       *
       * Requires `preserveDrawingBuffer` (dev only, set in GameCanvas): without it WebGL discards the
       * buffer after compositing and `toDataURL` returns a blank frame from outside the render
       * callback.
       *
       * `settleFrames` exists because a camera move takes effect on the *next* rendered frame, and
       * post-processing history (bloom, TAA-style accumulation) needs a few more to stabilise. A
       * capture taken immediately after moving shows the previous viewpoint.
       */
      (handle.__PHOTON__ as unknown as { capture?: unknown }).capture = async (
        name: string,
        settleFrames = 8,
      ) => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return { ok: false, error: 'no canvas' };
        await new Promise<void>((done) => {
          let left = settleFrames;
          const step = () => (left-- > 0 ? requestAnimationFrame(step) : done());
          requestAnimationFrame(step);
        });
        const dataUrl = canvas.toDataURL('image/png');
        const response = await fetch('/__capture', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, dataUrl }),
        });
        const result = await response.json();
        return { ...result, width: canvas.width, height: canvas.height };
      };

      // Animation states, for verifying the state mapper against a live match.
      //
      // Worth a dev hook rather than a console session of guesswork: the four states added in the
      // state-mapper pass are all edges or thresholds — a landing lasts a third of a second and a
      // turn a fifth — and none of them can be confirmed from a screenshot, because every state
      // currently resolves to the same clip until the animation pack is downloaded. What is
      // verifiable is which state the mapper *reaches*, and that is only observable from here.
      void import('@/render/CharacterStateMapper').then((module) => {
        const handle2 = handle.__PHOTON__ as unknown as {
          animStates?: unknown;
          triggerInteract?: unknown;
        };
        handle2.animStates = () =>
          [...this.match.state.actors.values()]
            .filter((actor) => actor.kind !== 'local')
            .map((actor) => ({
              id: actor.id,
              // `stateOf`, not `resolve`. Resolving here would run the mapper a second time this
              // frame, halve every hold and consume the landing edge before the renderer saw it.
              state: module.characterStates.stateOf(actor.id),
              tier: module.characterStates.tierOf(actor.id),
              speed: +Math.hypot(actor.velocity.x, actor.velocity.z).toFixed(2),
              grounded: actor.grounded,
            }));
        handle2.triggerInteract = (id: number, duration?: number) =>
          module.characterStates.triggerInteract(id, duration);
      });
    }
  }

  /** Advances the simulation by `count` fixed ticks, bypassing the render loop. Dev/test only. */
  stepTicks(count: number): void {
    for (let i = 0; i < count; i++) this.tick(TICK_DT);
  }

  stop(): void {
    this.loop?.stop();
  }

  get stats() {
    return this.loop.stats;
  }

  // --- Tick ----------------------------------------------------------------

  private tick = (dt: number): void => {
    const local = this.localActor;
    if (local) {
      // Sample peripherals straight into the local actor's input frame, scaling look by ADS.
      const frame = this.input.sample(dt);
      const sensitivityScale = weaponSensitivityScale(local);
      frame.lookYaw *= sensitivityScale;
      frame.lookPitch *= sensitivityScale;
      // A dead player still gets to look around, but not to act.
      if (!local.alive) {
        frame.moveX = 0;
        frame.moveZ = 0;
        frame.fire = false;
        frame.firePressed = false;
        frame.jump = false;
        frame.jumpPressed = false;
      }
      Object.assign(local.input, frame);

      // In client mode the input is also the thing we send upstream. It goes before the local
      // step so the packet reflects exactly the frame we are about to predict with.
      this.netClient?.sendInput(local.input);
    }

    this.match.step(dt);
    // Prediction is only judgeable against a stored per-tick result, so capture it after stepping.
    this.netClient?.recordPrediction();
  };

  // --- Render --------------------------------------------------------------

  private render = (alpha: number, frameDt: number): void => {
    this.alpha = alpha;
    const local = this.localActor;
    if (!local) return;

    this.netClient?.update(frameDt);
    this.applyNetworkedActors();
    this.updateView(local, alpha, frameDt);
    this.updateAudioListener();
    this.audio.stepMusic(frameDt, this.computeCombatIntensity(local, frameDt));

    // The HUD only needs ~20 Hz; pushing every frame would dominate React's cost.
    this.uiPushTimer -= frameDt;
    if (this.uiPushTimer <= 0) {
      this.uiPushTimer = 0.05;
      this.pushHudSnapshot(local);
    }
  };

  /**
   * Writes interpolated positions onto remote actors before rendering.
   *
   * Remote actors are sampled rather than simulated, so their authoritative transform for this
   * frame comes from the interpolator, not from the local physics step. Applied here — after the
   * simulation, before the view is built — so renderers see one consistent world.
   */
  private applyNetworkedActors(): void {
    const client = this.netClient;
    if (!client) return;
    for (const [id, sample] of client.remoteActors) {
      if (id === client.actorId) continue;
      const actor = this.match.state.actors.get(id);
      if (!actor) continue;
      actor.prevPosition.x = actor.position.x;
      actor.prevPosition.y = actor.position.y;
      actor.prevPosition.z = actor.position.z;
      actor.position.x = sample.px;
      actor.position.y = sample.py;
      actor.position.z = sample.pz;
      actor.yaw = sample.yaw;
      actor.pitch = sample.pitch;
      actor.lean = sample.lean;
      actor.height = sample.height;
    }
  }

  private updateView(local: Actor, alpha: number, frameDt: number): void {
    const view = this.view;

    // Interpolate the eye between the previous and current tick.
    const eye = eyePosition(local, { x: 0, y: 0, z: 0 });
    const prevEyeY = local.prevPosition.y + local.height - MOVEMENT.eyeOffsetFromTop;
    view.position.x = lerp(local.prevPosition.x, eye.x, alpha);
    view.position.y = lerp(prevEyeY, eye.y, alpha);
    view.position.z = lerp(local.prevPosition.z, eye.z, alpha);

    // Look is applied directly rather than interpolated — input latency is more felt than jitter.
    view.yaw = local.yaw + local.weapon.recoilYaw;
    view.pitch = clamp(local.pitch + local.weapon.recoilPitch, -1.55, 1.55);
    view.adsBlend = local.weapon.adsBlend;
    view.fovScale = weaponFovScale(local);

    const speed = speedXZ(local.velocity);
    view.speed = speed;

    // --- View bob -----------------------------------------------------------
    const bobScale = this.reduceBob ? 0 : 1;
    if (local.grounded && speed > 0.5 && local.stance !== 'slide') {
      this.bobPhase += frameDt * MOVEMENT.viewBobFrequency * Math.PI * 2 * (speed / MOVEMENT.walkSpeed);
    } else {
      this.bobPhase += frameDt * 1.2;
    }
    const bobAmount =
      MOVEMENT.viewBobAmount *
      clamp(speed / MOVEMENT.sprintSpeed, 0, 1.2) *
      (1 - local.weapon.adsBlend * 0.75) *
      bobScale;
    view.bobX = Math.sin(this.bobPhase) * bobAmount;
    view.bobY = Math.abs(Math.cos(this.bobPhase)) * bobAmount * 0.7;

    // --- Landing dip --------------------------------------------------------
    if (local.fx.landedThisTick > 0) {
      this.landingDip = Math.min(
        MOVEMENT.maxLandingDip,
        local.fx.landedThisTick * MOVEMENT.landingDipPerMps,
      );
      local.fx.landedThisTick = 0;
    }
    this.landingDip = damp(this.landingDip, 0, 0.09, frameDt);
    view.position.y -= this.landingDip * bobScale;

    // Prediction corrections are paid off through the camera, never by snapping the actor.
    if (this.netClient) {
      const smoothing = this.netClient.reconciler.smoothing;
      view.position.x += smoothing.x;
      view.position.y += smoothing.y;
      view.position.z += smoothing.z;
    }

    // --- Roll from lean and strafe ------------------------------------------
    const basis = groundBasis(local.yaw);
    const lateral = local.velocity.x * basis.rx + local.velocity.z * basis.rz;
    const strafeRoll = clamp(-lateral / MOVEMENT.sprintSpeed, -1, 1) * 0.022;
    const leanRoll = -local.lean * MOVEMENT.leanAngle * (Math.PI / 180);
    const slideRoll = local.stance === 'slide' ? 0.05 : 0;
    view.roll = damp(view.roll, leanRoll + strafeRoll + slideRoll, 0.06, frameDt);

    // --- Recoil kick and shake ----------------------------------------------
    if (local.fx.firedThisTick) {
      view.recoilKick = Math.min(1, view.recoilKick + 0.6);
      if (!this.reduceShake) this.shakeAmount = Math.min(1, this.shakeAmount + 0.35);
    }
    view.recoilKick = damp(view.recoilKick, 0, 0.06, frameDt);
    this.shakeAmount = damp(this.shakeAmount, 0, 0.05, frameDt);
    view.shake = this.shakeAmount;
  }

  private updateAudioListener(): void {
    if (!this.audio.isStarted) return;
    const forward = forwardFromLook(this.view.yaw, this.view.pitch);
    this.audio.updateListener(this.view.position, forward, { x: 0, y: 1, z: 0 });

    // Pick the tightest reverb zone containing the listener.
    let wetness = 0.25;
    let decay = 1.2;
    let bestVolume = Infinity;
    for (const zone of this.arena.definition.reverbZones) {
      const inside =
        Math.abs(this.view.position.x - zone.p[0]) <= zone.s[0] / 2 &&
        Math.abs(this.view.position.y - zone.p[1]) <= zone.s[1] / 2 &&
        Math.abs(this.view.position.z - zone.p[2]) <= zone.s[2] / 2;
      if (!inside) continue;
      const volume = zone.s[0] * zone.s[1] * zone.s[2];
      if (volume < bestVolume) {
        bestVolume = volume;
        wetness = zone.wetness;
        decay = zone.decaySeconds;
      }
    }
    this.audio.setReverb(wetness, decay);
  }

  /** Music intensity tracks how close and how numerous live enemies are. */
  private computeCombatIntensity(local: Actor, frameDt: number): number {
    let target = 0;
    for (const actor of this.match.state.actors.values()) {
      if (actor.id === local.id || !actor.alive) continue;
      if (!this.match.mode.freeForAll && actor.team === local.team) continue;
      const d = dist3(local.position, actor.position);
      if (d < 35) target += clamp(1 - d / 35, 0, 1);
    }
    if (!local.alive) target *= 0.3;
    this.combatIntensity = damp(this.combatIntensity, clamp(target * 0.45, 0, 1), 1.2, frameDt);
    return this.combatIntensity;
  }

  private pushHudSnapshot(local: Actor): void {
    const ui = useUi.getState();
    const mode = GAME_MODES[this.match.settings.mode];
    const state = this.match.state;

    const scores = mode.freeForAll
      ? [...state.actors.values()]
          .map((a) => ({
            key: String(a.id),
            label: a.name,
            team: a.team,
            score: state.scores[String(a.id)] ?? 0,
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 4)
      : this.match.settings.teams.map((team) => ({
          key: team,
          label: TEAMS[team].name,
          team,
          score: state.scores[team] ?? 0,
        }));

    ui.setHud({
      health: local.health,
      shield: local.shield,
      charge: local.weapon.charge,
      chargeMax: 6,
      recharging: local.weapon.recharging,
      rechargeProgress: local.weapon.rechargeProgress,
      alive: local.alive,
      respawnIn: Math.max(0, local.respawnTimer),
      spread: local.weapon.spread,
      adsBlend: local.weapon.adsBlend,
      team: local.team,
      score: local.score,
      kills: local.kills,
      deaths: local.deaths,
      assists: local.assists,
      timeRemaining: state.timeRemaining,
      scores,
      fps: this.loop.stats.fps,
      simMs: this.loop.stats.simMs,
      drawCalls: this.renderStats.drawCalls,
      cpuMs: this.renderStats.cpuMs,
      gpuMs: this.renderStats.gpuMs,
      objective: this.objectiveStatus(),
    });

    ui.setKillFeed(
      state.killFeed.map((entry) => ({
        id: entry.id,
        killer: entry.killer,
        killerTeam: entry.killerTeam,
        victim: entry.victim,
        victimTeam: entry.victimTeam,
        headshot: entry.headshot,
        selfInflicted: entry.selfInflicted,
      })),
    );

    const scoreboardOpen = this.input.scoreboardHeld || state.phase === 'ended';
    if (scoreboardOpen !== ui.scoreboardOpen) ui.setScoreboardOpen(scoreboardOpen);
    if (scoreboardOpen) {
      ui.setScoreboard(
        [...state.actors.values()]
          .map((a) => ({
            id: a.id,
            name: a.name,
            team: a.team,
            kills: a.kills,
            deaths: a.deaths,
            assists: a.assists,
            score: a.score,
            isLocal: a.kind === 'local',
            isBot: a.kind === 'bot',
          }))
          .sort((a, b) => b.score - a.score || b.kills - a.kills),
      );
    }
  }

  // --- Event wiring --------------------------------------------------------

  private wireAudio(): void {
    const ui = useUi.getState();

    this.events.on('shot_fired', ({ origin, team, isLocal }) => {
      // Team pitch offsets make it possible to hear which team is firing nearby.
      const pitch = { red: 1, blue: 0.92, green: 1.08, yellow: 0.86 }[team];
      this.audio.playLaser(isLocal ? undefined : origin, pitch, isLocal);
      if (isLocal) {
        const config = TEAMS[team];
        void config;
        this.input.rumble(0.28, 0.55, 70);
      }
    });

    this.events.on('projectile_impact', ({ position, hitActor, surface, incidence }) => {
      this.audio.playImpact(position, hitActor);
      // Only grazing hits on hard surfaces ricochet, so it stays an accent rather than constant.
      if (!hitActor && incidence < 0.55 && surface !== 'led' && surface !== 'trim') {
        this.audio.playRicochet(position, surface);
      }
    });

    this.events.on('weapon_recharge_start', ({ isLocal }) => this.audio.playRechargeStart(isLocal));
    this.events.on('weapon_recharge_end', ({ isLocal }) => this.audio.playRechargeEnd(isLocal));

    this.events.on('damage_dealt', (e) => {
      if (e.attackerIsLocal) {
        this.audio.playHitMarker(e.killed);
        ui.pushHitMarker(e.killed, performance.now() / 1000);
        this.input.rumble(RUMBLE.hitDealt.strong, RUMBLE.hitDealt.weak, RUMBLE.hitDealt.ms);
      }
      if (e.victimIsLocal) {
        this.audio.playDamageTaken();
        ui.pushDamageIndicator(e.fromYaw, performance.now() / 1000);
        this.input.rumble(RUMBLE.hitTaken.strong, RUMBLE.hitTaken.weak, RUMBLE.hitTaken.ms);
        if (!this.reduceShake) this.shakeAmount = Math.min(1, this.shakeAmount + 0.5);
      }
    });

    this.events.on('actor_died', ({ isLocal }) => {
      this.audio.playDeath(isLocal);
      if (isLocal) this.input.rumble(RUMBLE.kill.strong, RUMBLE.kill.weak, RUMBLE.kill.ms);
    });

    this.events.on('actor_spawned', ({ isLocal }) => {
      if (isLocal) this.audio.playRespawn();
    });

    this.events.on('footstep', ({ position, running, isLocal, surface }) =>
      this.audio.playFootstep(position, running, isLocal, surface),
    );
    this.events.on('jump', ({ position, isLocal }) => this.audio.playJump(position, isLocal));
    this.events.on('land', ({ position, impactSpeed, isLocal }) => {
      this.audio.playLand(position, impactSpeed, isLocal);
      if (isLocal && impactSpeed > 6) {
        this.input.rumble(RUMBLE.land.strong, RUMBLE.land.weak, RUMBLE.land.ms);
      }
    });
    this.events.on('slide_start', ({ position, isLocal }) => {
      this.audio.playSlide(position, isLocal);
      if (isLocal) this.input.rumble(RUMBLE.slideStart.strong, RUMBLE.slideStart.weak, RUMBLE.slideStart.ms);
    });

    this.events.on('announcement', ({ text, priority }) => {
      this.audio.playAnnouncement(priority);
      ui.setSubtitle(text);
      window.setTimeout(() => {
        if (useUi.getState().subtitle === text) useUi.getState().setSubtitle(null);
      }, 3200);
    });

    this.events.on('notification', ({ text, tone }) => ui.pushNotification(text, tone));

    // Tag confirmations and being tagged both surface as notifications, so the player always has
    // a written record of what just happened even if they missed the audio cue.
    this.events.on('damage_dealt', (e) => {
      if (e.killed && e.attackerIsLocal) {
        const victim = this.match.state.actors.get(e.victimId);
        ui.pushNotification(`TAGGED ${victim?.name ?? 'TARGET'}`, 'good');
      }
      if (e.killed && e.victimIsLocal) {
        const attacker = this.match.state.actors.get(e.attackerId);
        ui.pushNotification(`TAGGED BY ${attacker?.name ?? 'UNKNOWN'}`, 'bad');
      }
    });

    this.events.on('match_ended', ({ winner }) => {
      // Won if the local player's team took it; a draw reads as a loss, deliberately — a neutral
      // third sting would be a third thing to learn for an outcome that is already disappointing.
      this.audio.playMatchEnd(winner !== null && winner === this.localActor?.team);
      ui.setMatchResult({
        winner,
        scores: this.match.settings.teams.map((team) => ({
          team,
          score: this.match.state.scores[team] ?? 0,
        })),
      });
      ui.setScreen('results');
      this.input.exitPointerLock();
    });
  }

  /** Live state of the arena's central objective, for the HUD objective tracker. */
  private objectiveStatus() {
    const hill = this.match.triggers.get('central_hill');
    if (!hill) {
      return { label: 'CENTRAL ROOM', controllingTeam: null, contested: false, occupants: 0, heldSeconds: 0 };
    }
    return {
      label: 'CENTRAL ROOM',
      controllingTeam: hill.controllingTeam,
      contested: hill.contested,
      occupants: hill.occupants.length,
      heldSeconds: hill.heldSeconds,
    };
  }

  /** Seconds until the local player may respawn, for the death screen. */
  get respawnCountdown(): number {
    const local = this.localActor;
    if (!local || local.alive) return 0;
    return Math.max(0, Math.min(local.respawnTimer, this.match.settings.respawnSeconds));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.input?.detach();
    this.input?.exitPointerLock();
    this.events.clear();
    this.audio.dispose();
    this.netClient?.dispose();
    this.netClient = null;
    this.match?.dispose();
    this.physics?.dispose();
  }
}

/**
 * Yields to the browser between loading stages so the progress bar actually paints.
 *
 * Races rAF against a timer: a backgrounded tab never fires animation frames, and awaiting one
 * unconditionally would hang the load for anyone who alt-tabs while the arena is building.
 */
const frame = (): Promise<void> =>
  new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(done);
    window.setTimeout(done, 32);
  });

export { TICK_DT, COMBAT };
