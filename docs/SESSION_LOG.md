# Session Log

Chronological record of development sessions. Newest last. The purpose is continuity: what was
attempted, what was learned, and what a future session should not repeat.

---






## Session 18 - 2026-08-01 - Sprint 12: the asset pipeline

**Brief:** build a production asset pipeline. Registry, validation, importer, modular kit spec, hero
weapon spec, character pipeline, material system, decals, VFX, tooling, art bible expansion, external
toolchain, content roadmap, documentation.

**Outcome:** Parts A, B, C, D, E, H, J, K and L delivered. Parts F (decals) and G (VFX) are specified
in the contract but have no implementation. Part I (art bible expansion) partially - the new
documents cover most of its scope but ART_DIRECTION itself was not restructured.

### The design decision that mattered

Photon defines a **contract, not a format**. The runtime reads named nodes inside standard glTF
rather than a bespoke file type, because a custom format needs a custom exporter and that locks
content creation to whoever wrote the exporter. Node naming works out of any tool that can name an
object - including generative ones, which the brief explicitly asked to prepare for.

### The proof

The clearest demonstration that the pipeline works is that **the procedural rifle now follows the
asset contract too**. Its primitive meshes are named `PART_core`, `SOCKET_muzzle` and so on, and it
scans its own subtree with the same function the importer uses. The animation addresses parts by name
and cannot tell which source it is driving.

That is the standard every other system should be brought to, and it is what makes "drop in a .glb"
literally true rather than aspirational.

### The thing worth recording

The audit tool found a real specification error **on its first run, before a single asset existed** -
the manifest declared six material zones against a budget of five. The budget was what was wrong: two
of a weapon's zones animate and cannot share a cached material.

Building the checker before the content is the cheapest possible time to find that a rule is wrong.

## Session 17 — 2026-08-01 — Sprint 11: Art Direction Alpha

**Brief:** replace graybox presentation with production-quality visual identity — modular environment
kit, material library, hero weapon, player redesign, venue buildout, storytelling, lighting pass,
effects pass, performance, art bible.

**Outcome:** Parts B (materials), C (hero weapon) and K (art bible) delivered. Part G partially, as
a consequence of the material work. Parts A, D, E, F, H not delivered.

### What happened

Two things were achievable in code and were done properly: a material library with procedural
surface detail, and the hero weapon.

The material library is the higher-leverage of the two because it touches every surface. It also
produced the sprint's most useful lesson twice over. Roughness maps *multiply* — the first textures
were drawn at mid-grey, which halved every material's roughness and turned the arena into
semi-polished plastic. And the arena was already lit for a specific material response, so a pass
using physically nicer metalness values cost the scene its contrast. The texture variation was the
win; the lighting response had been right all along.

### The thing worth recording

This is the sprint where the ceiling of procedural art stopped being theoretical. The rifle went from
eight boxes to about thirty parts with genuinely good proportions, materials and state-driven
animation — and it still reads as well-proportioned primitives rather than a modelled object,
because what is missing is surface density: bevels, panel gaps, edge wear, cable runs.

No amount of procedural cleverness substitutes for an artist's pass. The user reached the same
conclusion independently before this sprint started, and it is now recorded in ART_DIRECTION.md
section 10 with the architectural preparation that makes the swap cheap.

# Session Log

Chronological record of development sessions. Newest last. The purpose is continuity: what was
attempted, what was learned, and what a future session should not repeat.

---





## Session 16 â€” 2026-08-01 â€” Sprint 10: The Living Arena

**Brief:** fix the bot engage branch with a short measured loop, build the venue, add environment
atmosphere, make the arena reactive, polish audio, measure everything, playtest, document.

**Outcome:** Parts A, B, D, F, G and H delivered. Part C â€” environment atmosphere â€” not delivered.
Part E untouched this sprint.

### The bot fix took seven iterations and produced a map requirement

Root cause was two literals: the standoff band lived inside `combatMovement` as "close above 22 m,
retreat below 7 m", whose equilibrium is exactly 7 m. `engageRange` had only ever gated acquisition.

The interesting part was the second-order effect. Moving preferred range into the profile inverted
the difficulty ladder, because aim error is an *angle* â€” the old degrees were monotonic, and while
every bot fought at the same 7 m they were monotonic in metres too. Spread across differing ranges
they all landed near three body half-widths and `hard` bots became measurably safer to fight than
`medium`. Deriving degrees from a target miss radius at each bot's own range fixed it.

Then five more iterations failed to separate the four difficulties, and the reason turned out not to
be tuning at all: **Arena 01 stops offering sight lines beyond about 10 m**, so bots preferring 15 m
and 19 m converged on the same achieved range and spent the fight repositioning instead of shooting.
Preferred ranges are now capped at what the building delivers, difficulty is two tiers rather than
four, and the fix for that is a longer arena.

That is the first *useful negative result* the project has produced â€” a finding that redirects
design rather than repairing code.

### The venue cost 3.19 ms and then cost nothing

The LED boards measured at 3.19 ms of a 12.8 ms frame while adding only four draw calls. That
mismatch is the whole diagnosis: cost with no draw calls behind it is upload cost. Four scrolling
signs were clearing a canvas, rasterising text and uploading 256 KB every frame. Rasterising once
and scrolling the texture offset took the entire venue to âˆ’0.23 ms, within noise.

### The thing worth remembering

Two of this sprint's three findings came from a *number that did not fit its neighbours* rather than
from anything visibly wrong: a difficulty ladder that ordered backwards, and a GPU cost with no draw
calls under it. Neither would have failed a test or looked wrong in a screenshot.

## Session 15 â€” 2026-08-01 â€” Sprint 9: The Identity Sprint

**Brief:** combat feel at 7 m, team colour identity, arena presentation, environment FX, audio pass,
rendering optimisation, player experience review, a visual style guide, documentation.

**Outcome:** Parts A, B, F, H and I delivered. Part E delivered in part (objective callouts,
match-end sting; the engine already had weapon, impact, footstep, ricochet and music coverage from
earlier sprints). Parts C and D â€” arena presentation and environment FX â€” not delivered.

### What happened

The first sprint in four where the brief's premise survived contact with measurement. The brief said
tune combat around 7 m; 7 m was real, and the tuning worked. That is what it looks like when the
measurement infrastructure has caught up with the ambition.

Combat: the geometry at 7 m said the bolt needed a 45 cm lead against a strafing player â€” larger
than a body half-width â€” and that five bolts to kill from a six-shot cell left no margin at a
measured 35% accuracy. Raised bolt speed, raised capacity, tightened sustained spread. The audit
immediately caught that this had helped the bots too and undone the Sprint 8 rebalance, so damage
came down to pay for it, and time-to-kill landed within 1% of where Sprint 8 had put it.

Identity: the arena now carries team colour and reports who holds the middle. Built deliberately
from emissive geometry rather than lights, because Sprint 8 measured the frame fragment-bound â€”
eight coloured point lights would have cost more than the whole post-processing chain. Measured
interleaved at 0.59 ms.

### The thing worth remembering

Two first passes were wrong in ways only looking caught:

1. The territory ring put a third of itself inside the perimeter wall â€” a 15 m radius from a corner
   spawn at (-25, -25) reaches x = -40 in a map that stops at -30. Clipped to bounds.
2. The objective callout fired 17 times in 120 s, half of them "lost" immediately followed by
   "held", because control flickers every time a player crosses the volume. Fixed with an asymmetric
   debounce: taking a room is decisive, losing one usually is not.

Neither would have shown up in a typecheck, a test, or a screenshot taken from the wrong place.

## Session 14 â€” 2026-08-01 â€” Sprint 8: Gameplay & Presentation

**Brief:** spawn system 2.0 as priority one, then visual identity, laser presentation, HUD 2.0, team
identity, arena atmosphere, performance to 120 FPS, gameplay review, telemetry, refactoring, docs.

**Outcome:** Parts A, G, H and K delivered. Part D delivered in part (crosshair, charge ring, team
accents). Parts B, C, E, F largely not delivered. Part I partially â€” the audit is new telemetry, but
no new recorded fields beyond it.

### What actually happened

Priority one was "make spawning intelligent and fair". The first thing built was a harness to
measure whether it was unfair, and it was not: the median spawn put the nearest enemy 30 m away,
none within 15 m, 2% with line of sight. **The system the brief asked to rebuild was already
working.** The ten-second death was the default bot difficulty, which shot like a good human.

That is the third consecutive sprint where the reported symptom was right and the reported cause was
wrong, and the second where the planned fix would have been aimed at an innocent system.

The other half of the sprint went to the frame-timing instrument, open since Sprint 4. Building it
inverted the project understanding of its own renderer within about a minute of first running: the
CPU is idle at 1.4â€“1.9 ms, the GPU is at 12.0â€“12.5 ms, and the frame is fragment-bound. **Draw calls
were never the constraint**, which means two sprints of batching work was optimising the wrong axis.

### The thing worth remembering

Two false performance findings were caught before they reached a document:

1. A 3 ms "saving" from lowering bloom intensity, which evaporated to âˆ’0.08 ms once the A/B was
   interleaved rather than sequential â€” GPU time turns out to be strongly view-dependent.
2. A catastrophic-looking regression (4 FPS, GPU 28 ms) that was a degraded WebGL context after a
   dozen in-tab reloads. The giveaway was **simulation time** rising 10Ã—, which no graphics change
   can cause.

Both would have been plausible in a report. Neither was true.

### The other thing worth remembering

The brief asked for 120 FPS. It is not achievable at current settings â€” closing the gap needs a 32%
cut, roughly renderScale 0.6. That was reported as a measured "no" rather than met by quietly
dropping resolution.

## Session 13 â€” 2026-08-01 â€” Sprint 7: Closed Alpha Stabilisation

**Brief:** resolve the disconnect/stale-state bug, complete latency validation 20-250 ms, finish the
process-per-client harness, play the game, and begin the visual foundation. 60-70% engineering,
30-40% presentation.

**Outcome:** Part A complete in full. Part C complete. Part D complete. Part B substantially
incomplete â€” two items of roughly forty. Part E complete.

### What actually happened

The sprint was supposed to close one known bug and then move to visuals. Reproducing the bug took
twenty minutes and the root cause turned out to have nothing to do with the server; chasing its
consequences surfaced three more production defects, each of which had been sitting behind a
misdiagnosis. That consumed the engineering budget and most of the presentation budget with it.

Four production bugs found and fixed:

1. **Actor identity never adopted** â€” the disconnect/stale-state bug, and also the "4-client limit"
   and the "8-client limit". Clients kept two notions of themselves and merged neither.
2. **Server-side RTT never measured** â€” a ping handler waiting for a second sight of a sequence
   number that clients only ever send once. Lag compensation had never worked.
3. **Team balance passed `botsPerTeam` as `maxPerTeam`** â€” every player forced onto red on any
   botless server, where friendly fire is off, so nobody could damage anybody.
4. **`kick()` leaked actors** â€” every timeout left an abandoned player in the arena permanently.

Three hypotheses about the residual prediction corrections were eliminated with measurements, two of
them previously recorded as leading candidates.

### The thing worth remembering

The light-shaft work was done against a misdiagnosis. A screenshot showed large bright shapes
dominating the frame centre; they were assumed to be the volumetric cones, which were fixed. Playing
the game afterwards showed the dominant artefact is bloom off the emissive fixtures, and the cones
were the faint grey wedges. The fix is correct and worth keeping â€” it addresses a real backlog item â€”
but it was aimed by inference rather than by observation, which is exactly the failure mode the
project's own working philosophy exists to prevent.

**When something looks wrong on screen, play it before fixing it.**

### The other thing worth remembering

Client scaling has now been reported as 4, then 8, then 16. Every earlier number was a measurement
fault. Three sprints, three "the server has a limit" findings, three client-side causes.

## Session 1 â€” 2026-07-31 â€” M1 Playable Core

**Entered with:** an empty directory and a full production brief.

### What happened

Wrote the production plan, then built the whole M1 vertical slice: engine, physics facade, movement,
weapons, combat, navigation, bots, arena, audio, render layer, HUD and menus.

The valuable half of the session was verification. Because the browser pane never composited, drove
the simulation headlessly through a DEV-only `window.__PHOTON__` handle and a `stepTicks()` method,
then measured behaviour directly. That found **ten defects**, several of which would have looked
like "the game is just broken" to a player and none of which typechecking or a build could catch â€”
including every raycast returning null, and every bolt passing through every player.

### Decisions taken

- **The simulation is headless, deterministic and fixed-step at 64 Hz.** `MatchDirector.step(dt)`
  is the entire game and imports nothing from React or Three.js. Everything else follows from this;
  it is what makes M5's authoritative server a redeployment rather than a rewrite.
- **Arenas are data.** Brushes, lights, spawns, objectives and reverb zones are typed records, so
  the M6 map editor reads and writes exactly what the arena files already contain.
- **Navigation is baked from the built collision world**, never authored. Hand-placed waypoints
  drift the moment a designer moves a wall.
- **Audio is fully synthesised.** No asset pipeline while the gameplay is still moving, and the
  mixer graph is the one authored assets will slot into later.
- **Bots are input sources.** A bot produces the same `InputFrame` a keyboard does and runs the same
  movement and weapon code, so it cannot cheat by construction.

### Traps worth remembering

- Rapier's query pipeline is only rebuilt by `world.step()`. Anything querying before the first step
  â€” arena construction, navigation baking â€” sees an empty acceleration structure.
- Rapier's collision filtering is symmetric: both sides must accept the other.
- Behaviour-tree sequences with memory skip their condition guards on resume. Guarded branches need
  a reactive sequence.

---

## Session 2 â€” 2026-07-31 â€” Visibility fix + interactive environment

**Entered with:** M1 complete but visually unconfirmed. User feedback: *"game needs huge graphical
upgrades can not see the arena"*, followed mid-session by the Phase 2 vertical-slice brief.

### What happened

Diagnosed "can't see the arena" as five stacked causes, only one of which was really a graphics
problem. The first was a gameplay bug: **every spawn faced the wall behind it**. Corner spawns were
rotated 180Â°, so the player opened on a wall a metre from their face. That alone reads as "the
arena didn't load".

The remaining four were genuine lighting faults, and the important lesson is that **none of them
raised an error**. Metals sampling a missing environment map, light intensities written in the
pre-r155 unit scale, an arena-spanning ceiling occluding the key light, and near-black albedo under
ACES all fail silently and identically: a black screen.

Because the browser pane in this environment never composites â€” React Three Fiber won't mount a
scene until it measures a non-zero canvas â€” screenshots were unavailable for the whole session.
Rather than guess, built `src/dev/lightingProbe.ts`: an offscreen renderer that reads pixels back
and reports luminance statistics with a verdict. That turned an unverifiable visual question into a
number, and it proved the environment-map diagnosis directly (0.170 without IBL â†’ 0.378 with).

Then implemented the interactive environment layer from the Phase 2 brief, split by cost: doors are
simulated because their colliders change routes and sightlines; everything else animates from the
render clock and costs the tick budget nothing.

### Decisions taken

- **Validate lighting numerically, not by eye.** The probe stays in the repo as the gate every new
  arena passes before it is called done. Arenas 02â€“04 will need it.
- **Props split by gameplay impact.** Simulated props must be deterministic and serializable (one
  byte per door); decorative props must never touch the tick.
- **Doors are kinematic bodies, not teleporting statics**, so the character controller resolves
  against them as moving obstacles.
- **Phase 2 brief handled as extension, not rebuild.** Most of its checklist shipped in M1;
  re-implementing it would have thrown away verified work. Coverage mapped in PROJECT_STATUS.md.

### Traps worth remembering

- A PowerShell `Get-Content | Set-Content` round-trip mangled UTF-8 em dashes into mojibake. Use
  the Edit tool or Python with explicit encoding for source files on Windows.
- `RAPIER.QueryPipeline.intersectionWithShape` returns a collider handle whose numeric value can be
  `0` for the first collider created â€” check `=== null`, never truthiness.

### Left undone

Nobody has looked at a rendered frame. That is the first task next session and is written up as
step 0 of NEXT_TASK.md.

---

## Session 3 â€” 2026-07-31 â€” Phase 2 vertical slice

**Entered with:** the arena visible at last, interactive props in, and a Phase 2 brief asking for a
polished playable slice.

### What happened

Most of the Phase 2 checklist had already shipped in M1, so the work was the genuinely missing
pieces rather than a rebuild: trigger volumes, staircases, a dark room, per-surface audio,
ricochets, an ambient bed, countdown callouts, bot hearing, and the HUD objective tracker and
notification stack.

The most useful thing built was **trigger volumes**, because three separate features wanted the same
primitive â€” objective occupancy, door proximity, and the capture/hold scoring M2 needs. Building it
once as a first-class system rather than three times as ad-hoc distance checks is what makes M2 a
scoring problem instead of a plumbing problem.

**Bot hearing** was the biggest believability win for the effort. The important decision was keeping
it on a separate channel from sight: hearing writes its own position and drives its own `investigate`
branch, and never unlocks firing. A bot now walks toward gunfire and clears the corner, but cannot
shoot at something it has not seen.

### The mistake worth remembering

The lighting probe built last session **was validating fiction.** It kept its own copies of the
ambient and exposure values instead of reading the scene's. When the global fill was cut by 3Ã— to
let the dark room actually fall off, the probe reported *no change whatsoever* â€” because it was
still rendering with the old numbers. The measurement looked authoritative and was meaningless.

Both now read `config/lighting.ts`. A validator that does not measure what the game actually renders
is worse than having none, because it manufactures confidence. Worth checking any time a tool and
the thing it measures both need the same constant.

Chasing that also produced a genuine finding: ambient and IBL are global and cannot be occluded, so
a sealed, roofed, unlit room still bottoms out near 75% of open-floor brightness. Real darkness needs
baked AO or per-zone probes. That is now written down as an M4 item rather than something to keep
throwing geometry at.

### Also worth remembering

The railing-seals-the-route bug was introduced a **second time**, now for the staircases, exactly as
it had been for the ramps. The rail builder takes an explicit list of openings per side; anything
arriving at an unlisted point gets walled out and the navigation bake correctly severs the deck.
ARCHITECTURE.md now says: when adding a route onto the ring, add its opening in the same commit.

And the first pair of staircases ran from the ring *up* toward the arena centre, terminating in
mid-air over the ground floor. Always check which end of a flight is the low one.

### Left undone

Still nobody has looked at a rendered frame. That remains step 0 of NEXT_TASK.md.

---

## Session 4 â€” 2026-07-31 â€” Phase 3: multiplayer foundation

**Entered with:** a polished single-player vertical slice and a brief asking for authoritative-server
multiplayer.

### What happened

This was the milestone the whole architecture was built for. The headless deterministic simulation
and the `InputFrame` abstraction existed from session 1 specifically so `MatchDirector.step()` could
run on a server unchanged â€” and it did. `server/index.ts` constructs physics, an arena and a match
and runs the identical simulation under Node. Nothing in `gameplay/`, `ai/`, `physics/` or `maps/`
needed a single change.

Built the netcode core properly rather than sketching all twelve subsystems in the brief thinly:
protocol, binary serialization, delta-compressed snapshots, transport abstraction, prediction,
reconciliation, interpolation, lag compensation, validation, and the server session. Then the match
systems that depend on them: the mode strategy interface with all seven modes, the lifecycle state
machine, team balancing, and statistics/MVP/XP.

### Decisions taken

- **Clients send intent, never state.** No message carries a position, health or score upward. This
  is structural rather than policy, and it deletes the whole "edit memory and win" cheat class.
- **Single-player runs the network path** through `LocalTransport`. It costs offline play some
  serialization it does not need, and buys exercising replication on every playthrough. Given that
  serialization bugs do not throw â€” they quietly desynchronise â€” that is the right trade.
- **Corrections move the camera, not the actor.** The actor snaps to server truth instantly so
  shooting stays consistent; the camera pays the discrepancy off over ~80 ms. Beyond 2.5 m the snap
  is shown honestly, because hiding a large desync looks worse than admitting it.
- **Mode-specific state lives on the mode, not on `Actor`.** `Actor` replicates every snapshot, so
  putting CTF carrier state there would tax the six modes that never use it.

### The trap worth remembering

`import.meta.env` is a **Vite injection that does not exist under Node**. The dedicated server
booted, baked navigation successfully, then died constructing the match â€” because `resolveSpawns`
read `import.meta.env.DEV`. Shared modules now go through `util/env.ts`.

This is the exact failure the headless-simulation rule exists to prevent, and it slipped in anyway
because in a browser it is invisible. Worth grepping for whenever a shared module gains a debug
branch.

### Also worth noting

The server's first successful boot immediately reported a buried spawn â€” the dark room added last
session walls off a neutral spawn point. A validator written in session 2 caught a regression
introduced in session 3, on a code path nobody had ever run. Fixed in the arena data rather than
left to the safety net.

### Left undone

Substantial parts of the Phase 3 brief are foundation-only or not started: the client-side
`NetClient`, multiplayer UI (lobby, ready, team select, end-of-match), spectator mode, the replay
framework, and voice/chat. All are listed in NEXT_TASK.md with the reasoning for the ordering.

And still â€” nobody has looked at a rendered frame.

---

## Session 5 â€” 2026-07-31 â€” Phase 4: multiplayer validation

**Entered with:** a complete server half and a NEXT_TASK that said the client half was the one thing
blocking everything else.

### What happened

Wrote `NetClient`, wired it into `Game`, added lag compensation and the F3 network overlay â€” then
built `scripts/netTest.ts`, which drives real `NetClient` instances over real WebSockets against a
real server with no renderer involved.

**The harness paid for itself on its first run.** It immediately found that `NetClient` skipped
snapshot entries for unknown actor ids â€” so clients never created representations of remote players
and every peer was invisible. That is the single bug that made multiplayer non-functional, and no
amount of typechecking or code reading had surfaced it across two sessions. It also found that
disconnected players were never removed from surviving clients' worlds.

After fixing those: three clients, all connected, all seeing each other, 175â€“190 snapshots each with
zero dropped, peer position divergence of 1â€“25 mm, and clean disconnect handling.

### The thing I could not fix

Prediction correction rate sits at 14â€“21/s where it should be near zero on a LAN, with a typical
error of 0.05â€“0.24 m.

I tested three hypotheses and rejected all of them:
- quantisation noise â€” far too small to explain 0.25 m
- position tolerance set below the noise floor â€” raising it to 0.16 m moved the rate only from 22/s
  to 17/s, and made the system blind to real errors, so I reverted it
- client/server tick-clock coupling in `dequeueInput` â€” genuinely wrong and now fixed (client ticks
  are opaque sequence numbers, not timestamps), but it made no material difference

The remaining suspects are that the reconciler replays `stepMovement` alone while the live path runs
the full `MatchDirector.step()` with a physics step between ticks, and that actor-vs-actor collision
means replay resolves against interpolated rather than authoritative peer positions.

**I stopped guessing at that point.** Three failed hypotheses is the signal to build an A/B harness
that runs an identical input sequence through both paths and diffs per tick, rather than continue
changing constants and re-measuring. Written up as the top production blocker.

### Worth remembering

- **Test harnesses must be paced like real clients.** The first version drove ticks as fast as the
  loop allowed, sent ~570 input packets/second, and was correctly kicked by the server's flood
  protection. The rate limiter working is not the same as the thing under test working.
- A validator built two sessions ago (spawn validation) caught a regression introduced one session
  ago, on a code path nobody had ever run, the first time the server booted. Cheap invariant checks
  keep paying out long after you write them.

### Left undone

Large parts of the Phase 4 brief: multiplayer UI, spectator mode, replay, objective-aware bots,
stress testing above 3 clients, and the polish pass. The netcode had to be proven working first, and
it now is â€” with one known quality issue.

And still, five sessions in, nobody has looked at a rendered frame.

---

## Session 6 â€” 2026-07-31 â€” Phase 5: prediction validated

**Entered with:** a Phase 5 brief covering both remaining alpha blockers and a full next-generation
visual overhaul, and a NEXT_TASK that named the prediction correction rate as the top blocker with a
specific instruction: build the A/B harness, stop guessing.

### What happened

Built `scripts/predictionAB.ts` and it paid off immediately â€” by **exonerating** the thing I most
suspected. The reconciler's replay path reproduces the full live simulation *exactly*: 0 m
divergence over 640 ticks with no other actors, 1.9 mm with six. `physics.step()` makes no
difference. Both of my remaining hypotheses were wrong.

That left the inputs and the comparison itself, and there were two real bugs there:

1. **Reconciliation compared across time.** It measured the client's *current* position against the
   server's *older* snapshot. At 20 Hz the client legitimately runs ~3 ticks ahead, which at sprint
   speed is ~0.4 m of entirely correct lead â€” and the observed error was 0.22â€“0.37 m. The number had
   been staring at me for two sessions and I had read it as noise rather than as a signal that I was
   measuring the wrong quantity.
2. **The server was skipping inputs.** `dequeueInput` took the newest queued frame and discarded the
   rest, so anything arriving while the server sat between ticks was never simulated even though the
   client had already predicted with it. Worse: I *introduced* this last session while trying to fix
   the very same symptom.

Correction rate went from 20â€“22/s to 3â€“4/s, with error down from 0.37 m to 0.054 m.

### The lesson

Five hypotheses were tested across three sessions. The four that were wrong all shared a shape: they
assumed the *simulation* was misbehaving. The two that were right were both about **what was being
compared, and when**. When a measurement looks like noise, check that it is measuring the quantity
you think it is before attributing it to the system under test.

Also: build the diagnostic earlier. The A/B harness took twenty minutes and settled in one run a
question that three sessions of reasoning had not.

### Track B not attempted

The brief asks for a next-generation visual overhaul â€” WebGPU, SSR, TAA, PBR conversion, volumetrics,
new VFX and animation. I did not start it, deliberately. Six sessions in, **nobody has looked at a
rendered frame**; the pane in this environment never composites, so React Three Fiber never mounts.
Rewriting the rendering pipeline blind, on top of visuals that have never been seen, would be
building on an unverified foundation and would make any resulting problem far harder to isolate.
That ordering argument is in NEXT_TASK.md.

### Left undone

Lag compensation is still not wired to projectiles. Stress testing above 3 clients, multiplayer UI,
objective-aware bots, spectator, replay and the listen-server path are all untouched from Phase 4.

---

## Session 7 â€” 2026-07-31 â€” Phase 6: the game was finally seen

**Entered with:** a Phase 6 brief whose Priority 1 was "play the game", and six sessions of
accumulated warnings that nobody ever had.

### What happened

The browser pane composited. After six phases of numeric-only verification, the game was visible.

Within two screenshots it was clear the game was **unplayable**, for a reason no automated check
could ever have reported: the first-person weapon is authored at life size and sat 0.42 m from a
95Â° camera, so it occupied a quarter of the viewport and completely covered the crosshair. Alongside
it, the view model's emissive values â€” tuned as though it were world geometry â€” blew out under bloom
into a featureless glowing slab, and the volumetric light shafts were 13 m wide cones that filled
the screen from anywhere on the deck.

Three blockers, all fixed this session. Four more issues found and documented but not fixed,
including one that is quietly informative: an idle player is shoved across the arena and killed by
bots walking through them, which is the *same* actor-collision problem that has been producing the
residual network prediction corrections for two phases. One fix now resolves both.

### The lesson, stated plainly

Every automated check was green the entire time the weapon was covering the crosshair. The
typechecker, the production build, the lighting probe (reporting "good" exposure), the netcode probe
(lossless round trip), and the three-client network test (0 dropped snapshots, millimetre
divergence) all passed â€” while the game could not be aimed.

Those checks were not wasted; they caught real bugs that inspection never would have, several of
which would have been agony to find later. But they validate the questions you thought to ask.
Looking at the thing asks all of them at once.

I flagged this gap at the end of every phase from 2 onwards and kept building anyway. The right call
would have been to treat "cannot see the output" as a blocking environmental problem in Phase 2 and
spend the effort on getting a view, rather than compounding six phases of work on an unobserved
foundation. Deferring the visual overhaul in Phase 5 was correct for exactly this reason; deferring
the *look* itself for as long as I did was not.

### Left undone

Priorities 3-8 of the Phase 6 brief: lag compensation wiring, large stress tests, listen server,
objective-aware bots, multiplayer UI, and the visual overhaul proper. Priority 1 consumed the
session, which was the right allocation â€” the findings changed what the rest of the roadmap should
be.

---

## Session 8 â€” 2026-07-31 â€” Phase 7: the loop, running

**Entered with:** a brief that adopted Observe â†’ Measure â†’ Fix â†’ Play Again as the working
philosophy, and my own Phase 7 ordering from last session.

### What happened

Executed the three top items, then played again to verify â€” which is the whole point.

All three fixes confirmed by observation rather than by reasoning: the player now spawns at 6/6
charge instead of 4/6 (the lock-acquiring click was firing), an idle player now holds its spawn
instead of being shoved across the arena and killed by bots pathing through it, and the performance
overlay reports real draw calls instead of "1".

That third one mattered more than it looked. **The instrument was broken, so the thing it measured
could not be investigated.** Once fixed, it immediately surfaced two bottlenecks that no amount of
reasoning had found: 20 live point lights against a configured cap of 8 (impact flashes, prop
beacons and the muzzle light were all outside the budget, and every lit surface evaluates every
light), and 137 unbatched prop/avatar meshes against 21 instanced. Triangle count â€” the thing one
instinctively optimises â€” is 12.6k and completely irrelevant.

Reducing the light count took draw calls 167 â†’ 110.

### Two things I could not settle

**The 120 FPS target is unmeasurable here.** Frame time is 16.7 ms, which is exactly 1/60 s. The
display is vsync-capped, so "60 FPS" means "hitting the cap" and says nothing about headroom. I have
recorded that rather than reporting 60 FPS as though it were a limit, because treating a cap as a
measurement is how false performance confidence starts.

**Network runs above three clients fail.** The server is provably healthy â€” it accepts all eight
connections, and transmits at 48.4 KB/s with snapshot sizes growing 39 â†’ 151 â†’ 283 B exactly as
delta compression predicts. But `rx = 0.0 KB/s`: no client sends anything, and none receives
anything. The leading hypothesis is that the harness co-locates eight *complete* game clients (each
with its own physics world, navigation bake and 64 Hz simulation) in a single Node event loop and
starves socket I/O â€” which would produce precisely this signature. That is a hypothesis, not a
finding, and I have written it up as unresolved rather than shipping an 8v8 "PASS".

### Worth keeping

**Fix the measurement before optimising the thing being measured.** Two sessions running, the most
valuable single change has been to an instrument rather than to the game.

### Left undone

Priorities 4â€“9: lag compensation wiring, listen server, objective-aware bots, multiplayer UI, and
the visual polish pass. The 16-client run has still never been attempted.

---

## Session 9 â€” 2026-07-31 â€” Repository and production restructure

**Entered with:** a brief to reorganise into a professional monorepo with `apps/` and ten
`packages/`, adaptable "if a different structure better fits the existing implementation".

### The structure decision

I did not do the monorepo split, and that was the main judgement call of the session.

The codebase is 78 files and ~17k lines, already separated along exactly the seams the proposed
packages would use â€” `gameplay`, `net`, `render`, `ai`, `physics`, `ui`, `audio`, `config`, `util`.
Splitting it would have meant ten build configurations, rewriting every import path away from the
`@/` alias, and putting a verified netcode path at risk, in exchange for organisation that pays off
at a scale this project is nowhere near. I recorded the trigger for revisiting it â€” a second
application needing to share `gameplay` and `net` â€” in the README rather than leaving it as an
unexplained omission.

### What was actually missing

The survey that informed that decision also found the real gap: **zero tests**, in a project with
16.7k lines and a netcode layer whose failures are silent by nature. Vitest had been installed
since the first session and never used.

Wrote 29 tests aimed specifically at code that has broken before: serialization round-trip and
bounds checking, quantisation error bounds, RNG determinism and state restore, the look/basis
conventions behind the spawn-facing bug that shipped twice, and snapshot delta compression including
baseline eviction. All pass. They would have caught at least two historical bugs.

Also: lint found only three errors across 78 files, which is a reasonable signal about the state of
the code.

### Also done

Git initialised and pushed to a private GitHub repo, CI with a dedicated netcode job that stands up
a real server and runs three clients against it, ESLint/Prettier/EditorConfig, issue and PR
templates that ask for measurements rather than adjectives, and `AI_HANDOFF.md` â€” which front-loads
the traps that have cost this project time so the next agent does not rediscover them.

### On visibility

The brief said to create the repo and push. It did not say public or private, and the README
declares all rights reserved. Publishing source is difficult to walk back once indexed, so I asked
rather than assuming, and created it private on the user's answer.

---

## Session 10 â€” 2026-07-31 â€” Networking sprint

**Entered with:** a full-sprint brief and my own NEXT_TASK naming the 4+ client failure as priority
one. Chose the Networking + Prediction grouping the brief lists as a cohesive example.

### What happened

The 4+ client failure was **not** the harness event-loop saturation I had hypothesised for two
sessions. It was `NetClient.connect()` resolving on socket-open rather than on the server's
handshake acknowledgement. Callers treated the session as ready before it had an actor id, and
`sendInput` correctly refused to transmit â€” so clients sat there connected, receiving snapshots and
sending nothing. Four clients now pass where they previously failed outright.

Then wired lag compensation into live projectile resolution. It had been implemented, tested and
documented for two phases without a single caller â€” bolts were still resolving against present-tick
positions. Bolts are now grouped by owner so the world is rewound once per shooter, and each shooter
is rewound by their own measured RTT rather than an average. Bots are exempt: they have no latency,
so rewinding them would only add error.

Added the telemetry layer as Photon Director groundwork. The design constraint I held to is that it
is a **sink, not a system** â€” nothing reads telemetry back into gameplay, because that would make it
part of the simulation and break determinism. It is wired through the existing event bus rather than
by calls inside systems, so adding a metric never means editing a gameplay file.

### A correction to a previous claim

Phase 7 confidently attributed the 22/s prediction correction rate to actor-vs-actor collision, and
removed actor collision on that basis. **The rate did not change.** That attribution was wrong, and
I have said so in the changelog, roadmap and status rather than letting it stand.

Removing actor collision was still the right call for a different reason â€” an idle player was being
shoved across the arena and killed â€” but it did not fix what I claimed it would.

That makes five hypotheses tested and rejected on this one problem. I have stopped proposing new
ones and written the next step as *instrument a single correction end to end*: capture the
acknowledged tick, the stored prediction, the server position, the replayed inputs and the result.
One real example will settle it.

### Worth remembering

Two sessions running, the bug was in the *harness or the plumbing*, not the system under test. The
8-client failure looked like a server scaling limit and was a client-side promise resolving too
early. Before concluding that a system does not scale, check that the thing measuring it is honest.

### Left undone

8-client runs still fail. Lag compensation is live but only exercised at ~1 ms RTT, where rewind is
a no-op â€” it needs a 20-250 ms sweep before it can be called validated.

---

## Session 11 â€” 2026-07-31 â€” Sprint 5: prediction drift root cause

**Entered with:** a vertical-slice brief spanning eleven steps, and my own NEXT_TASK naming
prediction-correction instrumentation as priority one. Step 2 of the brief asked for exactly that,
so the two agreed.

### What happened

Found the cause by **reading the server tick loop** rather than by hypothesising again. When no input
was available for a client on a given tick, the server re-simulated with that client's previous
input â€” advancing the actor by a movement step the client never predicted. Two 64 Hz clocks that are
not phase-locked starve constantly, so this was continuous systematic drift, and the arithmetic
matched: one starved tick at sprint speed is 0.13 m against observed errors of 0.05â€“0.37 m.

Then instrumented it before fixing it, which was the right order â€” the correlation was decisive:
3.4% starvation on the client correcting at 2/s, 12.3% and 19.7% on the two correcting at 22/s.

Two fixes: starved actors hold position rather than replaying stale input, and a two-tick jitter
buffer primes a cushion before the server starts consuming. Starvation fell roughly threefold.

### What this makes six

Six hypotheses have now been examined for this one defect. Four were wrong, and **two of those were
previously reported as fixes** â€” the actor-collision attribution in Phase 7, and the tick-clock
coupling in Phase 4. Both are corrected in the docs.

The lesson I would keep: I found this one by reading the loop line by line, having exhausted the
things that were plausible from a distance. Five rounds of reasoning about the symptom produced
nothing; twenty minutes of reading the code that actually runs produced it immediately.

### It is not finished

Corrections are still 2 / 22 / 22, and the shape changed: bimodal rather than continuous, with 22/s
being exactly the snapshot rate. Two clients correct on every single snapshot; one almost never
does. Starvation reduction did not move them, so something structural separates those clients â€” most
likely that two of the harness's movement patterns run into walls while one sprints through open
floor, and collide-and-slide amplifies sub-quantisation differences. That is written up as a
specific, falsifiable test rather than a seventh guess.

### Scope

The brief asked for eleven steps, of which this reached three: repository review, network
stabilisation, and telemetry groundwork. First-person feel, weapon polish, HUD, match flow and
visual polish were not touched.

I chose depth over breadth deliberately. The brief said to prefer finishing one subsystem completely
over touching ten, and prediction drift was the item blocking confidence in everything built on top
of it. Polishing the feel of a game whose movement disagrees with its server on every snapshot would
have been decorating an unresolved fault.

---

## Session 12 â€” 2026-07-31 â€” Sprint 6: two hypotheses disproven

**Entered with:** a validation brief demanding measurement over estimation, and my own NEXT_TASK
naming the geometry hypothesis as item one.

### What happened

Built the scenario support the geometry test needed, ran it, and **disproved my own hypothesis**.
With identical inputs, identical open-floor environment and near-identical distance travelled, the
correction rate stayed stubbornly bimodal: 0 / 22 / 22. Geometry is not the cause.

Then added lookup-miss instrumentation to test a second idea â€” that the "perfect" client might not
be accurate at all, merely never evaluating. That was also wrong: 176 comparisons, 1 miss. It really
does agree with the server.

### The finding that mattered

While running scenarios back to back I noticed the failures had a shape I had been blind to: **every
failing run was a second run against the same server process.** Every first run passed.

Tested it directly â€” 8 clients as the first run on a fresh server: **PASS**, 179â€“192 snapshots each,
zero dropped, every client seeing all seven peers.

So the "8-client scaling limit" that three sprints of documentation described does not exist. The
real defect is stale server state after a client generation disconnects. I had run the 8-client test
three times across three sessions and never once run it first.

That is a lesson about experimental hygiene rather than about netcode: I varied the thing I was
interested in and left the server process uncontrolled, so a confound sat in every measurement.
Fresh state per trial should have been the default from the first run.

### Scope, honestly

The brief had eight steps. I reached three: geometry validation, client scaling, and the technical
debt and documentation passes. **The latency sweep, playability review and rendering optimisation
were not done** â€” the two hypotheses consumed the budget, and I would rather report two solid
disproofs than four thin gestures.

Sprint 6's exit criteria are therefore only partly met, and I have said so rather than declaring the
sprint complete.

### Corrected in the docs

"Maximum stable client count: 4" is now "at least 8". The scaling-limit framing is removed from
NETWORK_BENCHMARK, PROJECT_STATUS and BACKLOG, and replaced with the disconnect bug.
