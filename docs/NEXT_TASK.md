# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md), [ART_DIRECTION.md](./ART_DIRECTION.md).

Working philosophy: **Observe -> Measure -> Fix -> Play Again.**

---

## 0. Re-measure the frame in a clean context

One number is still owed. The venue's cost was interleaved twice: **-0.07 ms** in a healthy context
and **1.3 ms** later, after the browser context had degraded to a 33 ms baseline with samples
swinging 28-39 ms. The first is trustworthy, the second is not.

Take one clean reading in a fresh pane before building anything that assumes headroom. Clean
readings this session, venue present: 60 FPS, GPU 9.6-12.1 ms, CPU 1.6-2.5 ms, sim 0.6-2.1 ms,
157-235 draw calls.

Also unconfirmed: the Photon Core's point light looked as though it floods the central room to white
at close range. Observed only in a degraded context, so look again before touching it.

## 1. The arena has no room for a spectator bowl

This is the sprint's real finding and it constrains everything that follows. The section is 9 m of
roof over a 5 m deck, and the deck walkway runs to within 0.5 m of the perimeter wall. That leaves
4 m of wall, players use the lower half, and a projecting balcony would put a ceiling 0.6 m over
their heads.

The galleries are therefore **relief**, capped at 0.5 m of projection. They read now, but they will
never read as a bowl at that depth.

**If a real bowl matters, the arena section has to change** - raise the roof over the perimeter, or
pull the deck away from the walls. That is arena data, not a render change, and it needs a
playtest because it moves sight lines.

## 2. Hero spaces beyond the centre

Sprint 15 asked for three memorable callouts and delivered none. The Core is still the only
landmark. Candidates with distinct silhouettes: a Broadcast Hub on one wall, an Energy Tower in a
corner, a Champion's Walk along an approach.

## 3. Atmosphere

Still no haze, dust or drifting particles. The banners are the only ambient motion in the building.

**Budget them explicitly.** Transparent overdraw is the third-largest GPU cost, and the frame is
already over target before anything is added.

## 4. Architectural variety

Everything is still rectangular. Curves, diagonals, circular structures and overhangs are untouched,
and they are what would make different parts of the map distinguishable from each other.

## 5. Still open

- **120 FPS unmet** - GPU 10-12 ms against an 8.33 ms budget, fragment-bound.
- **Characters are primitive blockouts** - the most visible remaining graybox.
- **Difficulty is two tiers, not four**, blocked on an arena with sight lines beyond ~10 m.

## Standing note

Twelve sprints of rules. Sprint 15 added two the hard way:

- when a system looks broken, check the instrument first;
- when a playtest names a culprit, measure before you fix it;
- when a graphics change looks like a win, interleave the A/B before believing it;
- when a cost has no draw calls behind it, it is upload or overdraw, not geometry;
- build the thing that checks the work before doing much of the work;
- if the detail is a rhythm, generate it; if it is a silhouette, model it;
- a landmark has to be visible from where players actually stand;
- **do not disturb a working preview mid-sprint.** Opening a second browser tab to run a comparison
  broke the pane's compositing for a whole session. The measurement environment is part of the
  build;
- **geometry that reads as absent is usually inside something.** The galleries were built, batched,
  instanced and committed, and were buried in a wall the entire time. Nothing catches that except
  looking at it. Typecheck, lint, tests and a clean build all passed on a gallery no one could see.
