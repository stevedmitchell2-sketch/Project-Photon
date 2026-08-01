# NEXT TASK

**Read first:** [ART_DIRECTION.md](./ART_DIRECTION.md) section 10,
[VISUAL_STYLE_GUIDE.md](./VISUAL_STYLE_GUIDE.md) section 13.

Working philosophy: **Observe -> Measure -> Fix -> Play Again.**

Sprint 13 made the arena read as a constructed interior. It does **not** yet read as a championship
venue, and the gap is now specific.

---

## 1. Lighting drama

**The single biggest remaining problem.** The arena is uniformly lit: every surface sits at roughly
the same brightness, so nothing draws the eye and the space has no focal point. A championship venue
is defined by contrast — a bright competition floor under a dark roof, pooled light on the objective,
falloff into the corners.

The style guide already says contrast comes from lit-versus-unlit regions. The arena does not obey
its own rule.

**Constraint:** the frame is fragment-bound and lights cost 2.3 ms for eight. This has to be done
with *placement and intensity*, not light count — fewer, stronger, more directional fixtures rather
than more of them.

## 2. Landmarks

Every callout in the arena is currently "central room" or a compass direction. A venue has named
places with distinct silhouettes: a reactor, a broadcast hub, a champion's walk.

The requirement is **shape**, not signage — a landmark works when you can identify where you are
from the silhouette alone, with the HUD hidden.

## 3. The floor

Still a featureless plane, and it is a third of every frame. Competition markings, lane guidance,
a centre circle at the objective, maintenance seams. The generator pattern from Sprint 13 applies
directly: derive from arena bounds and objective volumes, instance it.

## 4. Then content

CONTENT_ROADMAP Phase 1 is unchanged and unblocked. Wall and floor modules first — they replace the
most screen area per hour of work — then the rifle, then the character with skeletal playback.

## 5. Still open from earlier sprints

- **120 FPS unmet.** GPU 10-13 ms against 8.33. Sprint 13 added 1.22 ms for the architecture, which
  was affordable but is not free.
- **Difficulty is two tiers, not four**, blocked on an arena with sight lines beyond ~10 m.
- **Environment atmosphere** - fog, dust, steam, arcs.

## Standing note

Nine sprints of measurement rules, and Sprint 13 added a scoping one:

- when a system looks broken, check the instrument first;
- when a playtest names a culprit, measure before you fix it;
- when a graphics change looks like a win, interleave the A/B before believing it;
- when a cost has no draw calls behind it, it is upload or overdraw, not geometry;
- build the thing that checks the work before doing much of the work;
- **if the detail is a rhythm, generate it; if it is a silhouette, model it.**

That last one is a correction. Sprint 11 concluded procedural art had hit its ceiling and applied it
too broadly; Sprint 13 found 474 elements of genuine architectural gain in the half of the problem
that rule did not actually cover.
