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
    return null;
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
