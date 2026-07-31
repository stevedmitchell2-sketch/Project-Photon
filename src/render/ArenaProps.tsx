import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { PropSpec } from '@/maps/MapTypes';
import { DEG2RAD } from '@/util/math';
import { useGame } from './GameContext';

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
 * `text: 'clock'` binds the panel to the live match timer; anything else scrolls as a marquee. The
 * canvas is only redrawn when the rendered string actually changes, so a clock panel costs one
 * redraw per second rather than one per frame.
 */
function Display({ spec }: { spec: PropSpec }) {
  const game = useGame();
  const isClock = spec.text === 'clock';
  const lastDrawn = useRef('');
  const scroll = useRef(0);

  const { canvas, context, texture } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    return { canvas: c, context: ctx, texture: tex };
  }, []);

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

  const color = `#${(spec.color ?? 0x2de0ff).toString(16).padStart(6, '0')}`;

  useFrame((_, delta) => {
    let label: string;
    if (isClock) {
      const remaining = Math.max(0, game.match.state.timeRemaining);
      const s = Math.floor(remaining);
      label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      // Redraw only on a second boundary.
      if (label === lastDrawn.current) return;
    } else {
      scroll.current = (scroll.current + delta * 60) % 2048;
      label = spec.text ?? '';
    }

    lastDrawn.current = label;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(4,10,18,0.92)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 22;

    if (isClock) {
      context.font = 'bold 84px Rajdhani, Segoe UI, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, canvas.width / 2, canvas.height / 2);
    } else {
      context.font = 'bold 56px Rajdhani, Segoe UI, sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      const width = context.measureText(label).width + 120;
      const x = -(scroll.current % width);
      context.fillText(label, x, canvas.height / 2);
      context.fillText(label, x + width, canvas.height / 2);
    }
    context.shadowBlur = 0;
    texture.needsUpdate = true;
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
