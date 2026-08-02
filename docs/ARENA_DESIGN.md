# ARENA DESIGN

How Project Photon's arenas are built, and the rules that were learned the expensive way.

**Read with:** [ART_DIRECTION.md](./ART_DIRECTION.md), [VISUAL_STYLE_GUIDE.md](./VISUAL_STYLE_GUIDE.md).

---

## The two arenas

| | Classic (Arena 01) | Apex (Arena 02) |
|---|---|---|
| Role | Reference. Every benchmark, spawn audit and latency sweep was measured on it | The flagship venue, and the lobby default |
| Play space | 60 x 60 | 60 x 60 |
| Building | 60 x 60 | **84 x 84** |
| Roof | 9 m | **28 m** |
| Player levels | 2 (field, deck at 5 m) | **3** (field, mezzanine at 5 m, sky bridges at 9 and 11.2 m) |
| Symmetry | Four-fold | **Two-fold** |
| Spectators | Half a metre of relief on the wall | A real bowl: two raked tiers, suites, press boxes, gantry, truss grid |
| Brushes | 154 | 915 |
| Draw calls (shell) | 17 | 32 |
| Nav nodes | 2271 | 2627 |
| Median sight line | 8.6 m | **11.8 m** |

Classic is kept deliberately. Retiring it would silently invalidate every number
in [NETWORK_BENCHMARK.md](./NETWORK_BENCHMARK.md).

---

## `bounds` is the play space, not the building

The single most useful idea in Apex.

Navigation sampling, the minimap and the telemetry heatmaps all size themselves from `bounds`. Apex
keeps it at 60 x 60 — identical to Classic — and puts the entire spectator bowl in a 12 m ring
*outside* it. The bowl is therefore free in every system that scales with arena area, and it can be
as deep as it likes because nothing in it touches a sight line a player uses.

## The nav ceiling is not the roof

`ceilingY` is where navigation **starts casting downward**, not where the building stops. On an
arena whose roof is far above the top of play these are wildly different numbers, and confusing
them causes two distinct failures:

- Set it too low and the highest player level is invisible to the bake, so bots never use the
  arena's best flanking route.
- Set it too high and the bake starts sampling seating rows, and bots path into the crowd.

Apex sets it to 11.4: the upper bridge is at 11.2 and the first row of seating is at 13.0, so the
cast starts at 12.4 with 1.2 m of clearance below and 0.6 m above.

Anything in the renderer that wants the *roof* has to be told separately — see `rigCeilingY`.

## Two-fold symmetry

Four-fold symmetry guarantees balance and guarantees that every quadrant looks the same. That is the
single biggest reason Classic reads as a prototype.

Two-fold gives up nothing that matters for the primary mode. Red maps exactly onto blue and green
onto yellow, so every team pair is balanced — Apex measures **0.0%** difference in path distance from
red and blue to the objective. What it buys is that opposite walls can be different buildings.

The cost is real and is reported rather than hidden: three- and four-team modes on Apex are **26%**
uneven across the two diagonals, because red's route out of its corner is not the same route green
has out of theirs.

## Landmarks on the walls, spawns in the corners

Landmarks and spawns want the same real estate, and the corners lose. Apex's first cut put the
Broadcast Tower and the Fusion Reactor on the spawn diagonals; the audit found four spawn points
inside the tower's wall, unreachable, and team path distances 84% apart.

Putting a different building at each **wall midpoint** also solves navigation for the player: north
is the Tower, south is the Reactor, west is the Walk, east is the Sky Deck. Those are things you can
see, not compass directions you have to memorise.

---

## Curves out of boxes

The engine has axis-aligned boxes with a yaw, so a curve is a polygon with enough sides that the eye
stops counting them. `arc()` in `arena02_apex.ts` builds one from chords; at 24 segments an 11 m
radius has a 3 m chord and a 10 cm sagitta, which is below the noise of the surface detail.

The convention every curved element depends on: **yaw 0 faces -z**, and a box rotated by `r` has its
local +X along `(cos r, 0, -sin r)` and its local +Z along `(sin r, 0, cos r)`. So a brush placed at
angle `t` with `rot = t` gets local X tangential and local Z radial. Getting this backwards builds a
circle out of boxes all facing the same way, which reads as a pile of crates.

## Ramp pitch

Pitch tilts about the **yawed** X axis, so the high end of a ramp is always at `-localZ`. Which
world direction that is depends entirely on `rot`:

| `rot` | local +Z | high end at |
|---|---|---|
| 0 | +z | **-z** |
| 90 | +x | **-x** |
| 180 | -z | **+z** |
| 270 | -x | **+x** |

Both of Apex's ramp pairs were built backwards at least once. A reversed ramp collides and renders
perfectly and descends into the floor.

---

## What breaks navigation, and what none of the other gates catch

Every item here shipped at some point during Sprint 16, passed typecheck, lint, the full test suite
and a clean build, and rendered correctly.

**Headroom is the one to watch.** A surface is dropped from the bake entirely if there is less than
crouch clearance (~1.45 m) above it. That single rule caused most of the failures:

- A ramp running *underneath* the walkway it lands on has a slab 5 m above it for its whole length.
  Every sample fails, the flight breaks in the middle, and the level above bakes out as an island.
- A ramp crossing under a diagonal spoke loses headroom in a narrow band near the top. At 15.5 m out
  the worst case was 1.28 m; moving to 14 m and narrowing the spoke put it at 2.0 m.
- A landing pad that reaches back over its own staircase does the same thing in miniature: the top
  two metres of the flight disappear and it ends in mid-air.

**Steepness has a hard limit that is not the player's.** Links are refused when a 1.5 m grid step
gains more than `stepHeight + 1.5 * tan(maxSlope) * 0.5` — about 1.31 m. A 44 degree stair gains
1.48 m per grid step. A person can walk up it; no bot will ever try.

**Railings sever levels.** They block the line-of-sight probe that links neighbours, so every place
traffic crosses a rail needs an opening — and the opening has to be *where the traffic actually
arrives*. `railing()` measures its gaps along its own local run, which is not the world axis, and
both of Apex's cuts got that conversion wrong in opposite directions.

**A bridge railed end to end is a bridge nothing can arrive on.** Give each span a landing where its
stairs meet it and open the rail there.

**Symmetry has a sign.** Under 180 degrees a feature at `+z` maps to `-z`. A landing pad written as
`sx * 3.5` instead of `-sx * 3.5` lands neatly on the opposite side of the span from its own
staircase, and takes 201 nodes off the graph.

---

## The audit

```bash
npm run arena-audit
```

Builds every arena for real — the same `buildArena` and `NavGraph.build` the game runs — and checks
what a compiler cannot: draw calls and singleton batches, whether every declared floor has walkable
ground, whether every spawn can path to the objective, whether mirror pairs are equidistant, and how
long the sight lines are.

`tests/unit/arenaStructure.test.ts` runs the subset worth failing a build over.

Two notes on its thresholds, because both are the sort of thing that gets quietly widened until it
passes:

- The **mirror-pair** tolerance is 6% rather than 0%, and the slack is measurement, not design. A*
  breaks ties by node index, and indices are assigned in grid-scan order, which is not symmetric.
  Apex's red/blue pair measures 0.0%, which is what a clean mirror looks like.
- The **connected-component** floor is 95%. Apex measures 98.2%; the remainder is the tops of cover
  blocks and reactor drums, reachable by mantling but not by walking, and correctly unlinked.

## Sight lines and the difficulty ladder

Bot aim error is specified in metres of miss at range. Classic's maze capped the median sight line
at 8.6 m, so `hard` and `expert` had nowhere to be better than `medium` — which is exactly what the
Sprint 10 measurements showed, and why the ladder has been stuck at two usable tiers since.

Apex's median is 11.8 m and 22% of bearings run past 25 m. Whether that is enough to separate the
tiers has **not** been measured yet; it is the first thing Sprint 17 should do.
