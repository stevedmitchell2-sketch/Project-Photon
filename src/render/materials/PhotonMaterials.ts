import * as THREE from 'three';
import type { SurfaceKind } from '@/maps/MapTypes';
import { photonTextures } from './PhotonTextures';

/**
 * The Photon material library.
 *
 * One place that decides what every surface in the game is *made of*. Before this, materials were
 * assembled inline wherever they were needed — a roughness and a metalness picked per call site —
 * which meant the same conceptual surface had three slightly different definitions in three files
 * and nothing could be changed globally.
 *
 * A material here is a **named physical substance**, not a colour. `brushedAluminium` is a
 * substance; "the wall material" is not, because a wall might be aluminium or composite depending
 * on what the arena says it is. Colour is supplied by the caller, from the arena palette or a team.
 *
 * ## The design constraints this library works under
 *
 * - **The frame is fragment-bound.** Sprint 8 measured lights at 2.3 ms of a 12.3 ms frame; texture
 *   samples land on the same budget. Materials therefore share a small texture set, use roughness
 *   maps rather than normal maps wherever roughness alone carries the read, and are cached so the
 *   renderer compiles one shader program per substance rather than one per object.
 * - **Readability outranks realism.** Every substance stays within the mid-tone band the style guide
 *   defines. A genuinely photoreal dark metal would be correct and would also make a player
 *   standing in front of it invisible.
 * - **The arena is lit for a specific material response.** Metalness and roughness here are close to
 *   the values the lighting was tuned against, deliberately. A first pass used physically nicer
 *   numbers — aluminium at 0.82 metalness, composite at 0.05 — and the whole arena lost contrast:
 *   walls went from mid-dark to pale grey, because low metalness shows more diffuse albedo and the
 *   environment map lifted the rest. The texture variation is the win here; the lighting response
 *   was already correct and did not need changing.
 * - **Emissive is a signal, not a finish.** Substances that glow do so because they are carrying
 *   information — team colour, energy state, guidance. Nothing glows for decoration.
 *
 * ## Caching
 *
 * Materials are cached by (substance, colour, options). Three.js compiles a shader program per
 * unique material configuration, so an uncached library would multiply program count by object
 * count — which is both a load-time cost and a per-frame state-change cost.
 */


/**
 * ## Normal maps (Batch 1 of the visual overhaul)
 *
 * Every roughness map above now has a matching normal map, derived from the same canvas by
 * `heightToNormal`. This is the change that stops 915 brushes reading as cubes.
 *
 * Roughness varies how a surface *scatters* light; it never varies how the surface *faces*. A panel
 * seam painted only into roughness has no shadow, no highlight break and no relief at a grazing
 * angle — which is exactly the angle a player sees a wall from while running past it. The original
 * pass chose roughness-only deliberately for fill rate, and that choice is the single largest reason
 * the arena looks assembled rather than manufactured.
 *
 * `normalScale` is per-substance rather than global. Relief tuned to read on a wall at 20 m looks
 * like corrugation on a handrail at arm's length, so brushed metal is held near 0.55 while a panel
 * seam runs at 1.0.
 *
 * Cost is one texture fetch plus the tangent transform per fragment. On a fragment-bound frame that
 * is not free, and it is measured rather than assumed.
 */

export type Substance =
  | 'brushedAluminium'
  | 'titanium'
  | 'carbonFibre'
  | 'compositePolymer'
  | 'rubberGrip'
  | 'antiSlipFloor'
  | 'competitionFloor'
  | 'hexPanel'
  | 'temperedGlass'
  | 'energyGlass'
  | 'ledStrip'
  | 'holoPanel'
  | 'paintedAlloy'
  | 'energyEmitter'
  | 'graphite'
  | 'structuralCeramic';

export interface SubstanceOptions {
  /** Base colour. Substances that carry team or arena colour need this; others ignore it. */
  color?: number;
  /** Emissive colour for the illuminated substances. Defaults to `color`. */
  emissive?: number;
  /** Multiplier on the substance's natural emissive strength. */
  glow?: number;
  /** Set false for view-model scale surfaces — see the note on solid angle below. */
  worldScale?: boolean;
}

interface SubstanceRecipe {
  build(options: Required<Pick<SubstanceOptions, 'color'>> & SubstanceOptions): THREE.Material;
}

const textures = () => photonTextures();

/**
 * Emissive strength is not scale-invariant.
 *
 * The most-repeated mistake in this renderer. What matters is the solid angle a surface occupies,
 * not what it is made of: a value tuned on a wall 10 m away is wrong on a view model 0.4 m from the
 * near plane, where it reads as a glowing slab once bloom is applied. Substances used on the weapon
 * pass `worldScale: false` and get roughly a fifth of the world value.
 */
const emissiveFor = (base: number, options: SubstanceOptions): number =>
  base * (options.glow ?? 1) * (options.worldScale === false ? 0.2 : 1);

const RECIPES: Record<Substance, SubstanceRecipe> = {
  /** The arena's default structural metal. Directional streaks, moderate reflectivity. */
  brushedAluminium: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().brushedMetal,
        normalMap: textures().brushedMetalNormal,
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughness: 0.5,
        metalness: 0.46,
      }),
  },

  /**
   * Graphite. Dark, technical, barely reflective — the structural framing the arena is built from.
   *
   * Deliberately the darkest substance in the set. Framing only reads as framing if it is a value
   * step away from the panel it surrounds; matched in tone it just adds geometry, and the wall goes
   * back to looking like one slab with extra bumps.
   */
  graphite: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().brushedMetal,
        normalMap: textures().brushedMetalNormal,
        normalScale: new THREE.Vector2(0.40, 0.40),
        roughness: 0.74,
        metalness: 0.38,
      }),
  },

  /**
   * Structural ceramic. Clean, satin, engineered — the premium surface of the venue.
   *
   * Low roughness variation and almost no metalness, so it holds a soft directional gradient across
   * a large panel instead of breaking into noise. This is what makes the arena read as a built
   * facility rather than a warehouse.
   */
  structuralCeramic: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().panelSeam,
        normalMap: textures().panelSeamNormal,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.55,
        metalness: 0.08,
      }),
  },

  /** Structural, darker and less reflective than aluminium. Ribs, trusses, frames. */
  titanium: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().brushedMetal,
        normalMap: textures().brushedMetalNormal,
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughness: 0.62,
        metalness: 0.6,
      }),
  },

  /** Engineered composite. Equipment, cover, weapon bodies — sports kit, not armour plate. */
  carbonFibre: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().carbonWeave,
        normalMap: textures().carbonWeaveNormal,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughness: 0.6,
        metalness: 0.34,
      }),
  },

  /** Matte structural plastic. The bulk of non-structural surfaces; deliberately unremarkable. */
  compositePolymer: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().panelSeam,
        normalMap: textures().panelSeamNormal,
        normalScale: new THREE.Vector2(1.0, 1.0),
        roughness: 0.88,
        metalness: 0.16,
      }),
  },

  /** Grips and pads. Almost no specular — it is what the eye reads as "hand goes here". */
  rubberGrip: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().antiSlip,
        normalMap: textures().antiSlipNormal,
        normalScale: new THREE.Vector2(0.7, 0.7),
        roughness: 0.95,
        metalness: 0,
      }),
  },

  /** Walkways, ramps, catwalk decking. Grip pattern doubles as a bump signal. */
  antiSlipFloor: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().antiSlip,
        normalMap: textures().antiSlipNormal,
        normalScale: new THREE.Vector2(0.7, 0.7),
        bumpMap: textures().antiSlip,
        bumpScale: 0.015,
        roughness: 0.55,
        metalness: 0.66,
      }),
  },

  /** The playing surface: laid panels with visible seams, polished but not mirrored. */
  competitionFloor: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().panelSeam,
        normalMap: textures().panelSeamNormal,
        normalScale: new THREE.Vector2(1.0, 1.0),
        roughness: 0.3,
        metalness: 0.64,
      }),
  },

  /** The signature motif. Used sparingly — a floor of it everywhere would be noise. */
  hexPanel: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().hexPanel,
        normalMap: textures().hexPanelNormal,
        normalScale: new THREE.Vector2(0.9, 0.9),
        bumpMap: textures().hexPanel,
        bumpScale: 0.008,
        roughness: 0.4,
        metalness: 0.55,
      }),
  },

  /**
   * Observation glazing.
   *
   * Deliberately *not* `MeshPhysicalMaterial` with `transmission`, which was tried first. Real
   * transmission forces Three.js to render a separate transmission pass of the whole scene, which
   * on a frame already 30% over its GPU budget is indefensible for a few window panels — and it
   * misbehaves on instanced meshes, which is how all arena glass is drawn.
   *
   * Cheap transparency with a strong specular response sells glass perfectly well at the distances
   * it is seen from here, and costs one blend instead of a scene re-render.
   */
  temperedGlass: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughness: 0.08,
        metalness: 0.1,
        transparent: true,
        opacity: 0.26,
        depthWrite: false,
      }),
  },

  /**
   * Energy fields: barriers, gates, shield emitters.
   *
   * Additive and depth-write-off, so overlapping fields accumulate rather than z-fighting. This is
   * the substance with the highest overdraw cost in the library — use it on thin surfaces.
   */
  energyGlass: {
    build: (o) =>
      new THREE.MeshBasicMaterial({
        color: o.emissive ?? o.color,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
  },

  /** Guidance and trim lighting. Unlit so it reads at full strength in a dark corridor. */
  ledStrip: {
    build: (o) =>
      new THREE.MeshBasicMaterial({
        color: o.emissive ?? o.color,
        toneMapped: false,
      }),
  },

  /** Holographic display faces. Emissive and slightly transmissive, never solid. */
  holoPanel: {
    build: (o) =>
      new THREE.MeshBasicMaterial({
        color: o.emissive ?? o.color,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
  },

  /** Painted structural alloy. Arena furniture, housings, brackets. */
  paintedAlloy: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        roughnessMap: textures().panelSeam,
        normalMap: textures().panelSeamNormal,
        normalScale: new THREE.Vector2(1.0, 1.0),
        roughness: 0.56,
        metalness: 0.42,
      }),
  },

  /**
   * Live energy: emitter tips, charge cells, weapon cores.
   *
   * A lit material rather than an unlit one, so it still receives some environment response and
   * does not read as a flat sticker — the difference between a glowing part and a painted one.
   */
  energyEmitter: {
    build: (o) =>
      new THREE.MeshStandardMaterial({
        color: o.color,
        emissive: o.emissive ?? o.color,
        emissiveIntensity: emissiveFor(2.2, o),
        roughness: 0.28,
        metalness: 0.1,
        toneMapped: false,
      }),
  },
};

const cache = new Map<string, THREE.Material>();

/**
 * Returns a shared material for a substance.
 *
 * Shared, not copied: two objects asking for the same substance and colour get the same instance,
 * which is what lets the renderer batch them and keeps the shader program count flat.
 *
 * **Never mutate a returned material.** Anything that needs to animate a property — a pulsing
 * emitter, a colour that follows team control — must call `photonMaterial(..., { unique: true })`
 * or clone, or it will animate every other object sharing that substance.
 */
export function photonMaterial(
  substance: Substance,
  options: SubstanceOptions & { unique?: boolean } = {},
): THREE.Material {
  const color = options.color ?? 0xffffff;
  const key = `${substance}|${color}|${options.emissive ?? -1}|${options.glow ?? 1}|${options.worldScale === false ? 'v' : 'w'}`;

  if (!options.unique) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  const material = RECIPES[substance].build({ ...options, color });
  material.name = `photon:${substance}`;
  if (!options.unique) cache.set(key, material);
  return material;
}

/**
 * Which substance an arena surface is made of.
 *
 * The arena declares a `SurfaceKind` — what a brush is *for* — and this decides what it is *made
 * of*. Keeping the two separate is what lets a future arena be built from the same kinds with a
 * different material language, and it keeps the arena files free of rendering decisions.
 */
export const SURFACE_SUBSTANCE: Record<SurfaceKind, Substance> = {
  floor: 'competitionFloor',
  wall: 'compositePolymer',
  catwalk: 'antiSlipFloor',
  barrier: 'carbonFibre',
  pillar: 'brushedAluminium',
  ramp: 'antiSlipFloor',
  glass: 'temperedGlass',
  led: 'ledStrip',
  trim: 'ledStrip',
  frame: 'graphite',
  vent: 'carbonFibre',
};

export function disposePhotonMaterials(): void {
  for (const material of cache.values()) material.dispose();
  cache.clear();
}

/** Live material count, for the performance readout. */
export const photonMaterialCount = (): number => cache.size;
