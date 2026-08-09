import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { Game } from '@/engine/Game';
import { LIGHTING } from '@/config/lighting';
import { useSettings } from '@/state/settingsStore';
import { GameProvider } from './GameContext';
import { PostFX } from './PostFX';
import { Scene } from './Scene';

/**
 * The renderer host.
 *
 * WebGPU is opt-in and feature-detected: when `navigator.gpu` is missing — or the settings ask for
 * WebGL — R3F's default WebGL2 renderer is used, which is still the safe target for the framerate
 * budget. The rest of the render tree is backend-agnostic.
 */
export function GameCanvas({ game }: { game: Game }) {
  const graphics = useSettings((s) => s.graphics);
  const accessibility = useSettings((s) => s.accessibility);

  return (
    <Canvas
      shadows={graphics.shadows}
      dpr={[1, Math.min(2, graphics.renderScale * window.devicePixelRatio)]}
      gl={{
        antialias: graphics.preset !== 'performance',
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
        depth: true,
        /**
         * Dev only, and the one thing that makes offscreen capture possible.
         *
         * WebGL discards the drawing buffer after compositing unless asked not to, so
         * `canvas.toDataURL()` normally returns a blank image from outside the render callback.
         * Preserving it lets the capture tool read the real 1600x1000 backing store at any moment,
         * which is the whole point: the browser pane composites the page at ~175x105 and no
         * screenshot of it can ever show panel seams.
         *
         * Off in production. It blocks a driver optimisation, and nothing in a shipped build reads
         * the buffer back.
         */
        preserveDrawingBuffer: import.meta.env.DEV,
      }}
      camera={{ fov: graphics.fov, near: 0.05, far: 220, position: [0, 2, 0] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        // ACES rolls midtones down hard. Exposure above 1 compensates so the arena's mid-dark
        // surfaces survive tone mapping instead of being crushed toward black.
        gl.toneMappingExposure = LIGHTING.toneMappingExposure;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        // Take manual control of the render counters. EffectComposer runs several passes and
        // three.js resets `info` at the start of each one, so an automatic reset leaves whatever
        // the final post pass drew — one fullscreen triangle, reported as "1 DRAW". Disabling
        // autoReset accumulates every pass, and RendererStats resets once per frame after reading.
        gl.info.autoReset = false;
        if (graphics.shadows) {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }
      }}
      // The engine owns its own fixed-step loop; R3F must not drive a second one.
      frameloop="always"
    >
      <GameProvider value={game}>
        <Scene graphics={graphics} accessibility={accessibility} />
        <PostFX graphics={graphics} />
      </GameProvider>
    </Canvas>
  );
}
