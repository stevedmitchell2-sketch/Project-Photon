# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md), [ARENA_DESIGN.md](./ARENA_DESIGN.md).

Working philosophy: **Observe -> Measure -> Fix -> Play Again.**

---

## 1. Play Apex, then measure the difficulty ladder on it

Apex is structurally validated and has been looked at, but **nobody has played a full match on it.**
Everything below assumes a real playtest happens first.

Then measure the thing this arena was partly built for. Bot aim error is specified in metres of miss
at range, and Classic's median sight line of 8.6 m is why `hard` and `expert` have measured the same
as `medium` since Sprint 10. Apex's median is 11.8 m with 22% of bearings past 25 m.

```bash
npm run spawn-audit -- --seconds 240 --bots 6 --difficulty hard
```

Run the ladder on Apex and see whether four tiers separate. If they do, that unblocks a backlog item
that has been stuck for six sprints. If they do not, the fix is in `botDifficulty.ts`, not the map.

## 2. Fix Classic's symmetry, or retire it from competitive use

The audit found a real defect nobody knew about: Classic is four-fold symmetric in name only. Red
and blue are **17.1%** apart in path distance to the objective, green and yellow **37.6%**. The dark
room at (-21, 6) and the two staircases were never part of the rotation.

Every balance number measured on Classic since M1 carries that bias. Either mirror those three
features properly or stop using it for anything but benchmarks.

## 3. Cross-diagonal fairness on Apex

Two-fold symmetry balances team *pairs* exactly and leaves 3- and 4-team modes **26%** uneven across
the diagonals. Red and blue are 0.0% apart; green and yellow are 4.6% apart and both sit about 10 m
further from the objective than red and blue.

This is a known, measured, deliberate cost. If 4-team modes matter, the answer is a second route out
of the green and yellow corners, not a change to the symmetry.

## 4. Finish the presentation

Apex has the architecture. It still lacks:

- **Atmosphere.** No haze, no dust, no drifting particles, no beams. A 28 m atrium is the first
  space in this project where volumetrics would actually pay for themselves. **Budget them
  explicitly** — transparent overdraw is the third-largest GPU cost and the frame is already over
  the 120 FPS target at 10.3 ms.
- **A hero weapon.** The Sprint 12 pipeline accepts a drop-in asset; nothing has been made.
- **Characters.** Still primitive blockouts, and now the most visible graybox by a wide margin —
  the building around them is finished and they are not.
- **Two small art notes from the first look:** the truss fixture pods read as cyan cubes floating
  free of the grid, and the upper half of the arena is still flatter in contrast than the lower.

## 5. Still open

- **120 FPS unmet.** GPU 10.3 ms against an 8.33 ms budget, fragment-bound.
- **Residual prediction corrections** on some clients, narrowed to a stale acknowledged tick.

## Standing note

Thirteen sprints of rules. Sprint 16 added the one that matters most:

- when a system looks broken, check the instrument first;
- when a playtest names a culprit, measure before you fix it;
- when a graphics change looks like a win, interleave the A/B before believing it;
- when a cost has no draw calls behind it, it is upload or overdraw, not geometry;
- build the thing that checks the work before doing much of the work;
- if the detail is a rhythm, generate it; if it is a silhouette, model it;
- a landmark has to be visible from where players actually stand;
- do not disturb a working preview mid-sprint - the measurement environment is part of the build;
- geometry that reads as absent is usually inside something;
- **a level is not correct because it compiles, collides and renders.** Ten separate defects in
  Apex passed typecheck, lint, seventy tests and a clean build, and every one of them made part of
  the arena unusable. Space has properties no compiler models: headroom, reachability, steepness,
  symmetry. **Write the audit that measures them, and run it before you look at the thing.**
