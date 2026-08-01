import { describe, expect, it } from 'vitest';
import { Heatmap, MemorySink, Telemetry } from '@/engine/Telemetry';

/**
 * Telemetry is a sink, never a source. These lock in the properties that keep it safe to leave
 * switched on in a shipped build: free when disabled, bounded memory, and no path back into
 * gameplay.
 */

const ev = (type: string, tick = 0) =>
  ({ tick, time: tick / 64, category: 'combat' as const, type });

describe('Telemetry', () => {
  it('records nothing at all while disabled', () => {
    const t = new Telemetry();
    for (let i = 0; i < 100; i++) t.record(ev('hit', i));
    expect(t.events()).toHaveLength(0);
    expect(t.count('combat', 'hit')).toBe(0);
  });

  it('records once enabled and counts by category and type', () => {
    const t = new Telemetry();
    t.enabled = true;
    t.record(ev('hit'));
    t.record(ev('hit'));
    t.record(ev('death'));
    expect(t.count('combat', 'hit')).toBe(2);
    expect(t.count('combat', 'death')).toBe(1);
    expect(t.events()).toHaveLength(3);
  });

  it('copies the event so callers can reuse scratch objects', () => {
    const t = new Telemetry();
    t.enabled = true;
    const scratch = { tick: 1, time: 0, category: 'combat' as const, type: 'hit', value: 10 };
    t.record(scratch);
    scratch.value = 999;
    expect(t.events()[0].value).toBe(10);
  });

  it('bounds memory with a ring buffer instead of growing', () => {
    const t = new Telemetry(8);
    t.enabled = true;
    for (let i = 0; i < 40; i++) t.record(ev('hit', i));

    const events = t.events();
    expect(events).toHaveLength(8);
    // Oldest first, and only the most recent 8 survive.
    expect(events[0].tick).toBe(32);
    expect(events[7].tick).toBe(39);
    expect(t.summary().droppedEvents).toBe(32);
  });

  it('keeps counting after the buffer wraps', () => {
    const t = new Telemetry(4);
    t.enabled = true;
    for (let i = 0; i < 50; i++) t.record(ev('hit', i));
    // Counters are aggregate and must survive buffer pressure.
    expect(t.count('combat', 'hit')).toBe(50);
  });

  it('delivers buffered events to sinks and clears on flush', () => {
    const t = new Telemetry();
    t.enabled = true;
    const sink = new MemorySink();
    t.addSink(sink);

    t.record(ev('hit'));
    t.record(ev('death'));
    t.flush();

    expect(sink.received).toHaveLength(2);
    expect(t.events()).toHaveLength(0);
  });

  it('stops delivering to a removed sink', () => {
    const t = new Telemetry();
    t.enabled = true;
    const sink = new MemorySink();
    const remove = t.addSink(sink);
    remove();
    t.record(ev('hit'));
    t.flush();
    expect(sink.received).toHaveLength(0);
  });

  it('feeds positional events into a named heatmap', () => {
    const t = new Telemetry();
    t.enabled = true;
    t.createHeatmap('deaths', [-30, -30, 30, 30], 2);
    t.recordAt(ev('death'), { x: 10, y: 0, z: 10 }, 'deaths');
    t.recordAt(ev('death'), { x: 10.5, y: 0, z: 10.5 }, 'deaths');
    t.recordAt(ev('death'), { x: -20, y: 0, z: -20 }, 'deaths');

    const hotspots = t.heatmaps.get('deaths')!.hotspots(5);
    expect(hotspots[0].weight).toBe(2);
    expect(hotspots).toHaveLength(2);
  });
});

describe('Heatmap', () => {
  it('ignores samples outside its bounds rather than clamping them inward', () => {
    // Clamping would pile out-of-bounds events onto the edge cells and invent hotspots there.
    const map = new Heatmap(-10, -10, 10, 10, 2);
    map.add(500, 500);
    map.add(-500, 0);
    expect(map.hotspots()).toHaveLength(0);
  });

  it('normalises to a 0..1 range against its peak', () => {
    const map = new Heatmap(0, 0, 10, 10, 5);
    map.add(1, 1, 4);
    map.add(6, 1, 2);
    const norm = map.normalised();
    expect(Math.max(...norm)).toBeCloseTo(1, 6);
  });

  it('returns an all-zero normalisation when empty rather than dividing by zero', () => {
    const map = new Heatmap(0, 0, 10, 10, 5);
    expect(Math.max(...map.normalised())).toBe(0);
  });

  it('ranks hotspots by weight', () => {
    const map = new Heatmap(0, 0, 20, 20, 5);
    map.add(2, 2, 1);
    map.add(12, 12, 9);
    const top = map.hotspots(2);
    expect(top[0].weight).toBe(9);
    expect(top[1].weight).toBe(1);
  });
});
