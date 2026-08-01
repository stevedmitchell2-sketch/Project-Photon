# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md), [VISUAL_STYLE_GUIDE.md](./VISUAL_STYLE_GUIDE.md),
[RENDERING_GUIDE.md](./RENDERING_GUIDE.md).

Working philosophy: **Observe → Measure → Fix → Play Again.**

Sprint 9 gave the arena a side and tuned the weapon for the fight it actually has. What is missing
is the rest of the venue, and the bot behaviour that decides where fights happen at all.

---

## 1. Bots close to 7 m before shooting, and nothing changes it

The oldest unexplained gameplay behaviour in the project. **Median engagement range is 7.0 m at
every difficulty** — easy, medium, hard and expert — and it does not respond to `engageRange`, which
spans 26–62 m across the profiles. Bots walk into contact distance before firing whatever the
profile says.

Sprint 9 tuned the weapon around this rather than fighting it, which was the right call for one
sprint and is not a permanent answer: the photon rifle has falloff bands starting at 28 m, ADS, and
a projectile designed to be led. None of it is exercised, and the arena's sight lines are wasted.

**Where to look:** `BotBrain`'s engage branch — specifically whether the approach behaviour
terminates on acquiring line of sight or on arriving at a navigation node near the target. The
second would explain the behaviour exactly and would explain why `engageRange` is inert.

**The loop is short:** change the branch, run `npm run spawn-audit`, read `median engagement range`.

## 2. The rest of the venue

Sprint 9 built team identity. It did not build the venue around it. All unstarted:

- animated holographic displays
- LED scoreboards showing the live score
- digital advertising panels and arena branding
- animated wall panels
- team introduction and victory sequences
- goal / victory lighting beyond the objective ring

The style guide's environmental-storytelling section is the brief for this work. The pattern that
worked in Sprint 9 — **arena data declares intent, the renderer decides expression** — should carry
forward: add spec types to `MapTypes.ts`, author them in `arena01_classic.ts`, render from data.

## 3. Environment FX

Also unstarted: volumetric fog beyond the current `fogExp2`, dust particles, heat shimmer, steam
vents, electrical arcs, energy pulses along conduits.

**Constraint:** the frame is fragment-bound and transparent overdraw is the third-largest cost after
resolution and light count. Particles and fog are exactly the wrong kind of work for this frame.
Budget them explicitly and measure each one interleaved.

## 4. Per-pixel cost, and 120 FPS

GPU sits at 10–13 ms against an 8.33 ms budget. Levers in measured order:

1. **Lights per fragment** — `maxDynamicLights` 8 → 0 is worth 2.3 ms. The real fix is a budget that
   culls by distance and screen influence rather than a flat cap, and that includes impact flashes,
   prop beacons and the muzzle light, which currently sit outside it.
2. **Material cost** — everything is `MeshStandardMaterial`. Non-metallic architecture does not need
   a full PBR evaluation per fragment.
3. **Transparent overdraw** — shafts, beacons, fog and emissive stack per pixel.

`renderScale` closes the gap arithmetically and remains the last resort.

## 5. Spawn presentation

The spawn *system* is measured healthy and needs no logic changes. Territory rings and beacons now
mark the area. Still missing: a materialisation effect on the player, and a spawn audio cue.

## Standing note

Seven sprints running, the highest-value change has been to an *instrument* or to *plumbing* rather
than to a game system. Sprint 8 added the gameplay corollary: the reported symptom was right and the
reported cause was wrong, three sprints in a row.

Sprint 9 is the first sprint where that did **not** happen — the brief said tune combat for 7 m, and
7 m was real and measured, and the tuning worked. That is what it looks like when the measurement
infrastructure has caught up with the ambition.

The habit that produced it, and which is worth keeping:

- **when a system looks broken, check the instrument first;**
- **when a playtest names a culprit, measure before you fix it;**
- **when a graphics change looks like a win, interleave the A/B before believing it.**

Every one of those three was learned by getting it wrong first.
