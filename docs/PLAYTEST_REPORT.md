# Playtest Report — 2026-07-31

**First session in which the game has actually been seen running.** Six phases of development were
verified numerically (lighting probes, network harnesses, headless simulation stepping) because the
development environment's browser pane never composited. It composited this session.

Every finding below came from looking at the screen. None of them were caught by typechecking, the
production build, the lighting probe, the netcode probe, or the multi-client network test — all of
which were passing throughout.

---

## Severity 1 — Blockers found and fixed

### 1.1 The weapon covered the centre of the screen

The view model is authored at roughly life size (~0.9 m) and sat 0.42 m from a 95° FOV camera. It
occupied about a quarter of the viewport and **completely obscured the crosshair**. The game was
unaimable.

*Fixed:* view model scaled to 0.55 and pushed to 0.5 m. Crosshair is now visible and the weapon
reads as a weapon.

### 1.2 The weapon rendered as a solid glowing slab

Emissive intensities on the view model were tuned as if it were world geometry (2.4–3.0), and the
charge-cell indicators used `toneMapped: false`. At 0.4 m from the near plane, with bloom applied,
these blew out into a featureless bright bar.

*Fixed:* accent emissive 2.4 → 0.55, emitter 2.0 → 0.9, heat glow range reduced, charge cells
tone-mapped so they sit in the same exposure range as everything else.

**Lesson:** emissive values are not scale-invariant. A value tuned on a wall 10 m away is wrong on an
object 0.4 m from the eye, because what matters is the solid angle it occupies.

### 1.3 Volumetric light shafts filled the screen

Shaft cone radius was `light.distance * 0.28`. With fixtures throwing 48 m, that produced cones
**13 m across** — from anywhere on the deck, one filled most of the view as an opaque cyan wash.

*Fixed:* radius is now `min(2.4, distance * 0.06)` with opacity roughly halved. Still more prominent
than ideal; see Severity 3.

---

## Severity 2 — Confirmed, not yet fixed

### 2.1 Clicking to lock the pointer also fires the weapon

The click that engages pointer lock is a `Mouse0` press, which is bound to fire. Entering the arena
therefore spends a shot immediately — observed as a 4/6 charge cell reading on a fresh spawn.

*Fix:* swallow the first click after pointer lock is acquired, or require lock before routing mouse
buttons to the input pipeline.

### 2.2 An idle player is pushed around and killed by bots

Left completely idle with no input, the local player drifted from its spawn to mid-arena and died
twice. Player-versus-player capsule collision is enabled and bots path straight through the player's
position, shoving them along.

This is the same actor-collision system already flagged as the source of residual prediction
corrections. It now has a second, more visible symptom.

*Fix:* the standing recommendation — exclude actors from each other's movement collision and let the
server arbitrate contact — resolves both.

### 2.3 Frame rate is 37–60, against a 120 FPS target

Observed 60 on first load, 37 with combat in view, 52 in a quieter frame. The performance budget in
PRODUCTION_PLAN.md is written against 120 FPS.

Likely contributors, in order of suspicion: 23 live dynamic lights in the scene (the configured cap
is 8 — beacon and impact lights are not counted against it), the post-processing chain, and
overdraw from the additive light shafts.

*Not investigated this session.* Needs a profile, not a guess.

### 2.4 The draw-call readout reports "1 DRAW"

The scene demonstrably renders 21 instanced meshes and 137 plain meshes, so the counter is wrong,
not the renderer. Moving the sample to a priority-1000 `useFrame` (after R3F's render) did not fix
it — `EffectComposer` runs its own passes and resets `gl.info` between them.

*Fix:* sample `gl.info` from an `onAfterRender` callback on the composer's final pass, or accumulate
across passes. Cosmetic, but it makes the performance overlay untrustworthy, which matters while
chasing 2.3.

---

## Severity 3 — Polish and feel

- **Light shafts are still too prominent.** Even at the reduced size the vertical cyan column reads
  as an object rather than as atmosphere. Consider fading them by view angle so they are subtle
  head-on and only visible obliquely.
- **Weapon orientation looks slightly off** — the barrel reads as angled rather than pointing down
  the sight line. The idle sway/lowered rotations may be applying a residual yaw at rest.
- **Arena geometry reads well.** Catwalks, LED strips, extraction fans, cover blocks and the central
  room are all legible and the space is navigable at a glance.
- **HUD is legible and correct.** Minimap, objective tracker, match timer, team scores, integrity
  bars and charge cells all render and update correctly.
- **The arena is a touch flat in the mid-tones.** Surfaces away from a fixture fall into a fairly
  uniform grey. More contrast between lit and unlit areas would help readability and atmosphere.

---

## What worked

Worth recording, because a report of only problems is misleading:

- Match flow runs end to end — deploy, spawn, combat, scoring, respawn, match clock counting down.
- Bots fight competently and score against each other (observed 4–8 and 2–5 across sessions).
- The minimap correctly shows walls, the objective room, the player heading cone, and contacts.
- Objective tracker correctly reports the central room as neutral/held/contested.
- Team colours, killfeed, and the integrity/shield split all read correctly.
- Simulation cost stayed at 0.5–1.1 ms/tick throughout, well inside its 1.2 ms budget.

---

## Recommended fix order

1. **2.1 click-to-fire** — one-line class of fix, immediately noticeable.
2. **2.2 actor collision** — fixes an unplayable idle experience *and* the residual network
   prediction corrections. Highest value per unit work in the project right now.
3. **2.4 draw-call reporting** — needed before 2.3 can be investigated honestly.
4. **2.3 frame rate** — profile properly; the dynamic light count is the first thing to check.
5. **3.x polish** — after the above.

## Method note

The most useful thing about this session is what it says about the previous six. Every automated
check was green the entire time the weapon was covering the crosshair. Numeric verification is
necessary and it caught genuine bugs that inspection never would have — but it validates the
questions you thought to ask. Looking at the thing asks all of them at once.

---

# Playtest Iteration 2 — 2026-07-31 (Phase 7)

Verification pass after fixing the three Severity-1 blockers from iteration 1, following the
Observe → Measure → Fix → Play Again loop.

## Fixes verified by playing

| Iteration 1 issue | Status | Evidence |
| --- | --- | --- |
| 1.1 Weapon covered the crosshair | **Fixed** | Crosshair visible and centred; weapon reads as a weapon |
| 1.2 Weapon rendered as a glowing slab | **Fixed** | Dark body with a restrained accent, no bloom blowout |
| 1.3 Light shafts filled the screen | **Improved** | Much smaller; still more prominent than ideal (see below) |
| 2.1 Click-to-lock also fired | **Fixed** | Spawns at **6/6** charge (was 4/6) |
| 2.2 Idle player shoved and killed | **Fixed** | Spawns and stays at (−25, 0, −21.5); previously drifted to mid-arena and died twice |
| 2.4 "1 DRAW" readout | **Fixed** | Now reports 110–167 draw calls, matching the visible scene |

## New measurements

Profiling was impossible in iteration 1 because the draw-call counter was broken. With it fixed:

| Metric | Before | After |
| --- | --- | --- |
| Draw calls | 167 | **110** |
| Active point lights | 20 | **17** |
| Triangles | 14,081 | 12,603 |
| Frame time (median / p95) | 16.8 ms | 16.7 / 17.3 ms |
| JS heap | 37 MB | 43 MB |

**Finding: the 120 FPS target cannot currently be measured.** Frame time sits at exactly 1/60 s —
the display is vsync-capped, so "60 FPS" means "hitting the cap", not "at the limit". Any
optimisation claim needs a vsync-independent measurement first.

**Finding: the light budget was not enforced globally.** `graphics.maxDynamicLights` capped the
arena's own fixtures at 8, but impact flashes, prop beacons and the muzzle light were all outside
it — 20 live lights in total. Since every lit surface shader evaluates every light, this is charged
against the whole frame. Reduced to 17 by cutting concurrent impact flashes 6→3 and giving only two
beacons real lights.

**Finding: draw calls are dominated by unbatched props and avatars.** 137 individual meshes versus
21 instanced. Each bot is ~12 meshes, each prop 2–8. The arena geometry is already batched; the
dressing and characters are not. This is the next optimisation, and it is worth far more than
anything geometry-related — 12.6k triangles is trivial.

## Still open

- **Light shafts still read as objects rather than atmosphere.** The vertical cyan column is the
  most visually intrusive element on screen. Fading them by view angle would fix this properly.
- **Weapon orientation looks slightly angled at rest** — likely residual yaw in the idle sway.
- **Mid-tone flatness** — surfaces away from a fixture fall to a uniform grey.
- **4+ client network runs fail** — see [NETWORK_BENCHMARK.md](./NETWORK_BENCHMARK.md). Server is
  healthy and transmitting; clients receive nothing. Leading hypothesis is that the test harness
  co-locates eight full game clients in one Node event loop and starves socket I/O, but this is
  **unresolved** and blocks every figure above three clients.

## Loop assessment

Two iterations in, the loop is working. Iteration 1 found three blockers by looking; iteration 2
confirmed all three fixed and produced the first real render profile, which immediately surfaced two
optimisation targets that no amount of reasoning had identified — because the instrument needed to
see them was itself broken.

The pattern worth keeping: **fix the measurement before optimising the thing being measured.**

---

# Playtest Session 3 — 2026-08-01 (Sprint 7)

Bot Practice / Team Deathmatch, Classic arena, 3 and 6 players per team, browser preview at
913x988, WebGL2, 60 Hz display.

Three deployments observed end to end. Console clean throughout — no errors, no warnings.

## Severity 1 — Gameplay

### 3.1 You die roughly ten seconds after every spawn

Reproduced on **every one of three deployments**: spawn, orient, and be tagged before finding an
opponent. The kill feed shows the tagging bot is usually one that was already in a fight elsewhere.

This is the single biggest thing standing between the current build and a game worth playing. It is
some combination of three things, and they need separating before any of them is tuned:

- **Spawn placement relative to live combat.** `SpawnSystem` scores candidates, but nothing observed
  suggests it is weighting enemy proximity heavily enough at 6-per-team density.
- **Bot accuracy at medium difficulty.** Medium bots appear to acquire and land shots faster than a
  player orienting from a fresh spawn can react.
- **Time to kill.** 34 damage per bolt against 100 health + 60 shield is five bolts, and at a
  0.17 s fire interval that is 0.68 s of sustained fire. Short.

Scores bear this out: 7–15 after 50 seconds at 6 per team. A ten-minute match at that rate would end
on the score limit in under three minutes.

### 3.2 Bloom is blowing out the centre of the frame

The dominant visual artefact is not the volumetric shafts — it is bloom bleeding off the emissive
light fixtures. From most positions on the deck, two large white-cyan teardrops sit in the middle of
the screen and wash out everything behind them, including anything in the crosshair.

Note this corrects a diagnosis made earlier in the same session: the shafts were assumed to be the
offender, fixed, and found *not* to have been the main problem. The shaft fix is still correct (see
below) but bloom is the bigger contributor and is untouched.

## Severity 2 — Presentation

- **Crosshair is too small and too low-contrast.** A thin grey cross on a pale wall is nearly
  invisible. Needs an outline or a contrasting core.
- **Mid-tone flatness persists** from session 2. Surfaces away from a fixture are uniform grey.
- **No team colour in the environment.** Every strip and fixture is cyan regardless of which team
  holds the room, so the objective banner is the only team-state signal on screen.
- **Weapon idle orientation still reads angled** — carried from session 2, still present.

## What was fixed this session

- **Light shafts now fade by view angle** (`Scene.tsx`). A real shaft is scattered light: strong
  across the view, weak along it. A fixed-opacity cone did the opposite and read as solid geometry.
  Opacity is now weighted by how perpendicular the shaft is to the view direction and faded within
  6 m. Costs one dot product per shaft.
- **Avatars are drawn instanced** (`PlayerAvatars.tsx`). See PROJECT_STATUS for the numbers.

## Performance observed

| Condition | Draw calls | Sim time | FPS |
| --- | --- | --- | --- |
| 5 bots, before instancing | 146 | 0.70 ms | 60 |
| 11 bots, after instancing | 146 | 2.30 ms | 60 |
| 5 bots, after instancing, no enemies in view | 133 | 0.40 ms | 60 |

**Draw calls are now independent of player count** — more than doubling the roster left them
unchanged. Simulation time is dominated by bot AI, not rendering: 0.70 ms at 5 bots to 2.30 ms at
11, roughly linear in bot count.

FPS remains pinned at exactly 60 by vsync, so the 120 FPS target is still unverifiable. This has
been an open item since Sprint 4 and no optimisation claim can be validated against it.

## Loop assessment

Third session. This one produced its findings by playing rather than by looking at a still frame,
and the highest-value finding — dying ten seconds after every spawn — is one that no screenshot,
probe or benchmark would ever have surfaced. It is also the finding least addressed by this sprint,
which spent its budget on infrastructure.

The pattern from session 2 held again in a new form: **the light-shaft fix was made against a
misdiagnosis** that a screenshot supported and actually playing refuted.
