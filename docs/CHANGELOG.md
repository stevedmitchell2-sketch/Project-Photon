# Changelog

Newest first. Each entry is scoped to what a reviewer would need to know.

---

## [0.20.0] - 2026-08-01 - Sprint 14: the Photon Core

One iconic space rather than an evenly improved map.

### The Photon Core

A landmark suspended in the central objective room: a pulsing core inside three rings crossed on
different axes and spinning at different rates, a containment cage of four struts, and a beam
descending to the floor.

**Crossed rings rather than a sphere.** A sphere looks identical from every angle and therefore
reads as flat; crossed rings give parallax and tell you where you are standing relative to it.

**The Core is also the objective readout** — it takes the colour of whoever holds the room, strobes
while contested, floods on a win. So it keeps being worth looking at after the first match, and it
puts the project's oldest identity idea (the building reports the state of the match) at the visual
centre of the arena instead of in a HUD element.

**Placement took a correction.** A first pass hung it *above* the objective room. That gap is only
2.8 m, so a 5 m ring assembly clipped through the roof, and from the ground floor the roof edge
occluded it from every approach. A landmark nobody can see is not a landmark. Inside the room it is
framed by the four doorways and players fight around it.

### Lighting drama

**Ambient fill halved, 0.42 to 0.20**, key light raised to compensate. The single change that gave
the arena mood.

Ambient is a floor under every surface simultaneously, so at 0.42 the perimeter was lit to within a
hair of the objective and nothing drew the eye. The arena had been disobeying its own style guide,
which has said since M1 that contrast comes from lit-versus-unlit regions rather than a global dim.

### Competition floor

Boundary lines inset from the walls, panel seams on the module grid giving the floor scale, a
segmented ring marking the objective, and chevrons on each approach pointing inward. The chevrons
are navigation payload: from a corridor you can see which way the middle is without a HUD.

### Performance

GPU 10.3-11.7 ms, CPU 1.7-2.2 ms, 199-214 draw calls, 60 FPS held. Roughly +0.5 ms and +60 draw
calls against Sprint 13, for the Core, the floor markings and the extra fill from higher contrast.

### Hero camera test

Run with the HUD hidden. First Photon frames with a focal point, a readable enemy silhouette against
it, real vertical contrast and a distinctive shape. Honest remaining weaknesses in the sprint report.

---

## [0.19.0] - 2026-08-01 - Sprint 13: architecture where there were boxes

### The correction

Sprint 11 concluded procedural geometry had hit its ceiling. That was true of **hero assets** and
was applied too broadly. Architecture is the opposite case: repetitive structural detail on a
regular rhythm is what code does *better* than a person.

The rule, now in ART_DIRECTION section 10: **if the detail is a rhythm, generate it; if it is a
silhouette, model it.**

### What changed

`ArenaArchitecture` reads the existing brushes and builds along them. No arena data changed, no
collision changed.

**Walls** — structural ribs on a 4 m bay rhythm, recessed panels between them, a lit trim channel at
eye height, service hatches every third bay, vents every fourth, cable runs, a kick plate grounding
the floor join, a cornice at the roof line. Fittings sit on a slower rhythm than the bays on
purpose: detail that repeats every bay reads as wallpaper.

**Ceiling** — a broadcast rig replacing a 60 x 60 slab. Truss grid on a wider pitch than the walls,
chord members giving depth from the only angle it is seen, light fixtures at the intersections, four
broadcast cameras on the diagonals over the contested ground, speaker arrays down the long axis.

**Cover** — capping rail, corner posts and a lit strip echoing the wall trim. Cover sits at eye
height in the middle of the play space, so a bare box is in frame more than any wall is.

### Two things that had to be got right

- **Overhead structure needs lifting well above the ceiling's own value.** The rig hangs below the
  roof with nothing lighting it from above; a physically plausible dark truss disappeared entirely.
- **Fittings on a slower rhythm than bays.** The first pass put a hatch on every bay and it read as
  a repeating texture rather than as a serviced building.

### Cost

Measured interleaved: **474 instances in 18 batches for 1.22 ms and 17 draw calls.** GPU 10.1 to
11.3 ms of a fragment-bound frame.

### Showcase test

Run with the HUD hidden, per the brief. Honest verdict in the sprint report: the arena now reads as
a constructed interior rather than a graybox, and it does **not** yet read as a championship venue.
The remaining gap is named there and is mostly lighting drama, landmarks and a floor.

---

## [0.18.0] - 2026-08-01 - Sprint 12: the asset pipeline

Photon's limiting factor stopped being technology two sprints ago. This builds the factory.

### A contract, not a format

Photon deliberately defines no asset format of its own. A custom format needs a custom exporter,
which locks content creation to whoever wrote it. The runtime instead reads **named nodes** inside
standard glTF — `SOCKET_`, `PART_`, `MAT_`, `TEAM_`, `LOD`, `COL_` — which works out of any tool that
can name an object and export glTF.

**Nothing in the pipeline is Blender-specific.** Blender is the documented workflow because it is
free and complete. FBX is accepted as a compatibility path. A generative tool that emits standard
glTF is a first-class source, and ASSET_PIPELINE.md names the three things generated assets
habitually get wrong (unnamed nodes, dense topology, unpacked textures).

### What was built

- **`contract.ts`** — the interface between content and code. Node prefixes, required sockets and
  animated parts per kind, triangle/material/texture/LOD budgets, file and texture naming, accepted
  formats, material zone mapping.
- **`manifest.ts`** — the registry. Nine Phase 1 assets specified. **Entries exist before their
  files do**: the manifest is the specification an artist works to, every asset is optional, and the
  repository stays clone-and-run with no binaries.
- **`validate.ts`** — pure validation, no Three.js, DOM or filesystem, so the same rules run in CI,
  in the audit CLI, and in the browser as an asset loads.
- **`AssetLoader.ts`** — the importer. Extracts sockets, animated parts, LOD groups and collision by
  name, and substitutes library materials by zone so an imported mesh inherits the project's lighting
  response and team colour rather than shipping its own.
- **`assetAudit.ts`** — reports what exists, what is still to author, budget violations and unclaimed
  files. It caught a real specification error on its first run: the manifest declared six material
  zones against a budget of five, and **the budget was what was wrong** — two of a weapon's zones
  animate and cannot share a cached material.

### The weapon proves it

The clearest demonstration is that **the procedural rifle now follows the asset contract too**. Its
primitive meshes are named `PART_core`, `PART_rail_00`, `SOCKET_muzzle`, and it scans its own subtree
with the same function the importer uses.

The animation — charge rails, core pulse, emitter heat, muzzle light — addresses parts by name and
has no idea whether it is driving primitives or an imported mesh. Dropping
`HeroLaserRifle_v01.glb` into `public/assets/weapons/` swaps one branch of a ternary; the muzzle
light even relocates to the asset's own `SOCKET_muzzle`.

Rails and cells are **discovered, not counted**, so an asset may ship any number.

### Documentation

Seven new documents: ASSET_PIPELINE, ASSET_STANDARDS, MATERIAL_LIBRARY, MODULAR_KIT,
HERO_WEAPON_SPEC, CHARACTER_PIPELINE, CONTENT_ROADMAP.

CHARACTER_PIPELINE is explicit about being the **least-proven path**: it separates what is
implemented and tested from what is specified but untested (bone matching, clip playback,
socket-to-socket mounting) and recommends building skeletal playback *alongside* the first character
rather than before it.

### Tests

17 new tests covering naming, budgets, socket and LOD validation, ORM packing, manifest
self-consistency, and prefix unambiguity. 70 total.

---

## [0.17.0] - 2026-08-01 - Sprint 11: Art Direction Alpha

Materials, surface detail, and the hero weapon. Also the sprint where the ceiling of procedural art
became measurable rather than theoretical.

### A real material library

Every surface in the game was a flat colour with one roughness value — the single biggest reason the
arena read as graybox, because a solid-colour polygon looks like a solid-colour polygon however well
it is lit.

New `PhotonTextures` generates deterministic roughness and bump maps on canvas (brushed metal
streaks, carbon twill, anti-slip grip, panel seams, hex motif). New `PhotonMaterials` turns those
into **fourteen named physical substances** — the arena declares what a brush is *for*, the library
decides what it is *made of*. Materials are shared and cached, so shader program count stays flat.

**Two mistakes made and corrected, both worth keeping:**

- **Roughness maps multiply, they do not replace.** Textures drawn around 40% grey halved every
  material's roughness and turned the arena into semi-polished plastic. They now live in the
  0.7-1.0 band and modulate downward.
- **The arena was already lit for a specific material response.** A pass using physically nicer
  numbers (aluminium at 0.82 metalness, composite at 0.05) cost the scene its contrast — walls went
  from mid-dark to pale grey. Texture variation was the win; the response did not need changing.

`temperedGlass` is deliberately **not** `MeshPhysicalMaterial` with transmission, which was tried and
reverted: real transmission forces a separate full-scene pass, indefensible on a frame already 30%
over budget, and it misbehaves on the instanced meshes all arena glass uses.

### The PH-6 Photon Rifle

The placeholder was eight boxes. The replacement is sports equipment rather than a military weapon:
a long low body with a stepped shroud, an **exposed energy spine**, a visible core behind a housing,
a slotted barrel, heat fins, emitter prongs, a skeleton stock, and team trim on the upper flank.

**Charging rails carry a travelling band** while the cell recharges and idle as a slow breath when
ready; the core pulses with remaining charge. The weapon reports its own state, so a player can read
it without looking away from the fight.

Costs ~30 draw calls against the placeholder's 8. Affordable on a fragment-bound frame, and the
animation is written against part references rather than geometry — a modelled asset replaces the
primitives without touching a line of it.

### ART_DIRECTION.md

The permanent artistic foundation: what Photon is and is not, colour as a reserved channel,
architecture language, the material library and its three hard-won rules, lighting philosophy, weapon
and character design language, environmental storytelling, and future-arena guidance.

Including an honest section on **the limit of procedural art**: code does proportion, silhouette,
material response and state-driven animation well, and surface density badly. The next leap is an
asset pipeline, not more generated geometry.

---

## [0.16.0] - 2026-08-01 - Sprint 10: The Living Arena

The bot fix that seven sprints of measurement had been circling, and the venue the last two sprints
kept deferring.

### Bots no longer all fight at 7 metres

**Root cause.** The distance a bot tries to hold while fighting lived as two literals inside
`combatMovement` -- close above 22 m, retreat below 7 m -- whose equilibrium is exactly 7 m.
`engageRange` only ever gated *target acquisition*, never *position*, which is why moving it between
26 m and 62 m appeared to do nothing.

`preferredRange` and `rangeTolerance` now live in the profile. Engagement range becomes monotonic in
difficulty: **3.7 / 5.6 / 7.9 / 8.6 m**, where it was 7.0 / 7.0 / 7.1 / 7.0.

**`aimErrorDegrees` had to move with it**, and that is the non-obvious half. Aim error is an angle,
so its miss radius grows with distance. The old values were monotonic in degrees and -- because
every bot fought at the same 7 m -- in metres too, which is the only reason the ladder worked.
Spread across differing ranges they all landed near three body half-widths and the ladder inverted:
`hard` bots stood at 19 m behind a 1.06 m cone and measured consistently *safer* to fight than
`medium`. Degrees are now derived from a target miss radius at each bot's own preferred range.

**Seven measured iterations**, and the last finding is a map problem rather than a tuning one:
beyond roughly 10 m Arena 01 stops offering sight lines, so bots preferring 15 m and 19 m converged
on the same achieved range and spent the fight repositioning instead of shooting. Preferred ranges
are capped at what this building can deliver. A range-based difficulty ladder needs an arena with
long sight lines, which is a requirement for Arenas 02-04.

Final state is **two clean difficulty tiers rather than four** -- easy and medium at ~14 s median
life, hard and expert at ~8.7 s -- with the default at the Sprint 8 target pace and accuracy
monotonic at 21.6 / 33.8 / 47.6 / 52.3%. Seven regression tests, including the one that would have
caught the inverted ladder: aim error must be monotonic **in metres at each profile's own range**.

### The venue

New `VenueBoards` module supplying content for five board bindings -- `clock`, `scoreboard`,
`killfeed`, `objective`, `roundstatus` -- requested by name through the existing display prop. The
arena declares that a scoreboard belongs on a wall; what a scoreboard *is* lives in one place, so
every future arena inherits the same venue language.

Authored into Arena 01: twin scoreboards on the team approaches, elimination feeds where players
regroup after dying, a control bar above the objective, round status over each spawn approach, and
fictional league and sponsor signage. **Branding never uses a team colour** -- that channel is
reserved, and a red sponsor board reads as red territory.

Scoreboard numerals are white on a team-tinted panel rather than team-coloured: the first pass drew
both in the team colour and the score was barely readable across the room, because a red digit on a
red panel has almost no luminance contrast however much it glows.

### The arena reacts to the match

Reactive lighting now answers to match phase as well as objective control, and **phase outranks
control**: an amber swell in the final minute, a one-per-second red countdown beat in the last ten
seconds, and a winner-coloured flood that rises and widens when the match ends. Each state has its
own *rhythm* as well as its own hue, so the room stays legible with the sound off and to a
colourblind player.

### Performance: a 3.19 ms regression, found and removed

The venue first measured at **3.19 ms of a 12.8 ms frame while adding only four draw calls**, and
that mismatch is what gave it away -- cost with no draw calls behind it is upload cost. Four
scrolling signs were each clearing a canvas, rasterising text and uploading 256 KB *every frame*.
Marquees now rasterise once and scroll by moving the texture's UV offset.

Re-measured interleaved: the entire venue plus team identity costs **-0.23 ms**, within noise.

---

## [0.15.0] - 2026-08-01 - Sprint 9: the arena tells you what is happening

The identity sprint. The arena now carries team colour and reports the state of the match, and the
weapon is tuned for the fight the game actually has rather than the one it was designed for.

### Combat tuned around 7 metres

`spawn-audit` reports a median engagement range of 7.0 m at every difficulty and it does not respond
to `engageRange` -- bots close to contact before shooting. Rather than fight that, the weapon is now
tuned for it. The geometry that matters, against a 0.36 m capsule radius:

- **Bolts were too slow.** At 132 m/s a bolt took 53 ms to cross 7 m, so hitting a strafing player
  meant leading by **45 cm** -- more than a body half-width, at the range where a laser should feel
  instant. Now 215 m/s: 33 ms, 27 cm of lead. Still a visible streak across the 60 m arena.
- **The cell had no margin.** 160 effective health was five bolts out of a six-shot cell, so a
  single miss forced a recharge mid-fight at a measured ~35% accuracy. Capacity is now eight.
- `spreadPerShot` 0.42 -> 0.34 so a full eight-shot burst still ends inside a body width at 7 m.
- **Damage 34 -> 28 pays for all of it.** The buffs helped the bots too, and measurement caught it
  immediately: median life fell 14 s -> 10.6 s, undoing the Sprint 8 rebalance. With damage lowered,
  time-to-kill is back to 3.44 s (Sprint 8: 3.48 s) and median life sits at ~12 s.

### The arena has a side now

New `teamZones` and `reactiveZones` arena data, and a `TeamIdentity` renderer:

- **Territory rings** -- emissive floor strips in team colour around each spawn, clipped to the play
  space. A first pass put a third of the red ring inside the perimeter wall, because a 15 m radius
  from a corner spawn at (-25, -25) reaches x = -40 in a map that stops at -30.
- **Spawn beacons** -- vertical light columns readable over cover from across the arena.
- **Reactive objective lighting** -- the central room takes the colour of whoever holds it, eased
  over ~300 ms so it does not flicker as players cross the boundary, and strobes while contested.
  Contested strobes rather than blending two team colours into a meaningless purple.

**Built from emissive geometry, not lights.** Sprint 8 measured the frame as fragment-bound, where
`maxDynamicLights` 8 -> 0 was worth 2.3 ms. Expressing territory with eight coloured point lights
would have cost more than the entire post-processing chain. Measured cost of the whole system,
interleaved: **0.59 ms and 8 draw calls**, with exactly one real light on the objective.

### The arena speaks

- **Objective callouts** from the simulation, so they are deterministic, replicated and present in a
  replay. Debounce is asymmetric: taking a room is decisive and called in 1.5 s, losing one is
  usually a contested moment and waits 4 s. A first pass with a single 1.5 s window produced 17
  callouts in 120 s, half of them "lost" immediately followed by "held".
- **Match-end sting** -- rising major arpeggio for a win, falling minor for a loss. Pitch direction
  carries the meaning so it survives a bad speaker and a muted music bus.

### VISUAL_STYLE_GUIDE.md

New. The rules that make new content look like Photon: palettes, material language, lighting
philosophy, readability rules, laser standards, silhouette rules, and what Photon is not. Every rule
is a conclusion from something measured or got wrong, with the measurement named.

---

## [0.14.0] - 2026-08-01 - Sprint 8: the ten-second death, and what the frame actually costs

Two long-standing beliefs measured and found wrong, and the instrument that had been missing since
Sprint 4 finally built.

### Spawn placement was not the problem

The Sprint 7 playtest finding — "you die roughly ten seconds after every spawn" — was reproduced
exactly by a new headless harness (`npm run spawn-audit`) and then attributed. Median lifetime at
the default difficulty was **10.0 s**, split as **7.1 s finding a fight + 2.38 s losing it**.

Spawn placement needed no change at all: the median spawn put the nearest enemy **30.3 m** away,
**none** were within 15 m, and only **2%** had line of sight to an enemy. The existing scoring —
threat weighting, line-of-sight avoidance, recency cooldown — was already doing its job.

What made the game feel unfair was that the *default opponent* shot like a good human: 360 ms
reaction, 3.4 degrees of aim error, engaging out to 45 m. The difficulty ladder was compressed at
the bottom and had no headroom at the top, so `medium` was effectively a hard setting.

Rebalanced against measurement:

| difficulty | median life before | after |
| easy       | 16.2 s             | 26.7 s |
| medium     | **10.0 s**         | **~14 s** (three seeds) |
| hard       |  8.1 s             | 10.5 s |
| expert     | —                  |  8.5 s |

Lives ending inside ten seconds at the default fell from **50% to ~32%**.

The one genuine gap in the spawn system was **occupancy**: threat, sight lines and recency were all
scored, but nothing checked whether the point was physically free. Added.

### Frame timing, at last

Frames per second cannot answer the 120 FPS question on a vsynced display — it pins the interval to
one refresh regardless of how much work the frame did. `RendererStats` now measures **CPU frame
time** (bracketed across the frame's callbacks) and **GPU frame time** (via
`EXT_disjoint_timer_query_webgl2`, collected asynchronously so it never stalls the pipeline).

The first measurement:

| CPU | **1.4-1.9 ms** |
| GPU | **12.0-12.5 ms** |
| 120 FPS budget | 8.33 ms |

**The frame is GPU-bound with the CPU nearly idle, and fragment-bound rather than
draw-call-bound.** Halving `renderScale` takes GPU to 4.8 ms; removing every dynamic light saves
2.3 ms; post-processing, shadows and the volumetric shafts are all effectively free.

Draw calls were never the constraint, which means the batching work of Sprints 6-7 was optimising
the wrong axis — and the reason nobody noticed is that the instrument could not tell.

**120 FPS is not currently achievable**: closing the gap needs a 32% cut, roughly `renderScale` 0.6.
The target is not being met by quietly gutting resolution. The real lever is per-pixel cost.

### Bugs fixed

- **Disabling every post effect turned off rendering.** `RendererStats` registers a positive-priority
  `useFrame`, which hands R3F's render loop to whoever renders manually — normally `EffectComposer`.
  With bloom, vignette, grain and chromatic aberration all off, `PostFX` returned null, the composer
  unmounted and nothing rendered: a black screen with zero draw calls, reachable from the settings
  menu. Now falls back to a direct scene render.

### Presentation

- **Charge ring around the crosshair.** Remaining shots as tick marks, recharge as a sweeping arc —
  different in shape, not only colour — in the team accent. The cell counter was in the screen
  corner, which is the wrong place for the one thing a player needs while aiming.
- **Crosshair legibility**: dual drop-shadow and a centre pip, so the point of aim stays readable at
  full spread and against a bloomed wall.
- **Bloom reduced** across all presets (0.55/0.85/1.1 -> 0.35/0.5/0.68). Interleaved measurement puts
  the GPU difference at -0.08 ms: this is entirely a readability change. At the old values the
  emissive fixtures washed out whatever was under the crosshair.
- **Team accent variables** in CSS, mirroring the simulation's team colours.

### Method

Two measurement traps found and recorded in RENDERING_GUIDE.md: **GPU time is view-dependent** (the
same preset read 8.68 ms and 12.43 ms minutes apart, so A/B must be interleaved), and **repeated
in-tab reloads degrade the WebGL context** (4 FPS and a 10x simulation-time jump that no graphics
setting can explain). A promising 3 ms bloom saving evaporated to -0.08 ms under interleaved test.

---

## [0.13.0] - 2026-08-01 - Sprint 7: four production bugs, latency validated, 16 clients

The sprint set out to close the last infrastructure blockers. It found four genuine production
defects instead, three of which had been misdiagnosed as something else for multiple sprints.

### The disconnect / stale-state bug was never in the server

A networked client creates a local player before connecting, and the server then assigns the id that
player will really have. Nothing merged those two identities. Depending on the server's id counter
the client either had its own player reaped as a departed peer, or — on any server with bots — had
it overwritten by a bot's state every snapshot, camera included.

Invisible for three sprints because the only multi-client testing used a freshly started, botless
server, where local ids coincidentally matched server ids.

Fixed by `MatchDirector.adoptLocalActorId`; snapshot reaper hardened as defence in depth. Five
regression tests, all against a server whose counter has already advanced.

**Consequence:** three consecutive runs against one long-lived server now pass, where the second
previously failed outright. Maximum stable client count is **at least 16** — the design target —
where it was recorded as 4 and then 8.

### Lag compensation was not working

`ServerClient.rttMs` was measured by storing a ping sequence on first sight and measuring on the
second. Clients send each sequence once, so the value stayed at 0 forever and rewind used only the
fixed 75 ms interpolation delay.

Measured cost: hit rate on a strafing target at 250 ms RTT was **2.8%**; with RTT working it is
**8.5-11%**. Replaced with a server-side measurement that needs no protocol change.

### Every player was forced onto red on any botless server

`defaultBalanceConfig(teams, maxPerTeam)` was being passed `botsPerTeam`. With `--bots 0` the cap
was zero and every client fell through to the default team. Friendly fire is off in team modes, so
**nobody on the server could damage anybody** — on exactly the configuration used for every
automated test.

### Kicked clients leaked their actor

`kick()` removed the client record but not its actor, so every timeout and rate-limit kick left an
abandoned actor in the arena for the life of the server.

### Latency validation, 0-250 ms

Full sweep with a new duel harness: the target strafes, the shooter aims at what it *renders* and
fires. Tick rate holds at 64.0 Hz throughout; 0 snapshot drops, 0 input drops. Responsiveness
degrades linearly, 46 ms to 331 ms of acknowledgement lag. Upstream grows 5x with RTT; downstream is
flat. Full tables in NETWORK_BENCHMARK.md.

### Process-per-client scaling

16 clients, each in its own OS process: 16/16 complete, all peers visible, 0 dropped snapshots,
server at **22.2% of one core and 137 MB**. The harness costs 16x more CPU than the server it tests.

### Residual corrections: three more hypotheses eliminated

Co-location in one event loop — **disproven**. Server discarding queued inputs — **disproven**
(0 drops at every latency). Reconciliation comparing across time — **disproven for the quiet
client**, which minimises at offset 0 with 28 mm error.

Narrowed to one precise observation: the server reports every client moving identically (46.2 m),
but noisy clients minimise at reconciliation offset ~10, close to their acknowledgement lag. Also
established that client-side travelled distance is not a movement measure — 84 m of one client's
130 m "path" was correction snapping.

### Avatars are instanced

The rig is fifteen meshes per player: 75 draw calls at five bots, 240 at sixteen. Now drawn as
`InstancedMesh` batches keyed by (geometry, material) — a constant ~18 regardless of roster, and 0
when no enemies are visible. Measured 146 draw calls at 5 bots and **146 at 11**. Posing is
unchanged; the rig interface an authored character will implement is untouched.

### Light shafts fade by view angle

A real shaft is scattered light — strong across the view, weak along it. A fixed-opacity cone did
the opposite and read as solid geometry. Now weighted by view angle and faded within 6 m.

Worth recording that this was **aimed at the wrong target**: playing the game afterwards showed the
dominant artefact is bloom off the emissive fixtures, not the shafts. The fix is correct; the
diagnosis it was made against was not.

### Telemetry

Movement sampling at 4 Hz into a new `occupancy` heatmap, network corrections recorded with position
and error, frame timing sampled once a second with individual hitches over 50 ms recorded separately.

### New tooling

`npm run latency-sweep`, `npm run predict-align`, `npm run scale`, plus
`scripts/lib/loopbackSession.ts` shared by the scripts and the integration tests.

### Playtest

Third session, first to be played rather than observed. Headline finding: **you die roughly ten
seconds after every spawn**, reproduced on all three deployments. Not addressed this sprint.

---

## [0.12.0] - 2026-07-31 - Sprint 6: two hypotheses disproven

No new gameplay. This sprint replaced two long-standing assumptions with measurements, and both
assumptions were wrong.

### The 8-client "scaling limit" does not exist

**8 clients pass on a fresh server** - 179-192 snapshots each, 0 dropped, every client seeing all 7
peers.

Every failing multi-client run across three sprints was a *second* run against a server that had
already served and lost a previous batch. Every first run passes. The defect is **stale server state
after a client generation disconnects**, not a client-count limit.

Maximum stable client count is therefore **at least 8**, where it was previously recorded as 4.

### The geometry hypothesis is disproven

Sprint 5 proposed that level-geometry contact drove the residual correction rate. Added
`--scenario open|cover|identical` to the harness and ran identical inputs across open floor:

| Client | Travelled | Comparisons | Misses | Corrections/s |
| --- | --- | --- | --- | --- |
| 1 | 7.9 m | 176 | 1 | **0** |
| 2 | 8.2 m | 177 | 1 | 22 |
| 3 | 8.2 m | 177 | 1 | 22 |

Identical inputs, identical environment, identical comparison counts - still bimodal. Geometry is
not the cause, and neither is prediction-lookup failure (1 miss per ~177 comparisons).

### Added

- `--scenario` flag on the network harness, plus distance-travelled and position reporting.
- `Reconciler` lookup-miss and comparison counters, surfaced through `NetClient.stats`. Zero
  corrections previously meant either "perfectly accurate" or "never evaluated"; these separate them.
- **`docs/TECH_DEBT.md`** - debt with costs attached, and a "consciously accepted" section.

### Scope

Steps 3-5 of the brief - latency sweep, playability review, rendering optimisation - were **not**
reached. Sprint 6's exit criteria are partially met; the unanswered ones are listed in NEXT_TASK.

---

## [0.11.0] - 2026-07-31 - Sprint 5: prediction drift root cause

### Found - the server was inventing movement

When no input was available for a client on a tick, the server **re-simulated with that client's
previous input**, advancing the actor by a movement step the client never predicted. Two 64 Hz
clocks that are not phase-locked starve constantly, so this was continuous systematic drift. One
starved tick at sprint speed is 0.13 m; observed errors were 0.05-0.37 m.

Found by reading the tick loop, then **confirmed by instrumentation** rather than assumed:

| Client | Starved ticks | Corrections/s |
| --- | --- | --- |
| A | 3.4% | 2 |
| B | 12.3% | 22 |
| C | 19.7% | 22 |

This is the sixth hypothesis examined for this defect. The five before it are recorded in
NETWORK_ARCHITECTURE.md; four were wrong and two of those were previously reported as fixes.

### Fixed

- **Starved actors hold position** instead of replaying stale input, so the server never simulates a
  step the client did not.
- **Input jitter buffer** (`TARGET_INPUT_BUFFER = 2`) primes a cushion before consuming, absorbing
  ordinary clock drift. Costs ~31 ms of input latency, against correcting several times a second.

Measured: starvation **19.7 / 12.3 / 3.4% -> 6.6 / 4.1 / 1.4%**.

### Added

- `NetServer.inputHealth()` - per-client starvation diagnostics, printed in the server health line.
- `MatchDirector.setInputStarved()` - locomotion holds for a starved actor; weapons, regeneration
  and respawn timers still advance.
- **`docs/BACKLOG.md`** - scoped work behind NEXT_TASK, including a "deliberately not doing" section
  so settled decisions are not re-proposed.

### Still open

Corrections remain **2 / 22 / 22** - now *bimodal* rather than continuous, and 22/s is exactly the
snapshot rate, so two clients correct on every snapshot while one almost never does. Starvation
reduction did not move them. Leading hypothesis is contact with level geometry amplifying
sub-quantisation differences through collide-and-slide; the test to confirm it is in NEXT_TASK.

### Scope note

This sprint spent its budget on Steps 1-2 and 8 (review, network stabilisation, telemetry). Steps
3-7 - first-person feel, weapon polish, HUD, match flow, visual polish - were **not** reached. They
are unblocked and sequenced in NEXT_TASK for Sprint 6.

---

## [0.10.0] - 2026-07-31 - Networking sprint: scaling, lag compensation, telemetry

Cohesive sprint on Networking + Prediction, the highest-value unfinished work in NEXT_TASK.

### Fixed - 4-client multiplayer now works

`NetClient.connect()` resolved on **socket open** rather than on the server's handshake
acknowledgement. Callers therefore treated a session as ready before it had an actor id, and
`sendInput` correctly refused to transmit — producing clients that were connected, receiving
snapshots, and sending nothing. It now resolves on the acknowledgement, with a timeout, and rejects
on a kick.

Measured: **4 clients went from FAIL to PASS** (all see all peers, 129-135 snapshots each, 0
dropped). 8 clients still fail; see Known Issues.

### Added - lag compensation wired into live projectile resolution

`net/LagCompensation.ts` had been implemented and tested for two phases without ever being called.
`ProjectileSystem.step` now takes an optional rewind hook; bolts are grouped by owner (so the world
is rewound once per shooter, not once per bolt) and resolved against the world as that shooter saw
it. Owner order is sorted for determinism.

- `MatchDirector.enableLagCompensation()` - server-only. A client rewinding its own predicted world
  would fight its own reconciliation.
- `MatchDirector.setActorLatency()` - `NetServer` now measures per-client RTT from the ping round
  trip and feeds it in, so each shooter is rewound by their own latency rather than an average.
- Bots are never rewound - they have no latency, so rewinding them would only add error.

### Added - telemetry (Photon Director groundwork)

`engine/Telemetry.ts`: ring-buffered event recording with pluggable sinks and 2D heatmaps.

Three properties make it safe to leave in a shipped build: it returns immediately when disabled
(one branch per event), it is bounded by a ring buffer rather than a growing list, and it is a
**sink, not a system** - nothing reads telemetry back into gameplay, which would break determinism.

Wired via the existing event bus rather than calls inside systems, so gameplay code stays unaware
telemetry exists and new metrics need no system edits. Records shots, hits, headshots, deaths,
respawns, recharges, score changes and match end, with death and shot heatmaps.

### Tests

12 new tests (41 total): telemetry disabled-cost, ring wraparound, sink delivery and removal,
event copying, heatmap bounds rejection, normalisation and ranking.

### Known issues

- **8 clients still fail.** Server accepts all 8 and transmits 41.7 KB/s with correctly-scaling
  snapshots; clients receive nothing. Now a much narrower problem than "anything above 3".
- **Prediction corrections remain at 22/s.** Phase 7 attributed these to actor-vs-actor collision
  and removed it; corrections did not improve, so **that attribution was wrong**. The cause is still
  open.

---

## [0.9.0] - 2026-07-31 - Repository and production restructure

### Added

- **Git repository** initialised with two commits and pushed to a private GitHub repo
  (`Project-Photon`), `main` as default, twelve topics, eight issue labels.
- **Test suite** - 29 tests across three files, covering the code that has actually broken:
  serialization round-trip and bounds checking, quantisation error bounds, RNG determinism and
  state restore, look/basis conventions (including the spawn-facing bug that shipped twice), and
  snapshot delta compression, removal and baseline eviction. **The project previously had zero
  tests.**
- **CI** (`.github/workflows/ci.yml`) - two jobs. `validate` runs typecheck, lint, test and build
  with `if: !cancelled()` so one push reports every failure rather than one per round trip.
  `netcode` runs the prediction A/B harness and a three-client integration test against a real
  dedicated server.
- **ESLint** (flat config, deliberately few rules), **Prettier**, **EditorConfig**, `.gitattributes`,
  `.env.example`, issue and PR templates.
- **Docs**: `README.md` (rewritten), `CONTRIBUTING.md`, `docs/AI_HANDOFF.md`,
  `docs/RENDERING_GUIDE.md`.
- **npm scripts**: `lint`, `lint:fix`, `format`, `format:check`, `test:coverage`, and `validate`
  (the exact sequence CI runs).

### Fixed

- Three lint errors surfaced by the new config: a useless assignment in `BotBrain`, and two
  `prefer-const` violations in `arena01_classic`.

### Structure decision

**Kept the flat `src/` layout rather than splitting into `apps/` + `packages/`.** At 78 files and
~17k lines, already cleanly separated along the seams a package split would use, a monorepo would
mean ten build configs and rewriting every import path in exchange for organisation the codebase
does not need. Revisit when a second application (editor, launcher) needs to share `gameplay` and
`net`. Rationale recorded in the README.

---

## [0.8.0] - 2026-07-31 - Phase 7: playtest-driven fixes

Observe -> Measure -> Fix -> Play Again. Two playtest iterations this session.

### Fixed

- **Click-to-lock no longer fires the weapon.** The click that engages pointer lock is a Mouse0
  press bound to fire, so entering the arena spent a shot before the player saw the world. Mouse
  buttons now only act while the pointer is locked. Verified: spawns at 6/6 charge, was 4/6.
- **Actors no longer collide with each other.** An idle player was shoved across the arena and killed
  by bots pathing through them - they could not stand still. This was also the last known source of
  prediction disagreement (22/s for players in contact vs 3-4/s in open space), since the client
  resolves contact against interpolated peer positions and the server against live ones. Contact is
  now arbitrated by the server through damage. Verified: idle player holds its spawn.
- **Draw-call reporting.** The overlay read "1 DRAW" because `EffectComposer` resets `gl.info`
  between passes, leaving the final fullscreen pass. `info.autoReset` is now disabled and
  RendererStats resets once per frame after reading, giving the true total across all passes.

### Changed - render budget

Profiling (only possible once the counter was fixed) found **20 live point lights against a
configured cap of 8** - impact flashes, prop beacons and the muzzle light were all outside the
budget, and every lit surface shader evaluates every light. Concurrent impact flashes 6 -> 3, and
only two beacons carry a real light. Result: 20 -> 17 lights, 167 -> 110 draw calls.

### Added

- **`docs/NETWORK_BENCHMARK.md`** - measured client-count scaling, render profile, bottlenecks.
- **`docs/PLAYTEST_REPORT.md` iteration 2** - verification of every iteration-1 fix.

### Known issues

- **4+ client network runs fail.** The server is healthy and transmitting (48.4 KB/s at eight
  clients, snapshots scaling 39 -> 151 -> 283 B exactly as delta compression predicts) but clients
  receive nothing and send nothing. Leading hypothesis is the test harness co-locating eight full
  game clients in one Node event loop and starving socket I/O. **Unresolved**; blocks every figure
  above three clients.
- **The 120 FPS target is unmeasurable.** Frame time is exactly 1/60 s - the display is vsync-capped,
  so "60 FPS" means "hitting the cap", not "at the limit". Needs a vsync-independent measurement
  before any optimisation claim can be made.
- Light shafts still read as objects rather than atmosphere.
- Draw calls dominated by 137 unbatched prop and avatar meshes versus 21 instanced.

---

## [0.7.0] - 2026-07-31 - Phase 6: first playtest

**The game was seen running for the first time.** Six phases were verified numerically because the
development environment's browser pane never composited. It composited this session, and every
finding below came from looking at the screen - none were caught by typechecking, the production
build, the lighting probe, the netcode probe, or the multi-client network test, all of which were
green throughout.

### Fixed - blockers

- **The weapon covered the crosshair.** The view model is authored life-size and sat 0.42 m from a
  95-degree camera, occupying about a quarter of the viewport. The game was unaimable. Scaled to
  0.55 and pushed to 0.5 m.
- **The weapon rendered as a solid glowing slab.** Emissive intensities tuned for world geometry
  (2.4-3.0) plus `toneMapped: false` charge cells blew out under bloom at 0.4 m from the near plane.
  Emissive values are not scale-invariant - what matters is the solid angle an object occupies.
- **Volumetric light shafts filled the screen.** Cone radius was `distance * 0.28`; with 48 m
  fixtures that is a 13 m cone. Now `min(2.4, distance * 0.06)` with roughly half the opacity.

### Added

- **`docs/PLAYTEST_REPORT.md`** - full findings, severity-ranked, with a recommended fix order.

### Known issues found and documented

- Clicking to lock the pointer also fires the weapon (spawns at 4/6 charge).
- An idle player is shoved around the arena and killed by bots walking through them - the same
  actor-collision system behind the residual prediction corrections.
- Frame rate 37-60 against a 120 FPS target; 23 live dynamic lights against a configured cap of 8.
- The draw-call readout reports "1 DRAW"; `EffectComposer` resets `gl.info` between passes.

---

## [0.6.0] - 2026-07-31 - Phase 5: prediction validated

### Added

- **`scripts/predictionAB.ts`** - A/B harness that runs an identical scripted input sequence through
  the live simulation path and the reconciler's replay path, then diffs position per tick. Reports
  first divergence, mean/max/final error, and isolates `physics.step()` and actor collision as
  variables. `npm run predict-ab`.
- **Per-tick prediction ring** in `Reconciler`, so reconciliation can compare like with like.

### Fixed - prediction correction rate, 20-22/s down to 3-4/s

Two real bugs, found by measurement rather than inspection:

1. **Reconciliation compared across time.** It measured the client's *current* position against the
   server's *older* snapshot. At 20 Hz the client legitimately runs ~3 ticks ahead - roughly 0.4 m of
   entirely correct lead at sprint speed - so this reported a correction on essentially every
   snapshot. It now compares the server's result against the client's stored prediction *for that
   same tick*. This was the root cause.
2. **The server skipped inputs.** `dequeueInput` took only the newest queued frame and discarded the
   rest, so any input arriving while the server sat between ticks was never simulated even though
   the client had already predicted with it - permanent, accumulating divergence. Inputs are now
   consumed FIFO, one per tick, with a bounded backlog.

Also ruled out by measurement: replay path asymmetry. The A/B harness shows `stepMovement` alone
reproduces the full `MatchDirector.step()` **exactly** (0 m over 640 ticks, 1.9 mm with six actors),
and `physics.step()` makes no difference.

Also tried and reverted: raising the position tolerance. It moved the rate only 22->17/s while making
the system blind to genuine errors.

### Prediction accuracy

| Scenario | Corrections/s | Typical error |
| --- | --- | --- |
| Before | 20-22 | 0.05-0.37 m |
| Solo client, no peers | 4 | 0.098 m |
| Multi-client, open space | 3 | 0.054 m |
| Multi-client, players in contact | 22 | 0.23 m |

### Known issue

The residual 22/s for players in physical contact is actor-vs-actor collision divergence: the client
predicts against interpolated peer positions, the server against live ones. Diagnosed with evidence;
fix described in NEXT_TASK.md.

---

## [0.5.0] - 2026-07-31 - Phase 4: multiplayer validation

### Added

- **`net/NetClient.ts`** - the client half of the session. Packs inputs, drives prediction and
  reconciliation, samples remote actors through the interpolator, tracks RTT/jitter/loss.
- **`net/LagCompensation.ts`** - server rewind with a 250 ms cap, impossible-movement rejection, and
  guaranteed restoration via `finally`.
- **`ui/hud/NetOverlay.tsx`** - developer network overlay on **F3** (off / compact / full): ping,
  latency graph, jitter, packet loss, server and client tick, snapshot delay, interpolation buffer,
  prediction error, reconciliation count, bandwidth, and authority warnings.
- **`scripts/netTest.ts`** - headless multi-client validation harness driving real `NetClient`s over
  real WebSockets against a real server. `npm run nettest`.
- **`Game` network mode** - `offline` or `client`; connected clients no longer simulate their own
  bots, and remote actors are positioned from the interpolator each frame.
- **`MatchDirector.ensureReplicatedActor`** - materialises an actor for a server-assigned id.

### Fixed

- **Clients never created remote players.** `NetClient` skipped snapshot entries for unknown actor
  ids, so every peer was invisible. Found immediately by the new multi-client harness - this was the
  single bug that made multiplayer non-functional.
- **Disconnected players were never removed** from surviving clients' worlds.
- **`WebSocketTransport` used `window` timers**, so it could not run under Node.
- **The server compared client tick numbers against its own clock.** Two 64 Hz clocks free-running
  from different origins meant inputs were consumed systematically early or late. Client ticks are
  now treated as opaque monotonic sequence numbers.

### Verified

3 clients, real WebSockets, 8 s match: all connected, all see all peers, 175-190 snapshots each with
**0 dropped**, ping 2-4 ms, peer divergence 1-25 mm, 1.1 KB/s down / 2.6 KB/s up per client,
disconnect cleanup confirmed. `tsc --noEmit` and `vite build` clean.

### Known issue

Prediction correction rate is **14-21/s** where it should be near zero on a LAN (typical error
0.05-0.24 m). Three candidate causes were tested and rejected. Diagnosis and next steps in
NETWORK_ARCHITECTURE.md; this is the top production blocker.

---

## [0.4.0] — 2026-07-31 — Phase 3: multiplayer foundation

### Added — networking

- **Wire protocol** (`net/protocol.ts`) — versioned, with message enums, kick reasons, input bit
  flags, actor field masks and quantisation constants. A mismatched build is rejected at handshake
  rather than desynchronising three minutes into a match.
- **Binary serialization** (`net/serialize.ts`) — byte-aligned reader/writer with varints and bounds
  checking on every read. Deliberately not bit-packed: the ~15% saving is not worth making every
  layout change a debugging exercise.
- **Snapshots with delta compression** (`net/snapshot.ts`) — 16-bit field mask per actor, encoded
  against the newest baseline the client acknowledged, with explicit removals and a ring-buffer
  history that serves delta baselines, interpolation and lag-compensation rewind at once.
- **Transport abstraction** (`net/Transport.ts`) — `LocalTransport` (in-process pair, with optional
  simulated latency and loss) and `WebSocketTransport` (exponential backoff with jitter, so a server
  restart does not bring every client back in lockstep). Single-player runs the network path.
- **Client prediction and reconciliation** (`net/Reconciler.ts`) — input recording by tick, replay of
  unacknowledged frames against authoritative state, correction carried as a decaying camera offset
  rather than an actor snap.
- **Interpolation, extrapolation, lag compensation** (`net/Interpolator.ts`) — adaptive delay driven
  by measured jitter, bounded dead reckoning, and snapshot rewind for fair hit registration.
- **Authoritative server session** (`net/NetServer.ts`) — transport-agnostic, runs the same
  `MatchDirector`, handles handshake, input bundles, team switching, timeouts, bandwidth sampling.
- **Dedicated server** (`server/index.ts`) — Node entry over `ws`. `npm run server`.
- **Server-side validation** (`net/Validation.ts`) — rate limiting, input sanitisation, fire-rate
  checks, and post-simulation outcome validation against what the movement rules physically permit.
  Violations accrue strikes that decay with good behaviour, so a laggy client is not slowly kicked
  for being laggy.

### Added — match systems

- **Game mode strategy** (`gameplay/modes/`) — all seven competitive modes implemented: Team
  Deathmatch, Free For All, Capture the Flag, King of the Hill, Domination, Elimination, Last Team
  Standing, plus Training and Bot Practice.
- **Match lifecycle** (`gameplay/MatchFlow.ts`) — lobby → warmup → countdown → active → sudden death
  → ended → scoreboard → lobby, owned by the simulation and replicated to clients.
- **Team balancing** (`gameplay/TeamBalance.ts`) — headcount first, rating second; nobody moved
  mid-match; when a move is needed it is the most recently connected unlocked player.
- **Statistics, MVP and XP** (`gameplay/Statistics.ts`) — accuracy, damage, shield damage, streaks,
  time alive, objective score, weighted MVP and participation-weighted XP.
- **`dev/netProbe.ts`** — encode/decode round-trip validation with bandwidth measurement.
- **`util/env.ts`** — environment detection that works under both Vite and Node.

### Fixed

- **`import.meta.env` broke the dedicated server.** It is a Vite injection that does not exist under
  Node; the server booted, baked navigation, then died constructing the match. Shared modules now go
  through `util/env.ts`. Documented as a standing rule in ARCHITECTURE.md.
- **A neutral spawn was buried by the dark room's north wall** — caught by spawn validation on the
  server's first boot, and fixed in the arena data rather than left to the safety net.

### Verified

- Snapshot round trip **lossless**: max position error 1.88 mm against a 1.95 mm quantisation step.
- Bandwidth measured: 6 players 84 B per delta (13.4 kbit/s per client); 16 players (8v8) 204 B per
  delta (32.6 kbit/s per client).
- Dedicated server boots under Node, bakes the identical 2271-node navigation graph in 73 ms, and
  runs the match loop at 27 MB heap.
- `tsc --noEmit` and `vite build` clean.

---

## [0.3.0] — 2026-07-31 — Phase 2 vertical slice

### Added

- **Trigger volumes** (`gameplay/TriggerSystem.ts`). Axis-aligned volumes with per-tick occupancy,
  per-team counts, controlling team, contested flag and hold time, plus enter/exit edges derived by
  diffing against last tick. Built automatically from each arena's `objectives`. This is the shared
  primitive behind the objective tracker, powered doors, and the capture/hold scoring M2 needs.
- **Bot hearing.** Firing emits a noise with a 42 m audible radius; footsteps emit 9 m walking,
  17 m sprinting. Bots gained an `investigate` behaviour-tree branch between `search` and `roam`.
  Hearing writes a *separate* heard-position rather than the sight-memory, so a bot walks toward
  gunfire and clears the corner but can never shoot at something it has not actually seen.
- **Staircases.** `buildStairs()` emits a flight whose risers stay under the controller's autostep
  height, so climbing needs no jump and the navigation bake links them like any other surface. Two
  flights added, giving each half of the arena a slower, more contested ascent than the ramps.
- **Dark room.** An enclosed, roofed, lightless wing off the west maze, lit only by ankle-height
  glow strips.
- **Per-surface audio.** Colliders now carry their `SurfaceKind`, so footsteps and impacts know what
  they hit. Catwalk grating rings metallic, glass ticks, floor thuds.
- **Ricochets.** Grazing impacts (incidence < 0.55) on hard surfaces play a descending whistle.
- **Ambient arena bed.** Continuous 50 Hz mains hum with a detuned partner for slow beating, plus
  filtered noise for air handling.
- **Countdown callouts** at 60/30/10/5/3/2/1 seconds, driven by a table rather than per-line flags.
- **HUD objective tracker** reading the central room's trigger volume — neutral, held, or contested,
  with occupant count and hold time.
- **HUD notification stack** with good/bad/info tones, wired to tag confirmations and being tagged.
- **`config/lighting.ts`** — single source of truth for scene lighting constants.

### Fixed

- **The lighting probe was validating fiction.** It kept its own copies of the ambient and exposure
  values rather than reading the scene's, and the two drifted immediately: a rebalance that cut
  ambient by 3× measured as having *no effect at all*. Both now read `config/lighting.ts`. A
  validator that does not measure what the game actually renders is worse than no validator.
- **Staircases climbed to nowhere.** The first flight ran from the catwalk ring *up* toward the
  arena centre, so it terminated in mid-air over the ground floor. Direction reversed.
- **Perimeter railings sealed the staircases out**, exactly as they had previously severed the
  ramps. The rail builder now takes a list of openings per side rather than a single ramp position.
- **Global fill was masking level design.** Ambient dropped from 1.35 to 0.42 and hemisphere from
  0.9 to 0.3, so unlit spaces can actually fall off.

### Verified

- 60 s bot match: **0.423 ms/tick**, 150 shots, 715 noise events, 565 footsteps, 14 tags.
- Footsteps reported varied surfaces (floor, ramp, barrier); impacts reported six distinct surfaces.
- Stair path climbs 0 → 1.8 → 3.4 → 5.0; navigation 2271 nodes, 95% reachable from spawn.
- Lighting probe "good" at spawn, centre, open floor, maze, upper deck, stairs and dark room.
- `tsc --noEmit` and `vite build` clean.

### Known limitation

A *genuinely* dark room is not achievable with the current lighting model. Roofing the room helped
(0.275 → 0.219 mean luminance against 0.284 on the open floor), and with image-based lighting
disabled the gap is clearer (0.097 vs 0.144) — but ambient and IBL are global terms that no geometry
occludes. Real darkness needs baked ambient occlusion or per-zone light probes, which is an M4
art-pass item. Today the room is meaningfully dimmer, not dark.

---

## [0.2.0] — 2026-07-31 — Arena visibility + interactive environment

### Fixed — the arena was invisible

Reported as "can not see the arena". Five independent causes, none of which raised an error:

- **Every spawn point faced the wall behind it.** Red spawned at (−25, −25) with yaw 45°, whose
  forward vector is (−0.707, −0.707) — straight into the corner, a metre away. All corner and
  neutral spawns were rotated 180° from the play space. Replaced hand-written angles with a shared
  `facingCentre()` helper using the project's `atan2(-d.x, -d.z)` convention.
- **No environment map.** `MeshStandardMaterial` with `metalness > 0` draws most of its colour from
  reflected environment light; with `scene.environment` unset the reflective floors and catwalks
  sampled pure black. Added `ArenaEnvironment`, prefiltering Three's bundled `RoomEnvironment` into
  a PMREM cube. Measured effect on scene luminance: **0.170 → 0.378**.
- **Light intensities were in legacy units.** Three has been physically-based since r155;
  illuminance is `intensity / d²`. Fixtures at intensity 20–40 produced ~0.05. Rebalanced to
  130–620 and documented the unit on `LightSpec`.
- **The ceiling occluded the key light.** A 60 × 60 slab at y = 9 cast a shadow over the entire
  arena. Added a `noShadow` brush flag, threaded through the render batching, and set it on the
  ceiling.
- **Near-black albedo left nothing for tone mapping.** Raised the palette into the mid-dark range,
  lifted ambient to 1.35 and hemisphere to 0.9, raised `toneMappingExposure` to 1.35, and thinned
  fog density from 0.012 to 0.007.

### Added

- **Interactive environment layer.** New `PropSpec` arena data plus `PropSystem` (simulated) and
  `ArenaProps` (render-clock). Arena 01 gains 26 props: four powered doors on the objective room
  with real moving collision, four energy gates at the ramp mouths, four extraction fans, five
  pulsing beacons, four match-clock displays bound to the live timer, scrolling perimeter signage,
  and four ambient machines.
- **`PhysicsWorld.createKinematicBox` / `setKinematicPosition`** for moving level geometry.
- **`src/dev/lightingProbe.ts`** — offscreen luminance validation for arenas. Renders from a given
  eye pose, reads pixels back, reports mean/median/percentiles/black fraction and a verdict.
  DEV-only and lazily imported, so it stays out of the production bundle. Exposed as
  `__PHOTON__.probeLighting(position, yaw, pitch, options)`.
- **`RendererStats`** — publishes draw calls and triangle counts into the engine; the HUD
  performance readout now shows draw calls alongside FPS and simulation time.

### Changed

- `Brush` gains `noShadow`; render batches key on it so shadow-casting can differ per batch.
- `ArenaDefinition` gains `props`.
- `LightSpec.intensity` documented as physical units.

### Verified

- Lighting probe verdict "good" with 0% black pixels at all four corner spawns, arena centre, upper
  deck and maze corridors.
- Doors: closed at start, only the approached door opens, full 4 m travel, closes on departure.
- 60 s bot match with props: 0.775 ms/tick, 106 shots, 106 impacts, 9 kills.
- `tsc --noEmit` and `vite build` clean.

---

## [0.1.0] — 2026-07-31 — M1 Playable Core

First playable build. Engine, physics, movement, weapons, combat, Arena 01, bots, HUD, audio,
post-processing, settings and accessibility. Full system inventory in
[ROADMAP.md](./ROADMAP.md).

### Fixed during M1 verification

Ten defects found by measuring the running build rather than by inspection. The severe ones:

- Rapier's `queryPipeline` was never updated — **every raycast in the game returned null**.
- Character capsules omitted `PROJECTILE` from their collision filter — **every bolt passed through
  every player**.
- `body.setTranslation()` does not propagate to colliders until `world.step()`, so mid-tick capsule
  resizes were evaluated at the previous transform.
- A grounded character with zero downward velocity reads as airborne, so the flag oscillated every
  other tick — breaking coyote time and cancelling slides after one tick.
- A* used an inadmissible heuristic and no closed set; long routes reported unreachable.
- Unbroken railings and roof lips severed the entire upper deck from the ground floor.
- Behavior-tree `Sequence` memory skipped condition guards, crashing on a dead target.

Full list in [ROADMAP.md](./ROADMAP.md).
