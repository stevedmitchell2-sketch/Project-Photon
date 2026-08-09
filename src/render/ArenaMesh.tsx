import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { BuiltArena } from '@/maps/MapBuilder';
import { photonMaterial, SURFACE_SUBSTANCE, type Substance } from './materials/PhotonMaterials';

/**
 * The entire arena as one InstancedMesh per material batch.
 *
 * Arena 01 is ~180 brushes; batching collapses that to under a dozen draw calls. The matrices are
 * written once on mount because static geometry never moves — only the LED panels animate, and
 * they do it through a material uniform rather than by touching the instance buffer.
 */

/**
 * Physical size of one texture tile, in metres, per substance.
 *
 * ## The defect these fix
 *
 * Every brush is the same `BoxGeometry(1, 1, 1)` scaled per instance, and `BoxGeometry` UVs are 0–1
 * per face. Instance scaling changes the geometry's size and never touches its UVs, so **every face
 * shows exactly `repeat` tiles whatever its physical dimensions**. A 9 m wall and a 1 m barrier get
 * the same number of tiles — which made a panel seam 2.25 m wide on the wall and 0.25 m on the
 * barrier, a 9x inconsistency, with the large surfaces reduced to a gentle undulation no lighting
 * could reveal.
 *
 * That is the reason the arena reads as extruded boxes despite having roughness and normal maps: the
 * detail is the wrong physical size, and the error scales with how big the surface is.
 *
 * Tiles are therefore specified in metres and converted to a per-instance UV multiplier below.
 */
const METRES_PER_TILE: Partial<Record<Substance, number>> = {
  compositePolymer: 0.5,   // panel seams
  brushedAluminium: 0.1,
  titanium: 0.1,
  carbonFibre: 0.15,
  antiSlipFloor: 0.15,
  competitionFloor: 0.15,
  hexPanel: 0.35,
};

/**
 * Brush kinds using world-scaled UVs.
 *
 * Deliberately one kind for now. The change is proven on walls — the surfaces where the error was
 * largest and most visible — and captured before it goes anywhere near the rest of the arena.
 */
const WORLD_UV_KINDS = new Set(['wall']);

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

  /**
   * Rewrites the batch's UVs to a fixed physical density, per instance.
   *
   * The scale cannot be baked into the geometry: instances in one batch have different dimensions
   * and they share a single `BoxGeometry`, so baking would mean one geometry per brush and the loss
   * of the instancing this renderer is built on. Instead each instance carries a `vec2` multiplier
   * and the vertex shader applies it — one attribute, one program, batching untouched.
   *
   * `customProgramCacheKey` matters as much as the patch. Without it three.js hashes the compiled
   * program by material identity and can build a separate program per batch, which is precisely the
   * draw-call explosion this design exists to avoid.
   *
   * ## The two-axis simplification
   *
   * A box has three differently sized face pairs and a `vec2` can only be correct for one of them.
   * X and Y are used, which is right for the large vertical faces of a wall — the surfaces that
   * carry the read — and mildly wrong on its ends and top cap. Those are narrow, usually against
   * other geometry, and the cheap version is worth proving before a face-normal-aware variant is
   * written. If the ends visibly fail in the capture, that is the escalation.
   */
  const worldUv = WORLD_UV_KINDS.has(batch.kind);
  const metresPerTile = METRES_PER_TILE[SURFACE_SUBSTANCE[batch.kind]];

  useEffect(() => {
    if (!worldUv || !metresPerTile) return;
    const count = batch.instances.length;
    const scales = new Float32Array(count * 2);
    // The textures already carry their own `repeat` — `finish()` sets it when the canvas is built,
    // and three.js applies it in the UV transform before this multiplier lands. Ignoring it stacks
    // the two: a 25 m wall at 0.5 m/tile became 50 tiles, then the texture's own repeat of 4 turned
    // that into 200, or 12.5 cm per tile. The first capture showed exactly that — a dense dimple
    // pattern like perforated metal rather than architectural panels. Divide it back out.
    const baked = material.roughnessMap?.repeat.x || material.normalMap?.repeat.x || 1;
    for (let i = 0; i < count; i++) {
      // Instance scale is the brush's size in metres, so tiles = size / metres-per-tile.
      scales[i * 2] = Math.max(0.01, batch.instances[i].scale[0]) / metresPerTile / baked;
      scales[i * 2 + 1] = Math.max(0.01, batch.instances[i].scale[1]) / metresPerTile / baked;
    }
    geometry.setAttribute('aUvScale', new THREE.InstancedBufferAttribute(scales, 2));

    material.onBeforeCompile = (shader) => {
      shader.vertexShader =
        'attribute vec2 aUvScale;\n' +
        shader.vertexShader.replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          #ifdef USE_MAP
            vMapUv *= aUvScale;
          #endif
          #ifdef USE_NORMALMAP
            vNormalMapUv *= aUvScale;
          #endif
          #ifdef USE_ROUGHNESSMAP
            vRoughnessMapUv *= aUvScale;
          #endif`,
        );
    };
    material.customProgramCacheKey = () => 'photon-world-uv';
    material.needsUpdate = true;
  }, [worldUv, metresPerTile, batch, geometry, material]);

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
