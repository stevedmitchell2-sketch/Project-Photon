import { describe, expect, it } from 'vitest';
import { CLIP_CANDIDATES, normaliseClipName } from '@/assets/AssetAnimator';
import { ASSET_MANIFEST } from '@/assets/manifest';

/**
 * The animation content pack, checked against the resolver.
 *
 * These names are what will be typed into Mixamo's search box, and the whole pack
 * is worthless if a name lands one character away from what the engine looks for.
 * The failure is silent: an unresolved state means the animator never switches, so
 * the character keeps playing whatever it already was and nothing looks broken.
 *
 * `npm run clip-plan` is the interactive version of this. This is the version that
 * fails a build.
 */

/** Mixamo clip name -> the gameplay state it is meant to serve. */
const CONTENT_PACK: ReadonlyArray<readonly [string, string]> = [
  ['Breathing Idle', 'idle'],
  ['Walking', 'walk'],
  ['Running', 'run'],
  ['Fast Run', 'sprint'],
  ['Crouching Idle', 'crouch'],
  ['Running Slide', 'slide'],
  ['Jumping Up', 'jump'],
  ['Falling Idle', 'fall'],
  ['Hard Landing', 'landing'],
  ['Left Turn', 'turning'],
  ['Button Pushing', 'interact'],
  ['Falling Back Death', 'death'],
];

/**
 * States `CharacterStateMapper` can actually produce today.
 *
 * `sprint`, `landing`, `turning` and `interact` joined this list in the state-mapper pass. They were
 * in the content pack before anything produced them, which is exactly the arrangement this file
 * exists to make visible: a state that resolves but is never reached costs a download and shows
 * nothing.
 */
const DRIVEN_STATES = [
  'idle', 'walk', 'run', 'sprint',
  'crouch', 'slide',
  'jump', 'fall', 'landing',
  'turning', 'interact',
  'death',
] as const;

const robot = ASSET_MANIFEST.find((e) => e.id === 'hero_robot');

function resolvesTo(clipName: string, state: string): boolean {
  const normalised = normaliseClipName(clipName);
  const alias = robot?.clips?.[state];
  if (alias && normaliseClipName(alias) === normalised) return true;
  return (CLIP_CANDIDATES[state] ?? []).some((c) => normaliseClipName(c) === normalised);
}

describe('animation content pack', () => {
  it('resolves every planned clip to its intended state', () => {
    const failures = CONTENT_PACK.filter(([clip, state]) => !resolvesTo(clip, state)).map(
      ([clip, state]) => `${clip} -> ${state}`,
    );
    expect(failures).toEqual([]);
  });

  it('has no clip that silently serves the wrong state', () => {
    // The dangerous case. "Fast Run" sits inside the `run` candidate list, so
    // without an explicit alias a sprint download loads perfectly and animates the
    // run state — correct-looking, and wrong.
    const stolen: string[] = [];
    for (const [clip, intended] of CONTENT_PACK) {
      const normalised = normaliseClipName(clip);
      const alias = robot?.clips?.[intended];
      if (alias && normaliseClipName(alias) === normalised) continue; // pinned explicitly
      for (const [other, candidates] of Object.entries(CLIP_CANDIDATES)) {
        if (other === intended) continue;
        if (candidates.some((c) => normaliseClipName(c) === normalised)) {
          stolen.push(`${clip}: wanted "${intended}", claimed by "${other}"`);
        }
      }
    }
    expect(stolen).toEqual([]);
  });

  it('covers every state the renderer can actually drive', () => {
    // A driven state with no clip falls back to some other clip, which is how a
    // standing robot ends up playing a run cycle.
    const planned = new Set(CONTENT_PACK.map(([, state]) => state));
    const uncovered = DRIVEN_STATES.filter((state) => !planned.has(state));
    expect(uncovered).toEqual([]);
  });

  it('keeps manifest aliases limited to names the candidates cannot match', () => {
    // An alias for a name that already resolves is a second place to keep the same
    // fact, and the two will drift.
    const redundant = Object.entries(robot?.clips ?? {})
      .filter(([state, clip]) =>
        (CLIP_CANDIDATES[state] ?? []).some((c) => normaliseClipName(c) === normaliseClipName(clip)),
      )
      .map(([state, clip]) => `${state}: ${clip}`);
    expect(redundant).toEqual([]);
  });

  it('points every alias at a clip the pack actually includes', () => {
    // An alias for a clip nobody is going to download resolves to nothing.
    const packNames = new Set(CONTENT_PACK.map(([clip]) => normaliseClipName(clip)));
    // `mixamo.com` is the clip already shipping with the asset, not part of the pack.
    packNames.add(normaliseClipName('mixamo.com'));
    const dangling = Object.entries(robot?.clips ?? {})
      .filter(([, clip]) => !packNames.has(normaliseClipName(clip)))
      .map(([state, clip]) => `${state}: ${clip}`);
    expect(dangling).toEqual([]);
  });
});
