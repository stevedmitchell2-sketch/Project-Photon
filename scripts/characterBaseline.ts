import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { basename, join } from 'path';

/**
 * The character asset's structural fingerprint.
 *
 * "Fail loudly if the rig changes" needs something to compare against, and until now there was
 * nothing: every check in the pipeline asserted a *count*. A count cannot tell you that
 * `mixamorig:LeftHand` became `mixamorig:LeftHand_1`, that `SOCKET_backpack` was renamed, or that a
 * material zone was silently swapped — all of which keep the count and break the engine, because the
 * engine binds by name.
 *
 *     npm run character-baseline -- <file.glb> --write   # record it as correct
 *     npm run character-baseline -- <file.glb>           # compare against the record
 *     npm run character-baseline -- <file.glb> --init    # record only if none exists
 *
 * The baseline is committed. It is small, it is text, and a diff on it is a review of exactly what
 * changed about the rig — which is the thing nobody would otherwise notice until a socket stopped
 * carrying a weapon.
 */

const ASSET = 'public/assets/characters/PhotonServiceUnit_v01.glb';
const BASELINE_DIR = 'assets/baselines';

/**
 * Baseline path for an asset. `--id` overrides; otherwise the filename is the key.
 *
 * One baseline per asset, because a second character is not a variation on the first. The athlete's
 * Mixamo auto-rig has **57** bones where the Service Unit has 49 — the eight extras are ring-finger
 * joints, and all 49 the clips address are present. Checking the athlete against the Service Unit's
 * fingerprint would fail on a difference that is not an error, and a check that fails when nothing is
 * wrong stops being read.
 */
function baselinePath(assetPath: string, id?: string): string {
  return join(BASELINE_DIR, `${id ?? basename(assetPath).replace(/\.glb$/i, '')}.json`);
}

interface Baseline {
  /** What this file is, for anyone who opens it without context. */
  note: string;
  /** Which asset this fingerprint belongs to. */
  asset: string;
  jointCount: number;
  /** Every joint name, in skin order. Order matters: clips bind to it. */
  joints: string[];
  sockets: string[];
  materials: string[];
  images: string[];
  clips: string[];
  vertices: number;
  triangles: number;
}

function fingerprint(path: string): Baseline {
  const glb = readFileSync(path);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));

  const meshNode = json.nodes.find((n: { mesh?: number }) => n.mesh !== undefined);
  if (meshNode?.skin === undefined) throw new Error('no skinned mesh node — the rig is gone');
  const skin = json.skins[meshNode.skin];

  let triangles = 0;
  let vertices = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const pos = json.accessors[prim.attributes.POSITION];
      vertices += pos.count;
      triangles += prim.indices !== undefined ? json.accessors[prim.indices].count / 3 : pos.count / 3;
    }
  }

  return {
    note:
      'Structural fingerprint of a Photon character. Regenerate deliberately with ' +
      '`npm run character-baseline -- <file.glb> --write`; a diff here is a rig change and ' +
      'should be reviewed rather than accepted.',
    asset: basename(path),
    jointCount: skin.joints.length,
    joints: skin.joints.map((j: number) => json.nodes[j].name ?? ''),
    sockets: (json.nodes as Array<{ name?: string }>)
      .map((n) => n.name ?? '')
      .filter((n) => n.startsWith('SOCKET_'))
      .sort(),
    materials: (json.materials ?? []).map((m: { name?: string }) => m.name ?? '').sort(),
    images: (json.images ?? []).map((i: { name?: string }) => i.name ?? '').sort(),
    clips: (json.animations ?? []).map((a: { name?: string }) => a.name ?? '').sort(),
    vertices,
    triangles: Math.round(triangles),
  };
}

/** Differences that matter, in plain language. */
function compare(current: Baseline, recorded: Baseline): string[] {
  const problems: string[] = [];

  const setDiff = (label: string, now: string[], before: string[]) => {
    const gone = before.filter((x) => !now.includes(x));
    const added = now.filter((x) => !before.includes(x));
    if (gone.length) problems.push(`${label} MISSING: ${gone.join(', ')}`);
    if (added.length) problems.push(`${label} unexpected: ${added.join(', ')}`);
  };

  if (current.jointCount !== recorded.jointCount) {
    problems.push(`joint count ${recorded.jointCount} -> ${current.jointCount}`);
  }
  // Order-sensitive on purpose: `Skeleton.bones` is built in this order and clips bind to it, so a
  // reordering is a real break even when every name is still present.
  if (current.joints.join('|') !== recorded.joints.join('|')) {
    const gone = recorded.joints.filter((j) => !current.joints.includes(j));
    const added = current.joints.filter((j) => !recorded.joints.includes(j));
    if (gone.length || added.length) {
      if (gone.length) problems.push(`joints MISSING: ${gone.join(', ')}`);
      if (added.length) problems.push(`joints unexpected: ${added.join(', ')}`);
    } else {
      problems.push('joint order changed (same names) — clips bind by index and will mis-target');
    }
  }
  setDiff('sockets', current.sockets, recorded.sockets);
  setDiff('materials', current.materials, recorded.materials);
  setDiff('textures', current.images, recorded.images);
  setDiff('clips', current.clips, recorded.clips);

  // Geometry is allowed to move a little — a re-export is not bit-identical — but not by much. A
  // large jump means the high-poly bake source leaked into the export, which is silent otherwise:
  // it loads, it renders, and it costs 60x the triangles.
  const drift = recorded.triangles ? Math.abs(current.triangles - recorded.triangles) / recorded.triangles : 0;
  if (drift > 0.05) {
    problems.push(
      `triangles ${recorded.triangles.toLocaleString()} -> ${current.triangles.toLocaleString()} ` +
        `(${(drift * 100).toFixed(0)}% drift) — check the bake source did not export`,
    );
  }
  return problems;
}

function main(): void {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  /**
   * `--init` records a baseline when none exists and compares when one does.
   *
   * It lets a brand-new character go through the pipeline without a chicken-and-egg step, while an
   * established one still cannot be quietly re-recorded to make a failure go away — that needs
   * `--write`, which is a deliberate act with a diff to review.
   */
  const init = argv.includes('--init');
  const idIndex = argv.indexOf('--id');
  const id = idIndex >= 0 ? argv[idIndex + 1] : undefined;
  const path = argv.filter((a) => !a.startsWith('--') && a !== id)[0] ?? ASSET;
  const baseline = baselinePath(path, id);

  if (!existsSync(path)) {
    console.error(`\n  no asset at ${path}\n`);
    process.exitCode = 1;
    return;
  }

  const current = fingerprint(path);
  const summary =
    `${current.jointCount} joints · ${current.sockets.length} sockets · ` +
    `${current.materials.length} materials · ${current.images.length} textures · ` +
    `${current.clips.length} clips · ${current.triangles.toLocaleString()} tris`;

  if (write || (init && !existsSync(baseline))) {
    mkdirSync(BASELINE_DIR, { recursive: true });
    writeFileSync(baseline, JSON.stringify(current, null, 2) + '\n');
    console.log('');
    console.log(`  recorded ${baseline}`);
    console.log(`    ${summary}`);
    console.log('');
    return;
  }

  if (!existsSync(baseline)) {
    console.error(`\n  no baseline at ${baseline}. Record one with:`);
    console.error(`    npm run character-baseline -- ${path} --write\n`);
    process.exitCode = 1;
    return;
  }

  const recorded = JSON.parse(readFileSync(baseline, 'utf8')) as Baseline;
  const problems = compare(current, recorded);

  console.log('');
  console.log('  ' + '='.repeat(70));
  console.log(`  CHARACTER BASELINE — ${basename(path)}`);
  console.log('  ' + '='.repeat(70));
  console.log(`  ${summary}`);
  console.log('');
  if (problems.length === 0) {
    console.log('  ok  structurally identical to the recorded baseline.');
  } else {
    for (const p of problems) console.log(`  FAIL  ${p}`);
    console.log('');
    console.log('  If a change was intended, re-record deliberately:');
    console.log(`    npm run character-baseline -- ${path} --write`);
    process.exitCode = 1;
  }
  console.log('');
}

main();
