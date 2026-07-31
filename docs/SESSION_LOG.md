# Session Log

Chronological record of development sessions. Newest last. The purpose is continuity: what was
attempted, what was learned, and what a future session should not repeat.

---

## Session 1 — 2026-07-31 — M1 Playable Core

**Entered with:** an empty directory and a full production brief.

### What happened

Wrote the production plan, then built the whole M1 vertical slice: engine, physics facade, movement,
weapons, combat, navigation, bots, arena, audio, render layer, HUD and menus.

The valuable half of the session was verification. Because the browser pane never composited, drove
the simulation headlessly through a DEV-only `window.__PHOTON__` handle and a `stepTicks()` method,
then measured behaviour directly. That found **ten defects**, several of which would have looked
like "the game is just broken" to a player and none of which typechecking or a build could catch —
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
  — arena construction, navigation baking — sees an empty acceleration structure.
- Rapier's collision filtering is symmetric: both sides must accept the other.
- Behaviour-tree sequences with memory skip their condition guards on resume. Guarded branches need
  a reactive sequence.

---

## Session 2 — 2026-07-31 — Visibility fix + interactive environment

**Entered with:** M1 complete but visually unconfirmed. User feedback: *"game needs huge graphical
upgrades can not see the arena"*, followed mid-session by the Phase 2 vertical-slice brief.

### What happened

Diagnosed "can't see the arena" as five stacked causes, only one of which was really a graphics
problem. The first was a gameplay bug: **every spawn faced the wall behind it**. Corner spawns were
rotated 180°, so the player opened on a wall a metre from their face. That alone reads as "the
arena didn't load".

The remaining four were genuine lighting faults, and the important lesson is that **none of them
raised an error**. Metals sampling a missing environment map, light intensities written in the
pre-r155 unit scale, an arena-spanning ceiling occluding the key light, and near-black albedo under
ACES all fail silently and identically: a black screen.

Because the browser pane in this environment never composites — React Three Fiber won't mount a
scene until it measures a non-zero canvas — screenshots were unavailable for the whole session.
Rather than guess, built `src/dev/lightingProbe.ts`: an offscreen renderer that reads pixels back
and reports luminance statistics with a verdict. That turned an unverifiable visual question into a
number, and it proved the environment-map diagnosis directly (0.170 without IBL → 0.378 with).

Then implemented the interactive environment layer from the Phase 2 brief, split by cost: doors are
simulated because their colliders change routes and sightlines; everything else animates from the
render clock and costs the tick budget nothing.

### Decisions taken

- **Validate lighting numerically, not by eye.** The probe stays in the repo as the gate every new
  arena passes before it is called done. Arenas 02–04 will need it.
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
  `0` for the first collider created — check `=== null`, never truthiness.

### Left undone

Nobody has looked at a rendered frame. That is the first task next session and is written up as
step 0 of NEXT_TASK.md.

---

## Session 3 — 2026-07-31 — Phase 2 vertical slice

**Entered with:** the arena visible at last, interactive props in, and a Phase 2 brief asking for a
polished playable slice.

### What happened

Most of the Phase 2 checklist had already shipped in M1, so the work was the genuinely missing
pieces rather than a rebuild: trigger volumes, staircases, a dark room, per-surface audio,
ricochets, an ambient bed, countdown callouts, bot hearing, and the HUD objective tracker and
notification stack.

The most useful thing built was **trigger volumes**, because three separate features wanted the same
primitive — objective occupancy, door proximity, and the capture/hold scoring M2 needs. Building it
once as a first-class system rather than three times as ad-hoc distance checks is what makes M2 a
scoring problem instead of a plumbing problem.

**Bot hearing** was the biggest believability win for the effort. The important decision was keeping
it on a separate channel from sight: hearing writes its own position and drives its own `investigate`
branch, and never unlocks firing. A bot now walks toward gunfire and clears the corner, but cannot
shoot at something it has not seen.

### The mistake worth remembering

The lighting probe built last session **was validating fiction.** It kept its own copies of the
ambient and exposure values instead of reading the scene's. When the global fill was cut by 3× to
let the dark room actually fall off, the probe reported *no change whatsoever* — because it was
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

## Session 4 — 2026-07-31 — Phase 3: multiplayer foundation

**Entered with:** a polished single-player vertical slice and a brief asking for authoritative-server
multiplayer.

### What happened

This was the milestone the whole architecture was built for. The headless deterministic simulation
and the `InputFrame` abstraction existed from session 1 specifically so `MatchDirector.step()` could
run on a server unchanged — and it did. `server/index.ts` constructs physics, an arena and a match
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
  serialization bugs do not throw — they quietly desynchronise — that is the right trade.
- **Corrections move the camera, not the actor.** The actor snaps to server truth instantly so
  shooting stays consistent; the camera pays the discrepancy off over ~80 ms. Beyond 2.5 m the snap
  is shown honestly, because hiding a large desync looks worse than admitting it.
- **Mode-specific state lives on the mode, not on `Actor`.** `Actor` replicates every snapshot, so
  putting CTF carrier state there would tax the six modes that never use it.

### The trap worth remembering

`import.meta.env` is a **Vite injection that does not exist under Node**. The dedicated server
booted, baked navigation successfully, then died constructing the match — because `resolveSpawns`
read `import.meta.env.DEV`. Shared modules now go through `util/env.ts`.

This is the exact failure the headless-simulation rule exists to prevent, and it slipped in anyway
because in a browser it is invisible. Worth grepping for whenever a shared module gains a debug
branch.

### Also worth noting

The server's first successful boot immediately reported a buried spawn — the dark room added last
session walls off a neutral spawn point. A validator written in session 2 caught a regression
introduced in session 3, on a code path nobody had ever run. Fixed in the arena data rather than
left to the safety net.

### Left undone

Substantial parts of the Phase 3 brief are foundation-only or not started: the client-side
`NetClient`, multiplayer UI (lobby, ready, team select, end-of-match), spectator mode, the replay
framework, and voice/chat. All are listed in NEXT_TASK.md with the reasoning for the ordering.

And still — nobody has looked at a rendered frame.

---

## Session 5 — 2026-07-31 — Phase 4: multiplayer validation

**Entered with:** a complete server half and a NEXT_TASK that said the client half was the one thing
blocking everything else.

### What happened

Wrote `NetClient`, wired it into `Game`, added lag compensation and the F3 network overlay — then
built `scripts/netTest.ts`, which drives real `NetClient` instances over real WebSockets against a
real server with no renderer involved.

**The harness paid for itself on its first run.** It immediately found that `NetClient` skipped
snapshot entries for unknown actor ids — so clients never created representations of remote players
and every peer was invisible. That is the single bug that made multiplayer non-functional, and no
amount of typechecking or code reading had surfaced it across two sessions. It also found that
disconnected players were never removed from surviving clients' worlds.

After fixing those: three clients, all connected, all seeing each other, 175–190 snapshots each with
zero dropped, peer position divergence of 1–25 mm, and clean disconnect handling.

### The thing I could not fix

Prediction correction rate sits at 14–21/s where it should be near zero on a LAN, with a typical
error of 0.05–0.24 m.

I tested three hypotheses and rejected all of them:
- quantisation noise — far too small to explain 0.25 m
- position tolerance set below the noise floor — raising it to 0.16 m moved the rate only from 22/s
  to 17/s, and made the system blind to real errors, so I reverted it
- client/server tick-clock coupling in `dequeueInput` — genuinely wrong and now fixed (client ticks
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
it now is — with one known quality issue.

And still, five sessions in, nobody has looked at a rendered frame.

---

## Session 6 — 2026-07-31 — Phase 5: prediction validated

**Entered with:** a Phase 5 brief covering both remaining alpha blockers and a full next-generation
visual overhaul, and a NEXT_TASK that named the prediction correction rate as the top blocker with a
specific instruction: build the A/B harness, stop guessing.

### What happened

Built `scripts/predictionAB.ts` and it paid off immediately — by **exonerating** the thing I most
suspected. The reconciler's replay path reproduces the full live simulation *exactly*: 0 m
divergence over 640 ticks with no other actors, 1.9 mm with six. `physics.step()` makes no
difference. Both of my remaining hypotheses were wrong.

That left the inputs and the comparison itself, and there were two real bugs there:

1. **Reconciliation compared across time.** It measured the client's *current* position against the
   server's *older* snapshot. At 20 Hz the client legitimately runs ~3 ticks ahead, which at sprint
   speed is ~0.4 m of entirely correct lead — and the observed error was 0.22–0.37 m. The number had
   been staring at me for two sessions and I had read it as noise rather than as a signal that I was
   measuring the wrong quantity.
2. **The server was skipping inputs.** `dequeueInput` took the newest queued frame and discarded the
   rest, so anything arriving while the server sat between ticks was never simulated even though the
   client had already predicted with it. Worse: I *introduced* this last session while trying to fix
   the very same symptom.

Correction rate went from 20–22/s to 3–4/s, with error down from 0.37 m to 0.054 m.

### The lesson

Five hypotheses were tested across three sessions. The four that were wrong all shared a shape: they
assumed the *simulation* was misbehaving. The two that were right were both about **what was being
compared, and when**. When a measurement looks like noise, check that it is measuring the quantity
you think it is before attributing it to the system under test.

Also: build the diagnostic earlier. The A/B harness took twenty minutes and settled in one run a
question that three sessions of reasoning had not.

### Track B not attempted

The brief asks for a next-generation visual overhaul — WebGPU, SSR, TAA, PBR conversion, volumetrics,
new VFX and animation. I did not start it, deliberately. Six sessions in, **nobody has looked at a
rendered frame**; the pane in this environment never composites, so React Three Fiber never mounts.
Rewriting the rendering pipeline blind, on top of visuals that have never been seen, would be
building on an unverified foundation and would make any resulting problem far harder to isolate.
That ordering argument is in NEXT_TASK.md.

### Left undone

Lag compensation is still not wired to projectiles. Stress testing above 3 clients, multiplayer UI,
objective-aware bots, spectator, replay and the listen-server path are all untouched from Phase 4.

---

## Session 7 — 2026-07-31 — Phase 6: the game was finally seen

**Entered with:** a Phase 6 brief whose Priority 1 was "play the game", and six sessions of
accumulated warnings that nobody ever had.

### What happened

The browser pane composited. After six phases of numeric-only verification, the game was visible.

Within two screenshots it was clear the game was **unplayable**, for a reason no automated check
could ever have reported: the first-person weapon is authored at life size and sat 0.42 m from a
95° camera, so it occupied a quarter of the viewport and completely covered the crosshair. Alongside
it, the view model's emissive values — tuned as though it were world geometry — blew out under bloom
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
divergence) all passed — while the game could not be aimed.

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
session, which was the right allocation — the findings changed what the rest of the roadmap should
be.

---

## Session 8 — 2026-07-31 — Phase 7: the loop, running

**Entered with:** a brief that adopted Observe → Measure → Fix → Play Again as the working
philosophy, and my own Phase 7 ordering from last session.

### What happened

Executed the three top items, then played again to verify — which is the whole point.

All three fixes confirmed by observation rather than by reasoning: the player now spawns at 6/6
charge instead of 4/6 (the lock-acquiring click was firing), an idle player now holds its spawn
instead of being shoved across the arena and killed by bots pathing through it, and the performance
overlay reports real draw calls instead of "1".

That third one mattered more than it looked. **The instrument was broken, so the thing it measured
could not be investigated.** Once fixed, it immediately surfaced two bottlenecks that no amount of
reasoning had found: 20 live point lights against a configured cap of 8 (impact flashes, prop
beacons and the muzzle light were all outside the budget, and every lit surface evaluates every
light), and 137 unbatched prop/avatar meshes against 21 instanced. Triangle count — the thing one
instinctively optimises — is 12.6k and completely irrelevant.

Reducing the light count took draw calls 167 → 110.

### Two things I could not settle

**The 120 FPS target is unmeasurable here.** Frame time is 16.7 ms, which is exactly 1/60 s. The
display is vsync-capped, so "60 FPS" means "hitting the cap" and says nothing about headroom. I have
recorded that rather than reporting 60 FPS as though it were a limit, because treating a cap as a
measurement is how false performance confidence starts.

**Network runs above three clients fail.** The server is provably healthy — it accepts all eight
connections, and transmits at 48.4 KB/s with snapshot sizes growing 39 → 151 → 283 B exactly as
delta compression predicts. But `rx = 0.0 KB/s`: no client sends anything, and none receives
anything. The leading hypothesis is that the harness co-locates eight *complete* game clients (each
with its own physics world, navigation bake and 64 Hz simulation) in a single Node event loop and
starves socket I/O — which would produce precisely this signature. That is a hypothesis, not a
finding, and I have written it up as unresolved rather than shipping an 8v8 "PASS".

### Worth keeping

**Fix the measurement before optimising the thing being measured.** Two sessions running, the most
valuable single change has been to an instrument rather than to the game.

### Left undone

Priorities 4–9: lag compensation wiring, listen server, objective-aware bots, multiplayer UI, and
the visual polish pass. The 16-client run has still never been attempted.

---

## Session 9 — 2026-07-31 — Repository and production restructure

**Entered with:** a brief to reorganise into a professional monorepo with `apps/` and ten
`packages/`, adaptable "if a different structure better fits the existing implementation".

### The structure decision

I did not do the monorepo split, and that was the main judgement call of the session.

The codebase is 78 files and ~17k lines, already separated along exactly the seams the proposed
packages would use — `gameplay`, `net`, `render`, `ai`, `physics`, `ui`, `audio`, `config`, `util`.
Splitting it would have meant ten build configurations, rewriting every import path away from the
`@/` alias, and putting a verified netcode path at risk, in exchange for organisation that pays off
at a scale this project is nowhere near. I recorded the trigger for revisiting it — a second
application needing to share `gameplay` and `net` — in the README rather than leaving it as an
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
templates that ask for measurements rather than adjectives, and `AI_HANDOFF.md` — which front-loads
the traps that have cost this project time so the next agent does not rediscover them.

### On visibility

The brief said to create the repo and push. It did not say public or private, and the README
declares all rights reserved. Publishing source is difficult to walk back once indexed, so I asked
rather than assuming, and created it private on the user's answer.
