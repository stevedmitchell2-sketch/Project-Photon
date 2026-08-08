import { readFileSync } from 'fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Skeletal pose sanity check.
 *
 * An animation clip stores bone rotations *relative to the armature's rest pose*, so a clip authored
 * against one rest pose and applied to another produces a mangled character — arms folded through the
 * chest, feet pointing backwards. Every structural check passes: the joints are there, the weights
 * are valid, the channel counts are right, the clip names resolve. It is geometrically valid nonsense.
 *
 *     npm run pose-check -- public/assets/characters/PhotonServiceUnit_v01.glb [--self-test]
 *
 * ## Three ways this script lied before it worked
 *
 * Worth recording, because each one produced a confident wrong answer rather than an error.
 *
 * **Probes that never bound.** The first version looked bones up with
 * `getObjectByName('mixamorig:Head')` and skipped silently on a miss. three.js sanitises glTF node
 * names through `PropertyBinding.sanitizeNodeName`, which strips characters reserved in track paths —
 * the colon among them — so the rig's `mixamorig:Head` arrives as `mixamorigHead`. Every probe was
 * skipped and all 36 samples reported `ok`. A check that runs nothing passes everything.
 *
 * **The wrong skeleton.** Once the names matched, a scene-wide search still found the *first* bone of
 * that name, and this asset currently carries two complete Mixamo skeletons. It measured the stray
 * one and reported every clip as broken.
 *
 * **A self-test that could not fail.** Twisting a shoulder 90 degrees about Z moved the hand from
 * 0.493 m to 0.416 m out — nowhere near the band — so the sensitivity check passed while proving
 * nothing. It now inverts the hips, which no plausible pose survives.
 *
 * The shape of all three is the same: an instrument reporting success because it was not actually
 * looking. Which is exactly what this script exists to catch in the asset.
 */

interface Probe {
  bone: string;
  /** Height band as a fraction of the character's own height. */
  minY?: number;
  maxY?: number;
  /** Minimum horizontal distance from the hip centre line, in metres. */
  minLateral?: number;
}

/**
 * Landmarks worth asserting on a humanoid.
 *
 * Deliberately loose, and they have to hold across a crouch, a slide and a hard landing — poses where
 * the head legitimately drops toward hip height and a hand can pass close to the body. The target is
 * a mangled rig, which is not subtle.
 */
const PROBES: Probe[] = [
  // A slide puts the head near hip height — 0.24 on `Running Slide`, the lowest anything in the pack
  // reaches. 0.18 sits under that with room, and stays unreachable for a rig whose spine is folded
  // into the pelvis.
  { bone: 'mixamorig:Head', minY: 0.18 },
  { bone: 'mixamorig:Hips', minY: 0.10 },
  // A high knee reaches roughly half height; 0.80 leaves room for a kick.
  { bone: 'mixamorig:LeftFoot', maxY: 0.80 },
  { bone: 'mixamorig:RightFoot', maxY: 0.80 },
];

/**
 * Two hand probes were **removed rather than tuned**, which is worth explaining.
 *
 * A `minLateral` band on the hands — "a hand must not be inside the torso" — sounds like the ideal
 * test for a mangled rig, and it cannot work. Arms swing across the body constantly: `Jumping Up`
 * legitimately brings the left hand within **0.017 m** of the hip axis at frame 9. Any threshold a
 * real clip respects is far too small to catch a rig folded into itself.
 *
 * Loosening a band until the data passes turns a check into decoration. Deleting a probe that cannot
 * discriminate is honest; keeping it at a token value would not be. Sensitivity rests on the
 * head-above-hips assertion, which `--self-test` proves fires.
 */

/** Strips images/textures so the loader never touches the DOM. */
function stripTextures(glb: Buffer): ArrayBuffer {
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8')) as Record<string, unknown>;
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const material of (json.materials as Array<Record<string, unknown>>) ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    const pbr = material.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) {
      delete pbr.baseColorTexture;
      delete pbr.metallicRoughnessTexture;
    }
    const ext = material.extensions as Record<string, Record<string, unknown>> | undefined;
    for (const value of Object.values(ext ?? {})) {
      for (const name of Object.keys(value)) if (name.toLowerCase().includes('texture')) delete value[name];
    }
  }

  // Re-pack as a GLB. The BIN chunk is copied verbatim, so every accessor offset stays valid.
  const binStart = 20 + jsonLength;
  const binLength = glb.readUInt32LE(binStart);
  const bin = glb.subarray(binStart + 8, binStart + 8 + binLength);

  let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  while (jsonBytes.length % 4 !== 0) jsonBytes = Buffer.concat([jsonBytes, Buffer.from(' ')]);

  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBytes.length + 8 + bin.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  const out = Buffer.concat([header, jsonHeader, jsonBytes, binHeader, bin]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

/**
 * Clips that legitimately end with the character on the ground.
 *
 * `Falling Back Death` puts the head at 0.09 of height and *below* the hips two-thirds through,
 * because the robot is lying on its back. Every vertical assertion here is written for a standing
 * humanoid and none of them hold for a prone one.
 *
 * So these clips are exempted from the vertical probes and **reported as weakly checked**, rather
 * than the bands being widened until they pass. Widening would have cost the checks on all twelve
 * clips to accommodate one; hiding it would be worse. A prone clip is close to unchecked here, and
 * that is a real gap worth seeing in the output.
 */
const PRONE_CLIPS = [/death/i, /dying/i, /knock/i, /prone/i];

/** Name match that ignores whatever the loader did to separators. */
const key = (name: string): string => name.replace(/[^a-z0-9]/gi, '').toLowerCase();

/**
 * The bound skeleton's joint names, straight from the container, in skin order.
 *
 * Needed because three.js renames bones twice over. `PropertyBinding.sanitizeNodeName` drops the
 * colon (`mixamorig:Hips` -> `mixamorigHips`), and then, because this asset carries two skeletons
 * with identical node names, the loader appends `_1` to disambiguate the second — so the bones that
 * actually deform the mesh are called `mixamorigHips_1`. Matching on the name gave a false negative
 * on all six probes.
 *
 * `Skeleton.bones` is built in `skin.joints` order, so an index is exact and survives any renaming.
 */
function boundJointNames(glb: Buffer): string[] {
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  const meshNode = json.nodes.find((n: { mesh?: number }) => n.mesh !== undefined);
  const skin = json.skins[meshNode.skin];
  return skin.joints.map((j: number) => json.nodes[j].name ?? '');
}

async function main(): Promise<void> {
  const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('usage: npm run pose-check -- <file.glb> [--self-test]');
    process.exitCode = 1;
    return;
  }

  const gltf = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>(
    (resolve, reject) => {
      new GLTFLoader().parse(stripTextures(readFileSync(path)), '', resolve as never, reject);
    },
  );

  // The mesh with the most vertices is the character, and its `skeleton` is the authoritative bone
  // list — the only one that can affect what a player sees. A scene-wide name search is not
  // equivalent: this asset carries a second, unused Mixamo skeleton with identical bone names.
  let biggest: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((node) => {
    const candidate = node as THREE.SkinnedMesh;
    if (!candidate.isSkinnedMesh) return;
    const count = candidate.geometry.attributes.position.count;
    if (!biggest || count > biggest.geometry.attributes.position.count) biggest = candidate;
  });
  if (!biggest) {
    console.error('  no skinned mesh.');
    process.exitCode = 1;
    return;
  }
  const skinned = biggest as THREE.SkinnedMesh;
  const bones = skinned.skeleton.bones;

  gltf.scene.updateMatrixWorld(true);
  // Height from the character's own bind-pose geometry, not the scene: a scene box would include the
  // stray skeleton and every fraction would be measured against the wrong number.
  const box = new THREE.Box3().setFromObject(skinned);
  const height = box.max.y - box.min.y;

  console.log('');
  console.log('='.repeat(78));
  console.log(`  POSE CHECK — ${path.split(/[\\/]/).pop()}`);
  console.log('='.repeat(78));
  console.log(`  mesh "${skinned.name}"  ${bones.length} bones  height ${height.toFixed(3)} m  ${gltf.animations.length} clip(s)`);

  const jointNames = boundJointNames(readFileSync(path));
  const boneFor = (name: string): THREE.Bone | null => {
    const index = jointNames.findIndex((j) => key(j) === key(name));
    return index >= 0 ? (bones[index] ?? null) : null;
  };
  const bound = PROBES.map((probe) => ({ probe, bone: boneFor(probe.bone) }));
  const unbound = bound.filter((b) => !b.bone).map((b) => b.probe.bone);
  if (unbound.length) {
    console.log(`\n  FAIL  probe bone(s) not in the bound skeleton: ${unbound.join(', ')}`);
    console.log('        Reporting a pass here would be a check that ran nothing.\n');
    process.exitCode = 1;
    return;
  }
  const head = boneFor('mixamorig:Head')!;
  const hips = boneFor('mixamorig:Hips')!;
  console.log(`  ${bound.length} probes bound to bones of the deforming skeleton.`);
  console.log('');
  console.log(`  ${'CLIP'.padEnd(20)} ${'FRAME'.padEnd(6)} RESULT`);
  console.log('  ' + '-'.repeat(72));

  const mixer = new THREE.AnimationMixer(gltf.scene);
  const position = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  let failures = 0;

  for (const clip of gltf.animations) {
    const action = mixer.clipAction(clip);
    action.reset();
    action.play();

    // Three points through each clip, so a bad pose cannot hide between keyframes.
    for (const fraction of [0, 0.33, 0.66]) {
      mixer.setTime(clip.duration * fraction);
      gltf.scene.updateMatrixWorld(true);

      const problems: string[] = [];
      const prone = PRONE_CLIPS.some((re) => re.test(clip.name)) && fraction > 0;
      hips.getWorldPosition(scratch);
      const hipX = scratch.x;
      const hipZ = scratch.z;
      for (const { probe, bone } of bound) {
        bone!.getWorldPosition(position);
        const label = probe.bone.replace('mixamorig:', '');
        const y = (position.y - box.min.y) / height;
        if (!prone && probe.minY !== undefined && y < probe.minY) problems.push(`${label} too low (${y.toFixed(2)})`);
        if (!prone && probe.maxY !== undefined && y > probe.maxY) problems.push(`${label} too high (${y.toFixed(2)})`);
        if (probe.minLateral !== undefined) {
          const lateral = Math.hypot(position.x - hipX, position.z - hipZ);
          if (lateral < probe.minLateral) problems.push(`${label} inside the torso (${lateral.toFixed(3)} m out)`);
        }
      }

      // The crudest check, and the one an inverted rig cannot survive — for a standing pose.
      if (!prone && head.getWorldPosition(position).y <= hips.getWorldPosition(scratch).y) {
        problems.push('head is not above hips');
      }

      if (problems.length) failures++;
      console.log(
        `  ${(fraction === 0 ? clip.name : '').padEnd(20)} ${`${Math.round(clip.duration * fraction * 30)}`.padEnd(6)} ` +
          (problems.length ? `FAIL  ${problems.join('; ')}` : prone ? 'ok  (prone — vertical probes skipped, weakly checked)' : 'ok'),
      );
    }
    action.stop();
  }

  console.log('  ' + '-'.repeat(72));
  console.log(
    `  ${failures === 0 ? `every clip poses the skeleton plausibly (${gltf.animations.length * 3} samples)` : `${failures} sample(s) implausible`}`,
  );

  if (process.argv.includes('--self-test')) {
    // Invert the hips. No plausible pose puts the head below the pelvis, so if this does not trip
    // the check, the check is not measuring anything.
    mixer.stopAllAction();
    gltf.scene.updateMatrixWorld(true);
    const upright = head.getWorldPosition(position).y - hips.getWorldPosition(scratch).y;
    hips.rotateX(Math.PI);
    gltf.scene.updateMatrixWorld(true);
    const inverted = head.getWorldPosition(position).y - hips.getWorldPosition(scratch).y;
    const caught = inverted <= 0;
    console.log('');
    console.log(`  self-test: head is ${upright.toFixed(3)} m above hips upright, ${inverted.toFixed(3)} m after inverting them`);
    console.log(`  self-test: ${caught ? 'probe FIRES — the check is sensitive' : 'probe DID NOT FIRE — the check is measuring nothing'}`);
    if (!caught) process.exitCode = 1;
  }

  console.log('');
  if (failures) process.exitCode = 1;
}

void main();
