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
  useFrame(() => {
    const info = gl.info.render;
    game.renderStats.drawCalls = info.calls;
    game.renderStats.triangles = info.triangles;
    game.renderStats.programs = gl.info.programs?.length ?? 0;
    gl.info.reset();
  }, 1000);

  return null;
}
