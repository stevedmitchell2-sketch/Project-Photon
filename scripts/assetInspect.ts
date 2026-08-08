import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  ANIMATED_PARTS,
  ASSET_BUDGETS,
  NODE_PREFIX,
  REQUIRED_SOCKETS,
  type AssetKind,
} from '../src/assets/contract';

/**
 * Inbound asset inspector.
 *
 * `asset-audit` checks the *registry* — which specified assets exist and whether the manifest is
 * coherent. This checks a **file that just arrived**, before anyone decides what to do with it, and
 * answers the only question that matters on the first pass: is this production-ready, and if not,
 * exactly what has to happen to it?
 *
 *   npm run asset-inspect -- "path/to/model.glb"
 *   npm run asset-inspect -- "path/to/model.glb" --kind character
 *
 * It runs on the raw container, with no three.js and no browser, so it works on a 60 MB file in
 * milliseconds and can be pointed at anything a supplier sends.
 *
 * ## Why the rig check is first
 *
 * Every other property of a character asset can be fixed downstream. Triangles can be decimated,
 * textures resized, scale corrected, materials remapped — all of it is pipeline work on geometry
 * that already exists. A missing skeleton cannot be fixed downstream: it is authoring, it needs a
 * human or a rigging service, and no amount of importer work substitutes for it.
 *
 * So the rig verdict gates the report. An unrigged character is not a character that needs
 * optimising; it is a static prop that happens to be shaped like one.
 */

interface Gltf {
  asset?: { version?: string; generator?: string };
  extensionsUsed?: string[];
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: Array<{
    name?: string;
    mesh?: number;
    skin?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }>;
  meshes?: Array<{ name?: string; primitives: Array<{ attributes: Record<string, number>; indices?: number; material?: number }> }>;
  materials?: Array<Record<string, unknown>>;
  accessors?: Array<{
    count: number; type: string; componentType: number;
    min?: number[]; max?: number[];
    bufferView?: number; byteOffset?: number; normalized?: boolean;
  }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength: number; byteStride?: number }>;
  images?: Array<{ name?: string; mimeType?: string; bufferView?: number; uri?: string }>;
  textures?: Array<{ source?: number }>;
  skins?: Array<{ joints: number[]; skeleton?: number }>;
  animations?: Array<{ name?: string; channels: Array<{ target: { path: string } }>; samplers: unknown[] }>;
}

/** Reads a `.glb` or `.gltf`, returning the JSON and the binary chunk. */
function readGltf(path: string): { json: Gltf; bin: Buffer } {
  const file = readFileSync(path);
  if (file.readUInt32LE(0) !== 0x46546c67) {
    // A plain .gltf: JSON with external or embedded buffers.
    return { json: JSON.parse(file.toString('utf8')) as Gltf, bin: Buffer.alloc(0) };
  }
  const jsonLength = file.readUInt32LE(12);
  const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
  const binHeader = 20 + jsonLength;
  const binLength = binHeader + 8 <= file.length ? file.readUInt32LE(binHeader) : 0;
  const bin = binLength ? file.subarray(binHeader + 8, binHeader + 8 + binLength) : Buffer.alloc(0);
  return { json, bin };
}

/** Pixel dimensions from a JPEG or PNG header, without decoding the image. */
/**
 * Decodes a VEC4 skin-weight accessor and reports how well-formed it is.
 *
 * The attribute simply *existing* is not the same as the weights being usable, and the difference is
 * invisible until a character animates. Two failures worth catching:
 *
 * - **All-zero vertices.** A vertex with no influence is not carried by any bone. It stays at its
 *   bind position while the rest of the mesh moves, which reads as a spike or a torn seam.
 * - **Unnormalised sums.** Weights are meant to total 1. A vertex summing to 0.5 moves half as far as
 *   the bone that owns it, so a limb visibly stretches rather than rotating.
 *
 * Both survive an export, load without complaint, and are only findable by looking at the numbers.
 */
function weightHealth(json: Gltf, bin: Buffer): { checked: number; unweighted: number; offSum: number; worst: number } | null {
  const result = { checked: 0, unweighted: 0, offSum: 0, worst: 1 };
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const index = prim.attributes.WEIGHTS_0;
      if (index === undefined) continue;
      const accessor = json.accessors?.[index];
      if (!accessor || accessor.type !== 'VEC4' || accessor.bufferView === undefined) continue;
      const view = json.bufferViews?.[accessor.bufferView];
      if (!view) continue;

      // 5126 float, 5121 unsigned byte, 5123 unsigned short — the three glTF permits for weights.
      const width = accessor.componentType === 5126 ? 4 : accessor.componentType === 5123 ? 2 : 1;
      const scale = accessor.componentType === 5126 ? 1 : accessor.componentType === 5123 ? 65535 : 255;
      const stride = view.byteStride ?? width * 4;
      const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      if (base + stride * (accessor.count - 1) + width * 4 > bin.length) continue;

      for (let v = 0; v < accessor.count; v++) {
        let sum = 0;
        for (let c = 0; c < 4; c++) {
          const at = base + v * stride + c * width;
          const raw =
            accessor.componentType === 5126 ? bin.readFloatLE(at)
            : accessor.componentType === 5123 ? bin.readUInt16LE(at)
            : bin.readUInt8(at);
          sum += raw / scale;
        }
        result.checked++;
        if (sum === 0) result.unweighted++;
        else if (Math.abs(sum - 1) > 0.02) { result.offSum++; result.worst = Math.min(result.worst, sum); }
      }
    }
  }
  return result.checked ? result : null;
}

function imageSize(data: Buffer): { w: number; h: number } | null {
  if (data.length > 24 && data.readUInt32BE(0) === 0x89504e47) {
    return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
  }
  if (data.length > 4 && data[0] === 0xff && data[1] === 0xd8) {
    let o = 2;
    while (o + 9 < data.length) {
      if (data[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = data[o + 1];
      // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: data.readUInt16BE(o + 5), w: data.readUInt16BE(o + 7) };
      }
      o += 2 + data.readUInt16BE(o + 2);
    }
  }
  return null;
}

/**
 * Guesses the asset kind from what is in the file.
 *
 * Only used when the caller does not say. A skinned mesh with a humanoid-looking joint count is a
 * character; anything else defaults to prop, which has the tightest sensible budgets and therefore
 * errs toward reporting a problem rather than hiding one.
 */
function guessKind(json: Gltf): AssetKind {
  if (json.skins?.length) return 'character';
  const names = (json.nodes ?? []).map((n) => (n.name ?? '').toLowerCase()).join(' ');
  if (/weapon|rifle|gun|blaster/.test(names)) return 'weapon';
  return 'prop';
}

/** Bones a humanoid rig needs before retargeting is realistic. */
const HUMANOID_CORE = ['hips', 'spine', 'chest', 'neck', 'head'];
const HUMANOID_LIMBS = ['shoulder', 'arm', 'elbow', 'hand', 'leg', 'knee', 'foot', 'thigh', 'calf'];

interface Line {
  level: 'ok' | 'warn' | 'fail' | 'info';
  text: string;
}

function inspect(path: string, kindOverride?: AssetKind, expectClips?: number): { lines: Line[]; blocked: boolean } {
  const { json, bin } = readGltf(path);
  const lines: Line[] = [];
  const add = (level: Line['level'], text: string) => lines.push({ level, text });

  const kind = kindOverride ?? guessKind(json);
  const budget = ASSET_BUDGETS[kind];

  add('info', `file        ${basename(path)}  (${(readFileSync(path).byteLength / 1048576).toFixed(1)} MB)`);
  add('info', `generator   ${json.asset?.generator ?? 'unknown'}`);
  add('info', `treating as ${kind}  —  budget ${budget.triangles.toLocaleString()} tris, ${budget.materials} zones, ${budget.textureSize}px, ${budget.textureMemoryMb} MB, ${budget.lodLevels} LODs`);

  // --- Rigging, first, because it is the only thing that cannot be fixed downstream ---------
  const skins = json.skins ?? [];
  const animations = json.animations ?? [];
  const jointNames = new Set<string>();
  for (const skin of skins) {
    for (const joint of skin.joints) {
      const name = json.nodes?.[joint]?.name;
      if (name) jointNames.add(name.toLowerCase());
    }
  }

  add('info', '');
  add('info', 'RIGGING');
  let blocked = false;
  if (skins.length === 0) {
    add('fail', `no skin: the file contains no skeleton and no skinned mesh.`);
    if (kind === 'character') blocked = true;
  } else {
    const joints = skins.reduce((s, k) => s + k.joints.length, 0);
    add('ok', `${skins.length} skin(s), ${joints} joints.`);
    const core = HUMANOID_CORE.filter((b) => [...jointNames].some((n) => n.includes(b)));
    const limbs = HUMANOID_LIMBS.filter((b) => [...jointNames].some((n) => n.includes(b)));
    if (core.length >= 4 && limbs.length >= 4) {
      add('ok', `humanoid structure recognisable (${core.join(', ')} + ${limbs.length} limb bones) — retargeting is realistic.`);
    } else {
      add('warn', `joint names do not read as a standard humanoid rig; retargeting will need a manual bone map.`);
    }
  }

  // Weight *validity*, not just presence. The attribute existing says nothing about whether every
  // vertex is actually carried by a bone — see weightHealth.
  const weights = weightHealth(json, bin);
  if (skins.length > 0) {
    if (!weights) {
      add('warn', 'skin weights could not be decoded — cannot confirm every vertex is bound.');
    } else if (weights.unweighted > 0) {
      add('fail', `${weights.unweighted.toLocaleString()} of ${weights.checked.toLocaleString()} vertices have zero total weight — they will stay at the bind pose while the mesh animates.`);
      blocked = true;
    } else if (weights.offSum > 0) {
      add('warn', `${weights.offSum.toLocaleString()} vertices have weights that do not sum to 1 (lowest ${weights.worst.toFixed(3)}) — those areas will under-follow their bones.`);
    } else {
      add('ok', `weights valid: all ${weights.checked.toLocaleString()} vertices bound and normalised.`);
    }
  }

  if (animations.length === 0) {
    add('fail', 'no animation clips.');
    if (kind === 'character') blocked = true;
  } else {
    add('ok', `${animations.length} clip(s): ${animations.map((a) => a.name ?? '(unnamed)').join(', ')}`);
  }
  if (expectClips !== undefined) {
    // An explicit count, because "some clips arrived" is how a partial merge passes review. The
    // animation pack is twelve files and a merge that dropped four still loads and still animates.
    add(
      animations.length === expectClips ? 'ok' : 'fail',
      `expected ${expectClips} clip(s), found ${animations.length}.`,
    );
    if (animations.length !== expectClips) blocked = true;
  }

  // --- Geometry -------------------------------------------------------------
  add('info', '');
  add('info', 'GEOMETRY');
  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  const attributes = new Set<string>();
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      primitives++;
      for (const key of Object.keys(prim.attributes)) attributes.add(key);
      const position = json.accessors?.[prim.attributes.POSITION];
      if (position) vertices += position.count;
      const index = prim.indices !== undefined ? json.accessors?.[prim.indices] : undefined;
      triangles += index ? index.count / 3 : (position?.count ?? 0) / 3;
    }
  }

  const overBudget = triangles / budget.triangles;
  add(
    overBudget > 1 ? 'fail' : 'ok',
    `${Math.round(triangles).toLocaleString()} triangles, ${vertices.toLocaleString()} vertices` +
      (overBudget > 1 ? `  —  ${overBudget.toFixed(1)}x the ${budget.triangles.toLocaleString()} budget` : ''),
  );
  add(
    (json.meshes?.length ?? 0) === 1 && primitives === 1 ? 'warn' : 'info',
    `${json.meshes?.length ?? 0} mesh / ${primitives} primitive / ${json.nodes?.length ?? 0} node(s)` +
      (primitives === 1 ? '  —  one welded lump: no separable parts, no per-region materials' : ''),
  );
  add(attributes.has('NORMAL') ? 'ok' : 'fail', `attributes: ${[...attributes].sort().join(', ')}`);
  if (!attributes.has('TEXCOORD_0')) add('fail', 'no UV set: textures cannot be applied.');
  if (!attributes.has('TANGENT') && (json.materials ?? []).some((m) => 'normalTexture' in m)) {
    add('warn', 'normal map present but no TANGENT attribute — tangents are generated at load, which costs time and can seam.');
  }
  if (attributes.has('JOINTS_0') !== attributes.has('WEIGHTS_0')) {
    add('fail', 'JOINTS_0 and WEIGHTS_0 must both be present or both absent.');
  }

  // --- Scale and orientation ------------------------------------------------
  add('info', '');
  add('info', 'SCALE AND ORIENTATION');
  const positions = (json.meshes ?? []).flatMap((m) =>
    m.primitives.map((p) => json.accessors?.[p.attributes.POSITION]).filter(Boolean),
  ) as Array<{ min?: number[]; max?: number[] }>;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const accessor of positions) {
    if (!accessor.min || !accessor.max) continue;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], accessor.min[i]);
      max[i] = Math.max(max[i], accessor.max[i]);
    }
  }
  if (Number.isFinite(min[0])) {
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    add('info', `bounds  W ${size[0].toFixed(3)}  H ${size[1].toFixed(3)}  D ${size[2].toFixed(3)} m`);
    add('info', `origin  x ${min[0].toFixed(3)}..${max[0].toFixed(3)}  y ${min[1].toFixed(3)}..${max[1].toFixed(3)}  z ${min[2].toFixed(3)}..${max[2].toFixed(3)}`);
    const feetAtOrigin = Math.abs(min[1]) < 0.02;
    add(feetAtOrigin ? 'ok' : 'warn', feetAtOrigin ? 'origin sits at the feet.' : `origin is ${min[1].toFixed(3)} m from the lowest point — the model will float or sink.`);
    const centred = Math.abs(min[0] + max[0]) < 0.02 && Math.abs(min[2] + max[2]) < 0.02;
    add(centred ? 'ok' : 'warn', centred ? 'centred on the vertical axis.' : 'not centred in X/Z — it will orbit its own origin when it turns.');
  }

  // --- Materials and textures -----------------------------------------------
  add('info', '');
  add('info', 'MATERIALS AND TEXTURES');
  const materialCount = json.materials?.length ?? 0;
  add(
    materialCount > budget.materials ? 'fail' : 'ok',
    `${materialCount} material(s)` + (materialCount > budget.materials ? `  —  budget is ${budget.materials}` : ''),
  );

  let vram = 0;
  let largest = 0;
  for (const image of json.images ?? []) {
    let size: { w: number; h: number } | null = null;
    if (image.bufferView !== undefined && bin.length) {
      const view = json.bufferViews?.[image.bufferView];
      if (view) {
        const offset = view.byteOffset ?? 0;
        size = imageSize(bin.subarray(offset, offset + view.byteLength));
      }
    }
    if (!size) {
      add('info', `  ${image.name ?? '(unnamed)'}  (dimensions unavailable)`);
      continue;
    }
    // RGBA8 plus a third again for the mip chain — what it costs on the GPU, not on disk.
    const mb = (size.w * size.h * 4 * 1.3333) / 1048576;
    vram += mb;
    largest = Math.max(largest, size.w, size.h);
    add(
      size.w > budget.textureSize ? 'warn' : 'info',
      `  ${(image.name ?? '(unnamed)').padEnd(52)} ${size.w}x${size.h}  ${mb.toFixed(1)} MB VRAM`,
    );
  }
  if (largest > budget.textureSize) {
    add('fail', `largest texture ${largest}px exceeds the ${budget.textureSize}px limit for a ${kind}.`);
  }
  add(
    vram > budget.textureMemoryMb ? 'fail' : 'ok',
    `${vram.toFixed(1)} MB of texture memory` +
      (vram > budget.textureMemoryMb ? `  —  ${(vram / budget.textureMemoryMb).toFixed(1)}x the ${budget.textureMemoryMb} MB budget` : ''),
  );
  const pbr = (json.materials ?? []).some(
    (m) => 'normalTexture' in m || ((m.pbrMetallicRoughness as Record<string, unknown>)?.metallicRoughnessTexture !== undefined),
  );
  add(pbr ? 'ok' : 'warn', pbr ? 'real PBR maps present (base colour, metal-rough, normal).' : 'no PBR maps — flat colours only.');

  // Occlusion, checked separately and by name in the material rather than by an image in the file.
  // AO has been silently lost on this asset once already: glTF cannot represent a Mix graph, so a
  // baked AO wired into Base Color exported as a *baseColorTexture* instead — which destroyed the
  // three zone colours and left an image called `..._AO` sitting in the file looking correct. The
  // only reliable signal is an `occlusionTexture` on a material.
  const occluded = (json.materials ?? []).filter((m) => 'occlusionTexture' in m).length;
  const aoImage = (json.images ?? []).some((i) => /(^|[_\-\s])ao($|[_\-\s.])|occlusion/i.test(i.name ?? ''));
  if (occluded > 0) {
    add('ok', `occlusionTexture wired on ${occluded} material(s).`);
  } else if (aoImage) {
    add('fail', 'an AO image is in the file but no material has an occlusionTexture — the bake did not survive export. Route it through the glTF Material Output node group, not a Mix into Base Color.');
  } else {
    add('warn', 'no ambient occlusion map.');
  }

  // --- Photon contract ------------------------------------------------------
  add('info', '');
  add('info', 'PHOTON CONTRACT');
  const names = (json.nodes ?? []).map((n) => n.name ?? '');
  const withPrefix = (prefix: string) => names.filter((n) => n.startsWith(prefix));
  const sockets = withPrefix(NODE_PREFIX.socket).map((n) => n.slice(NODE_PREFIX.socket.length));
  const parts = withPrefix(NODE_PREFIX.part).map((n) => n.slice(NODE_PREFIX.part.length));
  const zones = [...new Set(withPrefix(NODE_PREFIX.material).map((n) => n.slice(NODE_PREFIX.material.length).split('_')[0]))];
  const lods = withPrefix(NODE_PREFIX.lod);

  const requiredSockets = REQUIRED_SOCKETS[kind];
  const missingSockets = requiredSockets.filter((s) => !sockets.includes(s));
  add(
    missingSockets.length ? 'fail' : 'ok',
    `sockets: ${sockets.length ? sockets.join(', ') : 'none'}` +
      (missingSockets.length ? `  —  missing required: ${missingSockets.join(', ')}` : ''),
  );
  add(parts.length ? 'ok' : 'warn', `PART_ nodes: ${parts.length ? parts.join(', ') : `none (kind expects ${ANIMATED_PARTS[kind].join(', ') || 'none'})`}`);
  add(zones.length ? 'ok' : 'warn', `MAT_ zones: ${zones.length ? zones.join(', ') : 'none — the whole model will keep its shipped material'}`);
  add(
    lods.length >= budget.lodLevels ? 'ok' : 'warn',
    `LOD levels: ${lods.length}` + (lods.length < budget.lodLevels ? `  —  ${budget.lodLevels} required` : ''),
  );

  if (json.extensionsUsed?.length) {
    add('info', '');
    add('info', `extensions: ${json.extensionsUsed.join(', ')}`);
  }

  return { lines, blocked };
}

function main(): void {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('usage: npm run asset-inspect -- <file.glb> [--kind character|weapon|module|prop] [--expect-clips N]');
    process.exitCode = 1;
    return;
  }
  const kindIndex = args.indexOf('--kind');
  const kind = kindIndex >= 0 ? (args[kindIndex + 1] as AssetKind) : undefined;
  const clipIndex = args.indexOf('--expect-clips');
  const expectClips = clipIndex >= 0 ? Number(args[clipIndex + 1]) : undefined;

  const { lines, blocked } = inspect(path, kind, expectClips);
  const mark: Record<Line['level'], string> = { ok: '  ok  ', warn: ' warn ', fail: ' FAIL ', info: '      ' };

  console.log('');
  for (const line of lines) console.log(`${mark[line.level]} ${line.text}`);

  const fails = lines.filter((l) => l.level === 'fail').length;
  const warns = lines.filter((l) => l.level === 'warn').length;
  console.log('');
  console.log(`  ${fails} blocking, ${warns} to address`);
  if (blocked) {
    console.log('');
    console.log('  VERDICT: not usable as a character. A skeleton and clips are authoring work, not');
    console.log('  pipeline work — nothing downstream can synthesise them. See docs for the rig plan.');
  }
  console.log('');
  if (fails) process.exitCode = 1;
}

main();
