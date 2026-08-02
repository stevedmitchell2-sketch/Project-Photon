import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ASSET_DIRECTORIES } from '../src/assets/contract';
import { ASSET_MANIFEST, findAsset } from '../src/assets/manifest';
import { box, boxGrid, GlbBuilder, merge, type AnimationChannel } from './lib/glbWriter';

/**
 * Reference assets.
 *
 * Writes real `.glb` files that follow `contract.ts` exactly, so the importer, the validator, the
 * socket and part binding, the LOD construction, the skinning and the material zones can be proven
 * against genuine glTF rather than against a specification nobody has tested.
 *
 *   npm run make-reference-assets
 *
 * ## Why these are not committed
 *
 * The output lands in `public/assets/`, which is git-ignored. The repository stays clone-and-run
 * with no binaries, CI never needs the content pipeline, and every asset in the registry remains
 * optional — a missing file falls back to procedural geometry, which is the normal state.
 *
 * Run this when you want to *exercise* the pipeline; delete `public/assets/` to get the procedural
 * fallbacks back. Both paths are supported and both are tested.
 *
 * ## What they are and are not
 *
 * These are **not art**. They are blocky, deliberately, and a production asset will replace them.
 * What they are is a complete exercise of the contract: every prefix, every required socket, the
 * full LOD chain within budget, material zones that map to the substance library, collision
 * geometry, a skeleton, and a looping animation clip. If the engine handles these, it handles a
 * Blender export; if it does not, the failure is Photon's and is reproducible from source.
 */

const OUT_ROOT = join(process.cwd(), 'public', 'assets');

function writeAsset(id: string, data: Buffer): void {
  const entry = findAsset(id);
  if (!entry) throw new Error(`no manifest entry for "${id}"`);
  const path = join(OUT_ROOT, ASSET_DIRECTORIES[entry.kind], entry.file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  const tris = data.byteLength;
  console.log(`  ${entry.file.padEnd(28)} ${(tris / 1024).toFixed(1).padStart(7)} KB   ${entry.kind}`);
}

// ---------------------------------------------------------------------------
//  Weapon: HeroLaserRifle_v01
// ---------------------------------------------------------------------------

/**
 * The hero weapon.
 *
 * Exercises: three required sockets, seven animated parts, six material zones, collision geometry,
 * and a two-level LOD chain inside the weapon budget (28k triangles, 50% drop between levels).
 *
 * Note the LOD structure, because it is the part most likely to be got wrong by an exporter: LOD
 * levels are **siblings under the asset root**, named `LOD0`, `LOD1`, and each contains the whole
 * model at that detail. They are not nested, and a part that must be animated has to exist inside
 * every level that the runtime might be showing.
 */
function buildRifle(): Buffer {
  const b = new GlbBuilder();

  const matShell = b.addMaterial({ name: 'shell', baseColor: [0.16, 0.18, 0.22, 1], roughness: 0.62, metallic: 0.1 });
  const matFrame = b.addMaterial({ name: 'frame', baseColor: [0.42, 0.46, 0.52, 1], roughness: 0.35, metallic: 0.85 });
  const matGrip = b.addMaterial({ name: 'grip', baseColor: [0.09, 0.1, 0.12, 1], roughness: 0.95 });
  const matVent = b.addMaterial({ name: 'vent', baseColor: [0.3, 0.33, 0.38, 1], roughness: 0.5, metallic: 0.7 });
  const matTrim = b.addMaterial({ name: 'trim', baseColor: [0.18, 0.88, 1, 1], emissive: [0.18, 0.88, 1] });
  const matCore = b.addMaterial({ name: 'core', baseColor: [0.18, 0.88, 1, 1], emissive: [0.18, 0.88, 1] });

  const roots: number[] = [];

  // --- LOD0: the detailed model -------------------------------------------
  const lod0Children: number[] = [];

  // Receiver, in a grid so LOD0 carries a realistic triangle count rather than a token one.
  lod0Children.push(
    b.addNode({
      name: 'MAT_shell_receiver',
      mesh: b.addMesh('receiver', [{ ...boxGrid([0.09, 0.1, 0.5], [0, 0, 0], 6), material: matShell }]),
    }),
  );
  lod0Children.push(
    b.addNode({
      name: 'MAT_frame_barrel',
      mesh: b.addMesh('barrel', [{ ...boxGrid([0.05, 0.05, 0.34], [0, 0.012, -0.38], 4), material: matFrame }]),
    }),
  );
  lod0Children.push(
    b.addNode({
      name: 'MAT_grip_handle',
      mesh: b.addMesh('grip', [
        { ...merge([box([0.055, 0.15, 0.07], [0, -0.12, 0.06]), box([0.05, 0.03, 0.16], [0, -0.05, 0.2])]), material: matGrip },
      ]),
    }),
  );
  lod0Children.push(
    b.addNode({
      name: 'MAT_vent_shroud',
      mesh: b.addMesh('shroud', [{ ...boxGrid([0.075, 0.02, 0.28], [0, 0.06, -0.3], 3), material: matVent }]),
    }),
  );

  // The animated parts.
  //
  // Each is a **transform with a `MAT_` mesh child**, not a mesh itself. A node carries one prefix,
  // and an animated emissive part needs to be two things at once — something the runtime moves and
  // something the material library paints. Nesting is how it gets both, and it is also how any DCC
  // tool naturally represents it: a group you keyframe, containing the geometry.
  //
  // Authoring these as `PART_core` meshes directly is the obvious first attempt and it leaves the
  // manifest's `core` and `trim` zones bound to nothing at all.
  const animatedPart = (
    name: string,
    translation: [number, number, number],
    zone: string,
    size: [number, number, number],
    material: number,
  ): number => {
    const mesh = b.addNode({ name: `MAT_${zone}_${name}`, mesh: b.addMesh(name, [{ ...box(size), material }]) });
    return b.addNode({ name: `PART_${name}`, translation, children: [mesh] });
  };

  lod0Children.push(animatedPart('core', [0, 0.005, -0.05], 'core', [0.035, 0.035, 0.12], matCore));
  lod0Children.push(animatedPart('emitter', [0, 0.012, -0.55], 'core', [0.042, 0.042, 0.05], matCore));
  for (let i = 0; i < 7; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    lod0Children.push(
      animatedPart(`rail_0${i}`, [side * 0.05, 0.01, -0.2 + i * 0.055], 'trim', [0.012, 0.012, 0.045], matTrim),
    );
  }

  const lod0 = b.addNode({ name: 'LOD0', children: lod0Children });
  roots.push(lod0);

  // --- LOD1: the same shape, far fewer triangles ---------------------------
  //
  // Under half of LOD0, which is what the weapon budget requires. Built from plain boxes rather
  // than grids: at the distance LOD1 is shown the subdivision is invisible and the triangles are
  // the entire cost.
  const lod1Children = [
    b.addNode({
      name: 'MAT_shell_receiver',
      mesh: b.addMesh('receiver_lod1', [{ ...box([0.09, 0.1, 0.5]), material: matShell }]),
    }),
    b.addNode({
      name: 'MAT_frame_barrel',
      mesh: b.addMesh('barrel_lod1', [{ ...box([0.05, 0.05, 0.34], [0, 0.012, -0.38]), material: matFrame }]),
    }),
    b.addNode({
      name: 'MAT_grip_handle',
      mesh: b.addMesh('grip_lod1', [{ ...box([0.055, 0.15, 0.07], [0, -0.12, 0.06]), material: matGrip }]),
    }),
    // The animated parts survive into LOD1. A part that exists only at LOD0 makes the animation stop
    // when the level switches, which reads as the weapon dying rather than as a detail reduction.
    b.addNode({
      name: 'PART_core',
      translation: [0, 0.005, -0.05],
      children: [
        b.addNode({
          name: 'MAT_core_lod1',
          mesh: b.addMesh('core_lod1', [{ ...box([0.035, 0.035, 0.12]), material: matCore }]),
        }),
      ],
    }),
    b.addNode({
      name: 'PART_emitter',
      translation: [0, 0.012, -0.55],
      children: [
        b.addNode({
          name: 'MAT_core_emitter_lod1',
          mesh: b.addMesh('emitter_lod1', [{ ...box([0.042, 0.042, 0.05]), material: matCore }]),
        }),
      ],
    }),
  ];
  roots.push(b.addNode({ name: 'LOD1', children: lod1Children }));

  // --- Sockets -------------------------------------------------------------
  // Transforms only, never geometry. The importer hides them; a socket with a mesh on it is the
  // most common contract violation and shows up as a stray box floating at the muzzle.
  roots.push(b.addNode({ name: 'SOCKET_muzzle', translation: [0, 0.012, -0.6] }));
  roots.push(b.addNode({ name: 'SOCKET_grip', translation: [0, -0.12, 0.06] }));
  roots.push(b.addNode({ name: 'SOCKET_sight', translation: [0, 0.07, -0.05] }));
  roots.push(b.addNode({ name: 'SOCKET_eject', translation: [0.05, 0.0, 0.02] }));

  // --- Collision -----------------------------------------------------------
  roots.push(
    b.addNode({
      name: 'COL_hull',
      mesh: b.addMesh('hull', [{ ...box([0.12, 0.28, 0.9], [0, -0.05, -0.15]) }]),
    }),
  );

  return b.build(roots, 'Photon reference asset generator (weapon)');
}

// ---------------------------------------------------------------------------
//  Character: HeroAthlete_v01
// ---------------------------------------------------------------------------

/**
 * The player character.
 *
 * This is the asset that matters most, because it is the only one that exercises **skinning and
 * animation** — the largest hole in the pipeline before this sprint. Clips were being loaded into a
 * map and dropped on the floor; nothing in the project had ever created an `AnimationMixer`.
 *
 * The rig is deliberately minimal but structurally real: a five-joint spine and limb chain, one
 * skinned mesh weighted to it, and two looping clips. If Photon can play these it can play a
 * Mixamo export, because the mechanism is identical.
 */
function buildAthlete(): Buffer {
  const b = new GlbBuilder();

  const matSuit = b.addMaterial({ name: 'suit', baseColor: [0.2, 0.23, 0.28, 1], roughness: 0.8 });
  const matArmor = b.addMaterial({ name: 'armor', baseColor: [0.3, 0.33, 0.4, 1], roughness: 0.45, metallic: 0.4 });
  const matTrim = b.addMaterial({ name: 'trim', baseColor: [0.18, 0.88, 1, 1], emissive: [0.18, 0.88, 1] });
  const matVisor = b.addMaterial({ name: 'visor', baseColor: [0.18, 0.88, 1, 1], emissive: [0.18, 0.88, 1] });

  // --- Skeleton ------------------------------------------------------------
  //
  // Joints are authored in *world* bind position and the inverse bind matrices are derived from
  // them, which is why `addSkin` takes the bind translations rather than trusting the node
  // transforms: a joint whose parent has a non-identity transform does not sit where its own
  // translation says it does, and the resulting mesh explodes on the first animated frame.
  const bind: Array<{ name: string; y: number; parent: number | null }> = [
    { name: 'hips', y: 0.95, parent: null },
    { name: 'spine', y: 1.25, parent: 0 },
    { name: 'chest', y: 1.5, parent: 1 },
    { name: 'neck', y: 1.68, parent: 2 },
    { name: 'head', y: 1.8, parent: 3 },
  ];

  const jointNodes: number[] = [];
  for (let i = 0; i < bind.length; i++) {
    const parentY = bind[i].parent === null ? 0 : bind[bind[i].parent!].y;
    jointNodes.push(b.addNode({ name: bind[i].name, translation: [0, bind[i].y - parentY, 0] }));
  }
  for (let i = 0; i < bind.length; i++) {
    if (bind[i].parent !== null) b.attach(jointNodes[bind[i].parent!], [jointNodes[i]]);
  }

  const skin = b.addSkin(
    jointNodes,
    bind.map((j) => [0, j.y, 0] as [number, number, number]),
    jointNodes[0],
  );

  // --- Skinned body --------------------------------------------------------
  //
  // One segment per joint, each weighted entirely to its own joint. Rigid weighting rather than
  // blended, because the point here is to prove the transform path end to end, and a hard-weighted
  // segment makes a skinning error obvious instead of smearing it into something that looks nearly
  // right.
  const segments: Array<{ size: [number, number, number]; centre: [number, number, number]; joint: number }> = [
    { size: [0.42, 0.34, 0.24], centre: [0, 0.95, 0], joint: 0 },
    { size: [0.44, 0.3, 0.26], centre: [0, 1.25, 0], joint: 1 },
    { size: [0.48, 0.32, 0.28], centre: [0, 1.5, 0], joint: 2 },
    { size: [0.18, 0.14, 0.18], centre: [0, 1.68, 0], joint: 3 },
    { size: [0.26, 0.26, 0.28], centre: [0, 1.84, 0], joint: 4 },
  ];

  const parts = segments.map((s) => box(s.size, s.centre));
  const body = merge(parts);
  const vertexCount = body.positions.length / 3;
  const joints = new Uint16Array(vertexCount * 4);
  const weights = new Float32Array(vertexCount * 4);
  let v = 0;
  segments.forEach((s, i) => {
    const count = parts[i].positions.length / 3;
    for (let k = 0; k < count; k++) {
      joints[(v + k) * 4] = s.joint;
      weights[(v + k) * 4] = 1;
    }
    v += count;
  });

  const bodyMesh = b.addMesh('body', [{ ...body, joints, weights, material: matSuit }]);
  const bodyNode = b.addNode({ name: 'MAT_suit_body', mesh: bodyMesh, skin });

  // Unskinned dressing, so the asset exercises both paths in one file.
  const visor = b.addNode({
    name: 'PART_visor',
    children: [
      b.addNode({
        name: 'MAT_visor_glass',
        mesh: b.addMesh('visor', [{ ...box([0.2, 0.07, 0.03], [0, 1.86, -0.14]), material: matVisor }]),
      }),
    ],
  });
  const pauldrons = b.addNode({
    name: 'MAT_armor_pauldrons',
    mesh: b.addMesh('pauldrons', [
      {
        ...merge([box([0.12, 0.12, 0.24], [-0.3, 1.52, 0]), box([0.12, 0.12, 0.24], [0.3, 1.52, 0])]),
        material: matArmor,
      },
    ]),
  });
  const chestTrim = b.addNode({
    name: 'MAT_trim_chest',
    mesh: b.addMesh('chest_trim', [{ ...box([0.3, 0.03, 0.02], [0, 1.56, -0.15]), material: matTrim }]),
  });

  const lod0 = b.addNode({ name: 'LOD0', children: [bodyNode, visor, pauldrons, chestTrim] });

  // LOD1 and LOD2: the character budget asks for three levels, dropping 45% each time.
  const lod1 = b.addNode({
    name: 'LOD1',
    children: [
      b.addNode({
        name: 'MAT_suit_body',
        mesh: b.addMesh('body_lod1', [
          { ...merge([box([0.46, 0.95, 0.28], [0, 1.28, 0]), box([0.26, 0.26, 0.28], [0, 1.84, 0])]), material: matSuit },
        ]),
      }),
      b.addNode({
        name: 'PART_visor',
        children: [
          b.addNode({
            name: 'MAT_visor_lod1',
            mesh: b.addMesh('visor_lod1', [{ ...box([0.2, 0.07, 0.03], [0, 1.86, -0.14]), material: matVisor }]),
          }),
        ],
      }),
    ],
  });
  const lod2 = b.addNode({
    name: 'LOD2',
    children: [
      b.addNode({
        name: 'MAT_suit_body',
        mesh: b.addMesh('body_lod2', [{ ...box([0.46, 1.5, 0.28], [0, 1.4, 0]), material: matSuit }]),
      }),
    ],
  });

  // --- Clips ---------------------------------------------------------------
  //
  // Two, because one clip proves playback and two prove *blending* — the thing a character actually
  // needs. Rotations are quaternions about X; the identity is (0, 0, 0, 1) and writing (1, 0, 0, 0)
  // instead is a 180 degree turn that reads as the model being inside out.
  const quatX = (radians: number): [number, number, number, number] => [
    Math.sin(radians / 2),
    0,
    0,
    Math.cos(radians / 2),
  ];

  const idleChannels: AnimationChannel[] = [
    {
      node: jointNodes[1],
      path: 'rotation',
      times: [0, 1, 2],
      values: [...quatX(0), ...quatX(0.045), ...quatX(0)],
    },
    {
      node: jointNodes[0],
      path: 'translation',
      times: [0, 1, 2],
      values: [0, 0.95, 0, 0, 0.975, 0, 0, 0.95, 0],
    },
  ];
  b.addAnimation('idle', idleChannels);

  const runChannels: AnimationChannel[] = [
    {
      node: jointNodes[1],
      path: 'rotation',
      times: [0, 0.25, 0.5, 0.75, 1],
      values: [...quatX(0.1), ...quatX(0.22), ...quatX(0.1), ...quatX(0.22), ...quatX(0.1)],
    },
    {
      node: jointNodes[2],
      path: 'rotation',
      times: [0, 0.25, 0.5, 0.75, 1],
      values: [...quatX(-0.12), ...quatX(0.06), ...quatX(-0.12), ...quatX(0.06), ...quatX(-0.12)],
    },
    {
      node: jointNodes[0],
      path: 'translation',
      times: [0, 0.25, 0.5, 0.75, 1],
      values: [0, 0.95, 0, 0, 1.01, 0, 0, 0.95, 0, 0, 1.01, 0, 0, 0.95, 0],
    },
  ];
  b.addAnimation('run', runChannels);

  const roots = [
    lod0,
    lod1,
    lod2,
    jointNodes[0],
    b.addNode({ name: 'SOCKET_helmet', translation: [0, 1.8, 0] }),
    b.addNode({ name: 'SOCKET_backpack', translation: [0, 1.45, 0.16] }),
    b.addNode({ name: 'SOCKET_weapon_right', translation: [0.3, 1.32, -0.12] }),
    b.addNode({ name: 'SOCKET_weapon_left', translation: [-0.3, 1.32, -0.12] }),
    b.addNode({ name: 'COL_body', mesh: b.addMesh('col_body', [{ ...box([0.5, 1.85, 0.35], [0, 0.925, 0]) }]) }),
  ];

  return b.build(roots, 'Photon reference asset generator (character)');
}

// ---------------------------------------------------------------------------

function main(): void {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;

  console.log('\nWriting reference assets to public/assets/\n');
  const builders: Record<string, () => Buffer> = {
    hero_rifle: buildRifle,
    hero_athlete: buildAthlete,
  };

  for (const [id, builder] of Object.entries(builders)) {
    if (only && only !== id) continue;
    writeAsset(id, builder());
  }

  const remaining = ASSET_MANIFEST.filter((e) => !(e.id in builders));
  console.log(
    `\n${Object.keys(builders).length} generated, ${remaining.length} manifest entries still awaiting real content.`,
  );
  console.log('These are structural references, not art. Delete public/assets/ to return to the');
  console.log('procedural fallbacks — both paths are supported.\n');
}

main();
