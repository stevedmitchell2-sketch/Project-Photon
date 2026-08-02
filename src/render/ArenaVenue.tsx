import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { photonMaterial } from './materials/PhotonMaterials';
import { facesFrom, type Placement } from './ArenaArchitecture';
import { useGame } from './GameContext';

/**
 * The venue: spectator galleries, ribbon boards and banners.
 *
 * Sprint 14 gave the arena a landmark and lighting contrast, and it still read as a *room*. The
 * missing ingredient was never detail — it was the implication of an audience. A championship venue
 * is defined by the fact that the play space is surrounded by people looking at it.
 *
 * ## Where it fits without touching gameplay
 *
 * The perimeter walls are 9 m and the upper deck sits at 5 m, so there is a 4 m band of wall above
 * the highest walkable surface doing nothing. The galleries are set into that band. Nothing here
 * collides, nothing changes the arena data, and no sight line a player uses is altered — the bowl
 * lives entirely above the top of play.
 *
 * That constraint is also why this works visually. Real arena seating is *above and behind* the
 * boundary, looking down; putting it anywhere a player could reach would make the space feel
 * smaller rather than larger.
 *
 * ## Reading as a crowd without modelling one
 *
 * There are no spectator models and there should not be. What sells an occupied gallery at this
 * distance is: a dark recess (so the eye reads depth), raked rows catching a little light (so the
 * eye reads repetition going away from it), a bright parapet in front (so the recess has an edge),
 * and warm suite windows breaking the rhythm (so it reads as *rooms* rather than a texture).
 *
 * Individual figures at 25 m would be a few pixels each and cost more than everything else here
 * combined.
 */

/** Gallery band, measured from the floor. Above the 5 m upper deck, below the 9 m roof. */
const GALLERY_BOTTOM = 5.6;
const GALLERY_TOP = 8.5;
/** Metres of wall per seating suite. Wider than the 4 m structural bay, so the two rhythms differ. */
const SUITE_WIDTH = 7.5;

export function ArenaVenue({ maxLights }: { maxLights: number }) {
  const game = useGame();

  const layout = useMemo(() => {
    const faces = facesFrom(game.arena.definition.brushes);

    const recesses: Placement[] = [];
    const parapets: Placement[] = [];
    const ribbons: Placement[] = [];
    const rows: Placement[] = [];
    const mullions: Placement[] = [];
    const suiteGlass: Placement[] = [];
    const banners: Placement[] = [];
    const bannerPoles: Placement[] = [];

    for (const face of faces) {
      const suites = Math.max(1, Math.round(face.length / SUITE_WIDTH));
      const suiteWidth = face.length / suites;
      const start = -face.length / 2;
      const bandHeight = GALLERY_TOP - GALLERY_BOTTOM;
      const bandCentre = (GALLERY_TOP + GALLERY_BOTTOM) / 2;

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

      // The recess. A dark plane set *behind* the wall line, which is what gives the gallery depth —
      // without it the seating reads as decals stuck on a flat surface.
      push(recesses, 0, bandCentre, -0.35, [face.length, bandHeight, 0.1]);

      // Parapet: the bright horizontal edge the recess sits behind. This is the element that most
      // makes the band read as a balcony rather than a hole.
      push(parapets, 0, GALLERY_BOTTOM - 0.15, 0.34, [face.length, 0.7, 0.6]);

      // LED ribbon board on the parapet face — the continuous animated band every real arena has
      // wrapped around its lower tier.
      push(ribbons, 0, GALLERY_BOTTOM - 0.15, 0.66, [face.length, 0.34, 0.08]);

      // Raked seating. Three rows stepping up and back; each row is one stretched instance rather
      // than individual seats, because at 25 m the read is the *banding*, not the seats.
      for (let tier = 0; tier < 3; tier++) {
        const t = tier / 2;
        push(
          rows,
          0,
          GALLERY_BOTTOM + 0.5 + t * (bandHeight - 1.2),
          -0.05 - t * 0.28,
          [face.length - 0.4, 0.42, 0.5],
        );
      }

      for (let suite = 0; suite <= suites; suite++) {
        const offset = start + suiteWidth * suite;
        // Mullions between suites, running the full band height. The vertical rhythm is what stops
        // a long dark band reading as a stripe.
        push(mullions, offset, bandCentre, 0.12, [0.3, bandHeight, 0.5]);
      }

      // Lit suite windows on a slower rhythm than the suites themselves — press boxes and VIP boxes
      // among ordinary seating. Warm against the arena's cyan, which is the only warm/cool contrast
      // in the building and the reason the galleries read as *occupied*.
      for (let suite = 0; suite < suites; suite++) {
        if (suite % 3 !== 1) continue;
        const centreOffset = start + suiteWidth * (suite + 0.5);
        push(suiteGlass, centreOffset, bandCentre + 0.35, 0.05, [suiteWidth - 1.2, 1.5, 0.06]);
      }

      // Championship banners hanging below the gallery, in the tall volume over the deck. Long
      // vertical shapes are the fastest way to communicate ceiling height.
      for (let suite = 0; suite < suites; suite++) {
        if (suite % 2 !== 0) continue;
        const centreOffset = start + suiteWidth * (suite + 0.5);
        push(banners, centreOffset, 3.7, 1.5, [1.9, 3.0, 0.06]);
        push(bannerPoles, centreOffset, 5.25, 1.5, [2.1, 0.12, 0.12]);
      }
    }

    return { recesses, parapets, ribbons, rows, mullions, suiteGlass, banners, bannerPoles };
  }, [game]);

  const palette = game.arena.definition.palette;

  return (
    <group name="arena-venue">
      <Batch placements={layout.recesses} substance="compositePolymer" color={0x0b1018} />
      <Batch placements={layout.rows} substance="compositePolymer" color={0x1b222c} />
      <Batch placements={layout.mullions} substance="titanium" color={0x4a5262} />
      <Batch placements={layout.parapets} substance="brushedAluminium" color={0x5d6878} />
      <Batch placements={layout.bannerPoles} substance="titanium" color={0x5b6472} />
      <Banners placements={layout.banners} />
      <Glow placements={layout.suiteGlass} color={0xffd9a0} opacity={0.5} />
      <RibbonBoards placements={layout.ribbons} color={palette.trim} lit={maxLights > 0} />
    </group>
  );
}

/** Static instanced geometry. */
function Batch({
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
  const mesh = useMemo(() => build(geometry, material, placements), [geometry, material, placements]);
  if (placements.length === 0) return null;
  return <primitive object={mesh} />;
}

/** Unlit emissive panels — suite windows. */
function Glow({
  placements,
  color,
  opacity,
}: {
  placements: Placement[];
  color: number;
  opacity: number;
}) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => {
    const m = photonMaterial('ledStrip', { color, emissive: color, unique: true }) as THREE.MeshBasicMaterial;
    m.transparent = true;
    m.opacity = opacity;
    return m;
  }, [color, opacity]);
  const mesh = useMemo(() => build(geometry, material, placements), [geometry, material, placements]);
  if (placements.length === 0) return null;
  return <primitive object={mesh} />;
}

/**
 * Championship banners.
 *
 * Faint team-neutral cloth with a slow sway. The sway is the point: a hanging banner is the cheapest
 * possible piece of ambient motion, and motion at the top of the frame is what stops a large space
 * reading as a photograph.
 */
function Banners({ placements }: { placements: Placement[] }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const material = useMemo(() => photonMaterial('compositePolymer', { color: 0x243447 }), []);
  const mesh = useMemo(() => build(geometry, material, placements), [geometry, material, placements]);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    placements.forEach((placement, i) => {
      dummy.position.copy(placement.position);
      dummy.rotation.set(0, placement.yaw, Math.sin(t * 0.45 + i * 1.3) * 0.035);
      dummy.scale.copy(placement.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (placements.length === 0) return null;
  return <primitive object={mesh} />;
}

/**
 * The LED ribbon board.
 *
 * A continuous animated band wrapping the lower gallery, which is the single most recognisable piece
 * of arena furniture there is — every basketball court, football stadium and esports stage has one.
 *
 * Animated by scrolling the texture offset rather than redrawing, for the reason Sprint 10 measured
 * the hard way: four canvas redraws per frame cost 3.19 ms while adding four draw calls. The chase
 * pattern is drawn once and moved.
 */
function RibbonBoards({
  placements,
  color,
  lit,
}: {
  placements: Placement[];
  color: number;
  lit: boolean;
}) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 16;
    const context = canvas.getContext('2d')!;
    const css = `#${color.toString(16).padStart(6, '0')}`;
    context.fillStyle = 'rgba(6,12,20,1)';
    context.fillRect(0, 0, 256, 16);
    // A repeating chase of bright cells with gaps — reads as a running message board without
    // needing to be legible, which it would not be at this distance anyway.
    for (let i = 0; i < 32; i++) {
      const bright = i % 5 !== 0;
      context.fillStyle = bright ? css : 'rgba(255,255,255,0.14)';
      context.globalAlpha = bright ? 0.85 : 0.35;
      context.fillRect(i * 8 + 1, 3, 6, 10);
    }
    context.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(8, 1);
    return tex;
  }, [color]);

  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, transparent: true, opacity: 0.9 }),
    [texture],
  );
  const mesh = useMemo(() => build(geometry, material, placements), [geometry, material, placements]);
  const light = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    texture.offset.x = (clock.elapsedTime * 0.06) % 1;
    if (light.current) {
      light.current.intensity = 26 + Math.sin(clock.elapsedTime * 1.7) * 6;
    }
  });

  if (placements.length === 0) return null;
  return (
    <>
      <primitive object={mesh} />
      {/* One light for the whole ribbon, at the arena centre. The band is emissive and carries
          itself; this exists only so the ribbon tints the upper walls it is mounted on. */}
      {lit && <pointLight ref={light} position={[0, GALLERY_BOTTOM, 0]} color={color} distance={40} decay={1.6} intensity={26} />}
    </>
  );
}

function build(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  placements: Placement[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
  const dummy = new THREE.Object3D();
  placements.forEach((placement, i) => {
    dummy.position.copy(placement.position);
    dummy.rotation.set(0, placement.yaw, 0);
    dummy.scale.copy(placement.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.count = placements.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.computeBoundingSphere();
  return mesh;
}
