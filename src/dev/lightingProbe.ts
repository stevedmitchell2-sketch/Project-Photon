import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LIGHTING, LUMINANCE_TARGETS } from '@/config/lighting';
import type { BuiltArena } from '@/maps/MapBuilder';
import type { SurfaceKind } from '@/maps/MapTypes';
import { forwardFromLook } from '@/util/math';

/**
 * Offscreen lighting validation for an arena.
 *
 * Renders the arena from a given eye pose into a render target, reads the pixels back and reports
 * luminance statistics. This answers the one question a screenshot answers — "can a player
 * actually see this room?" — but numerically, so it can run without a visible canvas and can be
 * asserted against in CI.
 *
 * It exists because lighting regressions are silent: nothing throws when a metallic floor samples
 * a missing environment map, or when a ceiling occludes the key light, or when light intensities
 * are written in the pre-r155 unit scale. The arena just goes black, and you only find out by
 * looking. Each new arena in M3 gets checked through here before it is called done.
 */

export interface LuminanceReport {
  /** Mean perceptual luminance across the frame, 0..1. */
  mean: number;
  median: number;
  p05: number;
  p95: number;
  /** Fraction of pixels below 2% luminance — effectively black. */
  blackFraction: number;
  /** Fraction above 90% — blown out. */
  clippedFraction: number;
  /** Distinct-ish tones present, a rough proxy for whether the image has structure. */
  distinctBuckets: number;
  verdict: 'black' | 'too-dark' | 'good' | 'washed-out';
}

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

export interface ProbeOptions {
  width?: number;
  height?: number;
  fov?: number;
  exposure?: number;
  ambientIntensity?: number;
  environmentIntensity?: number;
  /** Set false to reproduce what the scene looks like with IBL missing. */
  useEnvironment?: boolean;
}

/** Renders the arena from `position` looking along `yaw`/`pitch` and reports luminance. */
export function probeArenaLighting(
  arena: BuiltArena,
  position: { x: number; y: number; z: number },
  yaw: number,
  pitch: number,
  options: ProbeOptions = {},
): LuminanceReport {
  const {
    width = 320,
    height = 180,
    fov = 95,
    exposure = LIGHTING.toneMappingExposure,
    ambientIntensity = LIGHTING.ambientIntensity,
    environmentIntensity = LIGHTING.environmentIntensity,
    useEnvironment = true,
  } = options;

  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const definition = arena.definition;
  const palette = definition.palette;

  scene.background = new THREE.Color(palette.fog);
  scene.fog = new THREE.FogExp2(palette.fog, definition.fogDensity);

  let pmrem: THREE.PMREMGenerator | null = null;
  let envTarget: THREE.WebGLRenderTarget | null = null;
  if (useEnvironment) {
    pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    envTarget = pmrem.fromScene(room, 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = environmentIntensity;
  }

  scene.add(new THREE.AmbientLight(palette.ambient, ambientIntensity));
  scene.add(new THREE.HemisphereLight(palette.ambient, palette.floor, LIGHTING.hemisphereIntensity));
  for (const light of definition.lights) {
    const point = new THREE.PointLight(light.color, light.intensity, light.distance, 2);
    point.position.set(light.p[0], light.p[1], light.p[2]);
    scene.add(point);
  }

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const disposables: Array<{ dispose(): void }> = [geometry];

  for (const batch of arena.batches) {
    const surface = SURFACE_MATERIAL[batch.kind];
    const material = new THREE.MeshStandardMaterial({
      color: batch.color,
      emissive: batch.glow > 0 ? batch.color : 0x000000,
      emissiveIntensity: batch.glow,
      roughness: surface.roughness,
      metalness: surface.metalness,
      transparent: batch.kind === 'glass',
      opacity: batch.kind === 'glass' ? 0.24 : 1,
      envMapIntensity: 0.8,
    });
    disposables.push(material);

    const mesh = new THREE.InstancedMesh(geometry, material, batch.instances.length);
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();
    batch.instances.forEach((instance, i) => {
      pos.set(instance.position[0], instance.position[1], instance.position[2]);
      euler.set(instance.rotation[0], instance.rotation[1], instance.rotation[2], 'YXZ');
      quat.setFromEuler(euler);
      scale.set(instance.scale[0], instance.scale[1], instance.scale[2]);
      matrix.compose(pos, quat, scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    disposables.push(mesh);
  }

  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.05, 220);
  camera.position.set(position.x, position.y, position.z);
  const forward = forwardFromLook(yaw, pitch);
  camera.lookAt(position.x + forward.x, position.y + forward.y, position.z + forward.z);

  const target = new THREE.WebGLRenderTarget(width, height, {
    colorSpace: THREE.SRGBColorSpace,
  });
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);

  const pixels = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
  renderer.setRenderTarget(null);

  const report = analyse(pixels);

  // Tear everything down: probes are run in loops over spawn points and would otherwise leak
  // a WebGL context per call, which browsers cap at around 16.
  target.dispose();
  envTarget?.dispose();
  pmrem?.dispose();
  for (const item of disposables) item.dispose();
  renderer.dispose();
  renderer.forceContextLoss();

  return report;
}

function analyse(pixels: Uint8Array): LuminanceReport {
  const count = pixels.length / 4;
  const lum = new Float32Array(count);
  const buckets = new Set<number>();

  for (let i = 0; i < count; i++) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;
    // Rec. 709 luma — matches how a viewer perceives brightness.
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum[i] = l;
    buckets.add(Math.round(l * 40));
  }

  const sorted = Float32Array.from(lum).sort();
  const at = (q: number) => sorted[Math.min(count - 1, Math.floor(q * count))];
  const mean = lum.reduce((s, v) => s + v, 0) / count;

  let black = 0;
  let clipped = 0;
  for (let i = 0; i < count; i++) {
    if (lum[i] < 0.02) black++;
    else if (lum[i] > 0.9) clipped++;
  }
  const blackFraction = black / count;
  const clippedFraction = clipped / count;

  let verdict: LuminanceReport['verdict'];
  if (blackFraction > 0.7 || mean < LUMINANCE_TARGETS.blackFloor) verdict = 'black';
  else if (mean < LUMINANCE_TARGETS.playableMin) verdict = 'too-dark';
  else if (clippedFraction > 0.35) verdict = 'washed-out';
  else verdict = 'good';

  return {
    mean: round(mean),
    median: round(at(0.5)),
    p05: round(at(0.05)),
    p95: round(at(0.95)),
    blackFraction: round(blackFraction),
    clippedFraction: round(clippedFraction),
    distinctBuckets: buckets.size,
    verdict,
  };
}

const round = (v: number): number => Math.round(v * 1000) / 1000;
