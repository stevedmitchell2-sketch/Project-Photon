import { CLIP_CANDIDATES, normaliseClipName } from '../src/assets/AssetAnimator';
import { ASSET_MANIFEST } from '../src/assets/manifest';

/**
 * Animation library planner.
 *
 * Checks a proposed set of Mixamo downloads against the live resolver *before*
 * anyone spends an afternoon downloading them. For each clip it answers one
 * question: when this file lands, will the engine find it?
 *
 *   npm run clip-plan
 *   npm run clip-plan -- --asset hero_robot
 *
 * ## Why this exists
 *
 * The candidate lists were populated once with plausible-sounding names and the
 * `fall` state had no entry for "Falling Idle" — which is what Mixamo actually
 * calls its falling clip, and therefore the one file anyone would download. The
 * mismatch was invisible: the state simply never resolved, the animator never
 * switched, and the character kept playing whatever it was already playing.
 *
 * Guessing at names is the failure mode. This makes the guess checkable.
 */

/**
 * The proposed library.
 *
 * `mixamo` is the clip's name in Mixamo's browser, verbatim — that is what the
 * exporter writes into the file, and getting it exactly right is the whole point.
 * `state` is the gameplay state it is meant to serve.
 *
 * Chosen for a *service robot*, not a soldier. Mixamo's library is heavy on combat
 * and the brief rules it out, so the locomotion set is the neutral one and the
 * interaction clips are deliberately non-martial: a wave, a button press, an
 * inspection. Nothing aggressive, nothing tactical.
 */
interface PlannedClip {
  state: string;
  mixamo: string;
  /** Why this clip rather than a neighbouring one. */
  note: string;
  /** True when the state is not yet produced by the renderer's state mapper. */
  needsStateWiring?: boolean;
}

const PLAN: PlannedClip[] = [
  // --- Locomotion ---------------------------------------------------------
  { state: 'idle', mixamo: 'Breathing Idle',
    note: 'Neutral standing loop. "Idle" alone is a fidget cycle that reads as impatient on a service unit.' },
  { state: 'walk', mixamo: 'Walking',
    note: 'Straight forward walk. In-place; root motion is stripped on import regardless.' },
  { state: 'run', mixamo: 'Running',
    note: 'Standard run. Photon switches to this above 0.35 m/s.' },
  { state: 'sprint', mixamo: 'Fast Run',
    note: 'Longer stride for the >6 m/s band. Resolves to the run candidates today, so it needs a state split to be distinct.',
    needsStateWiring: true },
  { state: 'crouch', mixamo: 'Crouch Idle',
    note: 'Crouched hold. Photon crouch is a stance, not a movement, so the idle is the right pick.' },
  { state: 'slide', mixamo: 'Running Slide',
    note: 'Photon has a real slide stance and the mapper produces it. Missing from the first draft of this plan, which the checker caught.' },

  // --- Airborne ----------------------------------------------------------
  { state: 'jump', mixamo: 'Jumping Up',
    note: 'Launch only. The full "Jump" clip includes a landing, which would fight the fall and landing states.' },
  { state: 'fall', mixamo: 'Falling Idle',
    note: 'Airborne loop. The name the fall state failed to match before the candidate lists were corrected.' },
  { state: 'landing', mixamo: 'Hard Landing',
    note: 'Impact absorb. No landing state exists in the mapper yet, so this needs wiring and a one-shot.',
    needsStateWiring: true },

  // --- Presence ----------------------------------------------------------
  { state: 'turning', mixamo: 'Left Turn',
    note: 'Turn in place. Needs a yaw-rate threshold in the state mapper; mirrored at runtime for right turns.',
    needsStateWiring: true },
  { state: 'interact', mixamo: 'Button Pushing',
    note: 'The service animation. A maintenance unit operating arena equipment, not a soldier reloading.',
    needsStateWiring: true },

  // --- Already covered by the resolver, worth having ---------------------
  { state: 'death', mixamo: 'Falling Back Death',
    note: 'Deactivation. Reads as a unit powering down rather than a person dying.' },
];

function resolves(mixamoName: string, state: string, aliases: Record<string, string>): {
  ok: boolean;
  via: string;
  normalised: string;
} {
  const normalised = normaliseClipName(mixamoName);

  // Tier 1: an explicit manifest alias for this state pointing at this clip.
  const alias = aliases[state];
  if (alias && normaliseClipName(alias) === normalised) {
    return { ok: true, via: 'manifest alias', normalised };
  }

  // Tier 2: the candidate list for the state.
  const candidates = CLIP_CANDIDATES[state];
  if (candidates?.some((c) => normaliseClipName(c) === normalised)) {
    return { ok: true, via: 'candidate list', normalised };
  }

  // Would it be captured by some *other* state? That is worse than not resolving,
  // because the clip silently serves the wrong thing.
  for (const [other, list] of Object.entries(CLIP_CANDIDATES)) {
    if (other === state) continue;
    if (list.some((c) => normaliseClipName(c) === normalised)) {
      return { ok: false, via: `CLAIMED BY "${other}"`, normalised };
    }
  }
  return { ok: false, via: 'no match — needs a manifest alias', normalised };
}

function main(): void {
  const argv = process.argv.slice(2);
  const assetId = argv.includes('--asset') ? argv[argv.indexOf('--asset') + 1] : 'hero_robot';
  const entry = ASSET_MANIFEST.find((e) => e.id === assetId);
  const aliases = entry?.clips ?? {};

  console.log('');
  console.log('='.repeat(88));
  console.log(`  ANIMATION LIBRARY PLAN — ${assetId}`);
  console.log('='.repeat(88));
  console.log(`  ${PLAN.length} clips proposed. Checking each against the live resolver.`);
  console.log('');
  console.log(`  ${'MIXAMO CLIP'.padEnd(24)} ${'-> STATE'.padEnd(12)} ${'NORMALISED'.padEnd(20)} RESOLVES VIA`);
  console.log('  ' + '-'.repeat(84));

  const needAlias: PlannedClip[] = [];
  const claimed: PlannedClip[] = [];
  const needWiring: PlannedClip[] = [];

  for (const clip of PLAN) {
    const r = resolves(clip.mixamo, clip.state, aliases);
    const mark = r.ok ? ' ok ' : 'FAIL';
    console.log(`  ${mark} ${clip.mixamo.padEnd(23)} ${clip.state.padEnd(12)} ${r.normalised.padEnd(20)} ${r.via}`);
    if (!r.ok) {
      if (r.via.startsWith('CLAIMED')) claimed.push(clip);
      else needAlias.push(clip);
    }
    if (clip.needsStateWiring) needWiring.push(clip);
  }

  console.log('  ' + '-'.repeat(84));
  const ok = PLAN.length - needAlias.length - claimed.length;
  console.log(`  ${ok}/${PLAN.length} resolve as named.`);

  if (needAlias.length) {
    console.log('');
    console.log('  MANIFEST ADDITIONS REQUIRED');
    console.log('  These names match no candidate. Add to the asset\'s `clips` map:');
    console.log('');
    console.log('    clips: {');
    for (const c of needAlias) {
      console.log(`      ${c.state}: '${c.mixamo}',`.padEnd(46) + `// ${c.note.split('.')[0]}`);
    }
    console.log('    },');
  }

  if (claimed.length) {
    console.log('');
    console.log('  NAME COLLISIONS');
    console.log('  These clips would silently serve a different state than intended:');
    for (const c of claimed) console.log(`    ${c.mixamo} -> wanted "${c.state}"`);
    console.log('  A manifest alias fixes it: an explicit mapping beats every candidate list.');
  }

  if (needWiring.length) {
    console.log('');
    console.log('  STATE WIRING REQUIRED (renderer, not manifest)');
    console.log('  `movementState()` does not produce these, so the clips will load and never play:');
    for (const c of needWiring) console.log(`    ${c.state.padEnd(10)} ${c.note}`);
  }

  // What the engine can actually drive today.
  console.log('');
  console.log('  GAMEPLAY STATES THE MAPPER PRODUCES TODAY');
  const produced = ['idle', 'walk', 'run', 'crouch', 'jump', 'fall', 'slide', 'death'];
  for (const state of produced) {
    const planned = PLAN.find((p) => p.state === state);
    const status = planned
      ? `covered by "${planned.mixamo}"`
      : CLIP_CANDIDATES[state]
        ? 'NOT IN PLAN — will fall back to another clip'
        : 'no candidate list';
    console.log(`    ${state.padEnd(10)} ${status}`);
  }
  console.log('');

  if (needAlias.length || claimed.length) process.exitCode = 1;
}

main();
