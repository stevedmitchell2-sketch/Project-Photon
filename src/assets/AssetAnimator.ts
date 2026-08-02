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

export interface AnimatorOptions {
  /** Clip to start on. Defaults to the first clip in the file. */
  initial?: string;
  /** Playback rate multiplier. */
  timeScale?: number;
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
    for (const [name, clip] of asset.clips) {
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

/** Resolves a state to a clip the asset has, or null. */
export function clipFor(animator: AssetAnimator, state: string): string | null {
  for (const candidate of CLIP_CANDIDATES[state] ?? [state]) {
    if (animator.has(candidate)) return candidate;
  }
  return null;
}
