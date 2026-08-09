import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

/**
 * New character setup: a Mixamo-rigged FBX plus a Tripo high-poly, out comes a finished `.blend`.
 *
 *     npm run setup-character -- --rigged <tpose.fbx> --highpoly <hd.glb> --out <character.blend>
 *     npm run setup-character -- --rigged <tpose.fbx> --out <character.blend> --no-bake
 *
 * Runs unwrap, material zones, energy channels, the high-to-low normal + AO bake, sockets and the
 * height scale — then saves. `npm run build-character` takes it from there.
 *
 * The bake is Cycles and takes minutes. `--no-bake` skips it for a quick structural pass.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = 'tools/blender/photon_setup_character.py';

const BLENDER_CANDIDATES = [
  process.env.PHOTON_BLENDER,
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
  'blender',
].filter(Boolean) as string[];

function findBlender(): string | null {
  for (const c of BLENDER_CANDIDATES) {
    if (c === 'blender') {
      if (spawnSync(c, ['--version'], { encoding: 'utf8' }).status === 0) return c;
      continue;
    }
    if (existsSync(c)) return c;
  }
  return null;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const rigged = arg('rigged');
  const highpoly = arg('highpoly');
  const out = arg('out');
  if (!rigged || !out) {
    console.error('\n  usage: npm run setup-character -- --rigged <tpose.fbx> --out <file.blend>');
    console.error('           [--highpoly <hd.glb>] [--no-bake]\n');
    process.exitCode = 1;
    return;
  }
  const blender = findBlender();
  if (!blender) {
    console.error(`\n  no Blender found. Tried:\n    ${BLENDER_CANDIDATES.join('\n    ')}\n`);
    process.exitCode = 1;
    return;
  }

  // `--factory-startup` so the result depends only on the inputs, never on add-on state.
  const args = ['--background', '--factory-startup', '--python', SCRIPT, '--',
    '--rigged', resolve(rigged), '--out', resolve(out)];
  if (highpoly) args.push('--highpoly', resolve(highpoly));
  if (process.argv.includes('--no-bake')) args.push('--no-bake');

  const result = spawnSync(blender, args, { cwd: REPO, stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exitCode = 1;
}

main();
