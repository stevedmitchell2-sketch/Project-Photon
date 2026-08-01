# Changelog

Newest first. Each entry is scoped to what a reviewer would need to know.

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
