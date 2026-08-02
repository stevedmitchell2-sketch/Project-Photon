import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { GraphicsSettings } from '@/config/graphics';
import { LIGHTING } from '@/config/lighting';
import type { AccessibilitySettings } from '@/state/settingsStore';
import { DEG2RAD } from '@/util/math';
import { ArenaEnvironment } from './ArenaEnvironment';
import { ArenaArchitecture } from './ArenaArchitecture';
import { ArenaMesh } from './ArenaMesh';
import { ArenaVenue } from './ArenaVenue';
import { ArenaProps } from './ArenaProps';
import { useGame } from './GameContext';
import { ImpactFX } from './ImpactFX';
import { PhotonCore } from './PhotonCore';
import { PlayerAvatars } from './PlayerAvatars';
import { ProjectileRenderer } from './ProjectileRenderer';
import { RendererStats } from './RendererStats';
import { TeamIdentity } from './TeamIdentity';
import { ViewModel } from './ViewModel';

interface Props {
  graphics: GraphicsSettings;
  accessibility: AccessibilitySettings;
}

export function Scene({ graphics, accessibility }: Props) {
  const game = useGame();
  const arena = game.arena;
  const palette = arena.definition.palette;

  // Dynamic lights are the first thing to go in Performance Mode; optional lights drop first.
  const lights = useMemo(() => {
    const all = arena.definition.lights;
    const required = all.filter((l) => !l.optional);
    const optional = all.filter((l) => l.optional);
    return [...required, ...optional].slice(0, graphics.maxDynamicLights);
  }, [arena, graphics.maxDynamicLights]);

  return (
    <>
      <CameraRig graphics={graphics} reduceShake={accessibility.reduceCameraShake} />
      <RendererStats />

      <color attach="background" args={[palette.fog]} />
      {graphics.fogEnabled && (
        <fogExp2 attach="fog" args={[palette.fog, arena.definition.fogDensity]} />
      )}

      <ArenaEnvironment
        intensity={
          graphics.preset === 'performance'
            ? LIGHTING.environmentIntensityPerformance
            : LIGHTING.environmentIntensity
        }
      />

      {/* Fill light is deliberately restrained. Ambient is global and cannot be masked per-room,
          so a generous ambient term makes an unlit space impossible — the dark room reads exactly
          as bright as the lit floor. Keeping fill low and letting the arena's own fixtures do the
          work is what gives the level light and shade. Image-based lighting carries the rest. */}
      <ambientLight color={palette.ambient} intensity={LIGHTING.ambientIntensity} />
      <hemisphereLight args={[palette.ambient, palette.floor, LIGHTING.hemisphereIntensity]} />

      {/* One shadow-casting key light: shadow maps are the most expensive light feature by far. */}
      {graphics.shadows && (
        <directionalLight
          position={LIGHTING.keyLightPosition as unknown as [number, number, number]}
          intensity={LIGHTING.keyLightIntensity}
          color={LIGHTING.keyLightColor}
          castShadow
          shadow-mapSize-width={graphics.shadowMapSize}
          shadow-mapSize-height={graphics.shadowMapSize}
          shadow-camera-near={1}
          shadow-camera-far={90}
          shadow-camera-left={-38}
          shadow-camera-right={38}
          shadow-camera-top={38}
          shadow-camera-bottom={-38}
          shadow-bias={-0.0012}
          shadow-normalBias={0.03}
        />
      )}

      {lights.map((light, i) => (
        <pointLight
          key={i}
          position={light.p}
          color={light.color}
          intensity={light.intensity}
          distance={light.distance}
          decay={2}
        />
      ))}

      <ArenaMesh arena={arena} shadows={graphics.shadows} />
      <ArenaArchitecture />
      <ArenaVenue maxLights={graphics.maxDynamicLights} />
      <PhotonCore
        colorblind={accessibility.colorblindPalette}
        maxLights={graphics.maxDynamicLights}
      />
      <TeamIdentity
        colorblind={accessibility.colorblindPalette}
        maxLights={graphics.maxDynamicLights}
      />
      <ArenaProps
        colorblind={accessibility.colorblindPalette}
        maxBeaconLights={graphics.preset === 'performance' ? 0 : 2}
      />
      <PlayerAvatars
        colorblind={accessibility.colorblindPalette}
        enemyOutlines={accessibility.enemyOutlines}
        localTeam={game.localActor?.team ?? 'red'}
      />
      <ProjectileRenderer colorblind={accessibility.colorblindPalette} />
      <ImpactFX colorblind={accessibility.colorblindPalette} maxLights={graphics.maxDynamicLights} />
      <ViewModel colorblind={accessibility.colorblindPalette} />

      {graphics.volumetricLight && <LightShafts />}
    </>
  );
}

/**
 * Drives the camera from the interpolated view state produced by the engine.
 *
 * Rotation order is YXZ so yaw, pitch and roll compose the way a head does — applying roll last
 * keeps leaning from dragging the aim point off centre.
 */
function CameraRig({ graphics, reduceShake }: { graphics: GraphicsSettings; reduceShake: boolean }) {
  const game = useGame();
  const { camera } = useThree();
  const shakeSeed = useRef(Math.random() * 1000);

  useEffect(() => {
    camera.near = 0.05;
    camera.far = 220;
    camera.rotation.order = 'YXZ';
    camera.updateProjectionMatrix();
  }, [camera]);

  useFrame((_, delta) => {
    const view = game.view;
    const perspective = camera as THREE.PerspectiveCamera;

    camera.position.set(view.position.x, view.position.y, view.position.z);

    let pitch = view.pitch;
    let yaw = view.yaw;
    if (!reduceShake && view.shake > 0.001) {
      // Trig-based shake rather than random: it is smooth, so it never looks like frame stutter.
      shakeSeed.current += delta * 42;
      const amount = view.shake * 0.008;
      pitch += Math.sin(shakeSeed.current * 1.7) * amount;
      yaw += Math.sin(shakeSeed.current * 2.3) * amount;
    }
    camera.rotation.set(pitch, yaw, view.roll, 'YXZ');

    // FOV: base setting, narrowed by ADS, widened slightly by speed for a sense of pace.
    const speedFov = Math.min(6, Math.max(0, view.speed - 5.2) * 1.1);
    const targetFov = graphics.fov * view.fovScale + speedFov;
    if (Math.abs(perspective.fov - targetFov) > 0.01) {
      perspective.fov += (targetFov - perspective.fov) * Math.min(1, delta * 14);
      perspective.updateProjectionMatrix();
    }
  });

  return null;
}

/**
 * Volumetric light shafts.
 *
 * Implemented as additive cones under the arena's key lights rather than a raymarched pass: at
 * this light count it is visually equivalent from player eye height and costs a handful of
 * triangles instead of a full-screen march.
 */
/** Scratch vectors for the shaft fade, hoisted so the per-frame path allocates nothing. */
const cameraPosition = new THREE.Vector3();
const shaftPosition = new THREE.Vector3();
const toShaft = new THREE.Vector3();
const viewDirection = new THREE.Vector3();

function LightShafts() {
  const game = useGame();
  const shafts = useMemo(
    () => game.arena.definition.lights.filter((l) => !l.optional && l.p[1] > 5).slice(0, 6),
    [game],
  );
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock, camera }) => {
    const group = groupRef.current;
    if (!group) return;
    const t = clock.elapsedTime;

    // Fade by view angle.
    //
    // A real shaft is scattered light: you see it strongly when looking across it and barely at all
    // when looking along it. A fixed-opacity cone does the opposite of what the eye expects, and at
    // eye height it reads as a solid object sitting in the room — the single most intrusive element
    // on screen in the Sprint 7 playtest, dominating the centre of the frame from most positions.
    //
    // Weighting opacity by how perpendicular the shaft is to the view direction costs one dot
    // product per shaft and removes the artefact: shafts stay visible obliquely, where they read as
    // atmosphere, and drop away when stared at, where they read as geometry.
    group.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.MeshBasicMaterial;

      camera.getWorldPosition(cameraPosition);
      mesh.getWorldPosition(shaftPosition);
      toShaft.subVectors(shaftPosition, cameraPosition);
      const distance = toShaft.length() || 1;
      toShaft.divideScalar(distance);
      camera.getWorldDirection(viewDirection);

      // 0 when looking straight at the shaft, 1 when it is across the view.
      const across = 1 - Math.abs(toShaft.dot(viewDirection));
      // Also fade the nearest shafts, which are the ones that fill the frame.
      const proximity = Math.min(1, distance / 6);

      const breathing = 0.022 + 0.008 * Math.sin(t * 0.7 + i);
      material.opacity = breathing * (0.25 + 0.75 * across) * proximity;
      mesh.visible = material.opacity > 0.001;
    });
  });

  return (
    <group ref={groupRef}>
      {shafts.map((light, i) => (
        <mesh key={i} position={[light.p[0], light.p[1] / 2, light.p[2]]} rotation={[Math.PI, 0, 0]}>
          {/* Radius is a fraction of the fixture's throw, capped. Scaling it off `distance`
              unclamped produced 13 m cones that filled the screen from any position on the deck. */}
          <coneGeometry args={[Math.min(2.4, light.distance * 0.06), light.p[1], 14, 1, true]} />
          <meshBasicMaterial
            color={light.color}
            transparent
            opacity={0.025}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

export const defaultFovRadians = (fovDegrees: number): number => fovDegrees * DEG2RAD;
