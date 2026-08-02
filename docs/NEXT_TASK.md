# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md), [ART_DIRECTION.md](./ART_DIRECTION.md).

Working philosophy: **Observe -> Measure -> Fix -> Play Again.**

---

## 0. Verify Sprint 15 before anything else

`ArenaVenue` was built, committed, and **never seen rendered**. The preview pane stopped compositing
partway through Sprint 15 and could not be recovered, so:

- the spectator galleries have not been looked at once;
- the frame cost has not been measured;
- an unexplained performance reading was left open (GPU 23-37 ms and 4 FPS against a 10-12 ms
  Sprint 14 baseline, with simulation time up ~10x, which no rendering change can cause).

**Start by running the game and looking at it.** Then measure the venue group interleaved. Only the
geometry toggle was measured (0.07 ms) before the pane failed; the whole-frame question is open.

If the galleries look wrong, the likely candidates are the recess depth (set behind the wall line by
0.35 m, which may z-fight against the wall brush) and the parapet standing proud by 0.34 m.

## 1. Hero spaces beyond the centre

Sprint 15's brief asked for three memorable callouts and delivered none. The Core is still the only
landmark. Candidates with distinct silhouettes: a Broadcast Hub on one wall, an Energy Tower in a
corner, a Champion's Walk along an approach.

## 2. Atmosphere

Still no haze, dust or drifting particles. The banners are the only ambient motion in the building.

**Budget them explicitly.** Transparent overdraw is the third-largest GPU cost, and the frame is
already over target before anything is added.

## 3. Architectural variety

Everything is still rectangular. Curves, diagonals, circular structures and overhangs are untouched,
and they are what would make different parts of the map distinguishable from each other.

## 4. Still open

- **120 FPS unmet**, and the current baseline is now uncertain - see item 0.
- **Characters are primitive blockouts** - the most visible remaining graybox.
- **Difficulty is two tiers, not four**, blocked on an arena with sight lines beyond ~10 m.

## Standing note

Eleven sprints of rules. Sprint 15 added one the hard way:

- when a system looks broken, check the instrument first;
- when a playtest names a culprit, measure before you fix it;
- when a graphics change looks like a win, interleave the A/B before believing it;
- when a cost has no draw calls behind it, it is upload or overdraw, not geometry;
- build the thing that checks the work before doing much of the work;
- if the detail is a rhythm, generate it; if it is a silhouette, model it;
- a landmark has to be visible from where players actually stand;
- **do not disturb a working preview mid-sprint.** Opening a second browser tab to run a comparison
  broke the pane's compositing for the rest of the session and cost this sprint its verification.
  The measurement environment is part of the build.
