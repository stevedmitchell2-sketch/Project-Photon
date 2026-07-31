/**
 * Transport abstraction.
 *
 * The point of this interface is that `LocalTransport` and `WebSocketTransport` are
 * indistinguishable to everything above them. Single-player is not a special case that bypasses the
 * network layer — it is a match against a server that happens to live in the same process, running
 * the same authoritative code with the same message flow.
 *
 * That has a cost (single-player pays serialization it does not strictly need) and a large payoff:
 * the netcode path is exercised every single time anyone plays, so replication bugs surface during
 * ordinary development rather than the first time two people connect.
 */
export type TransportState = 'idle' | 'connecting' | 'open' | 'closing' | 'closed';

export interface TransportEvents {
  open(): void;
  message(data: Uint8Array): void;
  close(reason: string): void;
  error(error: Error): void;
}

export interface Transport {
  readonly state: TransportState;
  /** Round-trip latency in ms, or 0 for in-process transports. */
  readonly rttMs: number;
  connect(): Promise<void>;
  send(data: Uint8Array): void;
  close(reason?: string): void;
  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): () => void;
}

type Handlers = { [K in keyof TransportEvents]: Set<TransportEvents[K]> };

abstract class BaseTransport implements Transport {
  protected handlers: Handlers = {
    open: new Set(),
    message: new Set(),
    close: new Set(),
    error: new Set(),
  };
  protected _state: TransportState = 'idle';

  get state(): TransportState {
    return this._state;
  }

  abstract readonly rttMs: number;
  abstract connect(): Promise<void>;
  abstract send(data: Uint8Array): void;
  abstract close(reason?: string): void;

  on<K extends keyof TransportEvents>(event: K, handler: TransportEvents[K]): () => void {
    this.handlers[event].add(handler as never);
    return () => {
      this.handlers[event].delete(handler as never);
    };
  }

  protected emit<K extends keyof TransportEvents>(
    event: K,
    ...args: Parameters<TransportEvents[K]>
  ): void {
    for (const handler of this.handlers[event]) {
      (handler as (...a: unknown[]) => void)(...args);
    }
  }
}

/**
 * A pair of in-process endpoints, used for single-player and for the loopback half of a listen
 * server. Messages are copied and delivered on a microtask so that send/receive ordering matches a
 * real socket — delivering synchronously would let callers accidentally depend on reentrancy that
 * a network transport can never provide.
 */
export class LocalTransport extends BaseTransport {
  private peer: LocalTransport | null = null;
  readonly rttMs = 0;
  /** Artificial latency and loss, for exercising prediction without a second machine. */
  simulatedLatencyMs = 0;
  simulatedLossPercent = 0;
  private random = Math.random;

  static createPair(): [LocalTransport, LocalTransport] {
    const a = new LocalTransport();
    const b = new LocalTransport();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  async connect(): Promise<void> {
    this._state = 'open';
    queueMicrotask(() => this.emit('open'));
  }

  send(data: Uint8Array): void {
    if (this._state !== 'open' || !this.peer) return;
    if (this.simulatedLossPercent > 0 && this.random() * 100 < this.simulatedLossPercent) return;

    // Copy: the caller owns its buffer and will reuse it on the next send.
    const copy = data.slice();
    const deliver = () => this.peer?.emit('message', copy);
    if (this.simulatedLatencyMs > 0) setTimeout(deliver, this.simulatedLatencyMs);
    else queueMicrotask(deliver);
  }

  close(reason = 'closed'): void {
    if (this._state === 'closed') return;
    this._state = 'closed';
    this.emit('close', reason);
    const peer = this.peer;
    this.peer = null;
    peer?.close(reason);
  }
}

/**
 * Timer helpers that work in both the browser and Node.
 *
 * `window.setTimeout` does not exist under Node, and this transport has to run there — the
 * headless integration test drives real NetClients against a real server process.
 */
const setTimer = (fn: () => void, ms: number): number =>
  setTimeout(fn, ms) as unknown as number;
const clearTimer = (handle: number): void => clearTimeout(handle as unknown as Parameters<typeof clearTimeout>[0]);

/**
 * WebSocket transport with exponential-backoff reconnection.
 *
 * Reconnect is a transport concern rather than a session concern: the session layer above sees a
 * `close` only when reconnection has genuinely been abandoned, so a two-second network blip does
 * not tear down a match.
 */
export class WebSocketTransport extends BaseTransport {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer = 0;
  private intentionalClose = false;
  private lastPingSent = 0;
  private _rttMs = 0;

  constructor(
    private readonly url: string,
    private readonly options: {
      maxReconnectAttempts?: number;
      baseReconnectDelayMs?: number;
      maxReconnectDelayMs?: number;
    } = {},
  ) {
    super();
  }

  get rttMs(): number {
    return this._rttMs;
  }

  noteRtt(ms: number): void {
    // Smooth so a single delayed pong does not swing the quality indicator.
    this._rttMs = this._rttMs === 0 ? ms : this._rttMs * 0.8 + ms * 0.2;
  }

  markPingSent(): void {
    this.lastPingSent = performance.now();
  }

  markPongReceived(): void {
    if (this.lastPingSent > 0) this.noteRtt(performance.now() - this.lastPingSent);
  }

  connect(): Promise<void> {
    this.intentionalClose = false;
    this._state = 'connecting';

    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.url);
      socket.binaryType = 'arraybuffer';
      this.socket = socket;

      socket.onopen = () => {
        this._state = 'open';
        this.reconnectAttempts = 0;
        this.emit('open');
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.emit('message', new Uint8Array(event.data));
        }
      };

      socket.onerror = () => {
        const error = new Error(`WebSocket error connecting to ${this.url}`);
        this.emit('error', error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      socket.onclose = () => {
        this.socket = null;
        if (this.intentionalClose) {
          this._state = 'closed';
          this.emit('close', 'closed by client');
          return;
        }
        this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect(): void {
    const max = this.options.maxReconnectAttempts ?? 6;
    if (this.reconnectAttempts >= max) {
      this._state = 'closed';
      this.emit('close', `reconnection abandoned after ${max} attempts`);
      return;
    }

    this._state = 'connecting';
    const base = this.options.baseReconnectDelayMs ?? 400;
    const cap = this.options.maxReconnectDelayMs ?? 8000;
    // Exponential backoff with jitter, so a server restart does not bring every client back in
    // lockstep and immediately knock it over again.
    const delay = Math.min(cap, base * 2 ** this.reconnectAttempts) * (0.7 + Math.random() * 0.6);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimer(() => {
      void this.connect().catch(() => {
        /* onclose schedules the next attempt. */
      });
    }, delay);
  }

  send(data: Uint8Array): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(data);
  }

  close(reason = 'closed'): void {
    this.intentionalClose = true;
    clearTimer(this.reconnectTimer);
    this._state = 'closing';
    this.socket?.close();
    this.socket = null;
    this._state = 'closed';
    this.emit('close', reason);
  }
}
