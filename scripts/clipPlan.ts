import { readdirSync } from 'fs';
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
 *   npm run clip-plan -- --folder "C:/path/to/Clips"     # check the real downloads
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
 *
 * ## Why --folder exists
 *
 * Checking the *plan* only proves the plan is self-consistent. It cannot catch the plan being wrong
 * about what Mixamo calls something, and it was: the pack asked for `Crouch Idle` for a whole pass
 * and the real clip is **`Crouching Idle`**, which resolved to nothing. Twelve files were downloaded
 * before anyone found out.
 *
 * `--folder` resolves the filenames actually sitting on disk. It is the same check one step later,
 * against reality instead of intent, and it costs a second before an hour in Blender.
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
    note: 'Longer stride for the sprint band. Driven by the sprint tier of the mapper, above the dead band centred between walkSpeed and sprintSpeed.' },
  { state: 'crouch', mixamo: 'Crouching Idle',
    note: 'Crouched hold. Photon crouch is a stance, not a movement, so the idle is the right pick. Named Crouching Idle, not Crouch Idle — checked against the real download.' },
  { state: 'slide', mixamo: 'Running Slide',
    note: 'Photon has a real slide stance and the mapper produces it. Missing from the first draft of this plan, which the checker caught.' },

  // --- Airborne ----------------------------------------------------------
  { state: 'jump', mixamo: 'Jumping Up',
    note: 'Launch only. The full "Jump" clip includes a landing, which would fight the fall and landing states.' },
  { state: 'fall', mixamo: 'Falling Idle',
    note: 'Airborne loop. The name the fall state failed to match before the candidate lists were corrected.' },
  { state: 'landing', mixamo: 'Hard Landing',
    note: 'Impact absorb. Driven by the grounded-transition edge in the mapper and played held, not looped.' },

  // --- Presence ----------------------------------------------------------
  { state: 'turning', mixamo: 'Left Turn',
    note: 'Turn in place. Driven by yaw rate against the replicated prevYaw of the actor. A separate Right Turn download is used automatically if present.' },
  { state: 'interact', mixamo: 'Button Pushing',
    note: 'The service animation. Driven by triggerInteract(actorId), which plays a clip and carries no gameplay behaviour.' },

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

/** Resolve the real downloaded filenames. Catches a plan that is wrong about Mixamo's naming. */
function checkFolder(folder: string, aliases: Record<string, string>): void {
  let files: string[];
  try {
    files = readdirSync(folder).filter((f) => /\.fbx$/i.test(f)).sort();
  } catch {
    console.log(`  cannot read ${folder}`);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('='.repeat(88));
  console.log(`  DOWNLOADED CLIPS — ${folder}`);
  console.log('='.repeat(88));
  if (files.length === 0) {
    console.log('  no .fbx files here.');
    process.exitCode = 1;
    return;
  }
  console.log(`  ${files.length} file(s). Resolving each filename the way the engine will.`);
  console.log('');
  console.log(`  ${'FILE'.padEnd(28)} ${'NORMALISED'.padEnd(22)} RESOLVES TO`);
  console.log('  ' + '-'.repeat(84));

  const unresolved: string[] = [];
  const covered = new Set<string>();
  for (const file of files) {
    // Strip Mixamo's character prefix and the browser's duplicate suffix, exactly as
    // photon_import_clips.py does, so this reports what the importer will name the action.
    let name = file.replace(/\.fbx$/i, '');
    if (name.includes('@')) name = name.split('@').slice(-1)[0];
    name = name.replace(/ \(\d+\)$/, '').trim();

    const normalised = normaliseClipName(name);
    let via = '';
    for (const [state, clip] of Object.entries(aliases)) {
      if (normaliseClipName(clip) === normalised) via = `${state}  (manifest alias)`;
    }
    if (!via) {
      for (const [state, list] of Object.entries(CLIP_CANDIDATES)) {
        if (list.some((c) => normaliseClipName(c) === normalised)) via = `${state}  (candidate list)`;
      }
    }
    if (via) covered.add(via.split(' ')[0]);
    else unresolved.push(name);
    console.log(`  ${via ? ' ok ' : 'FAIL'} ${name.padEnd(23)} ${normalised.padEnd(22)} ${via || 'NOTHING — the state will never switch to it'}`);
  }

  console.log('  ' + '-'.repeat(84));
  console.log(`  ${files.length - unresolved.length}/${files.length} resolve.`);

  const missing = PLAN.map((p) => p.state).filter((state) => !covered.has(state));
  if (missing.length) {
    console.log('');
    console.log('  STATES WITH NO FILE ON DISK');
    for (const state of missing) {
      const planned = PLAN.find((p) => p.state === state);
      console.log(`    ${state.padEnd(10)} expects "${planned?.mixamo}"`);
    }
  }
  if (unresolved.length) {
    console.log('');
    console.log('  UNRESOLVED FILENAMES');
    console.log('  Either the download is named differently than the plan expects, or the plan is');
    console.log('  wrong about what Mixamo calls it. Check Mixamo before renaming the file — the');
    console.log('  candidate list is meant to carry the real name.');
    for (const name of unresolved) console.log(`    ${name}`);
    process.exitCode = 1;
  }
  console.log('');
}

function main(): void {
  const argv = process.argv.slice(2);
  const assetId = argv.includes('--asset') ? argv[argv.indexOf('--asset') + 1] : 'hero_robot';
  const entry = ASSET_MANIFEST.find((e) => e.id === assetId);
  const aliases = entry?.clips ?? {};

  const folderIndex = argv.indexOf('--folder');
  if (folderIndex >= 0) {
    checkFolder(argv[folderIndex + 1], aliases);
    return;
  }

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
    console.log('  The state mapper does not produce these, so the clips will load and never play:');
    for (const c of needWiring) console.log(`    ${c.state.padEnd(10)} ${c.note}`);
  }

  // What the engine can actually drive today.
  console.log('');
  console.log('  GAMEPLAY STATES THE MAPPER PRODUCES TODAY');
  const produced = ['idle', 'walk', 'run', 'sprint', 'crouch', 'slide', 'jump', 'fall', 'landing', 'turning', 'interact', 'death'];
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
