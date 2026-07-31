/**
 * Rapier collision groups are a packed u32: high 16 bits = membership, low 16 bits = filter.
 * Keeping the bit layout in one place stops the classic "why does my bolt hit my own capsule" bug.
 */
export const LAYER = {
  WORLD: 1 << 0,
  PLAYER: 1 << 1,
  BOT: 1 << 2,
  PROJECTILE: 1 << 3,
  TRIGGER: 1 << 4,
  DYNAMIC_PROP: 1 << 5,
  /**
   * Solid geometry that must not be sampled as walkable: ceilings, railings, roof lips. It blocks
   * movement and bolts exactly like WORLD, but the navigation bake filters it out — otherwise the
   * top face of every handrail becomes an isolated nav node.
   */
  WORLD_NONAV: 1 << 6,
} as const;

export const ACTOR_LAYERS = LAYER.PLAYER | LAYER.BOT;
const WORLD_LAYERS = LAYER.WORLD | LAYER.WORLD_NONAV;

export const groups = (membership: number, filter: number): number =>
  ((membership & 0xffff) << 16) | (filter & 0xffff);

const MOVERS = LAYER.PLAYER | LAYER.BOT | LAYER.PROJECTILE | LAYER.DYNAMIC_PROP;

/** Static level geometry: collides with everything that moves. */
export const GROUP_WORLD = groups(LAYER.WORLD, MOVERS);
export const GROUP_WORLD_NONAV = groups(LAYER.WORLD_NONAV, MOVERS);

/**
 * Character capsules.
 *
 * Rapier's interaction test is symmetric — both sides must accept the other — so the actor filter
 * has to name PROJECTILE even though bolts are swept raycasts rather than colliders. Leaving it
 * out means every shot passes cleanly through every player.
 *
 * Actors deliberately do **not** collide with each other. Two symptoms drove this:
 *
 *   1. An idle player was shoved across the arena and killed by bots pathing through their
 *      position — the player could not stand still.
 *   2. It was the last source of prediction disagreement. The client resolves contact against
 *      *interpolated* peer positions while the server uses live ones, so players in contact
 *      corrected at 22/s versus 3-4/s in open space.
 *
 * The cost is that two players can briefly overlap visually. That is a far smaller problem than
 * being unable to hold a position, and it is the conventional choice in shooters for exactly this
 * reason — contact is arbitrated by the server through damage, not by pushing capsules around.
 */
const ACTOR_FILTER = WORLD_LAYERS | LAYER.DYNAMIC_PROP | LAYER.TRIGGER | LAYER.PROJECTILE;
export const GROUP_PLAYER = groups(LAYER.PLAYER, ACTOR_FILTER);
export const GROUP_BOT = groups(LAYER.BOT, ACTOR_FILTER);

/** Projectile sweeps query the world and actors explicitly, so they need no solver membership. */
export const GROUP_PROJECTILE_QUERY = groups(
  LAYER.PROJECTILE,
  WORLD_LAYERS | LAYER.PLAYER | LAYER.BOT | LAYER.DYNAMIC_PROP,
);

/** Line-of-sight, mantle and stance probes: all solid level geometry. */
export const GROUP_WORLD_QUERY = groups(LAYER.PROJECTILE, WORLD_LAYERS | LAYER.DYNAMIC_PROP);

/** Navigation sampling: walkable geometry only. */
export const GROUP_NAV_QUERY = groups(LAYER.PROJECTILE, LAYER.WORLD | LAYER.DYNAMIC_PROP);

export const GROUP_DYNAMIC_PROP = groups(
  LAYER.DYNAMIC_PROP,
  WORLD_LAYERS | LAYER.PLAYER | LAYER.BOT | LAYER.PROJECTILE,
);
