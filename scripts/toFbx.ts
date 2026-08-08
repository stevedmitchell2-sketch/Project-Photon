import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve, basename } from 'path';

/**
 * GLB to FBX, for Mixamo upload.
 *
 *     npm run to-fbx -- assets/source/tripo/HeroAthlete_v01_game.glb
 *
 * Mixamo's character uploader does not accept GLB — it takes FBX, OBJ or ZIP — and Tripo exports GLB.
 * That format gap sits directly between the two halves of the asset pipeline, so it is worth one
 * command rather than a manual Blender round trip every time.
 *
 * Output lands beside the input as `<name>_for_mixamo.fbx` unless `--out` says otherwise.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = 'tools/blender/photon_glb_to_fbx.py';

const BLENDER_CANDIDATES = [
  process.env.PHOTON_BLENDER,
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
  'blender',
].filter(Boolean) as string[];

function findBlender(): string | null {
  for (const candidate of BLENDER_CANDIDATES) {
    if (candidate === 'blender') {
      if (spawnSync(candidate, ['--version'], { encoding: 'utf8' }).status === 0) return candidate;
      continue;
    }
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function main(): void {
  const args = process.argv.slice(2);
  const input = args.find((a) => !a.startsWith('--'));
  if (!input) {
    console.error('\n  usage: npm run to-fbx -- <model.glb> [--out <model.fbx>]\n');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(input)) {
    console.error(`\n  no such file: ${input}\n`);
    process.exitCode = 1;
    return;
  }

  const outIndex = args.indexOf('--out');
  const output =
    outIndex >= 0
      ? args[outIndex + 1]
      : resolve(dirname(input), basename(input).replace(/\.glb$/i, '') + '_for_mixamo.fbx');

  const blender = findBlender();
  if (!blender) {
    console.error(`\n  no Blender found. Tried:\n    ${BLENDER_CANDIDATES.join('\n    ')}\n`);
    process.exitCode = 1;
    return;
  }

  // `--factory-startup` so the conversion cannot inherit add-on state or a stray scene: the output
  // then depends only on the input.
  const result = spawnSync(
    blender,
    ['--background', '--factory-startup', '--python', SCRIPT, '--', '--in', resolve(input), '--out', resolve(output)],
    { cwd: REPO, stdio: 'inherit', shell: false },
  );
  if (result.status !== 0) {
    console.error('\n  conversion failed\n');
    process.exitCode = 1;
  }
}

main();
