import { useEffect } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useThree } from '@react-three/fiber';

/**
 * Image-based lighting for the arena.
 *
 * This is not a nicety — it is required for the surfaces to render at all. A `MeshStandardMaterial`
 * with metalness above zero gets almost all of its colour from reflected environment light, so
 * without an environment map the reflective floors and catwalks sample pure black and the arena
 * reads as an unlit void no matter how many point lights are in it.
 *
 * `RoomEnvironment` ships with Three.js, so this costs no network request and no asset pipeline.
 * It is prefiltered once into a PMREM cube and reused; the generator and render target are
 * disposed on unmount because both hold GPU memory.
 */
export function ArenaEnvironment({ intensity = 0.55 }: { intensity?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();

    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);

    scene.environment = target.texture;
    scene.environmentIntensity = intensity;

    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      room.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          const material = mesh.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
    };
  }, [gl, scene, intensity]);

  return null;
}
