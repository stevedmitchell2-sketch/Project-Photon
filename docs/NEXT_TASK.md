# NEXT TASK

**Read first:** [ART_DIRECTION.md](./ART_DIRECTION.md), [VISUAL_STYLE_GUIDE.md](./VISUAL_STYLE_GUIDE.md).

Working philosophy: **Observe -> Measure -> Fix -> Play Again.**

The central arena now photographs. The rest of the map does not, and that is the next job.

---

## 1. Scale

The arena reads as a *room*, not as a venue. Nothing in frame says an audience could be here.

- spectator balconies above the perimeter walls
- hanging banners in the tall volume
- observation windows on the upper deck
- broadcast booths flanking the centre

The generator pattern applies: derive from arena bounds, instance it. The perimeter walls already
have their faces computed in `ArenaArchitecture`.

## 2. Atmosphere

Still completely static air. Volumetric haze, drifting dust, moving spotlights.

**Budget them explicitly.** Transparent overdraw is the third-largest GPU cost after resolution and
light count, and the frame is already at 10-12 ms against an 8.33 ms target. Measure each addition
interleaved, and watch for cost with no draw calls behind it.

## 3. Colour beyond the centre

The Core gave the middle a strong identity. The perimeter is still grey-blue with cyan trim
everywhere. Team territory exists but is faint next to the Core.

The style guide's reserved-channel rule stands: no decorative team colour. What the perimeter needs
is warm/cool contrast — amber service lighting against cyan competition lighting — not more hues.

## 4. Then content

CONTENT_ROADMAP Phase 1 is unchanged and unblocked. Wall and floor modules replace the most screen
area per hour of work.

## 5. Still open

- **120 FPS unmet.** GPU 10-12 ms against 8.33.
- **Difficulty is two tiers, not four**, blocked on an arena with sight lines beyond ~10 m.
- **Characters are primitive blockouts** — the most visible remaining graybox now that the
  architecture is detailed.

## Standing note

Ten sprints of rules, and Sprint 14 added one about landmarks:

- when a system looks broken, check the instrument first;
- when a playtest names a culprit, measure before you fix it;
- when a graphics change looks like a win, interleave the A/B before believing it;
- when a cost has no draw calls behind it, it is upload or overdraw, not geometry;
- build the thing that checks the work before doing much of the work;
- if the detail is a rhythm, generate it; if it is a silhouette, model it;
- **a landmark has to be visible from where players actually stand.** The Core was first placed in
  a volume that looked ideal in the arena data and was occluded from every ground-floor approach.
