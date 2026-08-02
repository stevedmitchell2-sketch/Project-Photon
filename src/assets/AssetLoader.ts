import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { photonMaterial, type Substance } from '@/render/materials/PhotonMaterials';
import { isDev } from '@/util/env';
import { NODE_PREFIX } from './contract';
import { assetUrl, findAsset, type AssetEntry } from './manifest';
import { validateInspection, type AssetInspection, type Finding } from './validate';

/**
 * The Photon importer.
 *
 * Turns a standard glTF file into something the game can drive, by reading **node names** rather
 * than assuming a hierarchy. An asset that follows `contract.ts` needs no code written for it; the
 * loader finds its sockets, its animated parts, its LOD levels and its material zones by name, and
 * hands back a typed handle.
 *
 * ## What "first-class" means here
 *
 * An imported asset is not a special case bolted onto a procedural one. Both expose the same
 * interface — `socket(name)` and `part(name)` — so a system that animates a weapon does not know or
 * care which it has. That is what makes the swap free, and it is the single most important property
 * of this file.
 *
 * ## Failure is not an error
 *
 * Every asset in the manifest is optional. A missing file resolves to `null` and the caller falls
 * back to procedural geometry. The repository stays clone-and-run with no binaries, artists can drop
 * a single file in without a coordinated commit, and CI never needs the content pipeline.
 *
 * A file that exists but is *broken* is different, and is reported loudly in development.
 */

export interface LoadedAsset {
  entry: AssetEntry;
  /** The renderable root. Add this to a scene. */
  scene: THREE.Group;
  /** Attachment points by name, without the `SOCKET_` prefix. */
  sockets: Map<string, THREE.Object3D>;
  /**
   * Runtime-animated parts by name, without the `PART_` prefix.
   *
   * Resolves to the highest-detail instance. A part named in more than one LOD level appears once
   * here, pointing at its LOD0 node — see `allParts` when every copy matters.
   */
  parts: Map<string, THREE.Object3D>;
  /**
   * Every copy of every part, including the ones in lower LOD levels.
   *
   * The contract requires an animated part to exist in each level, so driving only the LOD0 copy
   * leaves the object frozen the moment the camera backs off far enough to switch. Animation code
   * should write through this; code that only needs a transform can use `parts`.
   */
  allParts: Map<string, THREE.Object3D[]>;
  /** Collision meshes, for the physics layer. Never added to the render scene. */
  collision: THREE.Mesh[];
  /** Animation clips shipped in the file, by name. */
  clips: Map<string, THREE.AnimationClip>;
  /** The `THREE.LOD` built from `LOD0..n`, or null when the asset declares a single level. */
  lod: THREE.LOD | null;
  /** Skinned meshes, if any. Their skeleton is driven through `AssetAnimator`. */
  skinned: THREE.SkinnedMesh[];
  /** What validation made of it. Empty when clean. */
  findings: Finding[];
  /** Frees geometry, materials and textures owned by this asset. */
  dispose(): void;
}

let loader: GLTFLoader | null = null;

function gltfLoader(): GLTFLoader {
  if (loader) return loader;
  loader = new GLTFLoader();
  // Draco is optional. Assets compressed with it load; assets without it are unaffected. The
  // decoder is fetched from the same origin so the pipeline has no external dependency at runtime.
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  loader.setDRACOLoader(draco);
  return loader;
}

/** Cache by asset id. Assets are immutable once loaded, so one copy serves every consumer. */
const cache = new Map<string, Promise<LoadedAsset | null>>();

/**
 * Loads an asset by manifest id.
 *
 * Returns `null` when the file is absent — which is the normal state for most of the registry and
 * is not an error. See the class comment.
 */
export function loadAsset(id: string): Promise<LoadedAsset | null> {
  const cached = cache.get(id);
  if (cached) return cached;

  const entry = findAsset(id);
  if (!entry) {
    if (isDev()) console.warn(`[assets] no manifest entry for "${id}"`);
    return Promise.resolve(null);
  }

  const promise = load(entry).catch((error: unknown) => {
    // A 404 is the expected case for an unauthored asset and must stay quiet, or the console fills
    // with noise for a repository that is working exactly as intended.
    const message = String(error);
    if (!message.includes('404') && isDev()) {
      console.warn(`[assets] "${id}" failed to load:`, error);
    }
    return null;
  });

  cache.set(id, promise);
  return promise;
}

/**
 * The name a node had **in the file**, not the one three.js gave it.
 *
 * `GLTFLoader` guarantees unique object names by appending `_1`, `_2` to duplicates. That is a
 * reasonable default and it breaks this contract head-on: an animated part is *required* to exist in
 * every LOD level, so `PART_core` in LOD0 and LOD1 arrive as `core` and `core_1`, and every lookup
 * for `core` finds only the highest-detail copy.
 *
 * The parser keeps an `associations` map from each object back to its source index, so the original
 * name is recoverable. Falling back to the object name keeps this safe for objects the parser did
 * not create.
 */
function originalNames(gltf: { parser?: unknown }): Map<THREE.Object3D, string> {
  const names = new Map<THREE.Object3D, string>();
  const parser = gltf.parser as
    | {
        json?: { nodes?: Array<{ name?: string }> };
        associations?: Map<object, { nodes?: number; index?: number; type?: string }>;
      }
    | undefined;
  const nodes = parser?.json?.nodes;
  const associations = parser?.associations;
  if (!nodes || !associations) return names;

  for (const [object, association] of associations) {
    // three.js has used two shapes for this record across versions; accept either.
    const index =
      typeof association?.nodes === 'number'
        ? association.nodes
        : association?.type === 'nodes'
          ? association.index
          : undefined;
    if (index === undefined) continue;
    const name = nodes[index]?.name;
    if (name) names.set(object as THREE.Object3D, name);
  }
  return names;
}

/**
 * Builds a `THREE.LOD` from `LOD0..n` sibling groups.
 *
 * Distances come from the model's own size rather than from constants, because a 0.6 m rifle and a
 * 1.85 m character cannot share a switch distance and neither can be guessed without knowing the
 * asset. Each level is shown from a multiple of the bounding radius, which makes the switch happen
 * at roughly the same *screen size* for everything — which is the only thing that matters.
 */
function buildLod(levels: Map<number, THREE.Object3D>): THREE.LOD | null {
  if (levels.size < 2) return null;

  const lod = new THREE.LOD();
  const ordered = [...levels.entries()].sort((a, b) => a[0] - b[0]);

  const box = new THREE.Box3().setFromObject(ordered[0][1]);
  const radius = Math.max(0.25, box.getBoundingSphere(new THREE.Sphere()).radius);

  // LOD0 from zero, then 12x and 30x the radius. Tuned so a character swaps at roughly 22 m and
  // 55 m, which is past the range at which its silhouette is doing any work.
  const multipliers = [0, 12, 30, 60, 120];
  ordered.forEach(([, group], i) => {
    lod.addLevel(group, radius * (multipliers[i] ?? multipliers[multipliers.length - 1] * (i + 1)));
  });
  return lod;
}

async function load(entry: AssetEntry): Promise<LoadedAsset> {
  const gltf = await gltfLoader().loadAsync(assetUrl(entry));
  const scene = gltf.scene as THREE.Group;

  if (entry.scale && entry.scale !== 1) scene.scale.setScalar(entry.scale);

  const trueName = originalNames(gltf);
  const nameOf = (node: THREE.Object3D): string => trueName.get(node) ?? node.name;

  const sockets = new Map<string, THREE.Object3D>();
  const parts = new Map<string, THREE.Object3D>();
  const allParts = new Map<string, THREE.Object3D[]>();
  const collision: THREE.Mesh[] = [];
  const skinned: THREE.SkinnedMesh[] = [];
  const lodGroups = new Map<string, THREE.Object3D[]>();
  const lodLevels = new Map<number, THREE.Object3D>();
  const nodeNames: string[] = [];

  const teamZones = new Set((entry.zones ?? []).filter((z) => z.teamColored).map((z) => z.zone));
  const substanceFor = new Map<string, Substance>(
    (entry.zones ?? [])
      .filter((z) => !z.useSourceMaterial)
      .map((z) => [z.zone, z.substance as Substance]),
  );

  // One traversal. Collected into a list first because reparenting during traversal is unsafe.
  const detach: THREE.Object3D[] = [];

  scene.traverse((node) => {
    const name = nameOf(node);
    nodeNames.push(name);

    if ((node as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(node as THREE.SkinnedMesh);

    if (name.startsWith(NODE_PREFIX.socket)) {
      sockets.set(name.slice(NODE_PREFIX.socket.length), node);
      // Sockets are transforms, not geometry. Anything modelled on one is a mistake, but hiding is
      // kinder than throwing — an artist sees an invisible marker rather than a broken import.
      node.visible = false;
      return;
    }

    if (name.startsWith(NODE_PREFIX.part)) {
      const id = name.slice(NODE_PREFIX.part.length);
      // First writer wins, and the traversal reaches LOD0 first, so `parts` holds the highest
      // detail copy while `allParts` keeps every level's.
      if (!parts.has(id)) parts.set(id, node);
      const list = allParts.get(id) ?? [];
      list.push(node);
      allParts.set(id, list);
      // Falls through: a part is normal geometry that also happens to be addressable.
    }

    if (name.startsWith(NODE_PREFIX.collision)) {
      if ((node as THREE.Mesh).isMesh) collision.push(node as THREE.Mesh);
      detach.push(node);
      return;
    }

    if (name.startsWith(NODE_PREFIX.lod)) {
      const level = name.slice(NODE_PREFIX.lod.length).split('_')[0];
      const list = lodGroups.get(level) ?? [];
      list.push(node);
      lodGroups.set(level, list);
      const index = Number.parseInt(level, 10);
      // Only a top-level group is a switchable level; a mesh *inside* LOD0 called `LOD0_barrel`
      // is detail, not a level.
      if (Number.isFinite(index) && node.parent === scene && !lodLevels.has(index)) {
        lodLevels.set(index, node);
      }
    }

    if (name.startsWith(NODE_PREFIX.material)) {
      // The zone is the first segment only: `MAT_shell_receiver` is zone `shell`. See contract.ts.
      const zone = name.slice(NODE_PREFIX.material.length).split('_')[0];
      applyZone(node, zone, substanceFor.get(zone), teamZones.has(zone));
    }
  });

  for (const node of detach) node.parent?.remove(node);

  const lod = buildLod(lodLevels);
  if (lod) {
    // `addLevel` reparents each group onto the LOD, so the groups leave `scene` on their own; the
    // LOD then goes back in their place.
    scene.add(lod);
  }

  const clips = new Map<string, THREE.AnimationClip>();
  for (const clip of gltf.animations ?? []) clips.set(clip.name, clip);

  const inspection = inspect(scene, nodeNames, lodGroups);
  const findings = validateInspection(entry, inspection);

  if (isDev() && findings.length > 0) {
    for (const finding of findings) {
      const log = finding.severity === 'error' ? console.error : console.warn;
      log(`[assets] ${finding.asset} [${finding.code}] ${finding.message}`);
    }
  }

  return {
    entry,
    scene,
    sockets,
    parts,
    allParts,
    collision,
    clips,
    lod,
    skinned,
    findings,
    dispose: () => disposeTree(scene),
  };
}

/**
 * Substitutes a library material onto a zone.
 *
 * An imported mesh does not bring its own look into the scene by default. It declares zones, and the
 * manifest maps each to a Photon substance, so every asset automatically inherits the project's
 * lighting response and readability rules — and a change to how carbon fibre looks changes every
 * asset made of it.
 *
 * Team-coloured zones get a unique material instance, because their colour is written per actor at
 * runtime and a shared instance would repaint every other wearer.
 */
function applyZone(
  node: THREE.Object3D,
  zone: string,
  substance: Substance | undefined,
  teamColored: boolean,
): void {
  if (!substance) return;
  const mesh = node as THREE.Mesh;
  if (!mesh.isMesh) return;

  // Preserve the authored base colour: the substance supplies the physical response, the file
  // supplies the hue. An artist's colour choice survives the substitution.
  const source = mesh.material as THREE.MeshStandardMaterial | undefined;
  const color = source?.color?.getHex?.() ?? 0xffffff;

  // Does the file bring its own surface detail?
  //
  // This is the line between the two kinds of asset the pipeline has to serve. A blockout ships flat
  // colours and *wants* the library's response substituted wholesale. A production asset ships baked
  // normal and ORM maps that are the entire reason it looks better than a box, and substituting them
  // away throws out the work — which is exactly what this function used to do to every asset,
  // unconditionally.
  //
  // So: textured materials are kept and *tuned* by the substance rather than replaced by it.
  const hasAuthoredMaps = Boolean(
    source?.normalMap ?? source?.roughnessMap ?? source?.metalnessMap ?? source?.map,
  );

  if (hasAuthoredMaps && source) {
    // Team-coloured zones still need their own instance, because their colour is written per actor
    // every frame and a shared one would repaint every other wearer.
    const material = teamColored ? (source.clone() as THREE.MeshStandardMaterial) : source;
    const reference = photonMaterial(substance, { color }) as THREE.MeshStandardMaterial;
    // Take the library's *response* — envelope values the maps modulate — and leave the maps alone.
    // Roughness and metalness maps multiply, so the scalars stay as gain rather than as the answer.
    if (!source.roughnessMap) material.roughness = reference.roughness;
    if (!source.metalnessMap) material.metalness = reference.metalness;
    if (teamColored) {
      material.emissive = new THREE.Color(color);
      material.emissiveIntensity = reference.emissiveIntensity;
    }
    material.envMapIntensity = reference.envMapIntensity;
    mesh.material = material;
  } else {
    mesh.material = photonMaterial(substance, {
      color,
      emissive: teamColored ? color : undefined,
      unique: teamColored,
    });
  }

  mesh.userData.photonZone = zone;
  mesh.userData.teamColored = teamColored;
  mesh.userData.authoredMaps = hasAuthoredMaps;
}

/** Summarises a loaded scene for the validator. */
function inspect(
  scene: THREE.Object3D,
  nodeNames: string[],
  lodGroups: Map<string, THREE.Object3D[]>,
): AssetInspection {
  const textures = new Set<string>();
  let largestTexture = 0;
  let textureBytes = 0;

  const countTriangles = (root: THREE.Object3D): number => {
    let total = 0;
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const index = mesh.geometry.index;
      const position = mesh.geometry.getAttribute('position');
      total += index ? index.count / 3 : position ? position.count / 3 : 0;
    });
    return Math.round(total);
  };

  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        const texture = value as THREE.Texture | null;
        if (!texture || !(texture as THREE.Texture).isTexture) continue;
        const image = texture.image as { width?: number; height?: number } | undefined;
        const name = texture.name || texture.userData?.src || '';
        if (name) textures.add(String(name));
        if (image?.width && image?.height) {
          largestTexture = Math.max(largestTexture, image.width, image.height);
          // RGBA8 plus a third again for the mip chain.
          textureBytes += image.width * image.height * 4 * 1.33;
        }
      }
    }
  });

  const triangles = countTriangles(scene);

  const lodTriangles = [...lodGroups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, nodes]) => nodes.reduce((sum, node) => sum + countTriangles(node), 0));

  return {
    nodeNames,
    triangles: lodTriangles[0] ?? triangles,
    lodTriangles,
    // First segment only, and de-duplicated, matching what `applyZone` actually binds. The two
    // read the same names from the same nodes, so a validator using a different rule reports
    // undeclared zones the importer mapped correctly and unused mappings it already applied —
    // which is exactly what the first real file through this pipeline produced.
    materialZones: [
      ...new Set(
        nodeNames
          .filter((n) => n.startsWith(NODE_PREFIX.material))
          .map((n) => n.slice(NODE_PREFIX.material.length).split('_')[0]),
      ),
    ],
    textures: [...textures],
    largestTexture,
    textureMemoryMb: textureBytes / 1024 / 1024,
  };
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      // Library materials are shared and cached; only asset-owned ones are disposed here.
      if (material && !material.name?.startsWith('photon:')) material.dispose();
    }
  });
}

/** Drops the cache. Used when a match ends and between hot reloads. */
export function clearAssetCache(): void {
  for (const promise of cache.values()) {
    void promise.then((asset) => asset?.dispose());
  }
  cache.clear();
}
