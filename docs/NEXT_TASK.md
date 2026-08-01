# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md), [VISUAL_STYLE_GUIDE.md](./VISUAL_STYLE_GUIDE.md),
[RENDERING_GUIDE.md](./RENDERING_GUIDE.md).

Working philosophy: **Observe → Measure → Fix → Play Again.**

Sprint 10 fixed the bot standoff and built the venue's LED infrastructure. What is left is
atmosphere, the per-pixel budget, and an arena the difficulty ladder can actually breathe in.

---

## 1. Environment atmosphere

The last untouched block of the last three briefs, and now the largest gap between this build and a
venue: volumetric fog beyond the current `fogExp2`, dust motes, steam vents, animated ventilation
fans, energy conduits, electrical arcs, moving light rigs, maintenance robots.

**Read the budget constraint before starting.** The frame is fragment-bound and transparent
overdraw is the third-largest cost after resolution and light count. Particles and volumetric fog
are precisely the wrong kind of work for this frame, and the Sprint 10 marquee incident is the
cautionary tale: a feature can cost 3 ms while adding four draw calls.

**Measure every addition interleaved, and watch for cost with no draw calls behind it** — that
signature means upload or overdraw, not geometry.

## 2. Per-pixel cost, and 120 FPS

GPU sits at 10–13 ms against an 8.33 ms budget with the CPU idle at 1.4–2.6 ms. Levers in measured
order:

1. **Lights per fragment** — `maxDynamicLights` 8 → 0 is worth 2.3 ms. A budget that culls by
   distance and screen influence, including impact flashes, prop beacons and the muzzle light which
   currently sit outside the cap.
2. **Material cost** — everything is `MeshStandardMaterial`. Non-metallic architecture does not need
   a full PBR evaluation per fragment.
3. **Transparent overdraw** — shafts, beacons, fog and emissive stack per pixel.

`renderScale` closes the gap arithmetically and remains the last resort.

## 3. An arena with long sight lines

Sprint 10's most useful negative result: **Arena 01 cannot support a range-based difficulty ladder.**
Bots preferring 15 m and 19 m converged on the same achieved range (9.9 m and 9.8 m) because beyond
roughly 10 m the building stops offering sight lines, and both spent so much of each fight
repositioning that neither was more lethal than `medium`.

Preferred ranges are currently capped at 6–13.5 m to suit. Arenas 02–04 should be authored with at
least one long hall or gallery, and their bot profiles raised — with `aimErrorDegrees` re-derived
from the miss-radius rule, or the ladder will silently invert again. `tests/unit/botStandoff.test.ts`
guards that property.

## 4. Difficulty is two tiers, not four

Easy and medium sit at ~14 s median life, hard and expert at ~8.7 s. Ordered correctly between the
pairs but flat within them. Seven measured iterations did not separate them further, because range
and accuracy trade against each other inside the span this arena allows. Item 3 is the prerequisite.

## 5. Audio

Partly addressed across Sprints 9–10 (objective callouts, match-end sting). Still open: PA voice,
crowd simulation, round transitions, environmental loops, recharge layering.

## 6. Holograms

Boards are flat wall-mounted panels. Free-floating holograms — logos, objective markers, directional
indicators — are unstarted and are the other half of Part B.

## Standing note

Seven sprints running, the highest-value change has been to an *instrument* or to *plumbing* rather
than to a game system. Sprint 8 added the gameplay corollary. Sprint 10 added a third:

- **when a system looks broken, check the instrument first;**
- **when a playtest names a culprit, measure before you fix it;**
- **when a graphics change looks like a win, interleave the A/B before believing it;**
- **when a cost has no draw calls behind it, it is upload or overdraw, not geometry.**

Every one of those was learned by getting it wrong first. Sprint 10 also produced the first *useful
negative result* — the arena cannot support the ladder — which is a different and better kind of
finding than a bug, because it redirects design rather than repairing code.
