/**
 * Fixed-timestep accumulator loop.
 *
 * Simulation runs at exactly TICK_HZ. Rendering runs as fast as the display allows and receives
 * `alpha`, the fraction between the previous and current tick, so visuals interpolate smoothly at
 * any refresh rate. This split is a hard requirement for the authoritative-server milestone.
 */
export const TICK_HZ = 64;
export const TICK_DT = 1 / TICK_HZ;

/** Never simulate more than this many ticks in one frame — prevents the spiral of death. */
const MAX_TICKS_PER_FRAME = 5;

export interface LoopStats {
  fps: number;
  frameMs: number;
  simMs: number;
  ticksLastFrame: number;
}

export class GameLoop {
  private running = false;
  private rafId = 0;
  private accumulator = 0;
  private lastTime = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;

  readonly stats: LoopStats = { fps: 0, frameMs: 0, simMs: 0, ticksLastFrame: 0 };

  constructor(
    private readonly onTick: (dt: number) => void,
    private readonly onRender: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  get isRunning(): boolean {
    return this.running;
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // A tab that was backgrounded returns a huge delta; clamp rather than fast-forwarding.
    if (frameDt > 0.25) frameDt = 0.25;
    this.stats.frameMs = frameDt * 1000;

    this.accumulator += frameDt;

    const simStart = performance.now();
    let ticks = 0;
    while (this.accumulator >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
      this.onTick(TICK_DT);
      this.accumulator -= TICK_DT;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) {
      // We are behind budget. Drop the backlog instead of accumulating debt forever.
      this.accumulator = 0;
    }
    this.stats.simMs = performance.now() - simStart;
    this.stats.ticksLastFrame = ticks;

    this.onRender(this.accumulator / TICK_DT, frameDt);

    this.fpsAccum += frameDt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  };
}
