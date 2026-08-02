import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Brush } from '@/maps/MapTypes';
import { photonMaterial } from './materials/PhotonMaterials';
import { useGame } from './GameContext';

/**
 * Architectural detail.
 *
 * The arena's perimeter is four brushes — 60 × 8 × 1 m boxes. Correct as collision, and the reason
 * the game has always read as graybox: a wall the size of a building with no features on it gives
 * the eye nothing to measure, nothing to recognise, and nothing to remember.
 *
 * This does not change the collision or the arena data. It reads the wall brushes and **builds
 * architecture along their faces**: structural ribs on a bay rhythm, recessed panels between them,
 * a lit trim channel, service hatches, vents, cable runs and a kick plate. The wall is still one
 * box to the physics engine and now reads as a constructed surface to the player.
 *
 * ## Why this is worth doing procedurally
 *
 * Sprint 11 concluded that procedural geometry has a ceiling, and that is true — of *hero assets*,
 * where what is missing is surface density: bevels, wear, moulded detail, the small-scale texture a
 * modeller adds. It is **not** true of architecture. Repetitive structural detail on a regular
 * rhythm is exactly what code does better than a person, because a person would have to place four
 * hundred of these by hand and keep them aligned.
 *
 * The rule that separates the two: **if the detail is a rhythm, generate it; if it is a
 * silhouette, model it.**
 *
 * ## Cost
 *
 * Everything is instanced by element type, so the entire arena's architecture is a handful of draw
 * calls regardless of how many bays it has. The frame is fragment-bound, so the real cost is fill —
 * these are small opaque elements sitting on top of surfaces that were already being drawn, which
 * is the cheapest kind of geometry to add.
 */

/** Bay spacing. Matches the 4 m module grid the kit specification is built around. */
const BAY = 4;

export interface Face {
  /** Centre of the wall face, on its inward surface. */
  centre: THREE.Vector3;
  /** Unit vector along the wall's length. */
  along: THREE.Vector3;
  /** Unit vector pointing into the room. */
  inward: THREE.Vector3;
  length: number;
  height: number;
  /** Rotation that aligns a box with this face. */
  yaw: number;
}

/**
 * Derives the inward faces of the arena's perimeter walls.
 *
 * Works from the brush data rather than hardcoded coordinates, so a future arena with a different
 * shell gets its architecture for free. A wall is treated as facing the arena centre, which is true
 * of every perimeter wall and is the only assumption made here.
 */
export function facesFrom(brushes: Brush[]): Face[] {
  const faces: Face[] = [];

  for (const brush of brushes) {
    if (brush.kind !== 'wall') continue;
    const [sx, sy, sz] = brush.s;
    // Perimeter walls are long, tall and thin. Interior chunks that happen to be tagged `wall` are
    // skipped: detailing a 2 m block adds clutter, not architecture.
    const longest = Math.max(sx, sz);
    if (longest < 12 || sy < 4) continue;

    const horizontal = sx >= sz;
    const length = horizontal ? sx : sz;
    const thickness = horizontal ? sz : sx;
    const centre = new THREE.Vector3(brush.p[0], brush.p[1], brush.p[2]);

    // Inward is whichever direction points back toward the origin.
    const inward = horizontal
      ? new THREE.Vector3(0, 0, centre.z > 0 ? -1 : 1)
      : new THREE.Vector3(centre.x > 0 ? -1 : 1, 0, 0);

    const along = horizontal ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);

    // Sit the detail on the inward surface, not the brush centre.
    const surface = centre.clone().addScaledVector(inward, thickness / 2);

    faces.push({
      centre: surface,
      along,
      inward,
      length,
      height: sy,
      yaw: horizontal ? 0 : Math.PI / 2,
    });
  }

  return faces;
}

/** One placement: position, rotation and scale for an instanced element. */
export interface Placement {
  position: THREE.Vector3;
  yaw: number;
  scale: THREE.Vector3;
}

export function ArenaArchitecture() {
  const game = useGame();

  const layout = useMemo(() => {
    const faces = facesFrom(game.arena.definition.brushes);

    const ribs: Placement[] = [];
    const panels: Placement[] = [];
    const trims: Placement[] = [];
    const hatches: Placement[] = [];
    const vents: Placement[] = [];
    const conduits: Placement[] = [];
    const kicks: Placement[] = [];
    const capitals: Placement[] = [];

    for (const face of faces) {
      const bays = Math.max(1, Math.round(face.length / BAY));
      const bayWidth = face.length / bays;
      const start = -face.length / 2;

      // Continuous elements: one instance stretched along the whole face.
      const push = (
        list: Placement[],
        offsetAlong: number,
        y: number,
        outward: number,
        scale: [number, number, number],
      ) => {
        const position = face.centre
          .clone()
          .addScaledVector(face.along, offsetAlong)
          .addScaledVector(face.inward, outward);
        position.y = y;
        list.push({ position, yaw: face.yaw, scale: new THREE.Vector3(...scale) });
      };

      // Kick plate: a darker band at the base. Grounds the wall and hides the floor join, which is
      // the single most obvious tell of untreated boxes.
      push(kicks, 0, 0.22, 0.06, [face.length, 0.44, 0.12]);

      // Lit trim channel at eye height. Recessed behind a lip, so it reads as installed rather than
      // painted — the lip is the rib row below.
      push(trims, 0, 2.55, 0.05, [face.length, 0.1, 0.1]);

      // Upper cornice, where the wall meets the ceiling structure.
      push(capitals, 0, face.height - 0.5, 0.1, [face.length, 0.35, 0.2]);

      for (let bay = 0; bay < bays; bay++) {
        const centreOffset = start + bayWidth * (bay + 0.5);
        const edgeOffset = start + bayWidth * bay;

        // Structural rib on every bay line. The vertical rhythm is what makes a long wall legible
        // and gives the eye a unit to measure the room in.
        push(ribs, edgeOffset, face.height / 2, 0.14, [0.34, face.height, 0.28]);

        // Recessed panel filling the bay, standing slightly proud of the wall. Cheaper than a real
        // recess and reads identically at play distance, because what the eye reads is the shadow
        // line at the panel edge, not the depth.
        push(panels, centreOffset, 3.9, 0.04, [bayWidth - 0.7, 4.4, 0.08]);

        // Service fittings on a slower rhythm than the bays — architecture that repeats every bay
        // reads as wallpaper. Every third bay gets a hatch, every fourth a vent.
        if (bay % 3 === 1) {
          push(hatches, centreOffset, 1.35, 0.1, [1.1, 1.5, 0.1]);
        }
        if (bay % 4 === 2) {
          push(vents, centreOffset, 6.2, 0.1, [1.4, 0.7, 0.1]);
        }
        if (bay % 2 === 0) {
          // Cable run dropping from the cornice to the service band.
          push(conduits, centreOffset + bayWidth * 0.32, 5.0, 0.16, [0.14, 2.2, 0.14]);
        }
      }

      // Close the final rib.
      push(ribs, start + face.length, face.height / 2, 0.14, [0.34, face.height, 0.28]);
    }

    // --- Broadcast rig ----------------------------------------------------
    //
    // The ceiling was a single 60 x 60 slab: looking up showed nothing at all, in a game whose
    // fiction is a televised sport. A venue's roof is the most equipment-dense surface in the
    // building, because that is where everything that watches and lights the match hangs from.
    //
    // Built as a truss grid rather than scattered props, so it reads as one installed system. The
    // grid pitch is deliberately wider than the wall bays — a ceiling on the same rhythm as the
    // walls reads as a repeated texture instead of a structure.
    const trusses: Placement[] = [];
    const fixtures: Placement[] = [];
    const lamps: Placement[] = [];
    const cameras: Placement[] = [];
    const speakers: Placement[] = [];
    const hangers: Placement[] = [];

    const bounds = game.arena.definition.bounds;
    const [minX, minZ, maxX, maxZ] = bounds;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const ceilingY = game.arena.definition.ceilingY;
    /**
     * Where the procedural broadcast rig hangs.
     *
     * `ceilingY` is the arena's **navigation** ceiling — the height the bake casts down from — and
     * on arenas whose roof is far above the top of play those are wildly different numbers. Apex
     * has a 28 m roof and a nav ceiling of 11.4, so reading the rig height off `ceilingY` hung a
     * complete lighting truss at 10.5 m, straight through the sky bridges.
     *
     * `rigCeilingY` lets an arena say where its roof actually is. Arenas that model their own rig
     * turn the whole thing off with `proceduralCeilingRig`.
     */
    const trussY = (game.arena.definition.rigCeilingY ?? ceilingY) - 0.9;
    const wantRig = game.arena.definition.proceduralCeilingRig !== false;

    const place = (
      list: Placement[],
      x: number,
      y: number,
      z: number,
      scale: [number, number, number],
      yaw = 0,
    ) => {
      list.push({ position: new THREE.Vector3(x, y, z), yaw, scale: new THREE.Vector3(...scale) });
    };

    const TRUSS_PITCH = 10;
    const beamsX = Math.floor(spanX / TRUSS_PITCH);
    const beamsZ = Math.floor(spanZ / TRUSS_PITCH);

    // Primary trusses running one way, secondaries crossing them: a real roof is a grid, and the
    // crossing is what makes it read as structure rather than as stripes.
    for (let i = 1; i < beamsX; i++) {
      const x = minX + (spanX / beamsX) * i;
      place(trusses, x, trussY, 0, [0.5, 0.7, spanZ - 2]);
      // Chord below the beam, so the truss has depth from underneath — the only angle it is seen.
      place(trusses, x, trussY - 0.55, 0, [0.22, 0.2, spanZ - 2]);
      for (let k = -2; k <= 2; k++) {
        place(hangers, x, trussY + 0.9, k * (spanZ / 6), [0.12, 1.6, 0.12]);
      }
    }
    for (let i = 1; i < beamsZ; i++) {
      const z = minZ + (spanZ / beamsZ) * i;
      place(trusses, 0, trussY - 0.75, z, [spanX - 2, 0.42, 0.34]);
    }

    // Lighting fixtures at truss intersections, angled inward toward the floor they light.
    for (let i = 1; i < beamsX; i++) {
      for (let k = 1; k < beamsZ; k++) {
        const x = minX + (spanX / beamsX) * i;
        const z = minZ + (spanZ / beamsZ) * k;
        place(fixtures, x, trussY - 1.25, z, [1.1, 0.55, 1.1]);
        place(lamps, x, trussY - 1.55, z, [0.85, 0.1, 0.85]);
      }
    }

    // Broadcast cameras on the corners of the objective room, looking in. Placed where a director
    // would actually put them: high, on the diagonals, covering the contested ground.
    const camRadius = Math.min(spanX, spanZ) * 0.28;
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + (i * Math.PI) / 2;
      place(
        cameras,
        Math.cos(angle) * camRadius,
        trussY - 1.1,
        Math.sin(angle) * camRadius,
        [0.75, 0.5, 1.1],
        -angle,
      );
    }

    // Speaker arrays along the long axis, facing down.
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      place(speakers, minX + spanX * t, trussY - 0.9, minZ + 2.5, [0.7, 0.9, 0.45]);
      place(speakers, minX + spanX * t, trussY - 0.9, maxZ - 2.5, [0.7, 0.9, 0.45]);
    }

    // --- Cover and pillars -------------------------------------------------
    //
    // The second-worst offender after the walls, and arguably worse in practice: cover sits in the
    // middle of the play space at eye height, so a bare box is in frame constantly. These are the
    // objects a player spends the most time looking at from a metre away.
    //
    // Three additions turn a box into a piece of equipment: a **capping rail** along the top edge
    // (which is what the eye actually reads when peeking over cover), **corner posts** that imply
    // a frame carrying the panel, and a **lit strip** just under the cap. All derived from the
    // brush's own dimensions, so any arena's cover is detailed without authoring.
    const coverCaps: Placement[] = [];
    const coverPosts: Placement[] = [];
    const coverStrips: Placement[] = [];
    const pillarBands: Placement[] = [];

    for (const brush of game.arena.definition.brushes) {
      if (brush.noCollide) continue;
      const [sx, sy, sz] = brush.s;
      const [px, py, pz] = brush.p;
      const yaw = ((brush.rot ?? 0) * Math.PI) / 180;

      if (brush.kind === 'barrier') {
        // Skip anything too small or too large to be cover a player uses.
        const footprint = Math.max(sx, sz);
        if (footprint < 1.2 || sy > 3.2) continue;

        const top = py + sy / 2;

        // Capping rail, slightly proud on every side. The strongest single read: a chamfered top
        // edge is the difference between "crate" and "barrier".
        coverCaps.push({
          position: new THREE.Vector3(px, top + 0.05, pz),
          yaw,
          scale: new THREE.Vector3(sx + 0.16, 0.14, sz + 0.16),
        });

        // Lit strip immediately below the cap, so cover is visible in a dark corner and its top
        // edge is unambiguous when you are about to peek over it.
        coverStrips.push({
          position: new THREE.Vector3(px, top - 0.14, pz),
          yaw,
          scale: new THREE.Vector3(sx + 0.06, 0.05, sz + 0.06),
        });

        // Corner posts on the long axis, implying a frame the panel is mounted into.
        const along = sx >= sz ? 'x' : 'z';
        const half = (along === 'x' ? sx : sz) / 2;
        for (const side of [-1, 1]) {
          const offset = new THREE.Vector3(
            along === 'x' ? side * (half - 0.1) : 0,
            0,
            along === 'z' ? side * (half - 0.1) : 0,
          ).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
          coverPosts.push({
            position: new THREE.Vector3(px + offset.x, py, pz + offset.z),
            yaw,
            scale: new THREE.Vector3(
              along === 'x' ? 0.2 : sx + 0.1,
              sy + 0.04,
              along === 'z' ? 0.2 : sz + 0.1,
            ),
          });
        }
      }

      if (brush.kind === 'pillar') {
        // Banding at two heights breaks a tall column and gives it an implied construction.
        for (const t of [0.28, 0.72]) {
          pillarBands.push({
            position: new THREE.Vector3(px, py - sy / 2 + sy * t, pz),
            yaw,
            scale: new THREE.Vector3(sx + 0.14, 0.18, sz + 0.14),
          });
        }
      }
    }

    // --- Competition floor -------------------------------------------------
    //
    // The floor is a third of every frame and was a bare plane. A sports floor is *marked*: it tells
    // you where the play area ends, where the objective is, and which way is which. Those markings
    // are navigation aids first and decoration second, which is why they are laid out from the
    // arena's own bounds and objective volumes rather than authored.
    const laneLines: Placement[] = [];
    const floorSeams: Placement[] = [];
    const objectiveRing: Placement[] = [];
    const approachChevrons: Placement[] = [];

    const FLOOR_Y = 0.03;

    // Boundary line inset from the wall, the way a court is marked inside its room.
    const inset = 3;
    const halfX = spanX / 2 - inset;
    const halfZ = spanZ / 2 - inset;
    place(laneLines, 0, FLOOR_Y, -halfZ, [halfX * 2, 0.04, 0.18]);
    place(laneLines, 0, FLOOR_Y, halfZ, [halfX * 2, 0.04, 0.18]);
    place(laneLines, -halfX, FLOOR_Y, 0, [0.18, 0.04, halfZ * 2]);
    place(laneLines, halfX, FLOOR_Y, 0, [0.18, 0.04, halfZ * 2]);

    // Panel seams on the module grid. These are what give the floor scale — a featureless plane
    // gives the eye no size reference at all, which is most of what makes a graybox look like one.
    const SEAM_PITCH = 8;
    for (let i = -Math.floor(spanX / SEAM_PITCH / 2); i <= Math.floor(spanX / SEAM_PITCH / 2); i++) {
      place(floorSeams, i * SEAM_PITCH, FLOOR_Y - 0.005, 0, [0.06, 0.03, spanZ - 2]);
    }
    for (let k = -Math.floor(spanZ / SEAM_PITCH / 2); k <= Math.floor(spanZ / SEAM_PITCH / 2); k++) {
      place(floorSeams, 0, FLOOR_Y - 0.005, k * SEAM_PITCH, [spanX - 2, 0.03, 0.06]);
    }

    // Objective marking: a segmented ring on the floor of the contested room, plus chevrons on each
    // approach pointing inward. The chevrons are the navigation payload — from a corridor you can
    // see which way the middle is without a HUD.
    const hill = game.arena.definition.objectives.find((o) => o.kind === 'hill');
    if (hill) {
      const radius = Math.max(hill.s[0], hill.s[2]) * 0.62;
      const segments = 20;
      for (let i = 0; i < segments; i++) {
        // Broken ring: gaps read as installed lighting, a solid circle reads as paint.
        if (i % 2 === 1) continue;
        const angle = (i / segments) * Math.PI * 2;
        place(
          objectiveRing,
          hill.p[0] + Math.cos(angle) * radius,
          FLOOR_Y,
          hill.p[2] + Math.sin(angle) * radius,
          [0.9, 0.05, 0.16],
          -angle,
        );
      }

      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        for (let step = 0; step < 3; step++) {
          const distance = radius + 3.5 + step * 2.6;
          place(
            approachChevrons,
            hill.p[0] + Math.cos(angle) * distance,
            FLOOR_Y,
            hill.p[2] + Math.sin(angle) * distance,
            [1.5 - step * 0.25, 0.05, 0.14],
            -angle + Math.PI / 2,
          );
        }
      }
    }

    return {
      ribs, panels, trims, hatches, vents, conduits, kicks, capitals,
      trusses: wantRig ? trusses : [],
      fixtures: wantRig ? fixtures : [],
      lamps: wantRig ? lamps : [],
      cameras: wantRig ? cameras : [],
      speakers: wantRig ? speakers : [],
      hangers: wantRig ? hangers : [],
      coverCaps, coverPosts, coverStrips, pillarBands,
      laneLines, floorSeams, objectiveRing, approachChevrons,
    };
  }, [game]);

  const palette = game.arena.definition.palette;

  return (
    <group name="arena-architecture">
      <Elements placements={layout.kicks} substance="titanium" color={0x1d232d} />
      <Elements placements={layout.panels} substance="compositePolymer" color={palette.wall} />
      <Elements placements={layout.ribs} substance="brushedAluminium" color={0x4a5464} />
      <Elements placements={layout.capitals} substance="titanium" color={0x39414f} />
      <Elements placements={layout.hatches} substance="paintedAlloy" color={0x3d4655} />
      <Elements placements={layout.vents} substance="titanium" color={0x232a35} />
      <Elements placements={layout.conduits} substance="paintedAlloy" color={0x2b323d} />
      <TrimChannels placements={layout.trims} color={palette.trim} />

      {/* Broadcast rig */}
      {/* Lifted well above the ceiling's own value. The rig hangs below the roof with nothing
          lighting it from above, so authored-dark structure disappears entirely — a real broadcast
          truss is visible because it catches the spill from the fixtures bolted to it, and these
          have to fake that with albedo. */}
      <Elements placements={layout.trusses} substance="brushedAluminium" color={0x707c8e} />
      <Elements placements={layout.hangers} substance="titanium" color={0x5b6472} />
      <Elements placements={layout.fixtures} substance="paintedAlloy" color={0x6a7484} />
      <Elements placements={layout.cameras} substance="paintedAlloy" color={0x4d5462} />
      <Elements placements={layout.speakers} substance="carbonFibre" color={0x424a57} />
      <TrimChannels placements={layout.lamps} color={0xfff2d0} />

      {/* Cover and pillars */}
      <Elements placements={layout.coverPosts} substance="brushedAluminium" color={0x505b6b} />
      <Elements placements={layout.coverCaps} substance="titanium" color={0x2f3742} />
      <Elements placements={layout.pillarBands} substance="brushedAluminium" color={0x596475} />
      <TrimChannels placements={layout.coverStrips} color={palette.trim} />

      {/* Competition floor */}
      <Elements placements={layout.floorSeams} substance="titanium" color={0x1b2029} />
      <TrimChannels placements={layout.laneLines} color={0xdfe9f5} />
      <TrimChannels placements={layout.objectiveRing} color={palette.trim} />
      <TrimChannels placements={layout.approachChevrons} color={0x8fa4bd} />
    </group>
  );
}

/** A batch of identical architectural elements. */
function Elements({
  placements,
  substance,
  color,
}: {
  placements: Placement[];
  substance: Parameters<typeof photonMaterial>[0];
  color: number;
}) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => photonMaterial(substance, { color }), [substance, color]);

  const mesh = useMemo(() => {
    const instanced = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
    const dummy = new THREE.Object3D();
    placements.forEach((placement, i) => {
      dummy.position.copy(placement.position);
      dummy.rotation.set(0, placement.yaw, 0);
      dummy.scale.copy(placement.scale);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    });
    instanced.count = placements.length;
    instanced.instanceMatrix.needsUpdate = true;
    instanced.castShadow = false;
    instanced.receiveShadow = true;
    instanced.computeBoundingSphere();
    return instanced;
  }, [geometry, material, placements]);

  if (placements.length === 0) return null;
  return <primitive object={mesh} />;
}

/**
 * The lit trim channel running each wall.
 *
 * Separate from the other elements because it breathes: a slow pulse across the whole arena, which
 * is what stops a large static room from reading as a photograph. Deliberately subtle — orientation
 * furniture must never compete with a muzzle flash for attention.
 */
function TrimChannels({ placements, color }: { placements: Placement[]; color: number }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(
    () => photonMaterial('ledStrip', { color, emissive: color, unique: true }) as THREE.MeshBasicMaterial,
    [color],
  );

  const mesh = useMemo(() => {
    const instanced = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
    const dummy = new THREE.Object3D();
    placements.forEach((placement, i) => {
      dummy.position.copy(placement.position);
      dummy.rotation.set(0, placement.yaw, 0);
      dummy.scale.copy(placement.scale);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    });
    instanced.count = placements.length;
    instanced.instanceMatrix.needsUpdate = true;
    instanced.computeBoundingSphere();
    return instanced;
  }, [geometry, material, placements]);

  useFrame(({ clock }) => {
    material.opacity = 0.78 + 0.16 * Math.sin(clock.elapsedTime * 0.9);
    material.transparent = true;
  });

  if (placements.length === 0) return null;
  return <primitive object={mesh} />;
}
