import * as THREE from 'three';
import type { LoadedAsset } from './AssetLoader';

/**
 * Clip playback for imported assets.
 *
 * Before this existed, `AssetLoader` parsed every animation in a file into a `Map` and nothing ever
 * read it. There was no `AnimationMixer` anywhere in the project. Skeletal animation — the thing
 * that separates a production character from a box that slides around — was specified, validated,
 * budgeted and documented, and not implemented.
 *
 * ## What this is not
 *
 * It is not a state machine and it does not decide what should play. The simulation already knows
 * whether an actor is running, sliding or dead, and that decision is deterministic and lives in
 * `gameplay/`. This is the presentation half: given a state name, cross-fade to the clip that
 * represents it and advance time.
 *
 * Keeping the split that way is what stops animation leaking into the simulation. A clip that fails
 * to load changes what the player sees and nothing else — never what the match does.
 *
 * ## Why cross-fade rather than switch
 *
 * A hard switch between clips pops, and the pop is far more noticeable than any amount of missing
 * detail in the clips themselves. `crossFadeTo` is three lines and buys more perceived quality than
 * doubling a character's triangle budget.
 */

/** How long a transition takes, in seconds, unless the caller says otherwise. */
const DEFAULT_FADE = 0.18;

/** Bone names that count as the animation root for root-motion stripping. */
const ROOT_BONE_HINTS = ["hips", "root", "armature", "pelvis"];

/**
 * Removes root translation from a clip.
 *
 * Two separate problems, one fix.
 *
 * **The simulation owns position.** An actor's world position comes from
 * `MovementSystem` — it is authoritative, replicated, and re-simulated during lag
 * compensation. A clip that also translates the root fights it: the mesh drifts
 * away from the collision capsule it is supposed to represent, and where it ends
 * up depends on how far through the clip it happens to be.
 *
 * **Mixamo exports in centimetres.** The first real character's clip drives
 * `mixamorigHips.position` over a range of 1.685 to 83.303. Against a model
 * authored in metres that lifted every avatar clear of the floor — measured at
 * 0.98 m, 1.99 m and 3.04 m off the ground for three characters standing on the
 * same spot, because each was at a different frame.
 *
 * Rotation is what actually carries the animation, so quaternion and scale tracks
 * are kept. Only root *translation* goes, and only on the root bone: hip bob on a
 * spine bone is animation, hip displacement on the root is locomotion the
 * simulation has already done.
 */
function stripRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const kept = clip.tracks.filter((track) => {
    if (!track.name.endsWith(".position")) return true;
    const node = track.name.split(".")[0].toLowerCase();
    return !ROOT_BONE_HINTS.some((hint) => node.includes(hint));
  });
  if (kept.length === clip.tracks.length) return clip;
  const stripped = clip.clone();
  stripped.tracks = kept;
  return stripped;
}

export interface AnimatorOptions {
  /** Clip to start on. Defaults to the first clip in the file. */
  initial?: string;
  /** Playback rate multiplier. */
  timeScale?: number;
  /**
   * Strip root translation from every clip. On by default.
   *
   * Off only for something whose position genuinely is animation rather than
   * simulation — a scripted prop, a cutscene actor. For anything the simulation
   * drives, leaving this on is what keeps the mesh on its collision capsule.
   */
  keepRootMotion?: boolean;
}

export class AssetAnimator {
  readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: string | null = null;

  /** Clip names this asset actually shipped, in file order. */
  readonly available: string[];

  /** Explicit state -> clip mapping from the manifest. Beats every heuristic. */
  readonly aliases: Record<string, string>;

  constructor(asset: LoadedAsset, options: AnimatorOptions = {}) {
    // The mixer binds to the asset root, not to a mesh. A character's clips address joints that are
    // siblings of the skinned mesh rather than children of it, so binding to the mesh finds nothing
    // and produces a rig that loads, validates and never moves.
    this.mixer = new THREE.AnimationMixer(asset.scene);
    this.mixer.timeScale = options.timeScale ?? 1;

    this.available = [...asset.clips.keys()];
    this.aliases = asset.entry.clips ?? {};
    for (const [name, raw] of asset.clips) {
      const clip = options.keepRootMotion ? raw : stripRootMotion(raw);
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      action.setEffectiveWeight(0);
      action.play();
      this.actions.set(name, action);
    }

    const initial = options.initial ?? this.available[0];
    if (initial) this.play(initial, 0);
  }

  get playing(): string | null {
    return this.current;
  }

  has(name: string): boolean {
    if (this.actions.has(name)) return true;
    // Also accept a normalised match, so a caller asking for "idle" finds a clip
    // the file called "Armature|Idle|Layer0".
    const wanted = normaliseClipName(name);
    return this.available.some((available) => normaliseClipName(available) === wanted);
  }

  /**
   * Cross-fades to a clip.
   *
   * A request for a clip the asset does not have is ignored rather than throwing. Assets are
   * optional and partial by design — a character with `idle` but no `slide` should keep idling
   * through a slide, not crash the renderer.
   */
  play(name: string, fade = DEFAULT_FADE): void {
    if (name === this.current) return;
    const next = this.actions.get(name);
    if (!next) return;

    const previous = this.current ? this.actions.get(this.current) : null;
    // Restore looping. An action left in LoopOnce by `playHeld` would otherwise play once and clamp
    // when a later state asks for it as a loop — which is only reachable if an asset maps a held
    // state and a looping state onto the same clip, but that is exactly what the single-clip fallback
    // does today.
    next.setLoop(THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = false;
    if (previous && fade > 0) {
      next.reset();
      next.setEffectiveWeight(1);
      previous.crossFadeTo(next, fade, false);
    } else {
      for (const action of this.actions.values()) action.setEffectiveWeight(0);
      next.reset();
      next.setEffectiveWeight(1);
    }
    this.current = name;
  }

  /**
   * Plays a clip once and returns to the previous one.
   *
   * For fire, reload and hit reactions — anything that is an event rather than a state.
   */
  playOnce(name: string, fade = 0.06): void {
    const action = this.actions.get(name);
    if (!action) return;
    const previous = this.current;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(1);
    action.play();
    this.current = name;

    const onFinished = (event: { action: THREE.AnimationAction }) => {
      if (event.action !== action) return;
      this.mixer.removeEventListener('finished', onFinished as never);
      action.setLoop(THREE.LoopRepeat, Infinity);
      if (previous) {
        this.current = null;
        this.play(previous, fade);
      }
    };
    this.mixer.addEventListener('finished', onFinished as never);
  }

  /**
   * Plays a clip once and holds its final pose, restoring nothing.
   *
   * For a one-shot the *state machine* owns — a landing, a service interaction — where something
   * else already knows how long the event lasts and what follows it.
   *
   * `playOnce` cannot do this job. It captures the state it interrupted and cross-fades back to it on
   * the mixer's `finished` event, which is the right behaviour for a fire or a hit reaction fired out
   * of band. Under a state mapper it is a race: the mapper asks for a locomotion state when the hold
   * expires, then the pending `finished` event fires and yanks playback back to whatever was playing
   * *before* the landing — a fall clip, on a character that is now standing.
   *
   * So this registers no listener. The mapper says when the event is over.
   */
  playHeld(name: string, fade = DEFAULT_FADE): void {
    const next = this.actions.get(name);
    if (!next) return;

    // No `name === current` guard, unlike `play`. Asking for an event again means play it again, and
    // a clamped one-shot that is already finished would otherwise silently do nothing.
    const previous = this.current === name ? null : this.actions.get(this.current ?? '');
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.setEffectiveWeight(1);
    next.play();
    if (previous && fade > 0) {
      previous.crossFadeTo(next, fade, false);
    } else {
      for (const action of this.actions.values()) if (action !== next) action.setEffectiveWeight(0);
    }
    this.current = name;
  }

  /** Advance. Call once per rendered frame with the frame's delta in seconds. */
  update(delta: number): void {
    this.mixer.update(delta);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot() as THREE.Object3D);
    this.actions.clear();
  }
}

/**
 * Normalises an exported clip name.
 *
 * Nobody ships clean clip names. Mixamo emits `mixamo.com` for every download, and
 * once a file has been through Blender the same clip arrives as
 * `Armature|mixamo.com|Layer0`. Other tools prefix the rig name, suffix a take
 * number, or use spaces where the engine expects underscores.
 *
 * Rather than grow the candidate lists forever, names are reduced to their
 * meaningful part before matching: pipe-delimited wrappers dropped, rig prefixes
 * stripped, separators unified, case folded.
 *
 *     "Armature|mixamo.com|Layer0"  ->  "mixamo.com"
 *     "mixamorig:Run Forward"       ->  "run_forward"
 *     "Take 001|Idle"               ->  "idle"
 */
export function normaliseClipName(name: string): string {
  // Pipe-delimited exports wrap the real name: keep the longest segment that is
  // not obviously boilerplate.
  const segments = name.split('|').map((part) => part.trim()).filter(Boolean);
  const meaningful =
    segments.filter((part) => !/^(armature|layer\d*|take\s*\d*|base\s*layer)$/i.test(part)) ;
  let out = (meaningful.length ? meaningful : segments).slice(-1)[0] ?? name;
  out = out.replace(/^mixamorig[:_]?/i, '');
  out = out.replace(/\.(fbx|glb|gltf|dae)$/i, '');
  return out.trim().replace(/[\s-]+/g, '_').toLowerCase();
}

/**
 * Maps a simulation state onto a clip name, taking the first the asset actually has.
 *
 * The indirection matters because the clip vocabulary is the artist's, not the engine's. A file may
 * ship `run_forward` or `sprint` or `locomotion_run`; the simulation only knows the actor is moving
 * fast. Listing candidates in preference order lets an asset satisfy the engine without either side
 * having to agree on a name in advance — which is the same principle as the node-name contract, one
 * level up.
 */
export const CLIP_CANDIDATES: Record<string, readonly string[]> = {
  // Entries are the *real* names from Mixamo's library, normalised, alongside the
  // generic ones. Guessing at plausible names is how the `fall` state ended up with
  // no entry for "Falling Idle" — which is what Mixamo actually calls it, and the
  // clip anyone downloading a fall would pick.
  idle: ['idle', 'idle_loop', 'stand', 'standing', 'breathing_idle', 'neutral_idle', 'happy_idle'],
  walk: ['walk', 'walking', 'walk_forward', 'locomotion_walk', 'standard_walk'],
  run: ['run', 'running', 'run_forward', 'sprint', 'sprinting', 'fast_run', 'jog_forward', 'locomotion_run'],
  crouch: ['crouch', 'crouching', 'crouching_idle', 'crouch_idle', 'crouched_walking', 'crouch_walk'],
  jump: ['jump', 'jumping', 'jumping_up', 'jump_start', 'jump_up'],
  fall: ['fall', 'falling', 'falling_idle', 'airborne', 'fall_loop', 'fall_a_loop'],
  slide: ['slide', 'sliding', 'running_slide', 'slide_forward'],
  fire: ['fire', 'firing', 'firing_rifle', 'shoot', 'shooting', 'attack', 'rifle_fire'],
  reload: ['reload', 'reloading', 'reload_rifle', 'vent', 'recharge'],
  death: ['death', 'dying', 'die', 'death_from_front', 'falling_back_death', 'death_backward'],
};

/**
 * Resolves a state to a clip the asset has, or null.
 *
 * Three tiers, most explicit first:
 *
 *   1. the manifest's `clips` map — an asset can state outright that its
 *      `mixamo.com` clip is the idle, which no amount of name matching can infer;
 *   2. the candidate lists, against normalised names;
 *   3. the asset's only clip, if it ships exactly one.
 *
 * Tier 3 exists because of the Service Unit: it ships one clip named `mixamo.com`,
 * every state resolved to null, and the animator silently played the same cycle
 * whether an actor was standing still or sprinting.
 */
export function clipFor(animator: AssetAnimator, state: string): string | null {
  const explicit = animator.aliases[state];
  if (explicit && animator.has(explicit)) return explicit;

  for (const candidate of CLIP_CANDIDATES[state] ?? [state]) {
    const match = animator.available.find(
      (name) => normaliseClipName(name) === normaliseClipName(candidate),
    );
    if (match) return match;
  }
  return animator.available.length === 1 ? animator.available[0] : null;
}

/**
 * How many movement states an asset can actually express.
 *
 * Worth calling on import, because a clip library that resolves nothing is
 * invisible: the character animates, so it looks like it works, and it takes a
 * close look at a standing player to notice they are playing a run cycle.
 */
export function clipCoverage(animator: AssetAnimator): {
  resolved: number;
  total: number;
  missing: string[];
} {
  const states = Object.keys(CLIP_CANDIDATES);
  const missing = states.filter((state) => {
    if (animator.aliases[state] && animator.has(animator.aliases[state])) return false;
    return !CLIP_CANDIDATES[state].some((candidate) =>
      animator.available.some((name) => normaliseClipName(name) === normaliseClipName(candidate)),
    );
  });
  return { resolved: states.length - missing.length, total: states.length, missing };
}
