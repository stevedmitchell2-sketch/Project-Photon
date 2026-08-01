import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  Vignette,
} from '@react-three/postprocessing';
import { BlendFunction, KernelSize } from 'postprocessing';
import { Vector2 } from 'three';
import { useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { GraphicsSettings } from '@/config/graphics';

/**
 * Post-processing stack.
 *
 * Ordering matters: bloom runs on the HDR buffer before any grading or grain, so emissive team
 * trim blooms on its true intensity rather than on a tone-mapped approximation. The whole chain is
 * conditional on settings, and Performance Mode collapses it to bloom only.
 */
export function PostFX({ graphics }: { graphics: GraphicsSettings }) {
  const aberrationOffset = useMemo(() => new Vector2(0.0006, 0.0009), []);

  if (!graphics.bloom && !graphics.vignette && !graphics.filmGrain && !graphics.chromaticAberration) {
    // Nothing to composite — but something still has to draw the scene.
    //
    // `RendererStats` registers a `useFrame` at a positive priority, which switches R3F out of
    // automatic rendering and hands the render loop to whoever is doing it manually. Normally that
    // is the `EffectComposer` below. With every effect switched off this component used to return
    // null, the composer unmounted, and *nothing* rendered: turning off bloom, vignette, grain and
    // chromatic aberration in the settings menu produced a black screen with zero draw calls.
    return <PlainRender />;
  }

  return (
    <EffectComposer multisampling={graphics.preset === 'quality' ? 4 : 0} enableNormalPass={false}>
      {graphics.bloom ? (
        <Bloom
          intensity={graphics.bloomIntensity}
          // Threshold sits just above the brightest non-emissive surface, so only neon blooms.
          luminanceThreshold={0.62}
          luminanceSmoothing={0.28}
          kernelSize={graphics.preset === 'performance' ? KernelSize.MEDIUM : KernelSize.LARGE}
          mipmapBlur
        />
      ) : (
        <></>
      )}
      {graphics.chromaticAberration ? (
        <ChromaticAberration
          offset={aberrationOffset}
          radialModulation
          modulationOffset={0.35}
          blendFunction={BlendFunction.NORMAL}
        />
      ) : (
        <></>
      )}
      {graphics.vignette ? <Vignette offset={0.28} darkness={0.62} eskil={false} /> : <></>}
      {graphics.filmGrain ? <Noise opacity={0.028} blendFunction={BlendFunction.OVERLAY} /> : <></>}
    </EffectComposer>
  );
}

/**
 * Draws the scene with no post-processing.
 *
 * Priority 1 matches where `EffectComposer` renders, so this slots into the same point in the frame
 * and stays ahead of the profiling callback at priority 1000.
 */
function PlainRender() {
  const { gl, scene, camera } = useThree();
  useFrame(() => {
    gl.render(scene, camera);
  }, 1);
  return null;
}
