import type { ArenaDefinition, PropSpec } from '@/maps/MapTypes';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { clamp, DEG2RAD, moveTowards } from '@/util/math';
import type { MatchState } from './types';

/**
 * Interactive arena props.
 *
 * Only props whose state can affect gameplay are simulated here — currently doors, because a door
 * has a collider that opens a sightline and a route. Everything else (fans, gates, beacons, signs)
 * is deterministic from the clock alone and is animated in the renderer, so it costs the tick
 * budget nothing.
 *
 * Door state is a single 0..1 openness per door, advanced toward a target chosen by proximity.
 * That makes it trivially serializable for the netcode milestone: one byte per door.
 */

export interface DoorRuntime {
  spec: PropSpec;
  bodyHandle: number;
  /** 0 closed, 1 fully open. */
  openness: number;
  /** Closed-position centre, from which the panel slides along its local X. */
  closedX: number;
  closedY: number;
  closedZ: number;
  axisX: number;
  axisZ: number;
  travel: number;
  triggerRadiusSq: number;
  /** Kept open briefly after the last actor leaves, so it does not clip someone in the doorway. */
  holdTimer: number;
}

/** Seconds for a door to travel its full stroke. */
const DOOR_SPEED = 1 / 0.45;
const DOOR_HOLD = 0.6;

export class PropSystem {
  readonly doors: DoorRuntime[] = [];

  constructor(arena: ArenaDefinition, physics: PhysicsWorld) {
    for (const spec of arena.props) {
      if (spec.kind !== 'door') continue;

      const rot = (spec.rot ?? 0) * DEG2RAD;
      const bodyHandle = physics.createKinematicBox(
        { x: spec.p[0], y: spec.p[1], z: spec.p[2] },
        { x: spec.s[0] / 2, y: spec.s[1] / 2, z: spec.s[2] / 2 },
        rot,
      );

      this.doors.push({
        spec,
        bodyHandle,
        openness: 0,
        closedX: spec.p[0],
        closedY: spec.p[1],
        closedZ: spec.p[2],
        // Panels slide along their own local X, so a rotated door opens sideways, not sideways
        // in world space.
        axisX: Math.cos(rot),
        axisZ: -Math.sin(rot),
        travel: spec.travel ?? spec.s[0],
        triggerRadiusSq: Math.pow(spec.triggerRadius ?? 3.6, 2),
        holdTimer: 0,
      });
    }
  }

  step(state: MatchState, physics: PhysicsWorld, dt: number): void {
    for (const door of this.doors) {
      let wanted = false;
      for (const actor of state.actors.values()) {
        if (!actor.alive) continue;
        const dx = actor.position.x - door.closedX;
        const dy = actor.position.y - door.closedY;
        const dz = actor.position.z - door.closedZ;
        // Vertical check keeps a door on the deck below from opening for someone on the catwalk.
        if (Math.abs(dy) > 2.4) continue;
        if (dx * dx + dz * dz <= door.triggerRadiusSq) {
          wanted = true;
          break;
        }
      }

      if (wanted) door.holdTimer = DOOR_HOLD;
      else door.holdTimer = Math.max(0, door.holdTimer - dt);

      const target = wanted || door.holdTimer > 0 ? 1 : 0;
      const next = moveTowards(door.openness, target, DOOR_SPEED * dt);
      if (next === door.openness) continue;
      door.openness = clamp(next, 0, 1);

      const offset = door.openness * door.travel;
      physics.setKinematicPosition(door.bodyHandle, {
        x: door.closedX + door.axisX * offset,
        y: door.closedY,
        z: door.closedZ + door.axisZ * offset,
      });
    }
  }

  /** Renderer reads this to place the visual panel. */
  doorOffset(door: DoorRuntime): { x: number; y: number; z: number } {
    const offset = door.openness * door.travel;
    return {
      x: door.closedX + door.axisX * offset,
      y: door.closedY,
      z: door.closedZ + door.axisZ * offset,
    };
  }

  dispose(physics: PhysicsWorld): void {
    for (const door of this.doors) physics.removeCharacter(door.bodyHandle);
    this.doors.length = 0;
  }
}
