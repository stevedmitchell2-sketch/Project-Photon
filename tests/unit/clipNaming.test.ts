import { describe, expect, it } from 'vitest';
import { CLIP_CANDIDATES, normaliseClipName } from '@/assets/AssetAnimator';

/**
 * Clip name resolution.
 *
 * The Service Unit shipped one clip called `mixamo.com` and **zero of nine**
 * movement states resolved to it, so the animator never switched: a standing robot
 * played a run cycle and a sprinting one played the same. It was invisible because
 * the character did animate — nothing looked broken until you watched a stationary
 * player closely.
 *
 * Nobody ships clean clip names, so these lock down the normalisation rather than
 * the candidate lists, which will keep growing.
 */

describe('normaliseClipName', () => {
  it('unwraps Blender pipe-delimited exports', () => {
    // What a Mixamo FBX looks like after a Blender round trip.
    expect(normaliseClipName('Armature|mixamo.com|Layer0')).toBe('mixamo.com');
    expect(normaliseClipName('Armature|Idle|Layer0')).toBe('idle');
    expect(normaliseClipName('Take 001|Run Forward')).toBe('run_forward');
  });

  it('strips rig prefixes', () => {
    expect(normaliseClipName('mixamorig:Walking')).toBe('walking');
    expect(normaliseClipName('mixamorig_Run')).toBe('run');
  });

  it('unifies separators and case', () => {
    expect(normaliseClipName('Run Forward')).toBe('run_forward');
    expect(normaliseClipName('run-forward')).toBe('run_forward');
    expect(normaliseClipName('RUN_FORWARD')).toBe('run_forward');
  });

  it('drops file extensions', () => {
    expect(normaliseClipName('Idle.fbx')).toBe('idle');
    expect(normaliseClipName('Armature|Sprint.glb|Layer0')).toBe('sprint');
  });

  it('leaves an already-clean name alone', () => {
    expect(normaliseClipName('idle')).toBe('idle');
    expect(normaliseClipName('crouch_walk')).toBe('crouch_walk');
  });

  it('never returns empty for a non-empty input', () => {
    for (const name of ['Armature|', '|Layer0', 'Armature|Layer0', 'x']) {
      expect(normaliseClipName(name).length).toBeGreaterThan(0);
    }
  });
});

describe('CLIP_CANDIDATES', () => {
  it('covers every state the movement mapper can produce', () => {
    // These are the states `movementState()` in AssetAvatars returns. A state with
    // no candidate list can never resolve, however the asset is named.
    for (const state of ['idle', 'walk', 'run', 'crouch', 'jump', 'fall', 'slide', 'fire', 'death']) {
      expect(CLIP_CANDIDATES[state], state).toBeDefined();
      expect(CLIP_CANDIDATES[state].length).toBeGreaterThan(0);
    }
  });

  it('lists candidates in already-normalised form', () => {
    // A candidate that does not survive its own normalisation can never match,
    // since both sides of the comparison are normalised.
    for (const [state, candidates] of Object.entries(CLIP_CANDIDATES)) {
      for (const candidate of candidates) {
        expect(normaliseClipName(candidate), `${state}: ${candidate}`).toBe(candidate);
      }
    }
  });

  it('matches real Mixamo clip names once normalised', () => {
    // Names taken from Mixamo's actual library, as exported through Blender.
    const real: Array<[string, string]> = [
      ['Armature|Idle|Layer0', 'idle'],
      ['Armature|Walking|Layer0', 'walk'],
      ['Armature|Running|Layer0', 'run'],
      ['mixamorig:Crouch Idle', 'crouch'],
      ['Armature|Falling Idle|Layer0', 'fall'],
    ];
    for (const [exported, state] of real) {
      const normalised = normaliseClipName(exported);
      const hit = CLIP_CANDIDATES[state].some((c) => normaliseClipName(c) === normalised);
      expect(hit, `${exported} -> ${state} (normalised "${normalised}")`).toBe(true);
    }
  });

  it('does not resolve an uninformative name to a specific state', () => {
    // `mixamo.com` carries no meaning. It must fall through to the manifest's
    // explicit `clips` map or the single-clip fallback, never guess a state.
    const normalised = normaliseClipName('mixamo.com');
    for (const candidates of Object.values(CLIP_CANDIDATES)) {
      expect(candidates.some((c) => normaliseClipName(c) === normalised)).toBe(false);
    }
  });
});
