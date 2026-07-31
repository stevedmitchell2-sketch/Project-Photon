import RAPIER from '@dimforge/rapier3d-compat';
import { MOVEMENT } from '@/config/movement';
import type { SurfaceKind } from '@/maps/MapTypes';
import type { Vec3 } from '@/util/math';
import { GROUP_WORLD, GROUP_WORLD_NONAV, GROUP_WORLD_QUERY } from './layers';

let initialized = false;

/** Rapier's WASM must be instantiated once before any world is constructed. */
export async function initPhysics(): Promise<void> {
  if (initialized) return;
  await RAPIER.init();
  initialized = true;
}

export interface RayHit {
  distance: number;
  point: Vec3;
  normal: Vec3;
  colliderHandle: number;
}

export interface BoxSpec {
  position: Vec3;
  /** Half-extents. */
  size: Vec3;
  /** Y-axis rotation in radians. */
  rotationY?: number;
  /** Solid, but excluded from navigation sampling (ceilings, railings, roof lips). */
  noNav?: boolean;
  /** Material of this surface, so footsteps and ricochets can sound like what they hit. */
  surface?: SurfaceKind;
}

/**
 * Owns the Rapier world and every query the gameplay layer needs.
 *
 * Gameplay code never imports RAPIER directly — it goes through here. That keeps the physics
 * backend swappable and keeps the WASM handle out of the simulation's serializable state.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly queryPipeline: RAPIER.QueryPipeline;
  private readonly staticBody: RAPIER.RigidBody;
  private readonly characters = new Map<number, RAPIER.KinematicCharacterController>();

  /** Scratch objects — physics runs 64x/sec and must not allocate. */
  private readonly tmpRayOrigin = { x: 0, y: 0, z: 0 };
  private readonly tmpRayDir = { x: 0, y: 0, z: 0 };

  /**
   * The query pipeline keeps its own acceleration structure, which is only rebuilt by
   * `world.step()` or an explicit `update()`. Arena construction and the navigation bake both run
   * before the first step, and actors move within a tick before projectiles query them, so every
   * mutation marks this dirty and the next query rebuilds lazily — at most once per tick.
   */
  private queryDirty = true;

  /**
   * Collider handle -> surface material. Populated as level geometry is added, so any query that
   * returns a collider can answer "what did I just hit?" without a lookup through the arena data.
   */
  private readonly surfaces = new Map<number, SurfaceKind>();

  constructor() {
    if (!initialized) {
      throw new Error('PhysicsWorld constructed before initPhysics() resolved');
    }
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    // Gravity is applied by the character controller, not the solver — the movement code needs
    // full authority over vertical velocity for jump arcs, coyote time and slide launches.
    this.world.integrationParameters.dt = 1 / 64;
    this.queryPipeline = this.world.queryPipeline;
    this.staticBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  /** Adds a static box to the level collision. Returns the collider handle for later removal. */
  addStaticBox(spec: BoxSpec): number {
    const desc = RAPIER.ColliderDesc.cuboid(spec.size.x, spec.size.y, spec.size.z)
      .setTranslation(spec.position.x, spec.position.y, spec.position.z)
      .setCollisionGroups(spec.noNav ? GROUP_WORLD_NONAV : GROUP_WORLD)
      .setFriction(0.4)
      .setRestitution(0);

    if (spec.rotationY) {
      const half = spec.rotationY * 0.5;
      desc.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    }
    this.queryDirty = true;
    const handle = this.world.createCollider(desc, this.staticBody).handle;
    if (spec.surface) this.surfaces.set(handle, spec.surface);
    return handle;
  }

  /** Adds a static ramp: a box rotated about the X axis to create a walkable slope. */
  addStaticSlope(spec: BoxSpec & { pitch: number; yaw: number }): number {
    const qy = quatFromEuler(0, spec.yaw, 0);
    const qp = quatFromEuler(spec.pitch, 0, 0);
    const q = multiplyQuat(qy, qp);
    const desc = RAPIER.ColliderDesc.cuboid(spec.size.x, spec.size.y, spec.size.z)
      .setTranslation(spec.position.x, spec.position.y, spec.position.z)
      .setRotation(q)
      .setCollisionGroups(spec.noNav ? GROUP_WORLD_NONAV : GROUP_WORLD)
      .setFriction(0.4);
    this.queryDirty = true;
    const handle = this.world.createCollider(desc, this.staticBody).handle;
    if (spec.surface) this.surfaces.set(handle, spec.surface);
    return handle;
  }

  /**
   * A box that the simulation moves each tick — sliding doors, lifts, conveyor plates.
   *
   * Kinematic rather than static so the character controller treats it as a moving obstacle and
   * resolves against it properly instead of letting actors sink into a teleporting collider.
   */
  createKinematicBox(position: Vec3, halfExtents: Vec3, rotationY = 0): number {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      position.x,
      position.y,
      position.z,
    );
    if (rotationY) {
      const half = rotationY * 0.5;
      bodyDesc.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    }
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setCollisionGroups(GROUP_WORLD_NONAV)
      .setFriction(0.4);
    this.world.createCollider(colliderDesc, body);
    this.queryDirty = true;
    return body.handle;
  }

  /** Moves a kinematic box. Marks queries dirty so the same tick sees the new transform. */
  setKinematicPosition(bodyHandle: number, position: Vec3): void {
    const body = this.world.getRigidBody(bodyHandle);
    if (!body) return;
    body.setNextKinematicTranslation(position);
    body.setTranslation(position, false);
    this.queryDirty = true;
  }

  /**
   * Creates a kinematic capsule + character controller for an actor.
   * Returns the rigid body handle; the controller is looked up by the same handle.
   */
  createCharacter(id: number, position: Vec3, height: number, radius: number, group: number): number {
    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(position.x, position.y, position.z)
      .setUserData(id);
    const body = this.world.createRigidBody(bodyDesc);

    const halfHeight = Math.max(0.01, height * 0.5 - radius);
    const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
      .setCollisionGroups(group)
      .setFriction(0);
    this.world.createCollider(colliderDesc, body);

    const controller = this.world.createCharacterController(0.02);
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setMaxSlopeClimbAngle((MOVEMENT.maxSlopeAngle * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((MOVEMENT.maxSlopeAngle * Math.PI) / 180);
    controller.enableAutostep(MOVEMENT.stepHeight, MOVEMENT.radius * 0.75, true);
    controller.enableSnapToGround(MOVEMENT.snapToGroundDistance);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(80);
    this.characters.set(body.handle, controller);
    this.queryDirty = true;

    return body.handle;
  }

  removeCharacter(bodyHandle: number): void {
    const controller = this.characters.get(bodyHandle);
    if (controller) {
      this.world.removeCharacterController(controller);
      this.characters.delete(bodyHandle);
    }
    const body = this.world.getRigidBody(bodyHandle);
    if (body) this.world.removeRigidBody(body);
    this.queryDirty = true;
  }

  /** Resizes an actor's capsule in place — used by crouch and slide stance changes. */
  setCharacterHeight(bodyHandle: number, height: number, radius: number): void {
    const body = this.world.getRigidBody(bodyHandle);
    if (!body || body.numColliders() === 0) return;
    const collider = body.collider(0);
    collider.setHalfHeight(Math.max(0.01, height * 0.5 - radius));
    collider.setRadius(radius);
    this.queryDirty = true;
  }

  /**
   * Collide-and-slide solve for one tick of motion. This is a *query*: it does not move the body.
   * The movement system owns the authoritative feet position and writes it back via
   * `setCharacterPosition`, which keeps the sim state canonical rather than the physics body.
   */
  moveCharacter(
    bodyHandle: number,
    desiredTranslation: Vec3,
    filterGroups: number,
  ): { translation: Vec3; grounded: boolean; slopeNormalY: number } {
    const body = this.world.getRigidBody(bodyHandle);
    const controller = this.characters.get(bodyHandle);
    if (!body || !controller) {
      return { translation: { x: 0, y: 0, z: 0 }, grounded: false, slopeNormalY: 1 };
    }
    // The character controller sweeps through the same acceleration structure the raycasts use.
    this.refreshQueries();
    const collider = body.collider(0);
    controller.computeColliderMovement(
      collider,
      desiredTranslation,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      filterGroups,
    );

    const corrected = controller.computedMovement();

    // The steepest surface we touched this tick decides whether we can stand on it.
    let slopeNormalY = 1;
    const n = controller.numComputedCollisions();
    for (let i = 0; i < n; i++) {
      const collision = controller.computedCollision(i);
      if (collision && collision.normal1.y > 0.1) {
        slopeNormalY = Math.min(slopeNormalY, collision.normal1.y);
      }
    }

    return {
      translation: { x: corrected.x, y: corrected.y, z: corrected.z },
      grounded: controller.computedGrounded(),
      slopeNormalY,
    };
  }

  getCharacterPosition(bodyHandle: number): Vec3 {
    const body = this.world.getRigidBody(bodyHandle);
    if (!body) return { x: 0, y: 0, z: 0 };
    const t = body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  /** Writes the authoritative capsule-centre position back onto the physics body. */
  setCharacterPosition(bodyHandle: number, position: Vec3): void {
    const body = this.world.getRigidBody(bodyHandle);
    if (!body) return;
    body.setTranslation(position, false);
    body.setNextKinematicTranslation(position);
    this.queryDirty = true;
  }

  /**
   * Raycast against a collision-group filter. Returns null on a miss.
   *
   * `solid` controls what happens when the origin is already inside a shape: true reports a
   * zero-distance hit (right for line-of-sight), false reports the far face instead (right for the
   * navigation scan, which walks downward through slabs and must be able to exit them).
   */
  raycast(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    filterGroups = GROUP_WORLD_QUERY,
    solid = true,
  ): RayHit | null {
    this.refreshQueries();
    this.tmpRayOrigin.x = origin.x;
    this.tmpRayOrigin.y = origin.y;
    this.tmpRayOrigin.z = origin.z;
    this.tmpRayDir.x = direction.x;
    this.tmpRayDir.y = direction.y;
    this.tmpRayDir.z = direction.z;

    const ray = new RAPIER.Ray(this.tmpRayOrigin, this.tmpRayDir);
    const hit = this.queryPipeline.castRayAndGetNormal(
      this.world.bodies,
      this.world.colliders,
      ray,
      maxDistance,
      solid,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      filterGroups,
    );
    if (!hit) return null;
    return {
      distance: hit.timeOfImpact,
      point: {
        x: origin.x + direction.x * hit.timeOfImpact,
        y: origin.y + direction.y * hit.timeOfImpact,
        z: origin.z + direction.z * hit.timeOfImpact,
      },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      colliderHandle: hit.collider.handle,
    };
  }

  /**
   * True when a standing capsule at `feetPosition` would not overlap level geometry.
   * Used to validate spawn points, which are hand-authored and drift as arenas are edited.
   */
  isCapsuleClear(feetPosition: Vec3, height: number, radius: number): boolean {
    return this.capsuleOverlap(feetPosition, height, radius) === null;
  }

  /** Handle of the first collider a standing capsule overlaps, or null. Useful for diagnosing maps. */
  capsuleOverlap(feetPosition: Vec3, height: number, radius: number): number | null {
    this.refreshQueries();
    const halfHeight = Math.max(0.01, height * 0.5 - radius);
    const shape = new RAPIER.Capsule(halfHeight, radius);
    const hit = this.queryPipeline.intersectionWithShape(
      this.world.bodies,
      this.world.colliders,
      { x: feetPosition.x, y: feetPosition.y + height * 0.5, z: feetPosition.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      GROUP_WORLD_QUERY,
    );
    return hit === null || hit === undefined ? null : hit;
  }

  /** True when nothing blocks the segment — the line-of-sight test used by bot perception. */
  hasLineOfSight(from: Vec3, to: Vec3): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-4) return true;
    const hit = this.raycast(from, { x: dx / dist, y: dy / dist, z: dz / dist }, dist, GROUP_WORLD_QUERY);
    return hit === null;
  }

  /** Surface material of a collider, defaulting to 'wall' for anything unregistered. */
  surfaceForCollider(colliderHandle: number): SurfaceKind {
    return this.surfaces.get(colliderHandle) ?? 'wall';
  }

  /** Resolves a collider handle back to the actor id stored on its rigid body. */
  actorIdForCollider(colliderHandle: number): number | null {
    const collider = this.world.getCollider(colliderHandle);
    if (!collider) return null;
    const body = collider.parent();
    if (!body) return null;
    const data = body.userData;
    return typeof data === 'number' ? data : null;
  }

  /**
   * Brings collider transforms and the query acceleration structure up to date.
   *
   * Setting a rigid body's translation does **not** immediately move its collider — Rapier
   * propagates body positions to colliders inside `world.step()`. Every query we run happens
   * before that step, so without the propagate call a capsule that moved or resized this tick is
   * still tested at its previous transform. That surfaced as a character losing ground contact for
   * exactly one tick whenever the stance changed, because the resized shape was evaluated against
   * the pre-resize centre and ended up hovering above the floor.
   */
  private refreshQueries(): void {
    if (!this.queryDirty) return;
    this.world.propagateModifiedBodyPositionsToColliders();
    this.queryPipeline.update(this.world.colliders);
    this.queryDirty = false;
  }

  step(): void {
    this.world.step();
    // `step` rebuilds the query structure itself, so nothing is stale afterwards.
    this.queryDirty = false;
  }

  dispose(): void {
    for (const controller of this.characters.values()) {
      this.world.removeCharacterController(controller);
    }
    this.characters.clear();
    this.world.free();
  }
}

interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

function quatFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

function multiplyQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
