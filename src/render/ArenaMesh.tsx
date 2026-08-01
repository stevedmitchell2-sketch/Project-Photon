import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { BuiltArena } from '@/maps/MapBuilder';
import { photonMaterial, SURFACE_SUBSTANCE } from './materials/PhotonMaterials';

/**
 * The entire arena as one InstancedMesh per material batch.
 *
 * Arena 01 is ~180 brushes; batching collapses that to under a dozen draw calls. The matrices are
 * written once on mount because static geometry never moves — only the LED panels animate, and
 * they do it through a material uniform rather than by touching the instance buffer.
 */

interface Props {
  arena: BuiltArena;
  shadows: boolean;
}

export function ArenaMesh({ arena, shadows }: Props) {
  return (
    <group>
      {arena.batches.map((batch, index) => (
        <Batch key={`${batch.kind}-${batch.color}-${batch.glow}-${index}`} batch={batch} shadows={shadows} />
      ))}
    </group>
  );
}

function Batch({ batch, shadows }: { batch: BuiltArena['batches'][number]; shadows: boolean }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const isAnimated = batch.kind === 'led';
  const isTransparent = batch.kind === 'glass';

  /**
   * The substance this batch is made of, from the material library.
   *
   * The arena declares what a brush is *for* (`SurfaceKind`); the library decides what it is *made
   * of*. That separation is what lets a future arena reuse these kinds with a different material
   * language, and it is why surfaces now carry roughness texture rather than a single flat value —
   * a solid-colour polygon reads as graybox however well it is lit.
   *
   * Animated LED batches ask for a unique instance, because they mutate `emissiveIntensity` every
   * frame and a shared material would pulse every other object made of the same substance.
   */
  const material = useMemo(
    () =>
      photonMaterial(SURFACE_SUBSTANCE[batch.kind], {
        color: batch.color,
        emissive: batch.glow > 0 ? batch.color : undefined,
        glow: batch.glow > 0 ? batch.glow : undefined,
        unique: isAnimated,
      }) as THREE.MeshStandardMaterial,
    [batch.kind, batch.color, batch.glow, isAnimated],
  );

  // Emissive on a lit substance is set here rather than in the recipe, because only the arena knows
  // which brushes glow — the same substance is used for lit and unlit surfaces.
  useEffect(() => {
    if (!('emissive' in material)) return;
    if (batch.glow > 0) {
      material.emissive = new THREE.Color(batch.color);
      material.emissiveIntensity = batch.glow;
    }
    material.envMapIntensity = 0.8;
  }, [material, batch.color, batch.glow]);

  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();

    batch.instances.forEach((instance, i) => {
      position.set(instance.position[0], instance.position[1], instance.position[2]);
      // YXZ matches how the physics collider composes yaw then pitch.
      euler.set(instance.rotation[0], instance.rotation[1], instance.rotation[2], 'YXZ');
      quaternion.setFromEuler(euler);
      scale.set(instance.scale[0], instance.scale[1], instance.scale[2]);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    return () => geometry.dispose();
  }, [batch, geometry]);

  // LED walls pulse on a slow sine so the arena never feels static.
  useFrame(({ clock }) => {
    if (!isAnimated) return;
    const t = clock.elapsedTime;
    material.emissiveIntensity = batch.glow * (0.62 + 0.38 * Math.sin(t * 1.6));
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, batch.instances.length]}
      castShadow={shadows && !isTransparent && !batch.noShadow && batch.kind !== 'floor'}
      receiveShadow={shadows && !isTransparent}
      frustumCulled
    />
  );
}
