import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { teamEmissive } from '@/config/teams';
import type { TeamId } from '@/config/teams';
import { useGame } from './GameContext';

/**
 * Impact feedback: scorch decals, spark bursts and a light flash.
 *
 * Everything here is pooled and instanced. Impacts are the highest-frequency visual event in the
 * game — six bolts a second per player, twelve players — so an allocation in this path would be a
 * per-second GC hazard rather than a one-off cost.
 */

const MAX_DECALS = 96;
const MAX_SPARKS = 480;
const SPARKS_PER_IMPACT = 14;
/**
 * Concurrent impact lights.
 *
 * Every point light in the scene is evaluated by every lit surface shader, so these are charged
 * against the whole frame, not just the pixels near the impact. Profiling found 20 live point
 * lights against a configured cap of 8 — impact flashes, prop beacons and the muzzle light were
 * all outside the budget. Three is enough to read as a burst during sustained fire.
 */
const MAX_FLASHES = 3;

interface Decal {
  active: boolean;
  age: number;
  life: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: number;
  color: THREE.Color;
}

interface Spark {
  active: boolean;
  age: number;
  life: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
}

interface Flash {
  active: boolean;
  age: number;
  position: THREE.Vector3;
  color: THREE.Color;
}

interface Props {
  colorblind: boolean;
  maxLights: number;
}

export function ImpactFX({ colorblind, maxLights }: Props) {
  const game = useGame();
  const decalRef = useRef<THREE.InstancedMesh>(null);
  const sparkRef = useRef<THREE.InstancedMesh>(null);

  const decals = useMemo<Decal[]>(
    () =>
      Array.from({ length: MAX_DECALS }, () => ({
        active: false,
        age: 0,
        life: 14,
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: 0.5,
        color: new THREE.Color(),
      })),
    [],
  );
  const sparks = useMemo<Spark[]>(
    () =>
      Array.from({ length: MAX_SPARKS }, () => ({
        active: false,
        age: 0,
        life: 0.4,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        color: new THREE.Color(),
        size: 0.05,
      })),
    [],
  );
  const flashes = useMemo<Flash[]>(
    () =>
      Array.from({ length: MAX_FLASHES }, () => ({
        active: false,
        age: 0,
        position: new THREE.Vector3(),
        color: new THREE.Color(),
      })),
    [],
  );

  const cursors = useRef({ decal: 0, spark: 0, flash: 0 });

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      up: new THREE.Vector3(0, 0, 1),
      tangent: new THREE.Vector3(),
      bitangent: new THREE.Vector3(),
      color: new THREE.Color(),
    }),
    [],
  );

  const decalGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const sparkGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  useEffect(() => {
    const off = game.events.on('projectile_impact', ({ position, normal, team, hitActor }) => {
      spawnImpact(position, normal, team, hitActor);
    });
    return off;

    function spawnImpact(
      position: { x: number; y: number; z: number },
      normal: { x: number; y: number; z: number },
      team: TeamId,
      hitActor: boolean,
    ) {
      const hex = teamEmissive(team, colorblind);

      // Scorch decal — only on world geometry; hitting a player leaves no mark.
      if (!hitActor) {
        const decal = decals[cursors.current.decal];
        cursors.current.decal = (cursors.current.decal + 1) % MAX_DECALS;
        decal.active = true;
        decal.age = 0;
        decal.life = 12 + Math.random() * 6;
        // Lift the quad off the surface to avoid z-fighting.
        decal.position.set(
          position.x + normal.x * 0.012,
          position.y + normal.y * 0.012,
          position.z + normal.z * 0.012,
        );
        scratch.normal.set(normal.x, normal.y, normal.z);
        decal.quaternion.setFromUnitVectors(scratch.up, scratch.normal);
        // Random roll so repeated hits do not tile identically.
        scratch.quaternion.setFromAxisAngle(scratch.normal, Math.random() * Math.PI * 2);
        decal.quaternion.premultiply(scratch.quaternion);
        decal.scale = 0.34 + Math.random() * 0.22;
        decal.color.setHex(hex);
      }

      // Spark burst in a hemisphere around the surface normal.
      for (let i = 0; i < SPARKS_PER_IMPACT; i++) {
        const spark = sparks[cursors.current.spark];
        cursors.current.spark = (cursors.current.spark + 1) % MAX_SPARKS;
        spark.active = true;
        spark.age = 0;
        spark.life = 0.22 + Math.random() * 0.3;
        spark.position.set(position.x, position.y, position.z);
        const spreadX = (Math.random() - 0.5) * 2;
        const spreadY = (Math.random() - 0.5) * 2;
        const spreadZ = (Math.random() - 0.5) * 2;
        const speed = 2.5 + Math.random() * 5.5;
        spark.velocity
          .set(normal.x * 1.6 + spreadX, normal.y * 1.6 + spreadY, normal.z * 1.6 + spreadZ)
          .normalize()
          .multiplyScalar(speed);
        spark.color.setHex(hex);
        spark.size = 0.035 + Math.random() * 0.045;
      }

      // Point-light flash. Capped hard: dynamic lights are the most expensive thing on this list.
      if (maxLights > 0) {
        const flash = flashes[cursors.current.flash];
        cursors.current.flash = (cursors.current.flash + 1) % Math.min(MAX_FLASHES, maxLights);
        flash.active = true;
        flash.age = 0;
        flash.position.set(position.x, position.y, position.z);
        flash.color.setHex(hex);
      }
    }
  }, [game, colorblind, maxLights, decals, sparks, flashes, scratch]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // --- Decals ---
    const decalMesh = decalRef.current;
    if (decalMesh) {
      let count = 0;
      for (const decal of decals) {
        if (!decal.active) continue;
        decal.age += dt;
        if (decal.age >= decal.life) {
          decal.active = false;
          continue;
        }
        // Fade over the last third of the lifetime.
        const fade = 1 - Math.max(0, (decal.age - decal.life * 0.66) / (decal.life * 0.34));
        scratch.scale.setScalar(decal.scale);
        scratch.matrix.compose(decal.position, decal.quaternion, scratch.scale);
        decalMesh.setMatrixAt(count, scratch.matrix);
        scratch.color.copy(decal.color).multiplyScalar(fade);
        decalMesh.setColorAt(count, scratch.color);
        count++;
      }
      decalMesh.count = count;
      decalMesh.instanceMatrix.needsUpdate = true;
      if (decalMesh.instanceColor) decalMesh.instanceColor.needsUpdate = true;
    }

    // --- Sparks ---
    const sparkMesh = sparkRef.current;
    if (sparkMesh) {
      let count = 0;
      for (const spark of sparks) {
        if (!spark.active) continue;
        spark.age += dt;
        if (spark.age >= spark.life) {
          spark.active = false;
          continue;
        }
        spark.velocity.y -= 14 * dt;
        spark.velocity.multiplyScalar(1 - 2.6 * dt);
        spark.position.addScaledVector(spark.velocity, dt);

        const t = 1 - spark.age / spark.life;
        scratch.scale.setScalar(spark.size * (0.4 + t));
        scratch.matrix.compose(spark.position, IDENTITY_QUAT, scratch.scale);
        sparkMesh.setMatrixAt(count, scratch.matrix);
        scratch.color.copy(spark.color).multiplyScalar(t * t);
        sparkMesh.setColorAt(count, scratch.color);
        count++;
      }
      sparkMesh.count = count;
      sparkMesh.instanceMatrix.needsUpdate = true;
      if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
    }

    for (const flash of flashes) {
      if (flash.active) {
        flash.age += dt;
        if (flash.age > 0.14) flash.active = false;
      }
    }
  });

  return (
    <group>
      <instancedMesh ref={decalRef} args={[decalGeometry, undefined, MAX_DECALS]} frustumCulled={false}>
        <meshBasicMaterial
          transparent
          opacity={0.55}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      <instancedMesh ref={sparkRef} args={[sparkGeometry, undefined, MAX_SPARKS]} frustumCulled={false}>
        <meshBasicMaterial
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      {flashes.map((flash, i) => (
        <FlashLight key={i} flash={flash} />
      ))}
    </group>
  );
}

const IDENTITY_QUAT = new THREE.Quaternion();

/** A short-lived point light at an impact. Intensity is driven per frame from the pooled record. */
function FlashLight({ flash }: { flash: Flash }) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(() => {
    const light = ref.current;
    if (!light) return;
    if (!flash.active) {
      light.intensity = 0;
      return;
    }
    light.position.copy(flash.position);
    light.color.copy(flash.color);
    light.intensity = (1 - flash.age / 0.14) * 26;
  });
  return <pointLight ref={ref} intensity={0} distance={7} decay={2} />;
}
