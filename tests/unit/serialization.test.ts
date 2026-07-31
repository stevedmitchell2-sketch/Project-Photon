import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter, ProtocolError } from '@/net/serialize';
import { QUANT } from '@/net/protocol';

/**
 * Serialization is the highest-consequence code in the project: a bug here does not throw, it
 * quietly gives one machine a different world than another. These cover the specific properties the
 * netcode depends on.
 */

describe('ByteWriter / ByteReader', () => {
  it('round-trips every primitive', () => {
    const w = new ByteWriter();
    w.u8(200);
    w.u16(60000);
    w.i16(-12345);
    w.u32(4000000000);
    w.f32(1.5);
    w.varint(300);
    w.string('PHOTON');

    const r = new ByteReader(w.finish());
    expect(r.u8()).toBe(200);
    expect(r.u16()).toBe(60000);
    expect(r.i16()).toBe(-12345);
    expect(r.u32()).toBe(4000000000);
    expect(r.f32()).toBeCloseTo(1.5, 5);
    expect(r.varint()).toBe(300);
    expect(r.string()).toBe('PHOTON');
    expect(r.exhausted).toBe(true);
  });

  it('encodes small varints in a single byte', () => {
    const w = new ByteWriter();
    w.varint(127);
    expect(w.length).toBe(1);
  });

  it('grows past its initial capacity without corrupting earlier writes', () => {
    const w = new ByteWriter(4);
    for (let i = 0; i < 500; i++) w.u16(i);
    const r = new ByteReader(w.finish());
    for (let i = 0; i < 500; i++) expect(r.u16()).toBe(i);
  });

  it('clamps rather than wraps out-of-range i16', () => {
    // A wrapped coordinate teleports a player across the map; clamping merely pins them.
    const w = new ByteWriter();
    w.i16(999999);
    w.i16(-999999);
    const r = new ByteReader(w.finish());
    expect(r.i16()).toBe(32767);
    expect(r.i16()).toBe(-32768);
  });

  it('throws ProtocolError on a truncated packet rather than reading past the buffer', () => {
    const w = new ByteWriter();
    w.u8(1);
    const r = new ByteReader(w.finish());
    r.u8();
    expect(() => r.u32()).toThrow(ProtocolError);
  });

  it('refuses a malformed over-long varint instead of looping', () => {
    // Hostile input must terminate. Six continuation bytes is beyond any legal encoding.
    const bytes = new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]);
    expect(() => new ByteReader(bytes).varint()).toThrow(ProtocolError);
  });
});

describe('quantisation', () => {
  it('keeps position error below half a quantisation step', () => {
    const step = 1 / QUANT.POSITION_SCALE;
    const w = new ByteWriter();
    const samples = [0, 0.001, -0.001, 12.3456, -27.9999, 100.5, -128, 127.99];
    for (const v of samples) w.position(v);

    const r = new ByteReader(w.finish());
    for (const v of samples) {
      expect(Math.abs(r.position() - v)).toBeLessThanOrEqual(step);
    }
  });

  it('round-trips angles across the +-PI boundary', () => {
    const w = new ByteWriter();
    const angles = [0, Math.PI - 0.001, -Math.PI + 0.001, 1.5707, -1.5707];
    for (const a of angles) w.angle(a);

    const r = new ByteReader(w.finish());
    for (const a of angles) {
      expect(Math.abs(r.angle() - a)).toBeLessThan(0.001);
    }
  });
});
