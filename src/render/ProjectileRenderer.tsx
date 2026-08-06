import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { teamEmissive } from '@/config/teams';
import { muzzleOffset } from './MuzzleRegistry';
import { useGame } from './GameContext';

/**
 * Photon bolts.
 *
 * Each bolt is drawn as a stretched, additively-blended capsule oriented along its velocity, which
 * gives it a motion-trail read without a separate trail system or any per-frame geometry churn.
 * One InstancedMesh covers every bolt in flight from every player.
 *
 * ## Drawn from the barrel, resolved on the authoritative path
 *
 * The simulated origin is not the muzzle — see `MuzzleRegistry`. Bolts are therefore drawn from
 * wherever the weapon actually is and converge onto the simulated line over their first few metres.
 * Hit detection is untouched: this moves pixels, not rays.
 */

const MAX_BOLTS = 256;
const BOLT_LENGTH = 2.6;
const BOLT_RADIUS = 0.075;

interface Props {
  colorblind: boolean;
}

export function ProjectileRenderer({ colorblind }: Props) {
  const game = useGame();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const glowRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    // A cylinder along Y, so we can aim it with quaternion-from-unit-vectors.
    const geo = new THREE.CylinderGeometry(BOLT_RADIUS, BOLT_RADIUS * 0.55, 1, 6, 1, true);
    geo.translate(0, -0.5, 0); // Origin at the leading tip.
    return geo;
  }, []);

  const glowGeometry = useMemo(() => {
    const geo = new THREE.CylinderGeometry(BOLT_RADIUS * 3.2, BOLT_RADIUS * 1.1, 1, 6, 1, true);
    geo.translate(0, -0.5, 0);
    return geo;
  }, []);

  const scratch = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      color: new THREE.Color(),
      offset: new THREE.Vector3(),
    }),
    [],
  );

  useFrame(() => {
    const mesh = meshRef.current;
    const glow = glowRef.current;
    if (!mesh || !glow || !game.match) return;

    const projectiles = game.match.projectiles.active;
    const alpha = game.alpha;
    let count = 0;

    for (const p of projectiles) {
      if (count >= MAX_BOLTS) break;

      // Interpolate between simulation ticks so bolts do not step at 64 Hz.
      scratch.position.set(
        p.prevPosition.x + (p.position.x - p.prevPosition.x) * alpha,
        p.prevPosition.y + (p.position.y - p.prevPosition.y) * alpha,
        p.prevPosition.z + (p.position.z - p.prevPosition.z) * alpha,
      );

      scratch.dir.set(p.velocity.x, p.velocity.y, p.velocity.z);
      const speed = scratch.dir.length();
      if (speed < 1e-4) continue;
      scratch.dir.divideScalar(speed);
      scratch.quaternion.setFromUnitVectors(scratch.up, scratch.dir);

      // Start the bolt at the barrel and let it settle onto the simulated line. The offset is zero
      // once the bolt is past the convergence distance, and zero always when the shooter has no
      // known muzzle — so this degrades exactly to the previous behaviour rather than to a guess.
      muzzleOffset(
        game.match.state.actors.get(p.ownerId),
        scratch.position,
        scratch.dir,
        p.distanceTravelled,
        scratch.offset,
      );
      scratch.position.add(scratch.offset);

      // Bolts stretch as they leave the muzzle, so the first frame does not look like a stub.
      const stretch = Math.min(1, p.distanceTravelled / 3) * BOLT_LENGTH + 0.4;
      scratch.scale.set(1, stretch, 1);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      mesh.setMatrixAt(count, scratch.matrix);

      scratch.scale.set(1, stretch * 1.25, 1);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      glow.setMatrixAt(count, scratch.matrix);

      scratch.color.setHex(teamEmissive(p.team, colorblind));
      mesh.setColorAt(count, scratch.color);
      glow.setColorAt(count, scratch.color);
      count++;
    }

    mesh.count = count;
    glow.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={glowRef} args={[glowGeometry, undefined, MAX_BOLTS]} frustumCulled={false}>
        <meshBasicMaterial
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh ref={meshRef} args={[geometry, undefined, MAX_BOLTS]} frustumCulled={false}>
        <meshBasicMaterial
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  );
}
