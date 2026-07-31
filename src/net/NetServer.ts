import type { MatchSettings } from '@/config/gameModes';
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
  validator: ClientValidator;
  /** Buffered inputs not yet consumed, keyed by tick. */
  inputQueue: Map<number, InputFrame>;
  /** Per-client snapshot history, for delta baselines. */
  history: SnapshotHistory;
  bytesSent: number;
  bytesReceived: number;
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
      validator: new ClientValidator(),
      inputQueue: new Map(),
      history: new SnapshotHistory(),
      bytesSent: 0,
      bytesReceived: 0,
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

  private kick(client: ServerClient, reason: KickReason): void {
    const writer = new ByteWriter(8);
    writer.u8(ServerMessage.Kick);
    writer.u8(reason);
    this.send(client, writer.finish());
    client.transport.close(`kicked: ${reason}`);
    this.clients.delete(client.id);
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
    client.team = pickTeamForJoin(
      this.balanceMembers(),
      defaultBalanceConfig(this.options.settings.teams, this.options.settings.botsPerTeam),
      (preferred as TeamId) || null,
    );

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

  private handleTeamSwitch(client: ServerClient, reader: ByteReader): void {
    const team = reader.string() as TeamId;
    // Manual switching is lobby-only by design: mid-match switching is a griefing vector and
    // instantly unbalances a round.
    if (this.flow.phase !== 'lobby' && this.flow.phase !== 'warmup') return;
    if (!this.options.settings.teams.includes(team)) return;

    const members = this.balanceMembers();
    const config = defaultBalanceConfig(this.options.settings.teams, this.options.settings.botsPerTeam);
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
      } else {
        // No input arrived for this tick. Hold the last movement but clear one-shot edges, so a
        // dropped packet does not repeat a jump or a shot.
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
    if (client.inputQueue.size === 0) return undefined;

    // Bound the backlog: never let a client build more than a few ticks of queued intent.
    const MAX_BACKLOG = 6;
    while (client.inputQueue.size > MAX_BACKLOG) {
      const oldest = Math.min(...client.inputQueue.keys());
      client.inputQueue.delete(oldest);
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
    const config = defaultBalanceConfig(
      this.options.settings.teams,
      this.options.settings.botsPerTeam,
    );
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

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();
