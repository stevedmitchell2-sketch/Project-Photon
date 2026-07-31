import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { BuiltArena } from '@/maps/MapBuilder';
import type { SurfaceKind } from '@/maps/MapTypes';

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

/** Per-surface material response. Reflective floors and matte walls read very differently. */
const SURFACE_MATERIAL: Record<SurfaceKind, { roughness: number; metalness: number }> = {
  floor: { roughness: 0.22, metalness: 0.65 },
  wall: { roughness: 0.72, metalness: 0.15 },
  catwalk: { roughness: 0.42, metalness: 0.72 },
  barrier: { roughness: 0.55, metalness: 0.35 },
  pillar: { roughness: 0.48, metalness: 0.42 },
  ramp: { roughness: 0.5, metalness: 0.4 },
  glass: { roughness: 0.08, metalness: 0.1 },
  led: { roughness: 0.9, metalness: 0 },
  trim: { roughness: 0.9, metalness: 0 },
};

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
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const surface = SURFACE_MATERIAL[batch.kind];
  const isAnimated = batch.kind === 'led';
  const isTransparent = batch.kind === 'glass';

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
    if (!isAnimated || !materialRef.current) return;
    const t = clock.elapsedTime;
    materialRef.current.emissiveIntensity = batch.glow * (0.62 + 0.38 * Math.sin(t * 1.6));
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, batch.instances.length]}
      castShadow={shadows && !isTransparent && !batch.noShadow && batch.kind !== 'floor'}
      receiveShadow={shadows && !isTransparent}
      frustumCulled
    >
      <meshStandardMaterial
        ref={materialRef}
        color={batch.color}
        emissive={batch.glow > 0 ? batch.color : 0x000000}
        emissiveIntensity={batch.glow}
        roughness={surface.roughness}
        metalness={surface.metalness}
        transparent={isTransparent}
        opacity={isTransparent ? 0.24 : 1}
        depthWrite={!isTransparent}
        envMapIntensity={0.8}
      />
    </instancedMesh>
  );
}
