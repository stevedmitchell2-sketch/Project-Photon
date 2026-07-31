import type { TeamId } from '@/config/teams';
import type { EventBus } from '@/engine/EventBus';
import type { ArenaDefinition, ObjectiveVolume } from '@/maps/MapTypes';
import type { Actor, GameEvents, MatchState } from './types';

/**
 * Axis-aligned trigger volumes and their occupancy.
 *
 * This is the shared primitive behind three things that would otherwise each grow their own
 * proximity code: objective rooms (who is holding the centre), powered doors and buttons, and the
 * capture/hold scoring that King of the Hill and Domination need in M2. Occupancy is recomputed
 * from scratch each tick rather than tracked incrementally, because a teleporting respawn must
 * never be able to leave a stale actor inside a volume.
 *
 * Enter and exit are derived by diffing against last tick, so consumers get edges without any of
 * them having to remember state.
 */

export interface TriggerVolume {
  id: string;
  kind: ObjectiveVolume['kind'] | 'zone';
  /** Centre and half-extents in metres. */
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  /** Owning team, for objectives that belong to one. */
  team?: TeamId;

  /** Actor ids currently inside. Rebuilt every tick. */
  occupants: number[];
  /** Occupant counts per team, for contest logic. */
  countsByTeam: Partial<Record<TeamId, number>>;
  /** The team with sole occupancy, or null when empty or contested. */
  controllingTeam: TeamId | null;
  contested: boolean;
  /** Seconds the current controlling team has held it uninterrupted. */
  heldSeconds: number;

  entered: number[];
  exited: number[];
}

export class TriggerSystem {
  readonly volumes: TriggerVolume[] = [];
  private readonly byId = new Map<string, TriggerVolume>();
  private previousOccupants = new Map<string, Set<number>>();

  constructor(arena: ArenaDefinition) {
    for (const objective of arena.objectives) {
      // Flags are points, not volumes to stand in; give them a small pickup radius instead.
      const pad = objective.kind === 'flag' ? 1.4 : 0;
      this.add({
        id: objective.id,
        kind: objective.kind,
        cx: objective.p[0],
        cy: objective.p[1],
        cz: objective.p[2],
        hx: objective.s[0] / 2 + pad,
        hy: objective.s[1] / 2 + pad,
        hz: objective.s[2] / 2 + pad,
        team: objective.team,
      });
    }
  }

  private add(spec: Omit<TriggerVolume, 'occupants' | 'countsByTeam' | 'controllingTeam' | 'contested' | 'heldSeconds' | 'entered' | 'exited'>): TriggerVolume {
    const volume: TriggerVolume = {
      ...spec,
      occupants: [],
      countsByTeam: {},
      controllingTeam: null,
      contested: false,
      heldSeconds: 0,
      entered: [],
      exited: [],
    };
    this.volumes.push(volume);
    this.byId.set(volume.id, volume);
    this.previousOccupants.set(volume.id, new Set());
    return volume;
  }

  /** Registers an ad-hoc volume — used by props and, later, by mode-specific zones. */
  addZone(id: string, centre: [number, number, number], size: [number, number, number]): TriggerVolume {
    return this.add({
      id,
      kind: 'zone',
      cx: centre[0],
      cy: centre[1],
      cz: centre[2],
      hx: size[0] / 2,
      hy: size[1] / 2,
      hz: size[2] / 2,
    });
  }

  get(id: string): TriggerVolume | undefined {
    return this.byId.get(id);
  }

  step(state: MatchState, dt: number, events: EventBus<GameEvents>): void {
    for (const volume of this.volumes) {
      volume.occupants.length = 0;
      volume.entered.length = 0;
      volume.exited.length = 0;
      volume.countsByTeam = {};

      for (const actor of state.actors.values()) {
        if (!actor.alive) continue;
        if (!containsActor(volume, actor)) continue;
        volume.occupants.push(actor.id);
        volume.countsByTeam[actor.team] = (volume.countsByTeam[actor.team] ?? 0) + 1;
      }

      const previous = this.previousOccupants.get(volume.id)!;
      for (const id of volume.occupants) {
        if (!previous.has(id)) volume.entered.push(id);
      }
      for (const id of previous) {
        if (!volume.occupants.includes(id)) volume.exited.push(id);
      }

      const teams = Object.keys(volume.countsByTeam) as TeamId[];
      const nextController = teams.length === 1 ? teams[0] : null;
      volume.contested = teams.length > 1;

      if (nextController !== volume.controllingTeam) {
        volume.controllingTeam = nextController;
        volume.heldSeconds = 0;
      } else if (nextController !== null) {
        volume.heldSeconds += dt;
      }

      previous.clear();
      for (const id of volume.occupants) previous.add(id);

      for (const id of volume.entered) {
        events.emit('trigger_entered', { volumeId: volume.id, actorId: id });
      }
      for (const id of volume.exited) {
        events.emit('trigger_exited', { volumeId: volume.id, actorId: id });
      }
    }
  }

  reset(): void {
    for (const volume of this.volumes) {
      volume.occupants.length = 0;
      volume.entered.length = 0;
      volume.exited.length = 0;
      volume.countsByTeam = {};
      volume.controllingTeam = null;
      volume.contested = false;
      volume.heldSeconds = 0;
      this.previousOccupants.get(volume.id)?.clear();
    }
  }
}

/** Tests the actor's centre of mass rather than their feet, so a crouching actor still counts. */
function containsActor(volume: TriggerVolume, actor: Actor): boolean {
  const y = actor.position.y + actor.height * 0.5;
  return (
    Math.abs(actor.position.x - volume.cx) <= volume.hx &&
    Math.abs(y - volume.cy) <= volume.hy &&
    Math.abs(actor.position.z - volume.cz) <= volume.hz
  );
}
