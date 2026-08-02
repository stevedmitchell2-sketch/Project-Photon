/**
 * A minimal glTF 2.0 / GLB writer.
 *
 * Photon's asset pipeline has never loaded a real file. Every part of it — the importer, the
 * validator, the socket and part binding, the LOD levels, the material zones — was written against
 * a specification and tested against nothing, because the repository deliberately contains no
 * binaries and the content does not exist yet.
 *
 * That is a pipeline nobody can trust. This exists so the engine can be proven against genuine
 * glTF, generated on demand, with no binary committed and no dependency on any modelling tool:
 * `npm run make-reference-assets` writes real `.glb` files that follow `contract.ts` exactly, and
 * the game loads them through the same path a Blender export would take.
 *
 * ## Why hand-written rather than three.js `GLTFExporter`
 *
 * `GLTFExporter` needs `Blob`, `FileReader` and `ImageData` — browser APIs that do not exist under
 * Node, which is where the content tooling has to run. Writing the container by hand is about two
 * hundred lines, has no dependencies, and has a second benefit worth more than the first: it is an
 * exact, executable statement of what Photon expects from an exporter. When an artist's file fails
 * to import, this is the reference to diff against.
 *
 * ## The container
 *
 * GLB is a 12-byte header followed by chunks. Chunk 0 is the glTF JSON padded with **spaces**;
 * chunk 1 is the binary buffer padded with **zeros**. Both paddings are mandatory and both must be
 * to a 4-byte boundary — a viewer that reads a file padded with the wrong byte usually reports
 * "unexpected token" and gives no hint which chunk is at fault.
 */

const MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const COMPONENT = {
  BYTE: 5120,
  UNSIGNED_BYTE: 5121,
  SHORT: 5122,
  UNSIGNED_SHORT: 5123,
  UNSIGNED_INT: 5125,
  FLOAT: 5126,
} as const;

const TARGET = {
  ARRAY_BUFFER: 34962,
  ELEMENT_ARRAY_BUFFER: 34963,
} as const;

type AccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';

const COMPONENTS_PER: Record<AccessorType, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

export interface Primitive {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  /** Material index from `addMaterial`. */
  material?: number;
  /** Skinning: four joint indices per vertex. */
  joints?: Uint16Array;
  /** Skinning: four weights per vertex, summing to 1. */
  weights?: Float32Array;
}

export interface NodeSpec {
  name: string;
  mesh?: number;
  skin?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
}

export interface MaterialSpec {
  name: string;
  baseColor?: [number, number, number, number];
  metallic?: number;
  roughness?: number;
  emissive?: [number, number, number];
}

/** One animated channel: a node, a property, and keyframes. */
export interface AnimationChannel {
  node: number;
  path: 'translation' | 'rotation' | 'scale';
  times: number[];
  /** Flat values: 3 per key for translation/scale, 4 per key for rotation. */
  values: number[];
}

interface Json {
  [key: string]: unknown;
}

export class GlbBuilder {
  private readonly chunks: Buffer[] = [];
  private byteLength = 0;

  private readonly bufferViews: Json[] = [];
  private readonly accessors: Json[] = [];
  private readonly meshes: Json[] = [];
  private readonly nodes: Json[] = [];
  private readonly materials: Json[] = [];
  private readonly skins: Json[] = [];
  private readonly animations: Json[] = [];

  /**
   * Appends bytes to the binary buffer and returns a bufferView index.
   *
   * Every view is aligned to 4 bytes. The spec only requires this for some accessor types, but
   * misaligned views are the single most common cause of a file that loads in one viewer and not
   * another, and the cost of always aligning is a handful of zero bytes.
   */
  private addView(data: Buffer, target?: number): number {
    while (this.byteLength % 4 !== 0) {
      this.chunks.push(Buffer.alloc(1));
      this.byteLength += 1;
    }
    const offset = this.byteLength;
    this.chunks.push(data);
    this.byteLength += data.byteLength;

    const view: Json = { buffer: 0, byteOffset: offset, byteLength: data.byteLength };
    if (target !== undefined) view.target = target;
    this.bufferViews.push(view);
    return this.bufferViews.length - 1;
  }

  private addAccessor(
    data: ArrayBufferView,
    componentType: number,
    type: AccessorType,
    target?: number,
    withBounds = false,
  ): number {
    const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const view = this.addView(buffer, target);
    const per = COMPONENTS_PER[type];
    const count = (data as unknown as { length: number }).length / per;

    const accessor: Json = { bufferView: view, componentType, count, type };

    // POSITION accessors *must* carry min and max — the loader uses them for the bounding box, and
    // three.js silently produces an unbounded object (which is then never frustum-culled) without.
    if (withBounds) {
      const values = data as unknown as ArrayLike<number>;
      const min = new Array<number>(per).fill(Infinity);
      const max = new Array<number>(per).fill(-Infinity);
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < per; c++) {
          const v = values[i * per + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      }
      accessor.min = min;
      accessor.max = max;
    }

    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }

  addMaterial(spec: MaterialSpec): number {
    const material: Json = {
      name: spec.name,
      pbrMetallicRoughness: {
        baseColorFactor: spec.baseColor ?? [1, 1, 1, 1],
        metallicFactor: spec.metallic ?? 0,
        roughnessFactor: spec.roughness ?? 0.8,
      },
      doubleSided: false,
    };
    if (spec.emissive) material.emissiveFactor = spec.emissive;
    this.materials.push(material);
    return this.materials.length - 1;
  }

  addMesh(name: string, primitives: Primitive[]): number {
    const prims = primitives.map((p) => {
      const attributes: Json = {
        POSITION: this.addAccessor(p.positions, COMPONENT.FLOAT, 'VEC3', TARGET.ARRAY_BUFFER, true),
        NORMAL: this.addAccessor(p.normals, COMPONENT.FLOAT, 'VEC3', TARGET.ARRAY_BUFFER),
      };
      if (p.joints && p.weights) {
        attributes.JOINTS_0 = this.addAccessor(p.joints, COMPONENT.UNSIGNED_SHORT, 'VEC4', TARGET.ARRAY_BUFFER);
        attributes.WEIGHTS_0 = this.addAccessor(p.weights, COMPONENT.FLOAT, 'VEC4', TARGET.ARRAY_BUFFER);
      }
      const indexType = p.indices instanceof Uint32Array ? COMPONENT.UNSIGNED_INT : COMPONENT.UNSIGNED_SHORT;
      const primitive: Json = {
        attributes,
        indices: this.addAccessor(p.indices, indexType, 'SCALAR', TARGET.ELEMENT_ARRAY_BUFFER),
        mode: 4, // TRIANGLES
      };
      if (p.material !== undefined) primitive.material = p.material;
      return primitive;
    });

    this.meshes.push({ name, primitives: prims });
    return this.meshes.length - 1;
  }

  addNode(spec: NodeSpec): number {
    const node: Json = { name: spec.name };
    if (spec.mesh !== undefined) node.mesh = spec.mesh;
    if (spec.skin !== undefined) node.skin = spec.skin;
    if (spec.translation) node.translation = spec.translation;
    if (spec.rotation) node.rotation = spec.rotation;
    if (spec.scale) node.scale = spec.scale;
    if (spec.children?.length) node.children = spec.children;
    this.nodes.push(node);
    return this.nodes.length - 1;
  }

  /** Adds children to an existing node, for hierarchies built bottom-up. */
  attach(parent: number, children: number[]): void {
    const node = this.nodes[parent];
    const existing = (node.children as number[] | undefined) ?? [];
    node.children = [...existing, ...children];
  }

  /**
   * A skin: the joint list plus one inverse bind matrix per joint.
   *
   * The inverse bind matrix takes a vertex from model space into the joint's local space at bind
   * time. For the rigs generated here every joint is a pure translation along Y, so the inverse is
   * a translation by the negation — written out column-major, because glTF matrices are column-major
   * and getting that backwards produces a mesh that explodes on the first frame of animation.
   */
  addSkin(joints: number[], bindTranslations: Array<[number, number, number]>, skeleton: number): number {
    const matrices = new Float32Array(joints.length * 16);
    for (let j = 0; j < joints.length; j++) {
      const [x, y, z] = bindTranslations[j];
      const m = matrices.subarray(j * 16, j * 16 + 16);
      m[0] = 1;
      m[5] = 1;
      m[10] = 1;
      m[15] = 1;
      m[12] = -x;
      m[13] = -y;
      m[14] = -z;
    }
    const accessor = this.addAccessor(matrices, COMPONENT.FLOAT, 'MAT4');
    this.skins.push({ joints, inverseBindMatrices: accessor, skeleton });
    return this.skins.length - 1;
  }

  addAnimation(name: string, channels: AnimationChannel[]): void {
    const samplers: Json[] = [];
    const jsonChannels: Json[] = [];

    for (const channel of channels) {
      const input = this.addAccessor(new Float32Array(channel.times), COMPONENT.FLOAT, 'SCALAR', undefined, true);
      const type: AccessorType = channel.path === 'rotation' ? 'VEC4' : 'VEC3';
      const output = this.addAccessor(new Float32Array(channel.values), COMPONENT.FLOAT, type);
      samplers.push({ input, output, interpolation: 'LINEAR' });
      jsonChannels.push({
        sampler: samplers.length - 1,
        target: { node: channel.node, path: channel.path },
      });
    }

    this.animations.push({ name, samplers, channels: jsonChannels });
  }

  /** Serialises the whole thing to a GLB buffer. */
  build(sceneRoots: number[], generator = 'Photon reference asset generator'): Buffer {
    const bin = Buffer.concat(this.chunks);

    const gltf: Json = {
      asset: { version: '2.0', generator },
      scene: 0,
      scenes: [{ nodes: sceneRoots }],
      nodes: this.nodes,
      meshes: this.meshes,
      materials: this.materials,
      accessors: this.accessors,
      bufferViews: this.bufferViews,
      buffers: [{ byteLength: bin.byteLength }],
    };
    if (this.skins.length) gltf.skins = this.skins;
    if (this.animations.length) gltf.animations = this.animations;

    let json = Buffer.from(JSON.stringify(gltf), 'utf8');
    // JSON pads with spaces, BIN pads with zeros. Both are load-bearing.
    while (json.byteLength % 4 !== 0) json = Buffer.concat([json, Buffer.from(' ')]);
    let binary = bin;
    while (binary.byteLength % 4 !== 0) binary = Buffer.concat([binary, Buffer.alloc(1)]);

    const total = 12 + 8 + json.byteLength + 8 + binary.byteLength;
    const out = Buffer.alloc(total);
    let o = 0;
    o = out.writeUInt32LE(MAGIC, o);
    o = out.writeUInt32LE(2, o);
    o = out.writeUInt32LE(total, o);
    o = out.writeUInt32LE(json.byteLength, o);
    o = out.writeUInt32LE(CHUNK_JSON, o);
    json.copy(out, o);
    o += json.byteLength;
    o = out.writeUInt32LE(binary.byteLength, o);
    o = out.writeUInt32LE(CHUNK_BIN, o);
    binary.copy(out, o);
    return out;
  }
}

// --- Geometry ---------------------------------------------------------------

/**
 * A box as 24 vertices and 36 indices.
 *
 * Four vertices per face rather than eight shared ones, because shared corners cannot carry per-face
 * normals and a box with averaged corner normals shades like a sphere.
 */
export function box(
  size: [number, number, number],
  centre: [number, number, number] = [0, 0, 0],
): { positions: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const [sx, sy, sz] = size.map((v) => v / 2) as [number, number, number];
  const [cx, cy, cz] = centre;

  const faces: Array<{ n: [number, number, number]; v: Array<[number, number, number]> }> = [
    { n: [0, 0, 1], v: [[-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]] },
    { n: [0, 0, -1], v: [[sx, -sy, -sz], [-sx, -sy, -sz], [-sx, sy, -sz], [sx, sy, -sz]] },
    { n: [1, 0, 0], v: [[sx, -sy, sz], [sx, -sy, -sz], [sx, sy, -sz], [sx, sy, sz]] },
    { n: [-1, 0, 0], v: [[-sx, -sy, -sz], [-sx, -sy, sz], [-sx, sy, sz], [-sx, sy, -sz]] },
    { n: [0, 1, 0], v: [[-sx, sy, sz], [sx, sy, sz], [sx, sy, -sz], [-sx, sy, -sz]] },
    { n: [0, -1, 0], v: [[-sx, -sy, -sz], [sx, -sy, -sz], [sx, -sy, sz], [-sx, -sy, sz]] },
  ];

  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const indices = new Uint16Array(36);

  faces.forEach((face, f) => {
    face.v.forEach((v, i) => {
      const o = (f * 4 + i) * 3;
      positions[o] = v[0] + cx;
      positions[o + 1] = v[1] + cy;
      positions[o + 2] = v[2] + cz;
      normals[o] = face.n[0];
      normals[o + 1] = face.n[1];
      normals[o + 2] = face.n[2];
    });
    const base = f * 4;
    const o = f * 6;
    indices[o] = base;
    indices[o + 1] = base + 1;
    indices[o + 2] = base + 2;
    indices[o + 3] = base;
    indices[o + 4] = base + 2;
    indices[o + 5] = base + 3;
  });

  return { positions, normals, indices };
}

/** Merges several boxes into one primitive, so a part is one draw call rather than several. */
export function merge(
  parts: Array<{ positions: Float32Array; normals: Float32Array; indices: Uint16Array }>,
): { positions: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const vertexCount = parts.reduce((s, p) => s + p.positions.length / 3, 0);
  const indexCount = parts.reduce((s, p) => s + p.indices.length, 0);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint16Array(indexCount);

  let vo = 0;
  let io = 0;
  for (const part of parts) {
    positions.set(part.positions, vo * 3);
    normals.set(part.normals, vo * 3);
    for (let i = 0; i < part.indices.length; i++) indices[io + i] = part.indices[i] + vo;
    vo += part.positions.length / 3;
    io += part.indices.length;
  }
  return { positions, normals, indices };
}

/** Subdivides a box into an n x n x n grid of boxes, to hit a triangle count for LOD testing. */
export function boxGrid(
  size: [number, number, number],
  centre: [number, number, number],
  n: number,
): { positions: Float32Array; normals: Float32Array; indices: Uint16Array } {
  const cells: Array<ReturnType<typeof box>> = [];
  const step: [number, number, number] = [size[0] / n, size[1] / n, size[2] / n];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        cells.push(
          box(step, [
            centre[0] - size[0] / 2 + step[0] * (i + 0.5),
            centre[1] - size[1] / 2 + step[1] * (j + 0.5),
            centre[2] - size[2] / 2 + step[2] * (k + 0.5),
          ]),
        );
      }
    }
  }
  return merge(cells);
}
