import { MOVEMENT } from '@/config/movement';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { GROUP_NAV_QUERY, GROUP_WORLD_QUERY } from '@/physics/layers';
import type { ArenaDefinition } from '@/maps/MapTypes';
import { distSq3, type Vec3 } from '@/util/math';

/**
 * Navigation graph built by probing the real collision world.
 *
 * Rather than trusting hand-authored waypoints (which drift the moment a designer nudges a wall),
 * this samples a horizontal grid, casts down to find every walkable surface at each column, then
 * links surfaces that a character could actually step between. Multi-level maps — catwalks over
 * floors, ramps between them — fall out of that naturally.
 *
 * Built once at map load. Roughly 25k raycasts for a 60x60 arena, ~40 ms.
 */

export interface NavNode {
  index: number;
  x: number;
  y: number;
  z: number;
  /** Column index, so we can find candidates near a position in O(1). */
  col: number;
  neighbors: number[];
  neighborCosts: number[];
  /** Distance to the nearest wall — bots prefer open lanes when travelling, cover when fighting. */
  openness: number;
}

const SPACING = 1.5;
const CLEARANCE = MOVEMENT.crouchHeight + 0.05;
/** Enough to walk down through a catwalk, a bridge and the deck below it in one column. */
const MAX_LEVELS_PER_COLUMN = 6;

export class NavGraph {
  readonly nodes: NavNode[] = [];
  private readonly columns: number[][] = [];
  private readonly cols: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;

  // Reusable A* scratch, sized once. Pathfinding runs several times per second across all bots.
  private gScore: Float32Array;
  private fScore: Float32Array;
  private cameFrom: Int32Array;
  private visitedStamp: Int32Array;
  private closedStamp: Int32Array;
  private searchStamp = 0;
  private readonly openHeap: number[] = [];

  private constructor(arena: ArenaDefinition) {
    const [minX, minZ, maxX, maxZ] = arena.bounds;
    this.minX = minX;
    this.minZ = minZ;
    this.cols = Math.floor((maxX - minX) / SPACING) + 1;
    this.rows = Math.floor((maxZ - minZ) / SPACING) + 1;
    for (let i = 0; i < this.cols * this.rows; i++) this.columns.push([]);
    // Allocated after sampling in `build`; placeholders keep the fields readonly.
    this.gScore = new Float32Array(0);
    this.fScore = new Float32Array(0);
    this.cameFrom = new Int32Array(0);
    this.visitedStamp = new Int32Array(0);
    this.closedStamp = new Int32Array(0);
  }

  static build(physics: PhysicsWorld, arena: ArenaDefinition): NavGraph {
    const graph = new NavGraph(arena);
    graph.sampleSurfaces(physics, arena);
    graph.linkNeighbors(physics);
    graph.computeOpenness(physics);
    return graph.finalize();
  }

  /** Casts down each grid column, collecting every stand-able surface. */
  private sampleSurfaces(physics: PhysicsWorld, arena: ArenaDefinition): void {
    const down: Vec3 = { x: 0, y: -1, z: 0 };
    const up: Vec3 = { x: 0, y: 1, z: 0 };
    const maxSlopeY = Math.cos((MOVEMENT.maxSlopeAngle * Math.PI) / 180);

    for (let cz = 0; cz < this.rows; cz++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const wx = this.minX + cx * SPACING;
        const wz = this.minZ + cz * SPACING;
        const col = cz * this.cols + cx;

        let castY = arena.ceilingY + 1;
        for (let level = 0; level < MAX_LEVELS_PER_COLUMN; level++) {
          // solid=false so a ray that begins inside a slab reports the face it exits through,
          // letting the scan walk down past catwalks instead of stalling on a zero-length hit.
          const hit = physics.raycast(
            { x: wx, y: castY, z: wz },
            down,
            castY + 2,
            GROUP_NAV_QUERY,
            false,
          );
          if (!hit) break;
          const surfaceY = hit.point.y;
          // Continue the scan just below whatever we hit, walkable or not.
          castY = surfaceY - 0.05;
          if (castY < -1) break;
          if (hit.normal.y < maxSlopeY) continue; // Too steep, or the underside of a slab.

          // Reject surfaces without enough headroom for a crouched character. This probe uses the
          // full world filter: a railing overhead still blocks standing there.
          const head = physics.raycast(
            { x: wx, y: surfaceY + 0.12, z: wz },
            up,
            CLEARANCE,
            GROUP_WORLD_QUERY,
          );
          if (head) continue;

          this.columns[col].push(this.nodes.length);
          this.nodes.push({
            index: this.nodes.length,
            x: wx,
            y: surfaceY,
            z: wz,
            col,
            neighbors: [],
            neighborCosts: [],
            openness: 0,
          });
        }
      }
    }
  }

  /** Connects nodes whose height difference and clearance allow a step or a slope walk. */
  private linkNeighbors(physics: PhysicsWorld): void {
    const offsets: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    // Ramps rise ~0.53 m over one 1.5 m grid step; allow a little more than that plus step height.
    const maxRise = MOVEMENT.stepHeight + SPACING * Math.tan((MOVEMENT.maxSlopeAngle * Math.PI) / 180) * 0.5;
    const probeHeight = 0.55;

    for (const node of this.nodes) {
      const cx = node.col % this.cols;
      const cz = Math.floor(node.col / this.cols);
      for (const [ox, oz] of offsets) {
        const nx = cx + ox;
        const nz = cz + oz;
        if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
        const candidates = this.columns[nz * this.cols + nx];
        for (const otherIndex of candidates) {
          const other = this.nodes[otherIndex];
          const dy = other.y - node.y;
          if (Math.abs(dy) > maxRise) continue;

          // A body-height probe between the two surfaces rejects links through walls and railings.
          const from: Vec3 = { x: node.x, y: node.y + probeHeight, z: node.z };
          const to: Vec3 = { x: other.x, y: other.y + probeHeight, z: other.z };
          if (!physics.hasLineOfSight(from, to)) continue;
          // Also probe at head height so a low doorway does not become a running lane.
          const fromHead: Vec3 = { x: node.x, y: node.y + CLEARANCE - 0.05, z: node.z };
          const toHead: Vec3 = { x: other.x, y: other.y + CLEARANCE - 0.05, z: other.z };
          if (!physics.hasLineOfSight(fromHead, toHead)) continue;

          const horizontal = Math.hypot(other.x - node.x, other.z - node.z);
          // Climbing is more expensive than descending, so bots prefer flowing routes.
          const cost = horizontal + Math.max(0, dy) * 2.2 + Math.max(0, -dy) * 0.4;
          node.neighbors.push(otherIndex);
          node.neighborCosts.push(cost);
        }
      }
    }
  }

  /** Distance to the nearest obstruction, used for cover scoring and lane preference. */
  private computeOpenness(physics: PhysicsWorld): void {
    const dirs: Vec3[] = [
      { x: 1, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: -1 },
    ];
    for (const node of this.nodes) {
      let min = 12;
      for (const dir of dirs) {
        const hit = physics.raycast(
          { x: node.x, y: node.y + 1.0, z: node.z },
          dir,
          12,
          GROUP_WORLD_QUERY,
        );
        if (hit && hit.distance < min) min = hit.distance;
      }
      node.openness = min;
    }
  }

  private finalize(): NavGraph {
    // Size the scratch arrays now that the node count is known.
    const n = this.nodes.length;
    this.gScore = new Float32Array(n);
    this.fScore = new Float32Array(n);
    this.cameFrom = new Int32Array(n);
    this.visitedStamp = new Int32Array(n).fill(-1);
    this.closedStamp = new Int32Array(n).fill(-1);
    return this;
  }

  get nodeCount(): number {
    return this.nodes.length;
  }

  /** Nearest reachable node to a world position, preferring the matching height band. */
  nearestNode(p: Vec3, maxRadiusCells = 3): number {
    const cx = Math.round((p.x - this.minX) / SPACING);
    const cz = Math.round((p.z - this.minZ) / SPACING);
    let best = -1;
    let bestScore = Infinity;
    for (let r = 0; r <= maxRadiusCells; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const gx = cx + dx;
          const gz = cz + dz;
          if (gx < 0 || gz < 0 || gx >= this.cols || gz >= this.rows) continue;
          for (const idx of this.columns[gz * this.cols + gx]) {
            const node = this.nodes[idx];
            const dy = Math.abs(node.y - p.y);
            // Weight vertical error heavily: being on the wrong floor is worse than being 2 m off.
            const score = distSq3(p, node) + dy * dy * 8;
            if (score < bestScore) {
              bestScore = score;
              best = idx;
            }
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  /**
   * A* between node indices. Writes the result into `outPath` (node indices, start-to-goal) and
   * returns its length, or -1 when unreachable. Allocation-free after construction.
   */
  findPath(startIndex: number, goalIndex: number, outPath: number[]): number {
    outPath.length = 0;
    if (startIndex < 0 || goalIndex < 0) return -1;
    if (startIndex === goalIndex) {
      outPath.push(startIndex);
      return 1;
    }

    const stamp = ++this.searchStamp;
    const goal = this.nodes[goalIndex];
    const heap = this.openHeap;
    heap.length = 0;

    this.gScore[startIndex] = 0;
    this.fScore[startIndex] = this.heuristic(this.nodes[startIndex], goal);
    this.cameFrom[startIndex] = -1;
    this.visitedStamp[startIndex] = stamp;
    this.heapPush(startIndex);

    // With a consistent heuristic and a closed set, no node is ever expanded twice, so the whole
    // reachable component is the hard ceiling on work done.
    let expansions = 0;
    const maxExpansions = this.nodes.length;

    while (heap.length > 0 && expansions++ < maxExpansions) {
      const current = this.heapPop();
      if (this.closedStamp[current] === stamp) continue;
      this.closedStamp[current] = stamp;

      if (current === goalIndex) {
        // Walk the parent chain then reverse into path order.
        let node = current;
        while (node !== -1) {
          outPath.push(node);
          node = this.cameFrom[node];
        }
        outPath.reverse();
        return outPath.length;
      }

      const node = this.nodes[current];
      const g = this.gScore[current];
      for (let i = 0; i < node.neighbors.length; i++) {
        const next = node.neighbors[i];
        if (this.closedStamp[next] === stamp) continue;
        const tentative = g + node.neighborCosts[i];
        if (this.visitedStamp[next] === stamp && tentative >= this.gScore[next]) continue;
        this.visitedStamp[next] = stamp;
        this.gScore[next] = tentative;
        this.fScore[next] = tentative + this.heuristic(this.nodes[next], goal);
        this.cameFrom[next] = current;
        this.heapPush(next);
      }
    }
    return -1;
  }

  /**
   * Must never overestimate, or A* returns wrong paths and thrashes the open set.
   *
   * Every edge costs at least its horizontal length, and the cheapest vertical movement is a
   * descent at 0.4 per metre (see `linkNeighbors`), so those are the coefficients used here.
   * An earlier version weighted the vertical term at 1.4 and was inadmissible on downhill routes.
   */
  private heuristic(a: NavNode, b: NavNode): number {
    return Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.y - b.y) * 0.4;
  }

  // --- Binary min-heap keyed on fScore ---------------------------------
  private heapPush(index: number): void {
    const heap = this.openHeap;
    heap.push(index);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.fScore[heap[parent]] <= this.fScore[heap[i]]) break;
      const t = heap[parent];
      heap[parent] = heap[i];
      heap[i] = t;
      i = parent;
    }
  }

  private heapPop(): number {
    const heap = this.openHeap;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < heap.length && this.fScore[heap[l]] < this.fScore[heap[smallest]]) smallest = l;
        if (r < heap.length && this.fScore[heap[r]] < this.fScore[heap[smallest]]) smallest = r;
        if (smallest === i) break;
        const t = heap[smallest];
        heap[smallest] = heap[i];
        heap[i] = t;
        i = smallest;
      }
    }
    return top;
  }

  /** A node roughly `radius` metres from `from` that has cover from `threat`. Returns -1 if none. */
  findCoverNode(physics: PhysicsWorld, from: Vec3, threat: Vec3, radius: number): number {
    let best = -1;
    let bestScore = -Infinity;
    const radiusSq = radius * radius;
    // Sample a bounded subset — a full scan every time a bot takes fire is not affordable.
    const stride = Math.max(1, Math.floor(this.nodes.length / 220));
    for (let i = this.searchStamp % stride; i < this.nodes.length; i += stride) {
      const node = this.nodes[i];
      const d = distSq3(from, node);
      if (d > radiusSq) continue;
      const eye: Vec3 = { x: node.x, y: node.y + 1.1, z: node.z };
      if (physics.hasLineOfSight(eye, threat)) continue; // Still exposed.
      const score = -d * 0.02 + node.openness * 0.35;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }
}
