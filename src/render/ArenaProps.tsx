import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { PropSpec } from '@/maps/MapTypes';
import { DEG2RAD } from '@/util/math';
import { useGame } from './GameContext';
import {
  boardSignature,
  createBoardTexture,
  drawBoard,
  isBoardBinding,
  type BoardPalette,
} from './VenueBoards';

/**
 * Animated and interactive set dressing.
 *
 * Split by cost: doors read their openness from the simulation (they affect play, so they must be
 * deterministic), while fans, gates, beacons, signs and machinery animate purely from the render
 * clock. That means the atmosphere costs the 64 Hz tick nothing and automatically runs at display
 * rate rather than tick rate.
 *
 * Materials are shared per prop kind so the whole dressing layer stays in a handful of draw calls.
 */
export function ArenaProps({
  colorblind,
  maxBeaconLights = 2,
}: {
  colorblind: boolean;
  /**
   * Beacons that get a real point light. The rest keep their pulsing emissive sphere, which is what
   * actually reads at a distance — the light itself only matters within a few metres, and each one
   * is evaluated by every lit surface in the scene.
   */
  maxBeaconLights?: number;
}) {
  const game = useGame();
  const props = game.arena.definition.props;
  void colorblind;

  const grouped = useMemo(() => {
    const by = (kind: PropSpec['kind']) => props.filter((p) => p.kind === kind);
    return {
      gates: by('energy_gate'),
      fans: by('fan'),
      beacons: by('warning_light'),
      displays: by('display'),
      machines: by('machine'),
    };
  }, [props]);

  return (
    <group>
      <Doors />
      {grouped.gates.map((spec) => (
        <EnergyGate key={spec.id} spec={spec} />
      ))}
      {grouped.fans.map((spec) => (
        <Fan key={spec.id} spec={spec} />
      ))}
      {grouped.beacons.map((spec, i) => (
        <WarningLight key={spec.id} spec={spec} withLight={i < maxBeaconLights} />
      ))}
      {grouped.displays.map((spec) => (
        <Display key={spec.id} spec={spec} />
      ))}
      {grouped.machines.map((spec) => (
        <Machine key={spec.id} spec={spec} />
      ))}
    </group>
  );
}

/** Sliding doors, positioned each frame from the simulation's openness value. */
function Doors() {
  const game = useGame();
  const doors = game.match.props.doors;
  const refs = useRef<Array<THREE.Group | null>>([]);

  const panelMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x2c3644, roughness: 0.35, metalness: 0.8 }),
    [],
  );
  const edgeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x2de0ff,
        emissive: 0x2de0ff,
        emissiveIntensity: 3,
        toneMapped: false,
      }),
    [],
  );

  useFrame(() => {
    doors.forEach((door, i) => {
      const group = refs.current[i];
      if (!group) return;
      const p = game.match.props.doorOffset(door);
      group.position.set(p.x, p.y, p.z);
    });
  });

  return (
    <group>
      {doors.map((door, i) => (
        <group
          key={door.spec.id}
          ref={(node) => {
            refs.current[i] = node;
          }}
          rotation={[0, (door.spec.rot ?? 0) * DEG2RAD, 0]}
        >
          <mesh material={panelMaterial} castShadow>
            <boxGeometry args={door.spec.s} />
          </mesh>
          {/* Leading edge light strip, so an opening door reads in peripheral vision. */}
          <mesh material={edgeMaterial} position={[door.spec.s[0] / 2 - 0.06, 0, 0]}>
            <boxGeometry args={[0.09, door.spec.s[1] * 0.92, door.spec.s[2] + 0.03]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Emissive curtain with a scrolling scanline. Non-colliding — you walk straight through it. */
function EnergyGate({ spec }: { spec: PropSpec }) {
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const period = spec.period ?? 3;
  const phase = spec.phase ?? 0;

  useFrame(({ clock }) => {
    const material = materialRef.current;
    if (!material) return;
    const t = (clock.elapsedTime / period + phase) % 1;
    // Sharp pulse rather than a sine: it should read as energy discharging, not breathing.
    material.opacity = 0.18 + 0.32 * Math.pow(Math.sin(t * Math.PI), 6);
  });

  return (
    <mesh position={spec.p} rotation={[0, (spec.rot ?? 0) * DEG2RAD, 0]}>
      <planeGeometry args={[spec.s[0], spec.s[1]]} />
      <meshBasicMaterial
        ref={materialRef}
        color={spec.color ?? 0x2de0ff}
        transparent
        opacity={0.25}
        side={THREE.DoubleSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </mesh>
  );
}

/** Rotating extraction fan behind a static housing. */
function Fan({ spec }: { spec: PropSpec }) {
  const bladesRef = useRef<THREE.Group>(null);
  const speed = (Math.PI * 2) / (spec.period ?? 2.5);

  const bladeMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: spec.color ?? 0x4d6070, roughness: 0.6, metalness: 0.7 }),
    [spec.color],
  );
  const housingMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: 0x232a36, roughness: 0.8, metalness: 0.4 }),
    [],
  );

  useFrame((_, delta) => {
    if (bladesRef.current) bladesRef.current.rotation.z += speed * delta;
  });

  return (
    <group position={spec.p} rotation={[0, (spec.rot ?? 0) * DEG2RAD, 0]}>
      <mesh material={housingMaterial}>
        <torusGeometry args={[spec.s[0] / 2, 0.16, 6, 20]} />
      </mesh>
      <group ref={bladesRef}>
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh
            key={i}
            material={bladeMaterial}
            rotation={[0, 0, (i / 5) * Math.PI * 2]}
            position={[0, 0, 0]}
          >
            <boxGeometry args={[spec.s[0] * 0.46, 0.28, 0.06]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Pulsing beacon with a real light. Capped intensity keeps it off the dynamic-light budget. */
function WarningLight({ spec, withLight }: { spec: PropSpec; withLight: boolean }) {
  const lightRef = useRef<THREE.PointLight>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const period = spec.period ?? 2;
  const phase = spec.phase ?? 0;

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({ color: spec.color ?? 0xffd84d, toneMapped: false }),
    [spec.color],
  );

  useFrame(({ clock }) => {
    const t = (clock.elapsedTime / period + phase) % 1;
    const pulse = Math.pow(Math.sin(t * Math.PI), 8);
    if (lightRef.current) lightRef.current.intensity = 12 + pulse * 90;
    if (meshRef.current) meshRef.current.scale.setScalar(0.85 + pulse * 0.4);
  });

  return (
    <group position={spec.p}>
      <mesh ref={meshRef} material={material}>
        <sphereGeometry args={[spec.s[0] / 2, 10, 8]} />
      </mesh>
      {withLight && (
        <pointLight ref={lightRef} color={spec.color ?? 0xffd84d} intensity={12} distance={14} decay={2} />
      )}
    </group>
  );
}

/**
 * Electronic sign drawn to a canvas texture.
 *
 * Two behaviours, chosen by the prop's `text` field:
 *
 *   - a **board binding** (`clock`, `scoreboard`, `killfeed`, `objective`, `roundstatus`) draws
 *     live match state through `VenueBoards`;
 *   - anything else scrolls as a marquee, which is how static branding and sponsor signage is
 *     authored.
 *
 * The arena file only ever names the binding. What a scoreboard *is* — its layout, its colours,
 * whether the last minute runs red — lives in `VenueBoards`, so every future arena inherits the
 * same venue language and a change to how a board reads happens in exactly one place.
 *
 * **Redraws only when the content signature changes.** A scoreboard showing 7-4 costs nothing at
 * all until someone scores; the clock costs one redraw per second. That is what makes a wall of
 * live displays affordable.
 */
function Display({ spec }: { spec: PropSpec }) {
  const game = useGame();
  const binding = isBoardBinding(spec.text) ? spec.text : null;
  const lastDrawn = useRef('');
  const scroll = useRef(0);

  const { canvas, context, texture } = useMemo(() => createBoardTexture(), []);

  useEffect(() => () => texture.dispose(), [texture]);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        map: texture,
        toneMapped: false,
        transparent: true,
      }),
    [texture],
  );

  const accent = `#${(spec.color ?? 0x2de0ff).toString(16).padStart(6, '0')}`;
  const palette: BoardPalette = useMemo(
    () => ({ accent, background: 'rgba(4,10,18,0.92)', dim: 'rgba(140,170,200,0.55)' }),
    [accent],
  );

  useFrame((_, delta) => {
    const state = game.match.state;
    const teams = game.match.settings.teams;

    if (binding) {
      const signature = boardSignature(binding, state, teams);
      if (signature === lastDrawn.current) return;
      lastDrawn.current = signature;
      drawBoard(binding, context, canvas, state, teams, palette);
      texture.needsUpdate = true;
      return;
    }

    // Marquee.
    //
    // The text is rasterised **once** and then scrolled by moving the texture's UV offset. The
    // obvious implementation — redraw the canvas at a shifted x every frame — costs a full canvas
    // clear, a text rasterisation and a 256 KB texture upload *per sign per frame*. Measured, four
    // scrolling signs cost 3.19 ms of a 12.8 ms frame while adding only four draw calls, which is
    // what gave it away: cost with no draw calls behind it is upload cost.
    //
    // Scrolling the offset is free. The canvas holds one copy of the label; `RepeatWrapping` makes
    // it tile seamlessly, so the sign scrolls forever without another upload.
    if (lastDrawn.current !== spec.text) {
      lastDrawn.current = spec.text ?? '';
      const label = spec.text ?? '';

      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = palette.background;
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = accent;
      context.shadowColor = accent;
      context.shadowBlur = 22;
      context.font = 'bold 56px Rajdhani, Segoe UI, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, canvas.width / 2, canvas.height / 2);
      context.shadowBlur = 0;

      texture.wrapS = THREE.RepeatWrapping;
      texture.needsUpdate = true;
    }

    scroll.current = (scroll.current + delta * 0.12) % 1;
    texture.offset.x = scroll.current;
  });

  return (
    <mesh position={spec.p} rotation={[0, (spec.rot ?? 0) * DEG2RAD, 0]} material={material}>
      <planeGeometry args={[spec.s[0], spec.s[1]]} />
    </mesh>
  );
}

/** Ambient machinery: a slow bob and a pulsing vent, to keep the corners from feeling static. */
function Machine({ spec }: { spec: PropSpec }) {
  const groupRef = useRef<THREE.Group>(null);
  const ventRef = useRef<THREE.MeshStandardMaterial>(null);
  const period = spec.period ?? 4;
  const phase = spec.phase ?? 0;

  const bodyMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: spec.color ?? 0x39465a, roughness: 0.65, metalness: 0.6 }),
    [spec.color],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime / period + phase;
    if (groupRef.current) groupRef.current.position.y = spec.p[1] + Math.sin(t * Math.PI * 2) * 0.035;
    if (ventRef.current) ventRef.current.emissiveIntensity = 1.4 + Math.sin(t * Math.PI * 4) * 1.1;
  });

  return (
    <group
      ref={groupRef}
      position={spec.p}
      rotation={[0, (spec.rot ?? 0) * DEG2RAD, 0]}
    >
      <mesh material={bodyMaterial} castShadow receiveShadow>
        <boxGeometry args={spec.s} />
      </mesh>
      <mesh position={[0, 0, spec.s[2] / 2 + 0.02]}>
        <planeGeometry args={[spec.s[0] * 0.62, spec.s[1] * 0.18]} />
        <meshStandardMaterial
          ref={ventRef}
          color={0x2de0ff}
          emissive={0x2de0ff}
          emissiveIntensity={1.6}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
