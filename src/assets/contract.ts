/**
 * The Photon asset contract.
 *
 * This file is the interface between *content* and *code*. An artist — or a generator — who follows
 * the naming rules below can hand Photon a `.glb` and have it work with no code change at all. The
 * runtime never looks for a mesh at a hardcoded index or assumes a hierarchy; it looks for **named
 * nodes**, and the names are specified here.
 *
 * That is the entire design. Everything else in `src/assets/` is machinery for enforcing it.
 *
 * ## Why names rather than a bespoke format
 *
 * Photon deliberately does not define its own asset format. A custom format needs a custom exporter,
 * which locks content creation to whoever wrote the exporter. Node naming inside standard glTF works
 * out of any tool that can export glTF — Blender, Substance, Houdini, Maya, an online converter, or
 * a generative model — because every one of them lets you name an object.
 *
 * **Nothing in this pipeline is Blender-specific.** Blender is the documented workflow because it is
 * free and complete, not because it is required.
 *
 * ## The prefixes
 *
 * Every meaningful node carries a prefix. Nodes without one are ordinary geometry and are rendered
 * as-is, which means an asset that follows none of these conventions still *loads* — it simply has
 * no sockets, no animated parts and no material zones.
 */

/** Node-name prefixes the importer understands. */
export const NODE_PREFIX = {
  /**
   * An attachment point. Position and rotation are read; the node itself is never rendered.
   * `SOCKET_muzzle` is where bolts leave a weapon, `SOCKET_helmet` is where a helmet mounts.
   */
  socket: 'SOCKET_',
  /**
   * A part the runtime animates. The name after the prefix is the part id the code asks for, so
   * `PART_rail_03` is addressed as `rail_03`.
   *
   * This is what lets one animation implementation drive both the procedural rifle and an imported
   * one: the code asks for `core`, and gets whichever node is called `PART_core`.
   */
  part: 'PART_',
  /**
   * A material zone. `MAT_shell` is assigned the substance the asset's manifest maps `shell` to,
   * which is how an imported mesh inherits the Photon material library instead of shipping its own
   * flat textures.
   */
  material: 'MAT_',
  /** A surface that takes team colour. Assigned at runtime from the wearing actor's team. */
  team: 'TEAM_',
  /** Level of detail. `LOD0` is the highest; the importer builds a Three.js LOD group from these. */
  lod: 'LOD',
  /** Collision geometry. Never rendered; handed to the physics layer. */
  collision: 'COL_',
} as const;

/** Sockets the runtime will look for, by asset kind. Missing required sockets fail validation. */
export const REQUIRED_SOCKETS: Record<AssetKind, readonly string[]> = {
  weapon: ['muzzle', 'grip', 'sight'],
  character: ['helmet', 'backpack', 'weapon_right', 'weapon_left'],
  module: [],
  prop: [],
  decal: [],
  vfx: [],
};

/**
 * Parts the runtime animates, by asset kind.
 *
 * These are *optional* in the sense that a missing part is skipped rather than fatal — a simpler
 * weapon with no charge rails still works. But they are listed so an artist knows what to name
 * things for the animation to find them, and so validation can warn when a hero asset is missing
 * animation hooks it probably meant to have.
 */
export const ANIMATED_PARTS: Record<AssetKind, readonly string[]> = {
  weapon: ['core', 'emitter', 'rail_00', 'rail_01', 'rail_02', 'rail_03', 'rail_04', 'rail_05', 'rail_06'],
  character: ['visor', 'backpack_core'],
  module: [],
  prop: [],
  decal: [],
  vfx: [],
};

export type AssetKind = 'weapon' | 'character' | 'module' | 'prop' | 'decal' | 'vfx';

/**
 * Triangle and texture budgets, per asset kind.
 *
 * Budgets are not aspirations — `npm run asset-audit` fails on a violation. They exist because the
 * frame is **fragment-bound**: Sprint 8 measured eight dynamic lights at 2.3 ms of a 12.3 ms frame,
 * and Sprint 11 confirmed texture samples land on the same budget. Geometry is comparatively cheap
 * here; texture memory and per-pixel work are not, which is why the texture budgets are tighter
 * than the triangle budgets relative to industry norms.
 *
 * `lodDrop` is the fraction of triangles each LOD level must remove relative to the one above.
 */
export interface AssetBudget {
  /** Triangles at LOD0. */
  triangles: number;
  /** Number of distinct material zones. Each one is a draw call per instance. */
  materials: number;
  /** Largest permitted texture edge, in pixels. */
  textureSize: number;
  /** Total texture memory for the asset, in megabytes. */
  textureMemoryMb: number;
  /** Required LOD levels, including LOD0. */
  lodLevels: number;
  /** Minimum triangle reduction between consecutive LODs. */
  lodDrop: number;
}

export const ASSET_BUDGETS: Record<AssetKind, AssetBudget> = {
  /**
   * The weapon is on screen 100% of the time and occupies a large solid angle, so it earns the
   * highest triangle budget in the project.
   *
   * Six material zones rather than five, and the extra one is not slack. Two of a weapon's zones —
   * team trim and the energy core — **animate**, mutating emissive every frame, which means they
   * cannot share a cached library material with anything else and must be unique instances. The
   * budget therefore covers four static zones plus two animated ones. A first pass set this at five
   * and the audit tool caught the manifest violating it on its first run, which is the correct
   * order of events but was the budget being wrong rather than the asset.
   *
   * A weapon is also a single instance, so a zone here costs one draw call per frame, not one per
   * player — which is why this is the most generous material budget in the project and why the
   * instanced kinds below are far tighter.
   */
  weapon: { triangles: 28_000, materials: 6, textureSize: 2048, textureMemoryMb: 12, lodLevels: 2, lodDrop: 0.5 },
  /**
   * Characters are instanced and there may be sixteen of them. The budget is per character, and the
   * material zone count is deliberately tight because avatars are drawn as instanced batches keyed
   * by (geometry, material) — every extra zone multiplies batches by team count.
   */
  character: { triangles: 18_000, materials: 4, textureSize: 2048, textureMemoryMb: 10, lodLevels: 3, lodDrop: 0.45 },
  /**
   * Environment modules are placed hundreds of times. Triangle budget is low and material budget is
   * lower, because a kit that shares one material set across every module collapses an entire arena
   * into a handful of draw calls.
   */
  module: { triangles: 2_500, materials: 2, textureSize: 1024, textureMemoryMb: 4, lodLevels: 2, lodDrop: 0.5 },
  prop: { triangles: 4_000, materials: 3, textureSize: 1024, textureMemoryMb: 4, lodLevels: 2, lodDrop: 0.5 },
  decal: { triangles: 32, materials: 1, textureSize: 1024, textureMemoryMb: 2, lodLevels: 1, lodDrop: 0 },
  vfx: { triangles: 512, materials: 1, textureSize: 512, textureMemoryMb: 2, lodLevels: 1, lodDrop: 0 },
};

/**
 * File naming.
 *
 * `PascalCaseName_vNN.glb`, e.g. `HeroLaserRifle_v01.glb`. The version suffix is mandatory and is
 * how an asset is iterated without cache invalidation problems or ambiguity about which file is
 * current — the manifest names the exact version in use, so an artist can drop `_v02` beside `_v01`
 * and switch by editing one line.
 */
export const ASSET_FILENAME = /^[A-Z][A-Za-z0-9]*_v\d{2}\.(glb|gltf|fbx)$/;

/** Texture naming: `AssetName_Zone_MAP.png`, where MAP is one of the suffixes below. */
export const TEXTURE_FILENAME = /^[A-Z][A-Za-z0-9]*_[a-z][A-Za-z0-9]*_(BC|N|ORM|E)\.(png|jpg|ktx2|exr)$/;

/**
 * Texture map suffixes.
 *
 * **ORM packing is mandatory** for anything with more than a base colour. Occlusion, roughness and
 * metalness travel in one texture's R, G and B channels rather than three separate files, which
 * cuts both texture memory and — the part that matters on a fragment-bound frame — the number of
 * samples per fragment from three to one.
 */
export const TEXTURE_SUFFIX = {
  /** Base colour, sRGB. */
  baseColor: 'BC',
  /** Tangent-space normal, linear. */
  normal: 'N',
  /** Occlusion (R) / Roughness (G) / Metalness (B), linear. */
  orm: 'ORM',
  /** Emissive, sRGB. */
  emissive: 'E',
} as const;

/** Directory layout under `public/assets/`. Enforced by the audit tool. */
export const ASSET_DIRECTORIES: Record<AssetKind, string> = {
  weapon: 'weapons',
  character: 'characters',
  module: 'modules',
  prop: 'props',
  decal: 'decals',
  vfx: 'vfx',
};

/**
 * Formats the importer accepts.
 *
 * glTF binary is the preferred interchange and the only one guaranteed to carry PBR materials,
 * sockets and animation intact through every tool. FBX is accepted because some pipelines and
 * generative tools still emit it, but it is converted on import and loses material fidelity — the
 * audit tool warns on it rather than failing.
 *
 * **No proprietary or tool-specific formats.** `.blend` is a working file, never a shipped asset.
 */
export const ACCEPTED_FORMATS = ['glb', 'gltf', 'fbx'] as const;
export type AssetFormat = (typeof ACCEPTED_FORMATS)[number];

/** The preferred format. Anything else is a compatibility path. */
export const PREFERRED_FORMAT: AssetFormat = 'glb';

/**
 * How a material zone in an asset maps onto the Photon material library.
 *
 * An imported mesh does **not** bring its own materials into the scene by default. It declares
 * zones by node name, and the manifest maps each zone to a library substance — so an asset picks up
 * the project's lighting response, team colour and readability rules automatically, and a change to
 * how carbon fibre looks changes every asset that uses it.
 *
 * Set `useSourceMaterial: true` on a zone to keep what the file shipped with. That is an escape
 * hatch for hero assets with authored texture sets, not the default, and the audit tool lists every
 * asset that uses it so the exceptions stay visible.
 */
export interface MaterialZoneMapping {
  /** Zone name, matching a `MAT_` node suffix. */
  zone: string;
  /** Substance name from `render/materials/PhotonMaterials`. */
  substance: string;
  /** Keep the asset's own material instead of substituting a library one. */
  useSourceMaterial?: boolean;
  /** Tint this zone with the owning actor's team colour. */
  teamColored?: boolean;
}
