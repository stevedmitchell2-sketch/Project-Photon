import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGame } from './GameContext';

/**
 * Renderer counters and frame profiling.
 *
 * Publishes draw calls, triangles, CPU frame time and GPU frame time into the engine so the
 * performance overlay can show them alongside the simulation timings.
 *
 * ## Why frames-per-second was never enough
 *
 * The 120 FPS target has been unverifiable since Sprint 4, and the reason is that the only number
 * being measured was the interval between frames. Vsync pins that interval to exactly one display
 * refresh — 16.67 ms on a 60 Hz panel — no matter how much or how little work the frame actually
 * did. A frame doing 2 ms of work and a frame doing 15 ms of work both report 60 FPS, right up
 * until the second one tips over and reports 30. It is a cliff detector, not a budget.
 *
 * Three sprints of rendering optimisation had to be argued through draw-call counts because of it.
 *
 * What matters is **how long the work takes**, which is measurable regardless of refresh rate:
 *
 *   - **CPU frame time** — wall time from the start of the frame's callbacks to the end of the
 *     render, excluding the block on vsync. Bracketed by two `useFrame` callbacks at the extreme
 *     ends of the priority range.
 *   - **GPU frame time** — measured on the device with `EXT_disjoint_timer_query_webgl2`. The GPU
 *     runs asynchronously, so a query issued this frame is not readable for a few more; results are
 *     collected when they are ready rather than waited on, which would stall the pipeline and
 *     destroy the thing being measured.
 *
 * With both, the 120 FPS question has an answer on a 60 Hz panel: the frame fits in 8.33 ms of
 * combined CPU and GPU work, or it does not.
 */
export function RendererStats() {
  const game = useGame();
  const { gl, scene, camera } = useThree();
  const frameStart = useRef(0);
  const gpu = useRef<GpuTimer | null>(null);

  useEffect(() => {
    game.renderer = { gl, scene, camera };
    return () => {
      game.renderer = null;
    };
  }, [game, gl, scene, camera]);

  useEffect(() => {
    const context = gl.getContext();
    gpu.current = GpuTimer.create(context as WebGL2RenderingContext);
    game.renderStats.gpuAvailable = gpu.current !== null;
    return () => {
      gpu.current?.dispose();
      gpu.current = null;
    };
  }, [gl, game]);

  // Priority -1000: the first callback of the frame, before any system has done work.
  useFrame(() => {
    frameStart.current = performance.now();
    gpu.current?.beginFrame();
  }, -1000);

  // Priority 1000: the last callback of the frame, after R3F's render and after the
  // post-processing chain. With `info.autoReset = false` (set in GameCanvas) the counters here are
  // the accumulated total across every pass rather than whatever the final pass happened to draw.
  useFrame((_, delta) => {
    const info = gl.info.render;
    const stats = game.renderStats;
    stats.drawCalls = info.calls;
    stats.triangles = info.triangles;
    stats.programs = gl.info.programs?.length ?? 0;
    gl.info.reset();

    gpu.current?.endFrame();
    const gpuMs = gpu.current?.latest ?? -1;
    if (gpuMs >= 0) stats.gpuMs = stats.gpuMs * 0.9 + gpuMs * 0.1;

    // Smoothed, because a single frame's CPU time is dominated by whatever the garbage collector
    // and the OS scheduler happened to be doing. The budget question is about the sustained cost.
    const cpuMs = performance.now() - frameStart.current;
    stats.cpuMs = stats.cpuMs * 0.9 + cpuMs * 0.1;

    // Headroom against the 120 FPS budget. CPU and GPU overlap in reality, so the honest bound is
    // the larger of the two rather than their sum.
    stats.frameBudgetMs = Math.max(stats.cpuMs, stats.gpuMs);

    frameAccumulator += delta;
    if (frameAccumulator >= 1) {
      game.match?.telemetry.record({
        tick: game.match.state.tick,
        time: game.match.state.time,
        category: 'performance',
        type: 'frame',
        value: stats.frameBudgetMs,
        target: `${stats.drawCalls}draw cpu${stats.cpuMs.toFixed(1)} gpu${stats.gpuMs.toFixed(1)}`,
      });
      frameAccumulator = 0;
    } else if (delta > 0.05) {
      // A frame over 50 ms is a visible hitch. Individually interesting, so recorded when it
      // happens rather than averaged away.
      game.match?.telemetry.record({
        tick: game.match.state.tick,
        time: game.match.state.time,
        category: 'performance',
        type: 'hitch',
        value: delta * 1000,
        target: `${stats.drawCalls}draw`,
      });
    }
  }, 1000);

  return null;
}

/** Telemetry sampling window. Module scope so it survives re-renders. */
let frameAccumulator = 0;

/**
 * GPU timing via `EXT_disjoint_timer_query_webgl2`.
 *
 * The extension measures elapsed time on the device between a begin and an end marker. Two rules
 * govern how it has to be used, and both exist because the GPU is not synchronous with us:
 *
 *   1. **Never wait for a result.** Polling `getQueryParameter` until it is available stalls the
 *      CPU on the GPU, which changes the frame being measured into a different, slower frame.
 *      Queries are collected opportunistically instead, typically two or three frames later.
 *   2. **Honour the disjoint flag.** If the driver preempted the GPU during a query — another
 *      application, a power-state change — the timing is meaningless and the extension says so.
 *      Those samples are discarded rather than averaged in.
 *
 * Only one query may be in flight at a time per the spec, so a frame that begins while the previous
 * query is still running simply does not sample. At a steady frame rate that still yields a sample
 * every few frames, which is ample for a smoothed average.
 */
class GpuTimer {
  private query: WebGLQuery | null = null;
  private pending: WebGLQuery | null = null;
  private active = false;
  /** Most recent valid GPU frame time in milliseconds, or -1 before the first result. */
  latest = -1;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: {
      TIME_ELAPSED_EXT: number;
      GPU_DISJOINT_EXT: number;
    },
  ) {}

  static create(gl: WebGL2RenderingContext | null): GpuTimer | null {
    if (!gl || typeof gl.createQuery !== 'function') return null;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return null;
    return new GpuTimer(gl, ext as unknown as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number });
  }

  beginFrame(): void {
    this.collect();
    if (this.pending || this.active) return;

    const query = this.gl.createQuery();
    if (!query) return;
    this.query = query;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.active = true;
  }

  endFrame(): void {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.active = false;
    this.pending = this.query;
    this.query = null;
  }

  /** Reads a finished query if one is ready. Never blocks. */
  private collect(): void {
    const pending = this.pending;
    if (!pending) return;

    const available = this.gl.getQueryParameter(pending, this.gl.QUERY_RESULT_AVAILABLE) as boolean;
    if (!available) return;

    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    if (!disjoint) {
      const nanoseconds = this.gl.getQueryParameter(pending, this.gl.QUERY_RESULT) as number;
      this.latest = nanoseconds / 1e6;
    }
    this.gl.deleteQuery(pending);
    this.pending = null;
  }

  dispose(): void {
    if (this.active) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.active = false;
    }
    if (this.query) this.gl.deleteQuery(this.query);
    if (this.pending) this.gl.deleteQuery(this.pending);
    this.query = null;
    this.pending = null;
  }
}
