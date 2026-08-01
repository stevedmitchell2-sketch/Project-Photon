import { GAME_MODES, type MatchSettings } from '@/config/gameModes';
import type { TeamId } from '@/config/teams';
import { TICK_DT } from '@/engine/GameLoop';
import { EventBus } from '@/engine/EventBus';
import type { MatchDirector } from '@/gameplay/MatchDirector';
import { MatchFlow, defaultMatchFlowConfig } from '@/gameplay/MatchFlow';
import { StatsTracker } from '@/gameplay/Statistics';
import {
  defaultBalanceConfig,
  pickTeamForJoin,
  rebalance,
  type BalanceMember,
} from '@/gameplay/TeamBalance';
import type { Actor, GameEvents } from '@/gameplay/types';
import { createInputFrame, copyInputFrame, type InputFrame } from '@/input/InputFrame';
import { ByteReader, ByteWriter, ProtocolError } from './serialize';
import {
  ClientMessage,
  CLIENT_TIMEOUT_MS,
  INPUT_BITS,
  KickReason,
  MAX_INPUTS_PER_PACKET,
  PROTOCOL_VERSION,
  ServerMessage,
  TICKS_PER_SNAPSHOT,
} from './protocol';
import { captureWorld, encodeSnapshot, SnapshotHistory, type WorldSnapshot } from './snapshot';
import type { Transport } from './Transport';
import { ClientValidator } from './Validation';

/**
 * Authoritative server session.
 *
 * Runs the identical `MatchDirector` a client runs, but its result is the only one that counts.
 * Clients contribute exactly one thing: a stream of `InputFrame`s attributed to their own actor.
 *
 * The server is transport-agnostic — it is handed `Transport` objects and never knows whether they
 * are WebSockets or in-process pipes. That is what lets single-player run this same class in the
 * browser, which in turn means the replication path is exercised on every playthrough instead of
 * only when two people connect.
 */

export interface ServerClient {
  id: number;
  transport: Transport;
  actorId: number;
  name: string;
  team: TeamId | null;
  ready: boolean;
  spectating: boolean;
  authenticated: boolean;
  /** Last input tick consumed. Echoed in snapshots so the client can reconcile. */
  lastInputTick: number;
  /** Snapshot tick this client last acknowledged, used as the delta baseline. */
  acknowledgedSnapshot: number;
  lastSeenMs: number;
  connectedAtTick: number;
  rating: number;
  /** Smoothed round-trip time in ms, used to size this client's lag-compensation rewind. */
  rttMs: number;
  /** Departure time of each snapshot, keyed by tick, for the server-side RTT measurement. */
  snapshotSentAt: Map<number, number>;
  validator: ClientValidator;
  /** Buffered inputs not yet consumed, keyed by tick. */
  inputQueue: Map<number, InputFrame>;
  /** Per-client snapshot history, for delta baselines. */
  history: SnapshotHistory;
  bytesSent: number;
  bytesReceived: number;
  /**
   * Ticks on which no input was available for this client.
   *
   * Diagnostic for prediction drift: a starved tick means the server has run ahead of the client's
   * input stream. What it does about that determines whether prediction stays honest.
   */
  starvedTicks: number;
  consumedTicks: number;
  /**
   * Inputs discarded because the queue exceeded `MAX_INPUT_BACKLOG`.
   *
   * Every one of these is a movement step the client predicted and the server never simulated, so
   * it is a permanent position disagreement until the next correction. Counted because "the server
   * quietly dropped some of your inputs" and "your prediction is inaccurate" look identical from
   * the client and have completely different fixes.
   */
  droppedInputs: number;
  /**
   * True once enough inputs have accumulated to start consuming.
   *
   * Two 64 Hz clocks that are not phase-locked will starve constantly if the server consumes the
   * instant the first input lands. Priming a small cushion first absorbs that jitter.
   */
  inputPrimed: boolean;
}

export interface NetServerOptions {
  maxClients: number;
  settings: MatchSettings;
  /** Called to construct the match. Injected so the server does not import physics directly. */
  createMatch: () => Promise<{ director: MatchDirector; events: EventBus<GameEvents> }>;
}

export class NetServer {
  private clients = new Map<number, ServerClient>();
  private nextClientId = 1;
  private director!: MatchDirector;
  /** Match event stream. Held so match events can be forwarded to clients as reliable RPCs. */
  private events!: EventBus<GameEvents>;
  private readonly flow: MatchFlow;
  readonly stats = new StatsTracker();
  private tickAccumulator = 0;
  private running = false;
  private lastTickMs = 0;
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  /** Rolling bandwidth counters, sampled per second for the profiling readout. */
  readonly bandwidth = { sentBytesPerSecond: 0, receivedBytesPerSecond: 0, snapshotBytes: 0 };
  private bandwidthWindowStart = 0;
  private bandwidthSent = 0;
  private bandwidthReceived = 0;

  constructor(private readonly options: NetServerOptions) {
    this.flow = new MatchFlow(defaultMatchFlowConfig());
  }

  async start(): Promise<void> {
    const { director, events } = await this.options.createMatch();
    this.director = director;
    this.events = events;
    // Only the authoritative director rewinds. A client doing so would fight its own reconciliation.
    this.director.enableLagCompensation(true);
    this.wireMatchEvents();
    this.running = true;
    this.lastTickMs = now();
    this.bandwidthWindowStart = this.lastTickMs;

    // Fixed-rate loop. setInterval drifts, so the accumulator below reconciles against real time
    // rather than assuming every callback is exactly one tick apart.
    this.loopHandle = setInterval(() => this.pump(), 1000 / 120);
  }

  /**
   * Forwards simulation events that clients cannot derive from snapshots.
   *
   * Most presentation follows from state — a client sees health drop and knows it was hit. But
   * discrete events (who tagged whom, an objective flipping) carry attribution that is impossible
   * to reconstruct from two sampled positions, so they replicate explicitly.
   */
  private wireMatchEvents(): void {
    this.events.on('damage_dealt', (e) => {
      this.stats.recordHit(e.attackerId, e.victimId, e.amount, 0, e.headshot);
      if (e.killed) this.stats.recordElimination(e.attackerId, e.victimId);
    });
    this.events.on('shot_fired', (e) => this.stats.recordShot(e.actorId));
    this.events.on('score_changed', () => this.broadcastMatchState());
  }

  private broadcastMatchState(): void {
    const flow = this.flow.serialize();
    const writer = new ByteWriter(64);
    writer.u8(ServerMessage.MatchState);
    writer.u8(flow.phase);
    writer.u16(flow.remaining);
    writer.varint(flow.sequence);
    const payload = writer.finish();
    for (const client of this.clients.values()) this.send(client, payload);
  }

  stop(): void {
    this.running = false;
    if (this.loopHandle) clearInterval(this.loopHandle);
    this.loopHandle = null;
    for (const client of this.clients.values()) {
      this.kick(client, KickReason.ServerShutdown);
    }
    this.clients.clear();
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Per-client input starvation, for prediction diagnostics. */
  inputHealth(): Array<{
    id: number;
    starved: number;
    consumed: number;
    dropped: number;
    starvedPercent: number;
  }> {
    return [...this.clients.values()].map((c) => {
      const total = c.starvedTicks + c.consumedTicks;
      return {
        id: c.id,
        starved: c.starvedTicks,
        consumed: c.consumedTicks,
        dropped: c.droppedInputs,
        starvedPercent: total > 0 ? Math.round((c.starvedTicks / total) * 1000) / 10 : 0,
      };
    });
  }

  get matchFlow(): MatchFlow {
    return this.flow;
  }

  // --- Connection lifecycle -------------------------------------------------

  accept(transport: Transport): ServerClient {
    const client: ServerClient = {
      id: this.nextClientId++,
      transport,
      actorId: -1,
      name: 'OPERATOR',
      team: null,
      ready: false,
      spectating: false,
      authenticated: false,
      lastInputTick: -1,
      acknowledgedSnapshot: 0,
      lastSeenMs: now(),
      connectedAtTick: this.director?.state.tick ?? 0,
      rating: 1000,
      rttMs: 0,
      snapshotSentAt: new Map(),
      validator: new ClientValidator(),
      inputQueue: new Map(),
      history: new SnapshotHistory(),
      bytesSent: 0,
      bytesReceived: 0,
      starvedTicks: 0,
      consumedTicks: 0,
      droppedInputs: 0,
      inputPrimed: false,
    };
    this.clients.set(client.id, client);

    transport.on('message', (data) => this.handleMessage(client, data));
    transport.on('close', () => this.disconnect(client.id, 'transport closed'));

    return client;
  }

  disconnect(clientId: number, reason: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);

    if (client.actorId >= 0) this.director?.removeActor(client.actorId);
    void reason;
    this.rebalanceTeams();
  }

  /**
   * Ejects a client and reclaims everything it owned.
   *
   * This must dispose of the actor exactly as a voluntary disconnect does. It previously only
   * removed the client record, so every timeout, rate-limit and invalid-input kick left an
   * abandoned actor standing in the arena — still replicated to everyone, still occupying a spawn,
   * still costing a capsule in the physics world, for the lifetime of the server.
   */
  private kick(client: ServerClient, reason: KickReason): void {
    const writer = new ByteWriter(8);
    writer.u8(ServerMessage.Kick);
    writer.u8(reason);
    this.send(client, writer.finish());
    client.transport.close(`kicked: ${reason}`);
    this.disconnect(client.id, `kicked: ${reason}`);
  }

  // --- Message handling -----------------------------------------------------

  private handleMessage(client: ServerClient, data: Uint8Array): void {
    client.lastSeenMs = now();
    client.bytesReceived += data.byteLength;
    this.bandwidthReceived += data.byteLength;

    if (!client.validator.acceptPacket(client.lastSeenMs)) {
      this.kick(client, KickReason.RateLimited);
      return;
    }

    try {
      const reader = new ByteReader(data);
      const type = reader.u8() as ClientMessage;

      switch (type) {
        case ClientMessage.Handshake:
          this.handleHandshake(client, reader);
          break;
        case ClientMessage.Input:
          if (client.authenticated) this.handleInput(client, reader);
          break;
        case ClientMessage.Ready:
          client.ready = reader.u8() !== 0;
          break;
        case ClientMessage.TeamSwitch:
          this.handleTeamSwitch(client, reader);
          break;
        case ClientMessage.Spectate:
          client.spectating = reader.u8() !== 0;
          break;
        case ClientMessage.Ping: {
          const stamp = reader.u32();
          // Pure echo. This exchange is the *client's* latency measurement — it stamps, we reflect,
          // it times the round trip. The server cannot learn its own RTT from it: a client sends
          // each sequence exactly once, so the server only ever sees a given stamp a single time.
          // It used to try anyway, storing the stamp on first sight and measuring on the second
          // sight that never came, which left `rttMs` at zero for the life of every session.
          // Server-side RTT is measured in `handleInput` instead.
          const writer = new ByteWriter(16);
          writer.u8(ServerMessage.Pong);
          writer.u32(stamp);
          writer.varint(this.director?.state.tick ?? 0);
          this.send(client, writer.finish());
          break;
        }
        case ClientMessage.Heartbeat:
          break;
        default:
          break;
      }
    } catch (error) {
      // A malformed packet is dropped, never allowed to corrupt state. Repeat offenders are kicked
      // by the validator's strike system rather than on a single bad frame.
      if (error instanceof ProtocolError) {
        client.validator.sanitise(createInputFrame(), this.director?.state.tick ?? 0);
        if (client.validator.shouldKick) this.kick(client, KickReason.InvalidInput);
        return;
      }
      throw error;
    }
  }

  private handleHandshake(client: ServerClient, reader: ByteReader): void {
    const version = reader.varint();
    const name = reader.string();
    const preferred = reader.string();

    if (version !== PROTOCOL_VERSION) {
      this.kick(client, KickReason.VersionMismatch);
      return;
    }
    if (this.clients.size > this.options.maxClients) {
      this.kick(client, KickReason.ServerFull);
      return;
    }

    client.name = name.slice(0, 16).toUpperCase() || 'OPERATOR';
    client.authenticated = true;
    client.team = pickTeamForJoin(this.balanceMembers(), this.balanceConfig(), (preferred as TeamId) || null);

    const actor = this.director.createNetworkPlayer(client.name, client.team ?? this.options.settings.teams[0]);
    client.actorId = actor.id;
    this.stats.register(actor.id, client.name, actor.team, false);

    const writer = new ByteWriter(128);
    writer.u8(ServerMessage.HandshakeAck);
    writer.u8(1); // accepted
    writer.varint(client.id);
    writer.varint(client.actorId);
    writer.varint(this.director.state.tick);
    writer.string(this.options.settings.arena);
    writer.string(this.options.settings.mode);
    this.send(client, writer.finish());

    // First snapshot must be full: the client has no baseline yet.
    this.sendSnapshot(client, true);
  }

  /**
   * Decodes a bundle of inputs.
   *
   * Clients resend a window of recent unacknowledged frames every packet, so duplicates are normal
   * and expected — the validator's monotonic tick check discards them for free.
   */
  private handleInput(client: ServerClient, reader: ByteReader): void {
    client.acknowledgedSnapshot = reader.varint();
    this.noteRoundTrip(client, client.acknowledgedSnapshot);
    const count = Math.min(reader.u8(), MAX_INPUTS_PER_PACKET);
    const currentTick = this.director.state.tick;

    for (let i = 0; i < count; i++) {
      const frame = createInputFrame();
      frame.tick = reader.varint();
      frame.moveX = reader.i16() / 1000;
      frame.moveZ = reader.i16() / 1000;
      frame.lookYaw = reader.i16() / 10000;
      frame.lookPitch = reader.i16() / 10000;
      frame.lean = reader.i16() / 1000;
      const bits = reader.u8();

      frame.jump = (bits & INPUT_BITS.JUMP) !== 0;
      frame.jumpPressed = (bits & INPUT_BITS.JUMP_PRESSED) !== 0;
      frame.sprint = (bits & INPUT_BITS.SPRINT) !== 0;
      frame.crouch = (bits & INPUT_BITS.CROUCH) !== 0;
      frame.fire = (bits & INPUT_BITS.FIRE) !== 0;
      frame.ads = (bits & INPUT_BITS.ADS) !== 0;
      frame.reload = (bits & INPUT_BITS.RELOAD) !== 0;
      frame.interact = (bits & INPUT_BITS.INTERACT) !== 0;

      if (!client.validator.sanitise(frame, currentTick)) continue;
      client.inputQueue.set(frame.tick, frame);
    }

    if (client.validator.shouldKick) this.kick(client, KickReason.InvalidInput);
  }

  /**
   * Measures this client's round-trip time, server-side, with no extra traffic.
   *
   * Every input packet echoes the newest snapshot tick the client has applied. The server knows
   * when it put that snapshot on the wire, so the gap between the two is a genuine round trip:
   * server → client → server. It overstates by up to one client tick (~16 ms) of processing, which
   * is small next to the latencies it exists to measure and errs in the safe direction — a slightly
   * generous rewind favours the shooter, which is the trade this system already makes.
   *
   * This number is the whole input to lag compensation. While it sat at zero, `rewindForOwner`
   * rewound by the interpolation delay alone and hit registration collapsed with latency: measured
   * at 21.9% hit rate on a strafing target at 0 ms and 3.1% at 250 ms.
   *
   * The measurement is taken once per snapshot. Inputs arrive at 64 Hz and snapshots at 20 Hz, so
   * roughly three input packets echo the same tick; only the first of them saw a real round trip,
   * and the rest would inflate the estimate with the time they spent waiting to be sent.
   */
  private noteRoundTrip(client: ServerClient, snapshotTick: number): void {
    const sentAt = client.snapshotSentAt.get(snapshotTick);
    if (sentAt === undefined) return;
    client.snapshotSentAt.delete(snapshotTick);

    const sample = now() - sentAt;
    client.rttMs = client.rttMs === 0 ? sample : client.rttMs * 0.8 + sample * 0.2;
    if (client.actorId >= 0) this.director.setActorLatency(client.actorId, client.rttMs);
  }

  private handleTeamSwitch(client: ServerClient, reader: ByteReader): void {
    const team = reader.string() as TeamId;
    // Manual switching is lobby-only by design: mid-match switching is a griefing vector and
    // instantly unbalances a round.
    if (this.flow.phase !== 'lobby' && this.flow.phase !== 'warmup') return;
    if (!this.options.settings.teams.includes(team)) return;

    const members = this.balanceMembers();
    const config = this.balanceConfig();
    const counts = members.filter((m) => m.team === team).length;
    if (counts >= config.maxPerTeam) return;

    client.team = team;
    const actor = this.director.state.actors.get(client.actorId);
    if (actor) actor.team = team;
  }

  // --- Simulation -----------------------------------------------------------

  private pump(): void {
    if (!this.running || !this.director) return;

    const nowMs = now();
    let elapsed = (nowMs - this.lastTickMs) / 1000;
    this.lastTickMs = nowMs;
    // A stalled host must not try to catch up a minute of simulation in one frame.
    if (elapsed > 0.25) elapsed = 0.25;
    this.tickAccumulator += elapsed;

    let ticks = 0;
    while (this.tickAccumulator >= TICK_DT && ticks < 8) {
      this.stepOnce();
      this.tickAccumulator -= TICK_DT;
      ticks++;
    }

    this.expireTimeouts(nowMs);
    this.sampleBandwidth(nowMs);
  }

  private stepOnce(): void {
    const state = this.director.state;

    // Feed each client's input for this tick into its actor.
    for (const client of this.clients.values()) {
      const actor = state.actors.get(client.actorId);
      if (!actor) continue;

      const frame = this.dequeueInput(client, state.tick);
      if (frame) {
        copyInputFrame(actor.input, frame);
        client.lastInputTick = frame.tick;
        client.consumedTicks++;
        this.director.setInputStarved(actor.id, false);
      } else {
        // No input available this tick: the server has run ahead of this client's input stream.
        //
        // Re-simulating with the previous input — which is what this used to do — advances the
        // actor by a movement step the client never predicted. At sprint speed that is 0.13 m of
        // drift per starved tick, and it is *systematic*, because two 64 Hz clocks that are not
        // phase-locked starve constantly. That was the unexplained 22/s correction rate.
        //
        // The honest response is to wait. The actor holds position for this tick and resumes when
        // its input arrives, so the server never simulates a step the client did not.
        client.starvedTicks++;
        this.director.setInputStarved(actor.id, true);
        actor.input.jumpPressed = false;
        actor.input.firePressed = false;
        actor.input.crouchPressed = false;
        actor.input.reloadPressed = false;
        actor.input.interactPressed = false;
      }
    }

    const previousPositions = new Map<number, { x: number; y: number; z: number }>();
    for (const client of this.clients.values()) {
      const actor = state.actors.get(client.actorId);
      if (actor) previousPositions.set(actor.id, { ...actor.position });
    }

    this.director.step(TICK_DT);
    this.stepFlow();

    // Post-simulation validation catches anything input validation missed.
    for (const client of this.clients.values()) {
      const actor = state.actors.get(client.actorId);
      const previous = previousPositions.get(client.actorId);
      if (!actor || !previous) continue;
      if (!client.validator.validateOutcome(actor, previous, state.tick)) {
        // Correct rather than kick: the authoritative position is simply restored.
        actor.position.x = previous.x;
        actor.position.y = previous.y;
        actor.position.z = previous.z;
      }
      client.validator.tick(state.time);
      if (client.validator.shouldKick) this.kick(client, KickReason.InvalidInput);
    }

    // Broadcast on the snapshot cadence, not every tick.
    if (state.tick % TICKS_PER_SNAPSHOT === 0) {
      const snapshot = captureWorld(state);
      for (const client of this.clients.values()) {
        client.history.push(snapshot);
        this.sendSnapshot(client, false, snapshot);
      }
    }
  }

  private stepFlow(): void {
    const state = this.director.state;
    const mode = this.director.gameMode;
    const humans = [...this.clients.values()].filter((c) => !c.spectating);

    this.flow.step(TICK_DT, {
      connectedPlayers: humans.length,
      readyPlayers: humans.filter((c) => c.ready).length,
      modeComplete: mode.isComplete(state),
      timeExpired: state.timeRemaining <= 0,
      tied: mode.winner(state) === null,
      offline: humans.length <= 1,
    });
  }

  /**
   * Consumes exactly one input per tick, in sequence order (FIFO).
   *
   * This must never skip an input. Client prediction works by replaying every unacknowledged frame
   * on top of the server's authoritative state; if the server silently discarded some of those
   * frames, the client's replay includes motion the server never simulated and the two disagree
   * permanently, by a little more each time.
   *
   * That is precisely what an earlier "take the newest, drop the rest" implementation did — every
   * input arriving while the server sat between ticks was thrown away. It measured as a 14-21/s
   * correction rate with a steady 0.05-0.24 m error, and it survived two rounds of investigation
   * because the simulation code was never at fault: an A/B harness later showed the replay path is
   * bit-identical to the live path in isolation.
   *
   * The queue is bounded instead. If a client runs fast enough to build a backlog, the *oldest*
   * frames are dropped to bound added latency — dropping there is visible as a single correction
   * rather than as permanent drift, and it only happens to a client that is misbehaving.
   */
  private dequeueInput(client: ServerClient, tick: number): InputFrame | undefined {
    void tick;

    // Jitter buffer. Client and server both run at 64 Hz but from independent, unsynchronised
    // clocks, so the arrival of input N relative to server tick N drifts continuously. Consuming
    // the instant the first frame lands leaves no slack, and the queue empties on any tick where
    // the packet lands a moment late — measured at 3-20% of ticks, and correction rate tracked it
    // almost exactly.
    //
    // Waiting for a small cushion before starting absorbs that drift. The cost is TARGET_BUFFER
    // ticks (~31 ms) of added input latency, which is a good trade against correcting several
    // times a second.
    if (!client.inputPrimed) {
      if (client.inputQueue.size < TARGET_INPUT_BUFFER) return undefined;
      client.inputPrimed = true;
    }

    if (client.inputQueue.size === 0) {
      // Drained. Re-prime rather than limping along one starved tick at a time.
      client.inputPrimed = false;
      return undefined;
    }

    // Bound the backlog: a client running fast must not accumulate unbounded input latency.
    while (client.inputQueue.size > MAX_INPUT_BACKLOG) {
      const oldest = Math.min(...client.inputQueue.keys());
      client.inputQueue.delete(oldest);
      client.droppedInputs++;
    }

    const nextTick = Math.min(...client.inputQueue.keys());
    const frame = client.inputQueue.get(nextTick);
    client.inputQueue.delete(nextTick);
    return frame;
  }

  // --- Replication ----------------------------------------------------------

  private sendSnapshot(client: ServerClient, full: boolean, snapshot?: WorldSnapshot): void {
    const state = this.director.state;
    const current = snapshot ?? captureWorld(state);
    const baseline = full ? null : client.history.get(client.acknowledgedSnapshot);

    const writer = new ByteWriter(2048);
    writer.u8(baseline ? ServerMessage.Snapshot : ServerMessage.FullSnapshot);
    writer.varint(client.lastInputTick < 0 ? 0 : client.lastInputTick);
    const payload = encodeSnapshot(current, baseline, writer);
    this.send(client, payload);
    this.bandwidth.snapshotBytes = payload.byteLength;

    // Departure time for the round-trip measurement in `noteRoundTrip`. Bounded: at 20 Hz this
    // holds a few seconds of history, far more than any playable latency needs.
    client.snapshotSentAt.set(current.tick, now());
    if (client.snapshotSentAt.size > 128) {
      const oldest = Math.min(...client.snapshotSentAt.keys());
      client.snapshotSentAt.delete(oldest);
    }
  }

  private send(client: ServerClient, data: Uint8Array): void {
    client.transport.send(data);
    client.bytesSent += data.byteLength;
    this.bandwidthSent += data.byteLength;
  }

  private expireTimeouts(nowMs: number): void {
    for (const client of [...this.clients.values()]) {
      if (nowMs - client.lastSeenMs > CLIENT_TIMEOUT_MS) {
        this.kick(client, KickReason.Timeout);
      }
    }
  }

  private sampleBandwidth(nowMs: number): void {
    const elapsed = nowMs - this.bandwidthWindowStart;
    if (elapsed < 1000) return;
    this.bandwidth.sentBytesPerSecond = Math.round((this.bandwidthSent * 1000) / elapsed);
    this.bandwidth.receivedBytesPerSecond = Math.round((this.bandwidthReceived * 1000) / elapsed);
    this.bandwidthSent = 0;
    this.bandwidthReceived = 0;
    this.bandwidthWindowStart = nowMs;
  }

  // --- Team balance ---------------------------------------------------------

  /**
   * Roster limits for this match.
   *
   * The cap is the *mode's* team size. It was previously `settings.botsPerTeam`, which is a
   * different quantity entirely and reads as an argument-order slip against
   * `defaultBalanceConfig(teams, maxPerTeam)`. On a server started with `--bots 0` it made the cap
   * zero, so `pickTeamForJoin` found no team with room, returned null, and every client fell
   * through to the `teams[0]` default — putting the entire server on red, where friendly fire is
   * off and therefore nobody can damage anybody. Team modes were unplayable on any botless server.
   */
  private balanceConfig() {
    return defaultBalanceConfig(this.options.settings.teams, GAME_MODES[this.options.settings.mode].maxPlayersPerTeam);
  }

  private balanceMembers(): BalanceMember[] {
    return [...this.clients.values()].map((c) => ({
      id: c.id,
      team: c.team,
      rating: c.rating,
      locked: false,
      connectedAtTick: c.connectedAtTick,
    }));
  }

  private rebalanceTeams(): void {
    if (this.flow.phase === 'active' || this.flow.phase === 'sudden_death') return;
    const config = this.balanceConfig();
    const { assignments } = rebalance(this.balanceMembers(), config);
    for (const [clientId, team] of assignments) {
      const client = this.clients.get(clientId);
      if (!client) continue;
      client.team = team;
      const actor: Actor | undefined = this.director?.state.actors.get(client.actorId);
      if (actor) actor.team = team;
    }
  }
}

/**
 * Inputs buffered before the server starts consuming a client's stream, and the ceiling it will
 * tolerate. Two ticks is ~31 ms of added input latency — cheap against a correction every 50 ms.
 */
const TARGET_INPUT_BUFFER = 2;
const MAX_INPUT_BACKLOG = 6;

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();
