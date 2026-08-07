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

  constructor(asset: LoadedAsset, options: AnimatorOptions = {}) {
    // The mixer binds to the asset root, not to a mesh. A character's clips address joints that are
    // siblings of the skinned mesh rather than children of it, so binding to the mesh finds nothing
    // and produces a rig that loads, validates and never moves.
    this.mixer = new THREE.AnimationMixer(asset.scene);
    this.mixer.timeScale = options.timeScale ?? 1;

    this.available = [...asset.clips.keys()];
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
    return this.actions.has(name);
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
 * Maps a simulation state onto a clip name, taking the first the asset actually has.
 *
 * The indirection matters because the clip vocabulary is the artist's, not the engine's. A file may
 * ship `run_forward` or `sprint` or `locomotion_run`; the simulation only knows the actor is moving
 * fast. Listing candidates in preference order lets an asset satisfy the engine without either side
 * having to agree on a name in advance — which is the same principle as the node-name contract, one
 * level up.
 */
export const CLIP_CANDIDATES: Record<string, readonly string[]> = {
  idle: ['idle', 'Idle', 'idle_loop', 'stand'],
  walk: ['walk', 'Walk', 'walk_forward', 'locomotion_walk'],
  run: ['run', 'Run', 'run_forward', 'sprint', 'locomotion_run'],
  crouch: ['crouch', 'crouch_idle', 'Crouch'],
  jump: ['jump', 'Jump', 'jump_start'],
  fall: ['fall', 'Fall', 'airborne'],
  slide: ['slide', 'Slide'],
  fire: ['fire', 'Fire', 'shoot', 'attack'],
  reload: ['reload', 'Reload', 'vent', 'recharge'],
  death: ['death', 'Death', 'die'],
};

/**
 * Resolves a state to a clip the asset has, or null.
 *
 * Falls back to the asset's only clip when nothing matches. A file that ships one
 * unnamed clip — which is what Mixamo produces, named `mixamo.com` — otherwise
 * resolves *nothing*: the Service Unit had zero of nine movement states match, so
 * the animator never switched and played the same cycle whether the actor was
 * standing, sprinting or dead. Better to play the one clip deliberately than to
 * fall through and look frozen by accident.
 */
export function clipFor(animator: AssetAnimator, state: string): string | null {
  for (const candidate of CLIP_CANDIDATES[state] ?? [state]) {
    if (animator.has(candidate)) return candidate;
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
  const missing = states.filter(
    (state) => !CLIP_CANDIDATES[state].some((candidate) => animator.has(candidate)),
  );
  return { resolved: states.length - missing.length, total: states.length, missing };
}
