/**
 * Wire protocol for PROJECT PHOTON.
 *
 * Design constraints that shaped this:
 *
 * 1. **The server is authoritative.** Clients send inputs, never positions. Every message from a
 *    client is a request the server may reject; nothing a client sends is trusted as state.
 * 2. **Inputs are tiny and lossy-tolerant.** An InputFrame is ~6 bytes packed. Clients send a
 *    sliding window of recent unacknowledged inputs in every packet, so a dropped datagram costs
 *    nothing — the next one carries the missing frames.
 * 3. **Snapshots are delta-compressed against an acknowledged baseline.** The server keeps the last
 *    N snapshots per client and encodes against the most recent one that client confirmed. If the
 *    client has fallen too far behind, it falls back to a full snapshot.
 * 4. **Everything is versioned.** A mismatched build is rejected at handshake rather than
 *    desynchronising silently three minutes into a match.
 */

/** Bumped whenever any packed layout below changes. Clients and servers must agree exactly. */
export const PROTOCOL_VERSION = 1;

/** Server simulation rate. Must equal the client's TICK_HZ for prediction to line up. */
export const SERVER_TICK_HZ = 64;

/** How often the server broadcasts snapshots. Lower than tick rate to save bandwidth. */
export const SNAPSHOT_HZ = 20;
export const TICKS_PER_SNAPSHOT = Math.round(SERVER_TICK_HZ / SNAPSHOT_HZ);

/** Snapshots retained per client for delta baselines, and for lag-compensation rewind. */
export const SNAPSHOT_HISTORY = 64;

/** Maximum inputs a client may bundle in one packet. Bounds the work a malicious client can force. */
export const MAX_INPUTS_PER_PACKET = 16;

/** A client silent for this long is dropped. */
export const CLIENT_TIMEOUT_MS = 10_000;
/** Heartbeat cadence when a client has nothing else to say. */
export const HEARTBEAT_INTERVAL_MS = 1_000;

/** Server rejects clients whose input rate exceeds this. Cheap flood protection. */
export const MAX_INPUT_PACKETS_PER_SECOND = 90;

export enum ClientMessage {
  Handshake = 1,
  Input = 2,
  Ready = 3,
  TeamSwitch = 4,
  Chat = 5,
  Ping = 6,
  Heartbeat = 7,
  Spectate = 8,
}

export enum ServerMessage {
  HandshakeAck = 1,
  Snapshot = 2,
  FullSnapshot = 3,
  MatchState = 4,
  Event = 5,
  Chat = 6,
  Pong = 7,
  Kick = 8,
  LobbyState = 9,
}

export enum KickReason {
  VersionMismatch = 1,
  ServerFull = 2,
  Timeout = 3,
  RateLimited = 4,
  InvalidInput = 5,
  ServerShutdown = 6,
}

export const KICK_REASON_TEXT: Record<KickReason, string> = {
  [KickReason.VersionMismatch]: 'Client version does not match the server',
  [KickReason.ServerFull]: 'Server is full',
  [KickReason.Timeout]: 'Connection timed out',
  [KickReason.RateLimited]: 'Too many packets',
  [KickReason.InvalidInput]: 'Invalid input rejected',
  [KickReason.ServerShutdown]: 'Server is shutting down',
};

/**
 * Bit flags for the boolean half of an InputFrame. Packing these into one byte is what keeps an
 * input frame small enough to resend a full window every packet.
 */
export const INPUT_BITS = {
  JUMP: 1 << 0,
  SPRINT: 1 << 1,
  CROUCH: 1 << 2,
  FIRE: 1 << 3,
  ADS: 1 << 4,
  RELOAD: 1 << 5,
  INTERACT: 1 << 6,
  /** Edge flags are derived server-side by diffing consecutive frames, except jump which is
   *  latency-critical enough to be worth an explicit bit. */
  JUMP_PRESSED: 1 << 7,
} as const;

/**
 * Fields of an actor that replicate, as a bitmask. Delta encoding writes this mask then only the
 * fields it names — a standing player who is not shooting costs 3 bytes plus the mask.
 */
export const ACTOR_FIELDS = {
  POSITION: 1 << 0,
  VELOCITY: 1 << 1,
  YAW: 1 << 2,
  PITCH: 1 << 3,
  STANCE: 1 << 4,
  HEALTH: 1 << 5,
  SHIELD: 1 << 6,
  WEAPON: 1 << 7,
  FLAGS: 1 << 8,
  SCORE: 1 << 9,
  TEAM: 1 << 10,
  LEAN: 1 << 11,
} as const;

export const ACTOR_FLAG = {
  ALIVE: 1 << 0,
  GROUNDED: 1 << 1,
  RECHARGING: 1 << 2,
  SPAWN_PROTECTED: 1 << 3,
  FIRED_THIS_TICK: 1 << 4,
} as const;

/**
 * Quantisation. Positions are sent as 16-bit fixed point over a 256 m cube at ~4 mm resolution,
 * which is far finer than any gameplay decision and a third the size of a float32.
 */
export const QUANT = {
  POSITION_SCALE: 256, // units per metre
  POSITION_MIN: -128,
  POSITION_MAX: 128,
  VELOCITY_SCALE: 128,
  ANGLE_SCALE: 10430.0, // radians -> int16, covers +-PI
  HEALTH_SCALE: 1,
} as const;

export interface HandshakeRequest {
  protocolVersion: number;
  playerName: string;
  /** Preferred team; the server may override for balance. */
  preferredTeam: string | null;
}

export interface HandshakeResponse {
  accepted: boolean;
  reason?: KickReason;
  clientId: number;
  actorId: number;
  serverTick: number;
  /** Echoed so the client can size its interpolation buffer. */
  snapshotHz: number;
  arenaId: string;
  modeId: string;
}

/** Connection quality, computed client-side from ping samples and snapshot arrival jitter. */
export interface ConnectionQuality {
  rttMs: number;
  jitterMs: number;
  packetLossPercent: number;
  /** Server ticks the client is running ahead by, to land inputs just before they are needed. */
  predictedTicksAhead: number;
  rating: 'excellent' | 'good' | 'fair' | 'poor' | 'disconnected';
}

export function rateConnection(rttMs: number, jitterMs: number, loss: number): ConnectionQuality['rating'] {
  if (rttMs >= 1e9) return 'disconnected';
  if (rttMs < 60 && jitterMs < 10 && loss < 1) return 'excellent';
  if (rttMs < 120 && jitterMs < 25 && loss < 3) return 'good';
  if (rttMs < 200 && jitterMs < 50 && loss < 8) return 'fair';
  return 'poor';
}
