import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { teamColor, teamEmissive } from '@/config/teams';
import type { ReactiveZone, TeamZone } from '@/maps/MapTypes';
import { useGame } from './GameContext';

/**
 * Environmental team identity.
 *
 * The arena tells you whose ground you are standing on. Until Sprint 9 every strip and fixture in
 * the level was the same cyan regardless of who held what, so the only team-state signal on screen
 * was a line of HUD text — which is exactly the wrong place for it. A player being chased through
 * three rooms is looking at the rooms.
 *
 * Three elements, in increasing order of how much they say:
 *
 *   1. **Territory strips** — a ring of emissive floor segments around each team's spawn, in that
 *      team's colour. Static, and the cheapest possible way to answer "whose half is this".
 *   2. **Spawn beacons** — vertical pillars of light at the spawn itself, visible over cover, so
 *      the answer is available from across the room rather than only underfoot.
 *   3. **Reactive objective lighting** — the central room takes the colour of whoever holds it, and
 *      strobes while it is contested. This one is not decoration: it is a live readout of the match
 *      state, readable from any doorway, and it is the feature that makes the arena feel like a
 *      venue staging a game rather than a room with lights in it.
 *
 * ## Why this is emissive geometry and not lights
 *
 * Sprint 8 measured the frame as **fragment-bound**: `maxDynamicLights` 8 → 0 was worth 2.3 ms of
 * a 12.3 ms frame, because every additional light is another loop over every lit fragment. Adding
 * six or eight coloured lights to express territory would have cost more than the entire
 * post-processing chain.
 *
 * Emissive, unlit geometry costs a draw call and some fill, and no per-fragment lighting at all. So
 * territory is expressed with `MeshBasicMaterial` — which also means it reads at full saturation
 * regardless of how dark the room is, which is precisely what a territory marker should do.
 *
 * Exactly **one** real light is used, on the reactive objective zone, because that is the single
 * element where the colour needs to fall on surrounding surfaces to be legible from a distance.
 */

const SEGMENTS_PER_RING = 24;

export function TeamIdentity({ colorblind, maxLights }: { colorblind: boolean; maxLights: number }) {
  const game = useGame();
  const zones = game.arena.definition.teamZones ?? [];
  const reactive = game.arena.definition.reactiveZones ?? [];

  // Named so a profiling pass can toggle the whole subtree's visibility and get an interleaved
  // before/after without a rebuild. Sprint 8 established that sequential graphics A/B is worthless
  // here, because GPU time depends on where the camera happens to be pointing.
  return (
    <group name="team-identity">
      {zones.map((zone, i) => (
        <TerritoryRing key={i} zone={zone} colorblind={colorblind} />
      ))}
      {reactive.map((zone, i) => (
        <ReactiveObjective key={i} zone={zone} colorblind={colorblind} allowLight={maxLights > 0} />
      ))}
    </group>
  );
}

/**
 * A team's territory marker: a broken ring of floor strips plus two beacons.
 *
 * The ring is broken rather than continuous — segments with gaps — because a solid circle reads as
 * a painted line on the floor, and a dashed one reads as installed lighting. It also halves the
 * fill cost.
 */
function TerritoryRing({ zone, colorblind }: { zone: TeamZone; colorblind: boolean }) {
  const game = useGame();
  const glow = teamEmissive(zone.team, colorblind);
  const base = teamColor(zone.team, colorblind);

  /**
   * Ring positions, clipped to the play space.
   *
   * A zone centred on a corner spawn has most of its radius outside the building: red sits at
   * (-25, -25) with a 15 m radius in a map that stops at -30, so a third of the ring was embedded
   * in the perimeter wall, lighting the inside of geometry nobody can see. Clipping here rather
   * than shrinking the radius keeps the zone describing *territory* — which really does extend to
   * the wall — while only drawing the part of it that is in the room.
   */
  const placements = useMemo(() => {
    const [minX, minZ, maxX, maxZ] = game.arena.definition.bounds;
    const margin = 1.2;
    const out: Array<{ x: number; z: number; angle: number }> = [];
    for (let i = 0; i < SEGMENTS_PER_RING; i++) {
      const angle = (i / SEGMENTS_PER_RING) * Math.PI * 2;
      const x = zone.p[0] + Math.cos(angle) * zone.radius;
      const z = zone.p[2] + Math.sin(angle) * zone.radius;
      if (x < minX + margin || x > maxX - margin || z < minZ + margin || z > maxZ - margin) continue;
      out.push({ x, z, angle });
    }
    return out;
  }, [game, zone]);

  const stripGeometry = useMemo(() => new THREE.BoxGeometry(1.5, 0.06, 0.34), []);
  const beaconGeometry = useMemo(() => new THREE.CylinderGeometry(0.16, 0.16, 5.2, 8, 1, true), []);

  const stripMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: glow, toneMapped: false, transparent: true, opacity: 0.85 }),
    [glow],
  );
  const beaconMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: base,
        toneMapped: false,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [base],
  );

  const strips = useRef<THREE.InstancedMesh>(null);
  const pulse = useRef(0);

  useFrame((_, delta) => {
    const mesh = strips.current;
    if (!mesh) return;

    // Laid out once, on the first frame the instance buffer exists — territory does not move, so
    // there is nothing to update afterwards.
    if (!mesh.userData.laidOut) {
      const dummy = new THREE.Object3D();
      placements.forEach((place, i) => {
        dummy.position.set(place.x, zone.p[1] + 0.04, place.z);
        dummy.rotation.set(0, -place.angle, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.count = placements.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.laidOut = true;
    }
    // A slow breath, so the strips read as powered rather than painted. Deliberately subtle: this
    // is orientation furniture and must never compete with a muzzle flash for attention.
    pulse.current += delta;
    stripMaterial.opacity = 0.72 + 0.13 * Math.sin(pulse.current * 1.1);
  });

  return (
    <group>
      <instancedMesh
        ref={strips}
        args={[stripGeometry, stripMaterial, SEGMENTS_PER_RING]}
        frustumCulled={false}
      />
      {/* Beacons flank the spawn rather than standing on it. At 2.4 m one of them filled half the
          screen the instant a player materialised, which is the opposite of an orientation cue. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          geometry={beaconGeometry}
          material={beaconMaterial}
          position={[zone.p[0] + side * 4.5, zone.p[1] + 2.6, zone.p[2] + side * 4.5]}
        />
      ))}
    </group>
  );
}

/**
 * Objective lighting that follows control.
 *
 * Reads `TriggerSystem` directly rather than the HUD snapshot, because the HUD is throttled to the
 * snapshot rate and this needs to respond on the frame the objective flips.
 *
 * Contested state strobes rather than picking a colour. A blend of the two team colours would land
 * on some muddy purple that means nothing; a strobe is unambiguous and is the visual language every
 * sports venue already uses for "something is happening here".
 */
function ReactiveObjective({
  zone,
  colorblind,
  allowLight,
}: {
  zone: ReactiveZone;
  colorblind: boolean;
  allowLight: boolean;
}) {
  const game = useGame();
  const light = useRef<THREE.PointLight>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const current = useRef(new THREE.Color(zone.neutralColor));
  const target = useRef(new THREE.Color(zone.neutralColor));
  const strobe = useRef(0);

  const ringGeometry = useMemo(() => new THREE.TorusGeometry(zone.radius, 0.12, 6, 48), [zone.radius]);
  const ringMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: zone.neutralColor,
        toneMapped: false,
        transparent: true,
        opacity: 0.7,
      }),
    [zone.neutralColor],
  );

  useFrame((_, delta) => {
    const state = game.match?.state;
    const trigger = game.match?.triggers.get(zone.objectiveId);
    const holder = trigger?.controllingTeam ?? null;
    const contested = trigger?.contested ?? false;

    // Match phase outranks objective control.
    //
    // The objective ring is the largest lit element in the room, which makes it the arena's loudest
    // channel — so the loudest things the match has to say borrow it. A venue does not keep showing
    // you who holds the middle once the match is over.
    const remaining = state?.timeRemaining ?? Infinity;
    const ended = state?.phase === 'ended';
    const winner = state?.winner ?? null;
    const finalMinute = !ended && remaining <= 60;
    const finalSeconds = !ended && remaining <= 10;

    if (ended) {
      target.current.set(winner ? teamEmissive(winner, colorblind) : zone.neutralColor);
    } else if (finalSeconds) {
      target.current.set(0xff2d55);
    } else if (finalMinute) {
      target.current.set(0xffd84d);
    } else {
      target.current.set(holder ? teamEmissive(holder, colorblind) : zone.neutralColor);
    }

    // Ease rather than snap. A hard cut on every occupancy change would flicker constantly as
    // players cross the boundary; easing means only a sustained change reads as a change.
    current.current.lerp(target.current, Math.min(1, delta * 3.5));

    strobe.current += delta;

    // Each state has its own rhythm, so the room is distinguishable with the sound off and by a
    // player who cannot separate the hues: a fast strobe for a contested objective, a one-per-second
    // countdown beat in the last ten seconds, a slow swell in the final minute, and a steady flood
    // once the match is decided.
    let pulse = 1;
    if (ended) pulse = 1;
    else if (finalSeconds) pulse = 0.35 + 0.65 * Math.abs(Math.sin(strobe.current * Math.PI));
    else if (contested) pulse = 0.55 + 0.45 * Math.sin(strobe.current * 11);
    else if (finalMinute) pulse = 0.7 + 0.3 * Math.sin(strobe.current * 2.2);

    ringMaterial.color.copy(current.current);
    ringMaterial.opacity = (ended ? 0.95 : holder ? 0.85 : 0.55) * pulse;

    if (ringRef.current) {
      // Ride slightly above the floor and breathe with the hold, so a held objective looks alive.
      ringRef.current.position.y = zone.p[1] + 0.06 + (holder ? 0.02 * Math.sin(strobe.current * 2) : 0);
      // The winner's ring rises and widens — a curtain call rather than a status light.
      const celebrate = ended ? 1 + 0.06 * (1 + Math.sin(strobe.current * 1.6)) : 1;
      ringRef.current.scale.setScalar(celebrate);
    }

    if (light.current) {
      light.current.color.copy(current.current);
      // Victory floods the room; everything else is a fixture.
      light.current.intensity = (ended ? 320 : holder ? 190 : 90) * pulse;
    }
  });

  return (
    <group>
      <mesh
        ref={ringRef}
        geometry={ringGeometry}
        material={ringMaterial}
        position={[zone.p[0], zone.p[1] + 0.06, zone.p[2]]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      {allowLight && (
        <pointLight
          ref={light}
          position={[zone.p[0], zone.p[1] + 3.4, zone.p[2]]}
          distance={zone.radius * 2.6}
          decay={2}
          color={zone.neutralColor}
          intensity={90}
        />
      )}
    </group>
  );
}
