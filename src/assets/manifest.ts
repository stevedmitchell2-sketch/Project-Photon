import {
  ASSET_DIRECTORIES,
  type AssetFormat,
  type AssetKind,
  type MaterialZoneMapping,
} from './contract';

/**
 * The asset registry.
 *
 * Every piece of imported content the game knows about, declared as data. Nothing loads an asset by
 * hardcoded path — code asks the registry for `hero_rifle` and gets whatever file that currently
 * points at, which is what lets an artist ship `_v02` beside `_v01` and switch by editing one line
 * here.
 *
 * ## Assets are optional by design
 *
 * Every entry may be absent from disk. The runtime falls back to the procedural implementation it
 * already has, and logs nothing louder than a debug line. That property is deliberate and load
 * bearing:
 *
 *   - the repository stays clone-and-run with no binary assets and no LFS;
 *   - a designer can work on gameplay without the art;
 *   - an artist can drop one file in and see it immediately, without a coordinated commit;
 *   - and CI does not need the content pipeline to test the game.
 *
 * `optional: false` marks an asset the game genuinely cannot run without. There are none yet, and
 * there should stay none until the procedural fallbacks are deleted.
 */

export interface AssetEntry {
  /** Stable id the code uses. Never a filename. */
  id: string;
  kind: AssetKind;
  /** File name inside the kind's directory, e.g. `HeroLaserRifle_v01.glb`. */
  file: string;
  format: AssetFormat;
  /** Human description, shown in the audit report. */
  description: string;
  /** How this asset's `MAT_` zones map onto the material library. */
  zones?: MaterialZoneMapping[];
  /**
   * Sockets this asset promises beyond the ones its kind requires.
   * Validation checks required sockets automatically; this documents extras.
   */
  extraSockets?: string[];
  /** False only for assets with no procedural fallback. */
  optional?: boolean;
  /** Scale applied on import, for assets authored in the wrong unit. */
  scale?: number;
  /**
   * Yaw correction in radians, for assets authored facing the wrong way.
   *
   * Photon's forward is -Z, matching the glTF convention. A model exported facing +Z needs `Math.PI`
   * here. It lives in the manifest rather than in the renderer because it is a property of the
   * *file*, and burying it in render code means the next asset with the same problem gets a second
   * hard-coded rotation somewhere else.
   */
  yawOffset?: number;
}

/**
 * The registry.
 *
 * Entries exist before their files do. That is intentional: the manifest is the **specification an
 * artist works to**, and `npm run asset-audit` reports which specified assets are still missing.
 * The list below is therefore also the content backlog, and CONTENT_ROADMAP.md orders it.
 */
export const ASSET_MANIFEST: AssetEntry[] = [
  // --- Phase 1: hero assets -------------------------------------------------
  {
    id: 'hero_rifle',
    kind: 'weapon',
    file: 'HeroLaserRifle_v01.glb',
    format: 'glb',
    description: 'PH-6 Photon Rifle. Replaces the procedural view model.',
    zones: [
      { zone: 'shell', substance: 'carbonFibre' },
      { zone: 'frame', substance: 'brushedAluminium' },
      { zone: 'grip', substance: 'rubberGrip' },
      { zone: 'vent', substance: 'titanium' },
      { zone: 'trim', substance: 'ledStrip', teamColored: true },
      { zone: 'core', substance: 'energyEmitter', teamColored: true },
    ],
  },
  {
    id: 'hero_athlete',
    kind: 'character',
    file: 'HeroAthlete_v01.glb',
    format: 'glb',
    description: 'Player character. Replaces the primitive avatar rig.',
    zones: [
      { zone: 'suit', substance: 'compositePolymer' },
      { zone: 'armor', substance: 'carbonFibre' },
      { zone: 'trim', substance: 'ledStrip', teamColored: true },
      { zone: 'visor', substance: 'energyEmitter', teamColored: true },
    ],
  },

  // --- Phase 1: structural kit ---------------------------------------------
  {
    id: 'wall_panel_large',
    kind: 'module',
    file: 'WallPanelLarge_v01.glb',
    format: 'glb',
    description: '4x4 m structural wall panel with recessed trim channel.',
    zones: [
      { zone: 'panel', substance: 'compositePolymer' },
      { zone: 'trim', substance: 'ledStrip' },
    ],
  },
  {
    id: 'wall_corner',
    kind: 'module',
    file: 'WallCorner_v01.glb',
    format: 'glb',
    description: 'Inside/outside corner module matching the 4 m wall grid.',
    zones: [{ zone: 'panel', substance: 'compositePolymer' }],
  },
  {
    id: 'floor_competition',
    kind: 'module',
    file: 'FloorCompetition_v01.glb',
    format: 'glb',
    description: '4x4 m competition floor tile with panel seams.',
    zones: [{ zone: 'floor', substance: 'competitionFloor' }],
  },
  {
    id: 'ceiling_rig',
    kind: 'module',
    file: 'CeilingLightRig_v01.glb',
    format: 'glb',
    description: 'Suspended lighting truss with integrated fixtures.',
    zones: [
      { zone: 'truss', substance: 'titanium' },
      { zone: 'fixture', substance: 'ledStrip' },
    ],
  },
  {
    id: 'cover_barrier',
    kind: 'module',
    file: 'CoverBarrier_v01.glb',
    format: 'glb',
    description: 'Waist-high tactical cover, laser-sport styling.',
    zones: [
      { zone: 'body', substance: 'carbonFibre' },
      { zone: 'trim', substance: 'ledStrip' },
    ],
  },

  // --- Phase 1: props -------------------------------------------------------
  {
    id: 'prop_charging_station',
    kind: 'prop',
    file: 'ChargingStation_v01.glb',
    format: 'glb',
    description: 'Player charging station for spawn rooms.',
    zones: [
      { zone: 'body', substance: 'paintedAlloy' },
      { zone: 'display', substance: 'holoPanel' },
    ],
  },
  {
    id: 'prop_equipment_locker',
    kind: 'prop',
    file: 'EquipmentLocker_v01.glb',
    format: 'glb',
    description: 'Locker bank for spawn and preparation areas.',
    zones: [{ zone: 'body', substance: 'brushedAluminium' }],
  },
];

/** Public URL for an asset, relative to the site root. */
export const assetUrl = (entry: AssetEntry): string =>
  `/assets/${ASSET_DIRECTORIES[entry.kind]}/${entry.file}`;

/** Filesystem path for an asset, relative to the repository root. */
export const assetPath = (entry: AssetEntry): string =>
  `public/assets/${ASSET_DIRECTORIES[entry.kind]}/${entry.file}`;

export const findAsset = (id: string): AssetEntry | undefined =>
  ASSET_MANIFEST.find((entry) => entry.id === id);
