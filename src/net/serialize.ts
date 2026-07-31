import { QUANT } from './protocol';

/**
 * Byte-oriented reader/writer over an ArrayBuffer.
 *
 * Deliberately byte-aligned rather than bit-packed. Bit packing would save perhaps another 15% but
 * makes every layout change a debugging exercise, and the dominant cost at 20 snapshots/second is
 * the per-actor field set, which delta compression already removes. Alignment keeps the encoder
 * readable and the decoder trivially verifiable against it.
 */
export class ByteWriter {
  private view: DataView;
  private bytes: Uint8Array;
  private offset = 0;

  constructor(initialCapacity = 1024) {
    this.bytes = new Uint8Array(initialCapacity);
    this.view = new DataView(this.bytes.buffer);
  }

  private ensure(extra: number): void {
    if (this.offset + extra <= this.bytes.length) return;
    let capacity = this.bytes.length * 2;
    while (capacity < this.offset + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.bytes);
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.offset, v & 0xff);
    this.offset += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.offset, v & 0xffff, true);
    this.offset += 2;
  }

  i16(v: number): void {
    this.ensure(2);
    // Clamp rather than wrap: a wrapped coordinate teleports a player across the map.
    this.view.setInt16(this.offset, Math.max(-32768, Math.min(32767, Math.round(v))), true);
    this.offset += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.offset, v >>> 0, true);
    this.offset += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
  }

  /** Variable-length unsigned integer. Most ids and tick deltas fit in one byte. */
  varint(v: number): void {
    let value = v >>> 0;
    while (value >= 0x80) {
      this.u8((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    this.u8(value);
  }

  string(s: string): void {
    const encoded = new TextEncoder().encode(s);
    this.varint(encoded.length);
    this.ensure(encoded.length);
    this.bytes.set(encoded, this.offset);
    this.offset += encoded.length;
  }

  /** Quantised position component. */
  position(v: number): void {
    this.i16(v * QUANT.POSITION_SCALE);
  }

  velocity(v: number): void {
    this.i16(Math.max(-255, Math.min(255, v)) * QUANT.VELOCITY_SCALE);
  }

  angle(v: number): void {
    this.i16(v * QUANT.ANGLE_SCALE);
  }

  finish(): Uint8Array {
    return this.bytes.subarray(0, this.offset);
  }

  get length(): number {
    return this.offset;
  }
}

export class ByteReader {
  private view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  get exhausted(): boolean {
    return this.offset >= this.bytes.byteLength;
  }

  u8(): number {
    this.require(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    this.require(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    this.require(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.require(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.require(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      // A varint longer than 5 bytes is malformed; refuse rather than looping on hostile input.
      if (shift > 28) throw new ProtocolError('varint too long');
    }
    return result >>> 0;
  }

  string(): string {
    const length = this.varint();
    this.require(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return new TextDecoder().decode(slice);
  }

  position(): number {
    return this.i16() / QUANT.POSITION_SCALE;
  }

  velocity(): number {
    return this.i16() / QUANT.VELOCITY_SCALE;
  }

  angle(): number {
    return this.i16() / QUANT.ANGLE_SCALE;
  }

  /**
   * Bounds check on every read. A truncated or hostile packet must throw here and be dropped by
   * the caller, never read past the buffer and produce garbage state.
   */
  private require(bytes: number): void {
    if (this.offset + bytes > this.bytes.byteLength) {
      throw new ProtocolError(
        `packet underrun: needed ${bytes} bytes at ${this.offset}, have ${this.bytes.byteLength}`,
      );
    }
  }
}

/** Thrown by the reader on malformed input. Callers drop the packet and may rate-limit the peer. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}
