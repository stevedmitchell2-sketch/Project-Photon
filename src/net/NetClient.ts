import { TICK_DT } from '@/engine/GameLoop';
import type { EventBus } from '@/engine/EventBus';
import type { MatchDirector } from '@/gameplay/MatchDirector';
import { MatchFlow } from '@/gameplay/MatchFlow';
import type { Actor, GameEvents } from '@/gameplay/types';
import type { InputFrame } from '@/input/InputFrame';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { applyActorSnapshot, decodeSnapshot, SnapshotHistory } from './snapshot';
import { Interpolator, type InterpolatedActor } from './Interpolator';
import { Reconciler } from './Reconciler';
import { ByteReader, ByteWriter, ProtocolError } from './serialize';
import {
  ClientMessage,
  HEARTBEAT_INTERVAL_MS,
  INPUT_BITS,
  KICK_REASON_TEXT,
  KickReason,
  MAX_INPUTS_PER_PACKET,
  PROTOCOL_VERSION,
  rateConnection,
  ServerMessage,
  SNAPSHOT_HZ,
  type ConnectionQuality,
} from './protocol';
import type { Transport } from './Transport';

/**
 * The client half of the session.
 *
 * Responsibilities, in the order they happen each tick:
 *   1. pack the local input frame and send it with the unacknowledged window
 *   2. predict the local player forward immediately (via the normal simulation)
 *   3. on snapshot arrival, reconcile the local player and interpolate everyone else
 *
 * The local player is simulated; every other actor is *sampled*. That distinction is the whole
 * design: predicting remote players would mean guessing their inputs, and being wrong about them
 * looks far worse than rendering them a fraction of a second late.
 */

export interface NetClientStats {
  connected: boolean;
  clientId: number;
  actorId: number;
  serverTick: number;
  /** Tick the client is simulating, which runs ahead of the server by roughly rtt/2. */
  clientTick: number;
  snapshotsReceived: number;
  snapshotsDropped: number;
  bytesReceived: number;
  bytesSent: number;
  /** Bytes/second, sampled over a rolling second. */
  downstreamBps: number;
  upstreamBps: number;
  quality: ConnectionQuality;
  /** Server-authority disagreements per second, from the reconciler. */
  corrections: number;
  lastCorrectionMetres: number;
  interpolationDelayMs: number;
  snapshotDelayMs: number;
  /** Snapshots skipped because no stored prediction matched the acknowledged tick. */
  lookupMisses: number;
  /** Snapshots where prediction was actually compared against the server. */
  comparisons: number;
}

export class NetClient {
  private readonly history = new SnapshotHistory();
  readonly reconciler = new Reconciler();
  readonly interpolator = new Interpolator();
  readonly flow = new MatchFlow();

  /** Remote actors, sampled at the interpolated render time. */
  readonly remoteActors = new Map<number, InterpolatedActor>();

  private clientId = -1;
  private localActorId = -1;
  private serverTick = 0;
  private clientTick = 0;
  private lastAcknowledgedInput = -1;
  private lastSnapshotTick = 0;
  private lastSnapshotAtMs = 0;
  private pingTimer = 0;
  private pingSequence = 1;
  private readonly pendingPings = new Map<number, number>();
  private rttSamples: number[] = [];
  private receivedCount = 0;
  private droppedCount = 0;
  private bytesIn = 0;
  private bytesOut = 0;
  private windowStartMs = 0;
  private windowIn = 0;
  private windowOut = 0;
  private disposed = false;

  readonly stats: NetClientStats = {
    connected: false,
    clientId: -1,
    actorId: -1,
    serverTick: 0,
    clientTick: 0,
    snapshotsReceived: 0,
    snapshotsDropped: 0,
    bytesReceived: 0,
    bytesSent: 0,
    downstreamBps: 0,
    upstreamBps: 0,
    quality: { rttMs: 0, jitterMs: 0, packetLossPercent: 0, predictedTicksAhead: 0, rating: 'good' },
    corrections: 0,
    lastCorrectionMetres: 0,
    interpolationDelayMs: 0,
    snapshotDelayMs: 0,
    lookupMisses: 0,
    comparisons: 0,
  };

  onKicked: ((reason: string) => void) | null = null;
  onConnected: ((actorId: number) => void) | null = null;

  /** Resolves when the server's handshake acknowledgement arrives. */
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly director: MatchDirector,
    private readonly physics: PhysicsWorld,
    private readonly events: EventBus<GameEvents>,
  ) {
    transport.on('message', (data) => this.handleMessage(data));
    transport.on('close', (reason) => {
      this.stats.connected = false;
      this.onKicked?.(reason);
    });
  }

  get isConnected(): boolean {
    return this.stats.connected;
  }

  get actorId(): number {
    return this.localActorId;
  }

  /**
   * Opens the transport, sends the handshake, and resolves only once the server has acknowledged.
   *
   * Resolving on socket-open alone is not enough: the session is not usable until the server has
   * assigned an actor id, and `sendInput` correctly refuses to send before that. A caller that
   * treats socket-open as "connected" will silently transmit nothing — which is exactly how the
   * multi-client harness produced clients that were connected, receiving snapshots, and sending
   * zero packets.
   */
  async connect(
    playerName: string,
    preferredTeam: string | null,
    timeoutMs = 10_000,
  ): Promise<void> {
    await this.transport.connect();

    const ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    const writer = new ByteWriter(128);
    writer.u8(ClientMessage.Handshake);
    writer.varint(PROTOCOL_VERSION);
    writer.string(playerName);
    writer.string(preferredTeam ?? '');
    this.send(writer.finish());
    this.windowStartMs = now();

    const timer = setTimeout(() => {
      this.readyReject?.(new Error(`handshake not acknowledged within ${timeoutMs} ms`));
    }, timeoutMs);

    try {
      await ready;
    } finally {
      clearTimeout(timer);
      this.readyResolve = null;
      this.readyReject = null;
    }
  }

  /**
   * Called once per simulation tick, before the local simulation steps.
   *
   * Sends the current input plus a window of unacknowledged frames. Resending is what makes the
   * protocol tolerant of loss: a dropped packet costs nothing because the next one carries the
   * frames it was going to deliver.
   */
  sendInput(input: InputFrame): void {
    if (!this.stats.connected) return;
    this.clientTick++;
    this.reconciler.record(this.clientTick, input);

    const window = this.reconciler.unacknowledged(MAX_INPUTS_PER_PACKET);
    const writer = new ByteWriter(256);
    writer.u8(ClientMessage.Input);
    writer.varint(this.lastSnapshotTick);
    writer.u8(window.length);

    for (const frame of window) {
      writer.varint(frame.tick);
      writer.i16(frame.moveX * 1000);
      writer.i16(frame.moveZ * 1000);
      writer.i16(frame.lookYaw * 10000);
      writer.i16(frame.lookPitch * 10000);
      writer.i16(frame.lean * 1000);

      let bits = 0;
      if (frame.jump) bits |= INPUT_BITS.JUMP;
      if (frame.jumpPressed) bits |= INPUT_BITS.JUMP_PRESSED;
      if (frame.sprint) bits |= INPUT_BITS.SPRINT;
      if (frame.crouch) bits |= INPUT_BITS.CROUCH;
      if (frame.fire) bits |= INPUT_BITS.FIRE;
      if (frame.ads) bits |= INPUT_BITS.ADS;
      if (frame.reload) bits |= INPUT_BITS.RELOAD;
      if (frame.interact) bits |= INPUT_BITS.INTERACT;
      writer.u8(bits);
    }
    this.send(writer.finish());
  }

  /**
   * Records where the local simulation ended up this tick. Must be called *after* the local
   * `MatchDirector.step()`, since reconciliation compares the server's result against this.
   */
  recordPrediction(): void {
    if (!this.stats.connected) return;
    const local = this.director.state.actors.get(this.localActorId);
    if (local) this.reconciler.recordPrediction(this.clientTick, local.position);
  }

  /** Called once per rendered frame. Drives interpolation, pings and the stats window. */
  update(frameDt: number): void {
    if (this.disposed) return;
    this.reconciler.update(frameDt);

    // Sample remote actors at the interpolated render time.
    const delayTicks = (this.interpolator.delayMs / 1000) * 64;
    const renderTick = this.lastSnapshotTick - delayTicks;
    this.interpolator.sample(this.history, renderTick, this.remoteActors);

    this.pingTimer -= frameDt * 1000;
    if (this.pingTimer <= 0 && this.stats.connected) {
      this.pingTimer = HEARTBEAT_INTERVAL_MS;
      this.sendPing();
    }

    this.sampleWindow();
    this.refreshStats();
  }

  private sendPing(): void {
    const sequence = this.pingSequence++ & 0xffffffff;
    this.pendingPings.set(sequence, now());
    const writer = new ByteWriter(16);
    writer.u8(ClientMessage.Ping);
    writer.u32(sequence);
    this.send(writer.finish());

    // Anything older than five seconds is counted as lost, for the packet-loss estimate.
    const cutoff = now() - 5000;
    for (const [seq, sentAt] of [...this.pendingPings]) {
      if (sentAt < cutoff) {
        this.pendingPings.delete(seq);
        this.droppedCount++;
      }
    }
  }

  setReady(ready: boolean): void {
    const writer = new ByteWriter(4);
    writer.u8(ClientMessage.Ready);
    writer.u8(ready ? 1 : 0);
    this.send(writer.finish());
  }

  requestTeam(team: string): void {
    const writer = new ByteWriter(32);
    writer.u8(ClientMessage.TeamSwitch);
    writer.string(team);
    this.send(writer.finish());
  }

  // --- Receive --------------------------------------------------------------

  private handleMessage(data: Uint8Array): void {
    this.bytesIn += data.byteLength;
    this.windowIn += data.byteLength;

    try {
      const reader = new ByteReader(data);
      const type = reader.u8() as ServerMessage;

      switch (type) {
        case ServerMessage.HandshakeAck:
          this.handleHandshakeAck(reader);
          break;
        case ServerMessage.Snapshot:
        case ServerMessage.FullSnapshot:
          this.handleSnapshot(reader, data);
          break;
        case ServerMessage.MatchState:
          this.flow.applySerialized({
            phase: reader.u8(),
            remaining: reader.u16(),
            sequence: reader.varint(),
          });
          break;
        case ServerMessage.Pong: {
          const sequence = reader.u32();
          const sentAt = this.pendingPings.get(sequence);
          if (sentAt !== undefined) {
            this.pendingPings.delete(sequence);
            this.noteRtt(now() - sentAt);
          }
          this.serverTick = reader.varint();
          break;
        }
        case ServerMessage.Kick: {
          const reason = reader.u8() as KickReason;
          this.stats.connected = false;
          const text = KICK_REASON_TEXT[reason] ?? 'Disconnected';
          this.onKicked?.(text);
          this.readyReject?.(new Error(text));
          break;
        }
        default:
          break;
      }
    } catch (error) {
      // A malformed packet is dropped. The client never trusts a partial decode, because applying
      // half a snapshot is exactly how a silent desync starts.
      if (error instanceof ProtocolError) {
        this.droppedCount++;
        return;
      }
      throw error;
    }
  }

  private handleHandshakeAck(reader: ByteReader): void {
    const accepted = reader.u8() === 1;
    if (!accepted) {
      this.onKicked?.('Server rejected the connection');
      this.readyReject?.(new Error('server rejected the connection'));
      return;
    }
    this.clientId = reader.varint();
    this.localActorId = reader.varint();
    this.serverTick = reader.varint();
    reader.string(); // arena id — already loaded locally
    reader.string(); // mode id
    this.clientTick = this.serverTick;
    this.stats.connected = true;
    this.onConnected?.(this.localActorId);
    this.readyResolve?.();
  }

  /**
   * Applies a snapshot.
   *
   * The local player is reconciled (rewind + replay); everyone else is written straight into the
   * simulation's actor list so the renderer and audio have something to read, then overridden each
   * frame by the interpolator's sampled position.
   */
  private handleSnapshot(reader: ByteReader, raw: Uint8Array): void {
    const acknowledgedInput = reader.varint();
    // The remainder of the packet is the encoded snapshot; hand it the same buffer offset.
    const payload = raw.subarray(raw.byteLength - reader.remaining);
    const decoded = decodeSnapshot(payload, this.history);
    if (!decoded) {
      this.droppedCount++;
      return;
    }
    if (decoded.baselineMissing) {
      // We no longer hold the baseline this delta was built against. Drop it and wait for the
      // server's next full snapshot rather than applying a half-known world.
      this.droppedCount++;
      return;
    }

    const snapshot = decoded.snapshot;
    this.history.push(snapshot);
    this.lastSnapshotTick = snapshot.tick;
    this.lastSnapshotAtMs = now();
    this.serverTick = snapshot.tick;
    this.receivedCount++;
    this.lastAcknowledgedInput = acknowledgedInput;
    this.interpolator.noteArrival(this.lastSnapshotAtMs);

    // Match phase and clock come from the server, never from local timers.
    this.director.state.timeRemaining = snapshot.timeRemaining;
    for (const [key, value] of Object.entries(snapshot.scores)) {
      this.director.state.scores[key] = value;
    }

    for (const [id, actorSnapshot] of snapshot.actors) {
      // A client learns about every other player from snapshots alone, so an unknown id is the
      // normal way a peer arrives — not an error. Materialise it rather than skipping, which was
      // the bug that made remote players invisible.
      const actor =
        this.director.state.actors.get(id) ??
        this.director.ensureReplicatedActor(id, actorSnapshot.team);

      if (id === this.localActorId) {
        this.reconciler.reconcile(
          actor,
          actorSnapshot,
          acknowledgedInput,
          this.clientTick,
          this.physics,
          this.events,
        );
      } else {
        // Remote actors take the server's word entirely, including look angles.
        applyActorSnapshot(actor, actorSnapshot, true);
        this.physics.setCharacterPosition(actor.bodyHandle, {
          x: actor.position.x,
          y: actor.position.y + actor.height * 0.5,
          z: actor.position.z,
        });
      }
    }

    // Anyone the server no longer reports has left. Removing them here is what stops a
    // disconnected player from being left standing in the arena forever.
    for (const id of [...this.director.state.actors.keys()]) {
      if (id === this.localActorId) continue;
      if (!snapshot.actors.has(id)) this.director.removeActor(id);
    }
  }

  private noteRtt(ms: number): void {
    this.rttSamples.push(ms);
    if (this.rttSamples.length > 20) this.rttSamples.shift();
  }

  private sampleWindow(): void {
    const nowMs = now();
    const elapsed = nowMs - this.windowStartMs;
    if (elapsed < 1000) return;
    this.stats.downstreamBps = Math.round((this.windowIn * 1000) / elapsed);
    this.stats.upstreamBps = Math.round((this.windowOut * 1000) / elapsed);
    this.windowIn = 0;
    this.windowOut = 0;
    this.windowStartMs = nowMs;
  }

  private refreshStats(): void {
    const rtt =
      this.rttSamples.length > 0
        ? this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length
        : 0;
    const jitter = this.interpolator.jitter;
    const total = this.receivedCount + this.droppedCount;
    const loss = total > 0 ? (this.droppedCount / total) * 100 : 0;

    this.stats.connected = this.transport.state === 'open' && this.stats.connected;
    this.stats.clientId = this.clientId;
    this.stats.actorId = this.localActorId;
    this.stats.serverTick = this.serverTick;
    this.stats.clientTick = this.clientTick;
    this.stats.snapshotsReceived = this.receivedCount;
    this.stats.snapshotsDropped = this.droppedCount;
    this.stats.bytesReceived = this.bytesIn;
    this.stats.bytesSent = this.bytesOut;
    this.stats.corrections = this.reconciler.stats.correctionsPerSecond;
    this.stats.lastCorrectionMetres = this.reconciler.stats.lastErrorMetres;
    this.stats.lookupMisses = this.reconciler.stats.lookupMisses;
    this.stats.comparisons = this.reconciler.stats.comparisons;
    this.stats.interpolationDelayMs = Math.round(this.interpolator.delayMs);
    this.stats.snapshotDelayMs = Math.round(now() - this.lastSnapshotAtMs);
    this.stats.quality = {
      rttMs: Math.round(rtt),
      jitterMs: Math.round(jitter),
      packetLossPercent: Math.round(loss * 10) / 10,
      // Running this far ahead lands our inputs at the server just before it needs them.
      predictedTicksAhead: Math.max(0, this.clientTick - this.serverTick),
      rating: this.stats.connected ? rateConnection(rtt, jitter, loss) : 'disconnected',
    };
    void this.lastAcknowledgedInput;
    void TICK_DT;
  }

  private send(data: Uint8Array): void {
    this.transport.send(data);
    this.bytesOut += data.byteLength;
    this.windowOut += data.byteLength;
  }

  /** Local actor, for the renderer. */
  localActor(): Actor | undefined {
    return this.director.state.actors.get(this.localActorId);
  }

  dispose(): void {
    this.disposed = true;
    this.stats.connected = false;
    this.transport.close('client disposed');
    this.history.clear();
    this.reconciler.reset();
    this.interpolator.reset();
    this.remoteActors.clear();
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const SNAPSHOT_RATE = SNAPSHOT_HZ;
