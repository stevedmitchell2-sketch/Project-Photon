# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md), [BACKLOG.md](./BACKLOG.md),
[RENDERING_GUIDE.md](./RENDERING_GUIDE.md).

Working philosophy: **Observe → Measure → Fix → Play Again.**

Sprint 8 fixed the ten-second death and built the frame-timing instrument. The two biggest open
items are now one gameplay problem and one rendering problem, and both are measured.

---

## 1. Every fight is point-blank

**Median engagement range is 7.0 m, and it does not move.** Measured at every difficulty, before and
after the Sprint 8 rebalance: easy, medium, hard and expert all produce 7.0–7.1 m. `engageRange` in
the bot profiles spans 26–62 m and changes nothing, which means bots close to contact distance
before shooting whatever the profile says.

This matters more than it sounds. The photon rifle has falloff bands, spread, ADS and a 132 m/s
projectile — an entire weapon design premised on fights at range. None of it is being exercised.

**Where to look:** `BotBrain`'s engage branch, and whether the approach behaviour terminates on line
of sight or on arrival at a navigation node near the target. The audit already reports engagement
range, so the loop is short: change the branch, run `npm run spawn-audit`, read the number.

## 2. The frame is fragment-bound, and 120 FPS needs per-pixel work

GPU 12.0–12.5 ms against an 8.33 ms budget, with the CPU idle at 1.4–1.9 ms. Full attribution in
RENDERING_GUIDE.md. The levers, in order of measured effect:

1. **Lights evaluated per fragment** — `maxDynamicLights` 8 → 0 is worth 2.3 ms. A real fix is a
   budget that culls by distance and screen influence rather than a flat cap, plus bringing impact
   flashes, prop beacons and the muzzle light inside that budget (they are currently outside it).
2. **Material cost** — every surface is `MeshStandardMaterial`. Non-metallic architecture does not
   need a full PBR evaluation per fragment.
3. **Transparent overdraw** — shafts, fog and emissive surfaces stack per pixel.

`renderScale` closes the gap arithmetically and should be the last resort, not the first.

**Do not measure sequentially.** GPU time is view-dependent — the same preset read 8.68 ms and
12.43 ms from different vantages. Interleave A/B, and restart the preview if simulation time moves.

## 3. Team colour in the environment

The HUD now carries the team accent. The arena does not — every strip and fixture is cyan whoever
holds the room, so the objective banner remains the only team-state signal on screen. Highest-value
remaining item in the visual identity work, because it makes the map itself communicate the match.

## 4. Arena presentation and environment FX

Entirely unstarted, and the largest block of the Sprint 8 brief not delivered: holograms, LED walls,
digital scoreboards, signage, spawn-room identity, volumetric fog, dust, vents, steam, conduits,
moving fixtures, alarm lighting.

## 5. Audio

Unstarted this sprint: recharge layering, impact polish, spatial ambience, announcements, footstep
surface variation, music transition hooks.

## 6. Spawn presentation

The spawn *system* is measured healthy and needs no further logic — placement was investigated in
Sprint 8 and found innocent. What it lacks is presentation: team-coloured spawn pads, an energy
effect on materialisation, and an audio cue.

## Standing note

Six sprints running, the highest-value change has been to an *instrument* or to *plumbing* rather
than to a game system: making the renderer visible, fixing the draw-call counter, fixing a handshake
promise, instrumenting input starvation, discovering server-side RTT was never measured, discovering
clients never adopted their actor id, and now discovering that frames-per-second could never have
answered the question it was being asked.

Sprint 8 added the gameplay equivalent: **the reported symptom was right and the reported cause was
wrong**, for the third sprint running. Spawn placement was blamed for the ten-second death and
measured innocent; the light shafts were blamed for washing out the frame and it was bloom.

**When a system looks broken, first check that the thing measuring it is honest — and when a
playtest names a culprit, measure before you fix it.**
