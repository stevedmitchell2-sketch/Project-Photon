import { readFileSync, writeFileSync, existsSync } from 'fs';

/**
 * The character asset's structural fingerprint.
 *
 * "Fail loudly if the rig changes" needs something to compare against, and until now there was
 * nothing: every check in the pipeline asserted a *count*. A count cannot tell you that
 * `mixamorig:LeftHand` became `mixamorig:LeftHand_1`, that `SOCKET_backpack` was renamed, or that a
 * material zone was silently swapped — all of which keep the count and break the engine, because the
 * engine binds by name.
 *
 *     npm run character-baseline -- --write      # record the current asset as correct
 *     npm run character-baseline                 # compare the asset against the record
 *
 * The baseline is committed. It is small, it is text, and a diff on it is a review of exactly what
 * changed about the rig — which is the thing nobody would otherwise notice until a socket stopped
 * carrying a weapon.
 */

const ASSET = 'public/assets/characters/PhotonServiceUnit_v01.glb';
const BASELINE = 'assets/character.baseline.json';

interface Baseline {
  /** What this file is, for anyone who opens it without context. */
  note: string;
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
      'Structural fingerprint of the Photon character. Regenerate deliberately with ' +
      '`npm run character-baseline -- --write`; a diff here is a rig change and should be reviewed.',
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
  const write = process.argv.includes('--write');
  const path = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? ASSET;

  if (!existsSync(path)) {
    console.error(`\n  no asset at ${path}\n`);
    process.exitCode = 1;
    return;
  }

  const current = fingerprint(path);

  if (write) {
    writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
    console.log('');
    console.log(`  recorded ${BASELINE}`);
    console.log(`    ${current.jointCount} joints · ${current.sockets.length} sockets · ` +
      `${current.materials.length} materials · ${current.images.length} textures · ` +
      `${current.clips.length} clips · ${current.triangles.toLocaleString()} tris`);
    console.log('');
    return;
  }

  if (!existsSync(BASELINE)) {
    console.error(`\n  no baseline at ${BASELINE}. Record one with:`);
    console.error('    npm run character-baseline -- --write\n');
    process.exitCode = 1;
    return;
  }

  const recorded = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
  const problems = compare(current, recorded);

  console.log('');
  console.log('  ' + '='.repeat(70));
  console.log('  CHARACTER BASELINE');
  console.log('  ' + '='.repeat(70));
  console.log(`  ${current.jointCount} joints · ${current.sockets.length} sockets · ` +
    `${current.materials.length} materials · ${current.images.length} textures · ` +
    `${current.clips.length} clips · ${current.triangles.toLocaleString()} tris`);
  console.log('');
  if (problems.length === 0) {
    console.log('  ok  structurally identical to the recorded baseline.');
  } else {
    for (const p of problems) console.log(`  FAIL  ${p}`);
    console.log('');
    console.log('  If a change was intended, re-record deliberately:');
    console.log('    npm run character-baseline -- --write');
    process.exitCode = 1;
  }
  console.log('');
}

main();
