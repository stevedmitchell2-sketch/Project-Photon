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
  /**
   * Vertical correction in metres, applied where the avatar is placed.
   *
   * A rigged character's feet do not always land on its origin once a clip is
   * playing: stripping root translation returns the root bone to its bind pose,
   * and if that pose sits the hips higher than the export origin, the whole mesh
   * floats by the difference.
   *
   * Measured per asset rather than derived, because it depends on the clip as
   * well as the rig — a crouched idle and a standing idle give different answers.
   * Measure once in engine, put the number here.
   */
  footOffset?: number;
  /**
   * Explicit state -> clip name mapping, overriding every naming heuristic.
   *
   * Needed because some names carry no information at all. Mixamo emits
   * `mixamo.com` for every download, so no candidate list can tell an idle from a
   * sprint — only the person who downloaded it knows. This is where they say so.
   */
  clips?: Record<string, string>;
  /**
   * Per-material overrides applied at load, keyed by the material's name in the file.
   *
   * For adjusting a shipped asset's look without re-exporting it. Zone assignment
   * is geometry and belongs in the DCC tool; the *values* a zone renders with are
   * data, and iterating them here is far cheaper than a Blender round trip.
   */
  materialOverrides?: Record<
    string,
    { color?: number; metallic?: number; roughness?: number; emissive?: number; emissiveIntensity?: number }
  >;
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
    /**
     * The Photon Arena Service Unit. First real authored character in the project.
     *
     * Retopologised from a Tripo source (1.94M -> 60,928 triangles), Mixamo-rigged
     * with 49 joints, and finished with a baked normal + occlusion pass from the
     * high-poly. Four material zones; the trim zone is emissive and takes team
     * colour at runtime.
     */
    id: 'hero_robot',
    kind: 'character',
    file: 'PhotonServiceUnit_v01.glb',
    format: 'glb',
    description: 'Photon Arena Service Unit. Ceramic shell, graphite joints, titanium accents.',
    /**
     * 0.8445, because the mesh exports at 2.285 m and the target is 1.93 m (6'4").
     *
     * Corrected here rather than in Blender on purpose: the height overshoot came
     * from scaling the armature, and re-scaling a bound rig risks the weights for
     * no gain. A scale on the import node is animation-safe and reversible.
     */
    scale: 0.8445,
    /**
     * -0.2 m. Measured, not guessed: with root motion stripped the mesh floated a
     * consistent 0.20 m above the actor origin on every avatar, including one
     * standing on the mezzanine at y = 3.33 — the same gap regardless of height,
     * which is what identifies it as a bind-pose offset rather than animation.
     */
    footOffset: -0.2,
    /**
     * The asset ships one clip called `mixamo.com`, which matches no state by name.
     * Declaring it as the idle is the only way the engine can know: nine states
     * resolved to nothing before this existed, and the animator played a run cycle
     * on stationary robots.
     *
     * Add entries here as named clips are imported.
     */
    clips: {
      // `idle: 'mixamo.com'` lived here while that was the asset's only clip. It has
      // to go now the pack has landed: an alias is tier 1 of the resolver and beats
      // every candidate list, so it would have held `idle` on the nameless original
      // and `Breathing Idle` — downloaded specifically for this state — would never
      // have played. An alias for a clip that has been superseded is worse than no
      // alias, because it keeps working.

      // --- The animation content pack -----------------------------------------
      //
      // Names are Mixamo's, verbatim, because that is what the exporter writes into
      // the file. Verified against the resolver by `npm run clip-plan` before any
      // download: every entry below is one the candidate lists could *not* match on
      // their own, so leaving them out would have produced a state that silently
      // never resolved.
      //
      // Clips whose Mixamo names already match a candidate — Breathing Idle,
      // Walking, Running, Crouching Idle, Jumping Up, Falling Idle, Running Slide,
      // Falling Back Death — are deliberately absent. They resolve without help,
      // and an alias for them would be a second place to keep the same fact.

      // No candidate list at all: these states are new.
      landing: 'Hard Landing',
      turning: 'Left Turn',
      interact: 'Button Pushing',

      // A collision, not a gap. "Fast Run" normalises into the *run* candidates, so
      // without this alias a sprint download would load correctly and silently serve
      // the run state — the worst kind of failure, because nothing looks wrong.
      sprint: 'Fast Run',
    },
    /**
     * Material balance pass.
     *
     * Measured in game, the graphite zone covers 28.5% of the model — forearms,
     * shins, neck and hands — and at 0.055 luminance it read almost black. The
     * robot looked like a dark industrial machine with a white torso rather than a
     * premium white service unit.
     *
     * Rather than reassign geometry between zones (which is a Blender edit and a
     * re-export), the graphite is lifted to a mid grey-blue and given more
     * metallic response, moving it toward the titanium end of the palette. The
     * ceramic identity stays dominant, the dark mass shrinks, and the mechanical
     * parts still read as mechanical.
     */
    materialOverrides: {
      // 0.055 -> 0.185. Still clearly darker than the shell, no longer a void.
      MAT_joint: { color: 0x2f3742, metallic: 0.72, roughness: 0.42 },
      // Slightly brighter and glossier, so titanium reads as machined rather than grey.
      MAT_accent: { color: 0x9aa4b4, metallic: 0.9, roughness: 0.22 },
      // A touch cooler and brighter: the ceramic should be the brightest thing on it.
      MAT_shell: { color: 0xdfe4ea, metallic: 0.16, roughness: 0.33 },
    },
    zones: [
      { zone: 'shell', substance: 'compositePolymer', useSourceMaterial: true },
      { zone: 'joint', substance: 'carbonFibre', useSourceMaterial: true },
      { zone: 'accent', substance: 'brushedAluminium', useSourceMaterial: true },
      { zone: 'trim', substance: 'ledStrip', teamColored: true },
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
