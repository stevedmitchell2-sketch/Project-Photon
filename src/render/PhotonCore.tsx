import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { teamEmissive } from '@/config/teams';
import { photonMaterial } from './materials/PhotonMaterials';
import { useGame } from './GameContext';

/**
 * The Photon Core.
 *
 * The arena's landmark, and the one object in the game that is supposed to be remembered. It hangs
 * in the tall volume above the central objective room, visible from the upper deck, from the ground
 * floor across the arena, and from every approach to the middle.
 *
 * ## Why a landmark has to do two jobs
 *
 * A centrepiece that is only decoration is a wasted opportunity in a competitive game, because
 * players stop seeing scenery within a match or two. The Core is also the **objective readout**: it
 * takes the colour of whoever holds the room, strobes while contested, and floods on a win. So it
 * keeps being looked at, and looking at it is always worth something.
 *
 * That doubling is the point. It is the strongest expression of the project's oldest identity idea —
 * *the building reports the state of the match* — and it puts that idea at the visual centre of the
 * arena rather than in a HUD element.
 *
 * ## Construction
 *
 * Three concentric rings on different axes, spinning at different rates, around a pulsing core, with
 * a containment cage and a beam descending to the objective roof. The rings are what make it
 * readable from any angle: a sphere looks the same from everywhere and therefore reads as flat,
 * while crossed rings give parallax and tell you where you are standing relative to it.
 *
 * Everything is emissive or unlit except the cage. On a fragment-bound frame that matters — the Core
 * is large in frame and lighting it properly would cost far more than making it glow.
 */

interface Props {
  colorblind: boolean;
  /** Zero disables the Core's own light, for Performance Mode. */
  maxLights: number;
}

export function PhotonCore({ colorblind, maxLights }: Props) {
  const game = useGame();

  /**
   * Where the Core hangs.
   *
   * **Inside** the objective room, not above it. A first pass suspended it in the volume between the
   * room's roof and the arena ceiling, which failed twice over: that gap is only 2.8 m, so a 5 m
   * ring assembly clipped straight through the roof, and from the ground floor the roof edge
   * occluded it from every approach — a landmark nobody can see is not a landmark.
   *
   * Inside the room it is better in every way. The room is 16 x 16 x 5, so there is space; it is
   * framed by the four doorways as you approach; and players fight *around* it, which makes the most
   * contested ground in the game also the most memorable.
   *
   * The height puts the ring assembly just above standing eye level (1.6 m), so it reads as
   * overhead presence without occluding body-height shots across the room.
   */
  const centre = useMemo(() => {
    const objective = game.arena.definition.objectives.find((o) => o.kind === 'hill');
    return new THREE.Vector3(objective?.p[0] ?? 0, 3.4, objective?.p[2] ?? 0);
  }, [game]);

  const coreRef = useRef<THREE.Mesh>(null);
  const ringRefs = useRef<Array<THREE.Mesh | null>>([]);
  const beamRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const haloRef = useRef<THREE.Mesh>(null);

  const current = useRef(new THREE.Color(0x2de0ff));
  const target = useRef(new THREE.Color(0x2de0ff));
  const clock = useRef(0);

  // Unique instances throughout: every one of these mutates colour or emissive every frame.
  const coreMaterial = useMemo(
    () => photonMaterial('energyEmitter', { color: 0x2de0ff, emissive: 0x2de0ff, unique: true }) as THREE.MeshStandardMaterial,
    [],
  );
  const ringMaterial = useMemo(
    () => photonMaterial('ledStrip', { color: 0x2de0ff, emissive: 0x2de0ff, unique: true }) as THREE.MeshBasicMaterial,
    [],
  );
  const haloMaterial = useMemo(
    () => photonMaterial('energyGlass', { color: 0x2de0ff, emissive: 0x2de0ff, unique: true }) as THREE.MeshBasicMaterial,
    [],
  );
  const beamMaterial = useMemo(
    () => photonMaterial('energyGlass', { color: 0x2de0ff, emissive: 0x2de0ff, unique: true }) as THREE.MeshBasicMaterial,
    [],
  );
  const cageMaterial = useMemo(() => photonMaterial('titanium', { color: 0x6b7688 }), []);

  const ringGeometry = useMemo(() => new THREE.TorusGeometry(1, 0.055, 8, 64), []);
  const coreGeometry = useMemo(() => new THREE.IcosahedronGeometry(0.62, 2), []);
  const haloGeometry = useMemo(() => new THREE.SphereGeometry(0.98, 20, 14), []);
  const beamGeometry = useMemo(() => new THREE.CylinderGeometry(0.36, 1.9, 3.3, 18, 1, true), []);
  const strutGeometry = useMemo(() => new THREE.BoxGeometry(0.12, 1.9, 0.12), []);

  useFrame((_, delta) => {
    clock.current += delta;
    const t = clock.current;

    const trigger = game.match?.triggers.get('central_hill');
    const state = game.match?.state;
    const holder = trigger?.contested ? null : (trigger?.controllingTeam ?? null);
    const contested = trigger?.contested ?? false;
    const ended = state?.phase === 'ended';
    const winner = state?.winner ?? null;

    // Match phase outranks objective control, per the style guide: a venue stops reporting who
    // holds the middle once the match is decided.
    if (ended) target.current.set(winner ? teamEmissive(winner, colorblind) : 0x2de0ff);
    else target.current.set(holder ? teamEmissive(holder, colorblind) : 0x2de0ff);
    current.current.lerp(target.current, Math.min(1, delta * 3));

    // Each state gets its own rhythm as well as its own hue, so the Core is readable with the sound
    // off and by a player who cannot separate the colours.
    let pulse = 0.75 + 0.25 * Math.sin(t * 1.4);
    if (contested) pulse = 0.5 + 0.5 * Math.sin(t * 10);
    else if (ended) pulse = 1;

    coreMaterial.color.copy(current.current);
    coreMaterial.emissive.copy(current.current);
    // Restrained deliberately. A first pass at 1.9 blew the core to a white blob under bloom and
    // the ring structure — the part that makes it readable from any angle — disappeared inside it.
    // The Core should read as a *shape*, not as a light source.
    coreMaterial.emissiveIntensity = (ended ? 2.1 : 1.05) * pulse;

    ringMaterial.color.copy(current.current);
    haloMaterial.color.copy(current.current);
    haloMaterial.opacity = (ended ? 0.2 : 0.10) * pulse;
    beamMaterial.color.copy(current.current);
    beamMaterial.opacity = (holder || ended ? 0.14 : 0.08) * pulse;

    if (coreRef.current) {
      // A slow bob, so it reads as suspended rather than welded in place.
      coreRef.current.position.y = centre.y + Math.sin(t * 0.6) * 0.12;
      coreRef.current.rotation.y = t * 0.15;
      coreRef.current.scale.setScalar(1 + 0.05 * Math.sin(t * 2.2));
    }
    if (haloRef.current) haloRef.current.scale.setScalar(1 + 0.08 * Math.sin(t * 1.1));

    // Rings on different axes and rates. Crossed rotation is what gives the Core parallax and makes
    // it identifiable from any position in the arena.
    const rates = [0.35, -0.24, 0.18];
    for (let i = 0; i < ringRefs.current.length; i++) {
      const ring = ringRefs.current[i];
      if (!ring) continue;
      const speed = rates[i] * (contested ? 3.2 : 1);
      if (i === 0) ring.rotation.z = t * speed;
      else if (i === 1) ring.rotation.x = Math.PI / 2 + t * speed;
      else ring.rotation.y = t * speed;
    }

    if (beamRef.current) {
      beamRef.current.scale.x = 1 + 0.04 * Math.sin(t * 3);
      beamRef.current.scale.z = beamRef.current.scale.x;
    }

    if (lightRef.current) {
      // The arena's focal light. Bright enough to be the brightest thing in the room, which is what
      // makes the middle read as the place the match is about.
      lightRef.current.color.copy(current.current);
      lightRef.current.intensity = (ended ? 620 : holder ? 430 : 300) * pulse;
    }
  });

  return (
    <group name="photon-core" position={[centre.x, 0, centre.z]}>
      {/* Core */}
      <mesh ref={coreRef} geometry={coreGeometry} material={coreMaterial} position={[0, centre.y, 0]} />
      <mesh ref={haloRef} geometry={haloGeometry} material={haloMaterial} position={[0, centre.y, 0]} />

      {/* Containment rings */}
      {[1.2, 1.5, 1.8].map((radius, i) => (
        <mesh
          key={i}
          ref={(node) => {
            ringRefs.current[i] = node;
          }}
          geometry={ringGeometry}
          material={ringMaterial}
          position={[0, centre.y, 0]}
          scale={radius}
        />
      ))}

      {/* Containment cage: four struts rising to the roof structure, so the Core is *mounted*
          rather than floating arbitrarily. A landmark needs to look installed. */}
      {[0, 1, 2, 3].map((i) => {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh
            key={`strut${i}`}
            geometry={strutGeometry}
            material={cageMaterial}
            position={[Math.cos(angle) * 2.1, centre.y + 1.3, Math.sin(angle) * 2.1]}
            rotation={[Math.cos(angle) * 0.12, 0, -Math.sin(angle) * 0.12]}
          />
        );
      })}

      {/* Beam descending to the objective roof — the line that connects the landmark to the ground
          players actually fight over. */}
      <mesh
        ref={beamRef}
        geometry={beamGeometry}
        material={beamMaterial}
        position={[0, centre.y - 1.75, 0]}
      />

      {maxLights > 0 && (
        <pointLight ref={lightRef} position={[0, centre.y - 0.5, 0]} distance={26} decay={2} intensity={300} />
      )}
    </group>
  );
}
