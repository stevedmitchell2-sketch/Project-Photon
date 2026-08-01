import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGame } from './GameContext';

/**
 * Publishes renderer counters into the engine so the performance overlay can show them alongside
 * the simulation timings. Draw calls are the number the rendering budget is actually written
 * against, so having it on screen while playing is what keeps the budget honest.
 *
 * Also hands the engine a reference to the renderer and scene, which the editor tools in M6 need.
 */
export function RendererStats() {
  const game = useGame();
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    game.renderer = { gl, scene, camera };
    return () => {
      game.renderer = null;
    };
  }, [game, gl, scene, camera]);

  // Priority 1000 runs after R3F's render and after the post-processing chain, so with
  // `info.autoReset = false` (set in GameCanvas) this reads the accumulated total across every
  // pass. Reset here rather than letting three.js do it per-pass.
  useFrame((_, delta) => {
    const info = gl.info.render;
    game.renderStats.drawCalls = info.calls;
    game.renderStats.triangles = info.triangles;
    game.renderStats.programs = gl.info.programs?.length ?? 0;
    gl.info.reset();

    // Frame timing into telemetry, once a second rather than every frame. A per-frame record would
    // push sixty entries a second through the ring and evict everything else; a one-second sample
    // still shows a sustained regression, which is the thing worth alerting on. The spike case is
    // covered separately below.
    frameAccumulator += delta;
    frameCount++;
    if (frameAccumulator >= 1) {
      game.match?.telemetry.record({
        tick: game.match.state.tick,
        time: game.match.state.time,
        category: 'performance',
        type: 'frame',
        value: (frameAccumulator / frameCount) * 1000,
        target: `${game.renderStats.drawCalls}draw`,
      });
      frameAccumulator = 0;
      frameCount = 0;
    } else if (delta > 0.05) {
      // A frame over 50 ms is a visible hitch. Those are individually interesting, so they are
      // recorded whenever they happen rather than being averaged away.
      game.match?.telemetry.record({
        tick: game.match.state.tick,
        time: game.match.state.time,
        category: 'performance',
        type: 'hitch',
        value: delta * 1000,
        target: `${game.renderStats.drawCalls}draw`,
      });
    }
  }, 1000);

  return null;
}

/** Frame-time accumulation state. Module scope so the sampling window survives re-renders. */
let frameAccumulator = 0;
let frameCount = 0;
