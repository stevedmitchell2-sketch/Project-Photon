import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, join } from 'path';

/**
 * The character pipeline, end to end.
 *
 *     npm run build-character
 *     npm run build-character -- --blend "C:/path/to/HeroAthlete.blend" --out HeroAthlete_v01.glb
 *     npm run build-character -- --promote      # replace the live asset on success
 *
 * Drops Mixamo FBX files into `assets/source/mixamo/`, and this does the rest: prunes stray
 * armatures, imports and names every clip, exports a GLB, then validates it four ways and refuses to
 * promote anything that fails.
 *
 * ## Why it stages instead of overwriting
 *
 * The build writes to `assets/source/.build/` and only copies over the live asset with `--promote`.
 * Every failure mode found while building this pipeline produced a file that *loaded* — 98 joints in
 * two skins, eleven clips on the wrong skeleton, a rig whose bones had been silently renamed. None of
 * them threw. If the build wrote straight to `public/assets/`, a broken export would replace a
 * working one and the only symptom would be a character that stopped moving.
 *
 * So the validation runs against the staged file, and the live asset is only touched once the staged
 * one has passed.
 *
 * ## What it does not do
 *
 * No retopology, no unwrapping, no baking, no material assignment, no socket placement. Those are
 * one-time authoring passes; re-running them would overwrite hand work. And it never saves the
 * `.blend` — the production file is read-only input, so the build is repeatable and cannot corrupt
 * its own source.
 */

// The project is ESM, so `__dirname` does not exist. Derived from import.meta instead.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIPS = 'assets/source/mixamo';
const BUILD_DIR = 'assets/source/.build';
const LIVE_DIR = 'public/assets/characters';
const DEFAULT_OUT = 'PhotonServiceUnit_v01.glb';
const BUILD_SCRIPT = 'tools/blender/photon_build_character.py';

/**
 * Where the authoring `.blend` lives.
 *
 * Outside the repository by default, because that is where it is and moving a 76 MB production file
 * is not this script's business. Override with `--blend` or `PHOTON_BLEND` rather than editing this.
 */
const DEFAULT_BLEND =
  process.env.PHOTON_BLEND ??
  'C:/Users/Home/Documents/Photon Tools/Exports/Photon_Robot_Animation_Working.blend';

/** Blender executables to try, in order. `PHOTON_BLENDER` wins. */
const BLENDER_CANDIDATES = [
  process.env.PHOTON_BLENDER,
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
  'blender',
].filter(Boolean) as string[];

function findBlender(): string | null {
  for (const candidate of BLENDER_CANDIDATES) {
    if (candidate === 'blender') {
      const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
      if (probe.status === 0) return candidate;
      continue;
    }
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

let step = 0;
function heading(text: string): void {
  step++;
  console.log('');
  console.log(`  [${step}] ${text}`);
  console.log('  ' + '-'.repeat(70));
}

function die(message: string): never {
  console.error('');
  console.error(`  BUILD FAILED — ${message}`);
  console.error('');
  console.error('  The live asset was not touched.');
  console.error('');
  process.exit(1);
}

/**
 * Runs one of the repo's own tsx scripts.
 *
 * Spawns `node --import tsx` rather than the `tsx` shim or `npx`. Both of those are `.cmd` files on
 * Windows, which `spawnSync` cannot resolve without `shell: true` — and a shell then re-splits this
 * repository's path at the space in "100 men vs gorilla", turning the command into a truncated path.
 * Going straight to the Node binary avoids the shell, and therefore the quoting problem, entirely.
 */
function runScript(label: string, args: string[]): void {
  run(label, process.execPath, ['--import', 'tsx', ...args]);
}

/** Runs a command, streaming its output, and dies on a non-zero exit. */
function run(label: string, command: string, args: string[]): void {
  // Never a shell: this repository's own path contains spaces, and cmd.exe re-splits it.
  const result = spawnSync(command, args, { cwd: REPO, stdio: 'inherit', shell: false });
  if (result.error) die(`${label}: ${result.error.message}`);
  if (result.status !== 0) die(`${label} exited ${result.status}`);
}

function main(): void {
  const blend = arg('blend') ?? DEFAULT_BLEND;
  const promote = process.argv.includes('--promote');
  // `--out` names the GLB, and its stem keys the baseline. A second character is a second .blend and
  // a second output file; nothing else about the pipeline changes.
  const outFile = arg('out') ?? DEFAULT_OUT;
  const STAGE = join(BUILD_DIR, outFile);
  const LIVE = join(LIVE_DIR, outFile);
  const baselineId = outFile.replace(/\.glb$/i, '');

  console.log('');
  console.log('='.repeat(76));
  console.log('  PHOTON — BUILD CHARACTER');
  console.log('='.repeat(76));

  heading('Preflight');
  const blender = findBlender();
  if (!blender) die(`no Blender found. Tried:\n      ${BLENDER_CANDIDATES.join('\n      ')}`);
  console.log(`  blender   ${blender}`);

  if (!existsSync(blend)) die(`no .blend at ${blend}\n      Pass --blend <path> or set PHOTON_BLEND.`);
  console.log(`  blend     ${blend}  (${(statSync(blend).size / 1048576).toFixed(0)} MB, read-only)`);

  if (!existsSync(CLIPS)) die(`no clips folder at ${CLIPS}`);
  const fbx = readdirSync(CLIPS).filter((f) => f.toLowerCase().endsWith('.fbx'));
  if (fbx.length === 0) {
    die(`no .fbx files in ${CLIPS}\n      See ${CLIPS}/README.md for the download list and settings.`);
  }
  console.log(`  clips     ${fbx.length} FBX in ${CLIPS}`);
  console.log(`  output    ${STAGE}  (baseline id "${baselineId}")`);

  // Cheapest check first, and the one that catches a typo before Blender spends a minute on it.
  heading('Resolve clip filenames against the engine');
  runScript('clip-plan', ['scripts/clipPlan.ts', '--folder', CLIPS]);

  heading('Blender: prune, import, export (headless)');
  mkdirSync(dirname(STAGE), { recursive: true });
  run('blender', blender, [
    '--background',
    blend,
    '--python',
    BUILD_SCRIPT,
    '--',
    '--clips',
    resolve(REPO, CLIPS),
    '--out',
    resolve(REPO, STAGE),
  ]);
  if (!existsSync(STAGE)) die('Blender reported success but wrote no file');

  heading('Validate: structure, budgets, contract');
  runScript('asset-inspect', [
    'scripts/assetInspect.ts',
    STAGE,
    '--kind',
    'character',
    '--expect-clips',
    String(fbx.length),
    // Budget overages are warnings here, structural defects are still failures. The character's
    // 3.4x triangle overage and 4.3x texture memory were measured and accepted — GPU cost was flat
    // from 1 to 16 robots, so LODs were declined on evidence. A gate that can never pass on the
    // asset it guards is a gate everyone learns to ignore.
    '--budget-warn',
  ]);

  heading('Validate: rig fingerprint against the recorded baseline');
  // `--init` records a fingerprint the first time a given asset is built and compares on every build
  // after. Without it a new character cannot pass its own first build — there is nothing to compare
  // against — and requiring a manual `--write` first would mean the usual response to a red build was
  // to re-record the baseline, which defeats the check.
  //
  // `--id` keys the baseline to the asset rather than to the pipeline. The athlete's Mixamo auto-rig
  // has 57 bones against the Service Unit's 49, and both are correct.
  runScript('character-baseline', ['scripts/characterBaseline.ts', STAGE, '--id', baselineId, '--init']);

  heading('Validate: skeletal poses');
  runScript('pose-check', ['scripts/poseCheck.ts', STAGE, '--self-test']);

  console.log('');
  console.log('='.repeat(76));
  console.log(`  ALL CHECKS PASSED — ${STAGE}`);
  console.log('='.repeat(76));

  if (promote) {
    copyFileSync(STAGE, LIVE);
    console.log('');
    console.log(`  promoted to ${LIVE}`);
    console.log('  Reload the dev server to pick it up.');
  } else {
    console.log('');
    console.log('  Staged, not promoted. The live asset is unchanged.');
    console.log('  Promote it with:');
    console.log('    npm run build-character -- --promote');
  }
  console.log('');
}

main();
