import * as THREE from 'three';

/**
 * Procedural texture library.
 *
 * Photon ships no image assets. Every surface in the game has, until now, been a flat colour with a
 * single roughness value, and that is the single biggest reason the arena reads as graybox: real
 * surfaces vary. A brushed panel catches light in streaks, a composite floor has a weave, an
 * anti-slip walkway has a grip pattern. Without that variation, a wall is a solid-colour polygon no
 * matter how well it is lit.
 *
 * These generate that variation on a canvas at load and hand it to the material library as
 * roughness and bump maps. Two consequences worth understanding before adding more:
 *
 *   1. **They cost fragment samples.** The frame is fragment-bound — Sprint 8 measured
 *      `maxDynamicLights` 8 → 0 as worth 2.3 ms of a 12.3 ms frame — so every extra map is per-pixel
 *      work on a budget that is already over. The library therefore shares a small set of textures
 *      across many materials rather than authoring one per surface, and prefers roughness variation
 *      (one channel, cheap, and what actually sells metal) over full normal maps.
 *   2. **They are deterministic.** Generated from a fixed seed so a surface looks the same in every
 *      session and in every screenshot. A texture that changed between runs would make visual
 *      regressions impossible to spot.
 *
 * Everything is greyscale and single-channel by intent. Colour comes from the material; these
 * supply *structure*.
 *
 * ## Roughness maps multiply
 *
 * The one thing to get right here, and it was got wrong first. Three.js multiplies the map's green
 * channel into the material's `roughness` — it does not replace it. A mid-grey map therefore *halves*
 * the roughness, and the first version of this library drew everything around 40% grey, which turned
 * every wall in the arena into a semi-polished surface and washed the whole scene out.
 *
 * **These textures live in the 0.7-1.0 band and modulate downward.** The material owns the intended
 * roughness; the texture only says where a surface is locally smoother.
 */

/** Texture resolution. 256 is ample for roughness breakup and keeps the whole library under 1 MB. */
const SIZE = 256;

/** Deterministic value noise, so surfaces are identical across sessions. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function makeCanvas(): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  return { canvas, context: canvas.getContext('2d')! };
}

function finish(canvas: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

/**
 * Brushed metal: fine directional streaks.
 *
 * The defining property is *anisotropy* — the streaks run one way, which is why a brushed panel
 * looks different as you walk past it and a flat grey one does not. Drawn as horizontal lines of
 * varying darkness rather than noise, because unstructured noise reads as dirt, and this arena is
 * maintained.
 */
export function brushedMetalRoughness(repeat = 3): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas();
  const rand = seededRandom(0x5eed01);

  context.fillStyle = '#f0f0f0';
  context.fillRect(0, 0, SIZE, SIZE);

  for (let i = 0; i < 1400; i++) {
    const y = rand() * SIZE;
    const length = 30 + rand() * 180;
    const x = rand() * SIZE;
    // Streaks are locally *smoother* than the surrounding metal, which is what catches the light.
    const shade = 196 + Math.floor(rand() * 52);
    context.strokeStyle = `rgb(${shade},${shade},${shade})`;
    context.lineWidth = rand() < 0.85 ? 1 : 2;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + length, y + (rand() - 0.5) * 1.5);
    context.stroke();
  }
  return finish(canvas, repeat);
}

/**
 * Carbon fibre: a woven twill.
 *
 * Two interleaved sets of slats. Used on load-bearing and equipment surfaces — the weapon body,
 * cover, pillars — because it reads as an engineered composite rather than painted metal, which is
 * the difference between "sports equipment" and "military hardware".
 */
export function carbonWeaveRoughness(repeat = 8): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas();
  const cell = SIZE / 8;

  context.fillStyle = '#e2e2e2';
  context.fillRect(0, 0, SIZE, SIZE);

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const horizontal = (x + y) % 2 === 0;
      const shade = horizontal ? 206 : 236;
      context.fillStyle = `rgb(${shade},${shade},${shade})`;
      context.fillRect(x * cell, y * cell, cell, cell);

      // Slat highlights, perpendicular per cell — the weave.
      context.strokeStyle = `rgba(255,255,255,0.10)`;
      context.lineWidth = 1;
      for (let i = 2; i < cell; i += 4) {
        context.beginPath();
        if (horizontal) {
          context.moveTo(x * cell, y * cell + i);
          context.lineTo(x * cell + cell, y * cell + i);
        } else {
          context.moveTo(x * cell + i, y * cell);
          context.lineTo(x * cell + i, y * cell + cell);
        }
        context.stroke();
      }
    }
  }
  return finish(canvas, repeat);
}

/**
 * Anti-slip flooring: a raised grip pattern.
 *
 * Doubles as the bump map, because the grip pattern is genuinely geometric — this is one of the few
 * places where a height signal earns its sample.
 */
export function antiSlipRoughness(repeat = 10): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas();
  const spacing = SIZE / 16;

  context.fillStyle = '#f2f2f2';
  context.fillRect(0, 0, SIZE, SIZE);

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // Offset every other row, which is how real grip plate is laid out.
      const cx = x * spacing + (y % 2 ? spacing * 0.5 : 0) + spacing * 0.5;
      const cy = y * spacing + spacing * 0.5;
      const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, spacing * 0.34);
      // Grip studs are worn smoother than the plate between them.
      gradient.addColorStop(0, '#b8b8b8');
      gradient.addColorStop(1, '#f2f2f2');
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(cx, cy, spacing * 0.34, 0, Math.PI * 2);
      context.fill();
    }
  }
  return finish(canvas, repeat);
}

/**
 * Competition flooring: large panel seams with a subtle sheen variation per panel.
 *
 * The seams are the point. A sports floor is *laid*, in panels, and the grid of seams is what tells
 * the eye how big the room is — a featureless floor gives no scale reference at all, which is
 * exactly the graybox problem.
 */
export function panelSeamRoughness(repeat = 4): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas();
  const rand = seededRandom(0x5eed02);
  const cells = 4;
  const cell = SIZE / cells;

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      // Panels are polished to slightly different degrees, as laid panels are.
      const shade = 214 + Math.floor(rand() * 28);
      context.fillStyle = `rgb(${shade},${shade},${shade})`;
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  // Seams: fully rough, so they never catch a highlight and always read as a recess.
  context.strokeStyle = '#ffffff';
  context.lineWidth = 3;
  for (let i = 0; i <= cells; i++) {
    context.beginPath();
    context.moveTo(i * cell, 0);
    context.lineTo(i * cell, SIZE);
    context.moveTo(0, i * cell);
    context.lineTo(SIZE, i * cell);
    context.stroke();
  }
  return finish(canvas, repeat);
}

/**
 * Hex panel: the arena's signature floor and wall motif.
 *
 * Hexagons are the one geometric flourish the style guide allows itself. They read as engineered
 * rather than decorative, tile without a visible grid direction, and give Photon a recognisable
 * silhouette in a screenshot — which is the whole point of a signature motif.
 */
export function hexPanelRoughness(repeat = 6): THREE.CanvasTexture {
  const { canvas, context } = makeCanvas();
  const radius = SIZE / 8;
  const height = Math.sqrt(3) * radius;

  context.fillStyle = '#dcdcdc';
  context.fillRect(0, 0, SIZE, SIZE);

  context.strokeStyle = '#ffffff';
  context.lineWidth = 2;

  for (let row = -1; row * height * 0.5 < SIZE + height; row++) {
    for (let col = -1; col * radius * 1.5 < SIZE + radius; col++) {
      const cx = col * radius * 1.5;
      const cy = row * height + (col % 2 ? height * 0.5 : 0);
      context.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const px = cx + Math.cos(angle) * radius * 0.92;
        const py = cy + Math.sin(angle) * radius * 0.92;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.stroke();
    }
  }
  return finish(canvas, repeat);
}

/**
 * Every texture the library uses, built once.
 *
 * Built lazily on first request and cached, because the arena is constructed before the renderer
 * exists in some code paths and `document` is not available under Node — the headless simulation
 * and the dedicated server must never touch this module.
 */
let cache: PhotonTextureSet | null = null;

export interface PhotonTextureSet {
  brushedMetal: THREE.CanvasTexture;
  carbonWeave: THREE.CanvasTexture;
  antiSlip: THREE.CanvasTexture;
  panelSeam: THREE.CanvasTexture;
  hexPanel: THREE.CanvasTexture;
}

export function photonTextures(): PhotonTextureSet {
  if (cache) return cache;
  cache = {
    brushedMetal: brushedMetalRoughness(),
    carbonWeave: carbonWeaveRoughness(),
    antiSlip: antiSlipRoughness(),
    panelSeam: panelSeamRoughness(),
    hexPanel: hexPanelRoughness(),
  };
  return cache;
}

export function disposePhotonTextures(): void {
  if (!cache) return;
  for (const texture of Object.values(cache)) texture.dispose();
  cache = null;
}
