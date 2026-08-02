import { describe, expect, it } from 'vitest';
import { box, boxGrid, GlbBuilder, merge } from '../../scripts/lib/glbWriter';

/**
 * Container-level tests for the reference asset writer.
 *
 * The generated assets themselves can only be proven in a browser, because `GLTFLoader` needs a
 * fetch stack and a WebGL context. What *can* be proven here is the half that goes wrong silently:
 * the GLB container, the chunk padding, and whether the accessors describe the data actually
 * written. A file with a mis-padded chunk or a missing POSITION min/max loads in one viewer,
 * fails in another, and reports an error that names neither.
 */

/** Parses a GLB back into its two chunks, the way a loader does. */
function parseGlb(buffer: Buffer): { json: Record<string, unknown>; bin: Buffer } {
  expect(buffer.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  expect(buffer.readUInt32LE(4)).toBe(2);
  expect(buffer.readUInt32LE(8)).toBe(buffer.byteLength);

  const jsonLength = buffer.readUInt32LE(12);
  expect(buffer.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as Record<string, unknown>;

  const binHeader = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binHeader);
  expect(buffer.readUInt32LE(binHeader + 4)).toBe(0x004e4942); // 'BIN\0'
  return { json, bin: buffer.subarray(binHeader + 8, binHeader + 8 + binLength) };
}

function simpleAsset(): Buffer {
  const b = new GlbBuilder();
  const material = b.addMaterial({ name: 'shell', baseColor: [0.2, 0.2, 0.2, 1] });
  const mesh = b.addMesh('body', [{ ...box([1, 2, 3]), material }]);
  const node = b.addNode({ name: 'MAT_shell_body', mesh });
  const socket = b.addNode({ name: 'SOCKET_muzzle', translation: [0, 1, -2] });
  return b.build([node, socket]);
}

describe('GLB writer', () => {
  it('writes a container a loader can parse', () => {
    const { json } = parseGlb(simpleAsset());
    expect((json.asset as { version: string }).version).toBe('2.0');
    expect(json.scene).toBe(0);
    expect((json.scenes as Array<{ nodes: number[] }>)[0].nodes).toHaveLength(2);
  });

  it('pads both chunks to four bytes', () => {
    // A name of odd length is what makes the JSON chunk need padding, which is the case that
    // actually breaks in the wild.
    const b = new GlbBuilder();
    const mesh = b.addMesh('x', [{ ...box([1, 1, 1]) }]);
    const buffer = b.build([b.addNode({ name: 'odd_length_name_here', mesh })]);

    expect(buffer.byteLength % 4).toBe(0);
    const jsonLength = buffer.readUInt32LE(12);
    expect(jsonLength % 4).toBe(0);
    const binLength = buffer.readUInt32LE(20 + jsonLength);
    expect(binLength % 4).toBe(0);
  });

  it('gives every POSITION accessor bounds', () => {
    const { json } = parseGlb(simpleAsset());
    const accessors = json.accessors as Array<{ min?: number[]; max?: number[]; type: string }>;
    const meshes = json.meshes as Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>;

    for (const mesh of meshes) {
      for (const primitive of mesh.primitives) {
        const accessor = accessors[primitive.attributes.POSITION];
        // Without these three.js produces an object with no bounding box, which is then never
        // frustum-culled — an asset that costs a draw call from everywhere in the arena.
        expect(accessor.min).toHaveLength(3);
        expect(accessor.max).toHaveLength(3);
        expect(accessor.min![0]).toBeCloseTo(-0.5);
        expect(accessor.max![2]).toBeCloseTo(1.5);
      }
    }
  });

  it('keeps every bufferView inside the binary chunk and aligned', () => {
    const { json, bin } = parseGlb(simpleAsset());
    const views = json.bufferViews as Array<{ byteOffset: number; byteLength: number }>;
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      expect(view.byteOffset % 4).toBe(0);
      expect(view.byteOffset + view.byteLength).toBeLessThanOrEqual(bin.byteLength);
    }
  });

  it('writes skins with one inverse bind matrix per joint', () => {
    const b = new GlbBuilder();
    const hips = b.addNode({ name: 'hips', translation: [0, 1, 0] });
    const spine = b.addNode({ name: 'spine', translation: [0, 0.3, 0] });
    b.attach(hips, [spine]);
    const skin = b.addSkin(
      [hips, spine],
      [
        [0, 1, 0],
        [0, 1.3, 0],
      ],
      hips,
    );
    const buffer = b.build([hips], 'test');
    const { json } = parseGlb(buffer);
    const skins = json.skins as Array<{ joints: number[]; inverseBindMatrices: number }>;
    const accessors = json.accessors as Array<{ type: string; count: number }>;

    expect(skin).toBe(0);
    expect(skins[0].joints).toHaveLength(2);
    const ibm = accessors[skins[0].inverseBindMatrices];
    expect(ibm.type).toBe('MAT4');
    expect(ibm.count).toBe(2);
  });

  it('writes animation channels as sampler pairs', () => {
    const b = new GlbBuilder();
    const node = b.addNode({ name: 'spine' });
    b.addAnimation('run', [
      { node, path: 'rotation', times: [0, 0.5, 1], values: [0, 0, 0, 1, 0.1, 0, 0, 0.99, 0, 0, 0, 1] },
    ]);
    const { json } = parseGlb(b.build([node], 'test'));
    const animations = json.animations as Array<{
      name: string;
      samplers: Array<{ input: number; output: number }>;
      channels: Array<{ sampler: number; target: { node: number; path: string } }>;
    }>;
    const accessors = json.accessors as Array<{ type: string; count: number }>;

    expect(animations[0].name).toBe('run');
    expect(animations[0].channels[0].target.path).toBe('rotation');
    expect(accessors[animations[0].samplers[0].input].type).toBe('SCALAR');
    // Rotations are quaternions: four components per key, not three.
    expect(accessors[animations[0].samplers[0].output].type).toBe('VEC4');
    expect(accessors[animations[0].samplers[0].output].count).toBe(3);
  });
});

describe('geometry helpers', () => {
  it('gives a box flat per-face normals', () => {
    const { positions, normals, indices } = box([2, 2, 2]);
    expect(positions).toHaveLength(24 * 3);
    expect(indices).toHaveLength(36);
    // Four vertices per face rather than eight shared ones — shared corners cannot carry per-face
    // normals and a box with averaged corner normals shades like a sphere.
    expect([normals[0], normals[1], normals[2]]).toEqual([0, 0, 1]);
  });

  it('renumbers indices when merging', () => {
    const merged = merge([box([1, 1, 1], [-2, 0, 0]), box([1, 1, 1], [2, 0, 0])]);
    expect(merged.positions).toHaveLength(48 * 3);
    expect(Math.max(...merged.indices)).toBe(47);
  });

  it('scales triangle count with grid subdivision, for LOD chains', () => {
    const one = box([1, 1, 1]).indices.length / 3;
    const grid = boxGrid([1, 1, 1], [0, 0, 0], 3).indices.length / 3;
    expect(one).toBe(12);
    expect(grid).toBe(12 * 27);
  });
});
