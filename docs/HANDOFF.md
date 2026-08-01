# Handoff

For a person or agent picking up Project Photon cold. Read this, then
[NEXT_TASK.md](./NEXT_TASK.md), then start.

Companions: [VISUAL_STYLE_GUIDE.md](./VISUAL_STYLE_GUIDE.md) is the authority on anything that gets
drawn; [AI_HANDOFF.md](./AI_HANDOFF.md) covers conventions and the reasoning behind the
architecture; [`.ai/CHATGPT_BOOTSTRAP.md`](../.ai/CHATGPT_BOOTSTRAP.md) is the compressed version for
a fresh model context. This file is the current state of play.

---

## What Photon is

A browser-based first-person laser tag arena shooter with authoritative-server multiplayer. One
arena, seven modes, bots, a full HUD, synthesised spatial audio, and a dedicated Node server running
the identical simulation the browser runs.

## The one rule everything depends on

**The simulation is headless and deterministic at a fixed 64 Hz.** `MatchDirector.step(dt)` imports
nothing from React or Three.js. Nothing in `gameplay/`, `ai/`, `physics/`, `maps/`, `net/` or
`input/` may import from `render/`, `ui/` or `state/`.

That rule is why the dedicated server exists at all: `server/index.ts` constructs physics, an arena
and a `MatchDirector` and runs the same code the client runs, and not one line of the simulation
needed changing to run under Node. It is also why client-side prediction is trustworthy — replaying
an input on the client produces bit-identical output to the server, verified by
`scripts/predictionAB.ts`.

If you find yourself wanting to import a renderer type into a gameplay file, that is the design
telling you the logic belongs somewhere else.

Related invariants:

- **No `Math.random()` in simulation.** Use `util/rng.ts` (seeded xoshiro128\*\*).
- **No `import.meta.env` outside `util/env.ts`.** It does not exist under Node and will break the
  server.
- **Clients send intent, never state.** A client that decided its own health would be the first
  thing any cheat tool patched.

## Getting it running

```bash
npm install --legacy-peer-deps
npm run dev                      # browser client on :5180
npm run server -- --port 8090 --bots 0
npm run validate                 # typecheck + lint + 46 tests + build
```

`--legacy-peer-deps` is required (ESLint 9 against an older plugin peer range). Known debt.

## The measurement tools, and why they matter more than usual here

| Command | Answers |
| --- | --- |
| `npm run nettest -- --port 8090 --clients 3` | Does replication work end to end over real sockets? |
| `npm run latency-sweep -- --seconds 20` | What happens to prediction, hit registration and bandwidth from 0 to 250 ms? |
| `npm run latency-sweep -- --lagcomp off` | Control condition: what does lag compensation actually buy? |
| `npm run predict-align -- --latency 150` | Is reconciliation comparing a prediction against the server state for the *same* tick? |
| `npm run scale -- --clients 16` | Client count, CPU, memory, bandwidth, process-per-client. |
| `npm run predict-ab` | Is the replay path bit-identical to the live path? |
| `npm run spawn-audit -- --seconds 180 --bots 6` | How long does a life last, and what ends it? Separates spawn placement from bot skill from time-to-kill. |

**Read this before trusting any measurement in this repository.** Five sprints running, the
highest-value change has been to an instrument rather than to a game system:

- the renderer was invisible because every spawn faced a wall;
- the draw-call counter was reset by the post-processing chain;
- `connect()` resolved on socket-open, so clients were "connected" and sending nothing;
- the server re-simulated stale input on starved ticks;
- frames-per-second could never have answered the 120 FPS question, because vsync pins it;
- **server-side RTT was never measured at all**, so lag compensation did nothing;
- **clients never adopted their server-assigned actor id**, so any server whose counter had advanced
  past 1 broke them.

The client-count limit has been reported as 4, then 8, then 16. All three earlier numbers were
measurement faults. When a system looks broken, check the instrument first.

And the corollary Sprint 7 added: **when something looks wrong on screen, play it before fixing it.**
The light shafts were diagnosed from a screenshot, fixed, and then found not to have been the
problem.

## Where things stand

### Solid

- Simulation, movement, weapon, combat, scoring, match flow, respawn.
- Arena 01 with two floors, ramps, staircases, catwalks, interactive props.
- Navigation baked from real collision geometry; bots patrol, engage, retreat, investigate noises.
- **Multiplayer: 16 concurrent clients, 0 dropped snapshots, server at 22% of one core.**
- **Latency validated 0-250 ms.** Tick rate flat, lag compensation measurably working.
- HUD, audio, accessibility, settings.
- 46 tests, clean typecheck, clean lint, clean build.

### Not solid

1. **The arena is static.** Boards and reactive lighting exist; fog, dust, steam, arcs and moving
   fixtures do not, so the venue reads as photographed rather than running.
2. **120 FPS is not achievable.** GPU 10–13 ms against an 8.33 ms budget, CPU idle at 1.4–1.9 ms.
   Fragment-bound. Measured rather than unknown.
3. **Difficulty is two tiers, not four**, and Arena 01's ~10 m sight-line limit is why. A
   range-based ladder needs a longer arena; the weapon's falloff, ADS and lead stay unexercised
   until then.
4. **Free-floating holograms unstarted** — boards are wall-mounted panels only.
5. **Residual prediction corrections** on some clients. Narrowed to a specific, testable
   observation; not a blocker.

### Not started

Arenas 02-04, authored characters, multiplayer UI, spectator, replay, voice, editor tools.

## What to do next

[NEXT_TASK.md](./NEXT_TASK.md) is ordered. The short version: **the arena has a side; now it needs
to be a venue.** Infrastructure is validated, spawning is fair, combat is tuned, team territory
reads, and the frame is measurable. What is missing is the building around it — displays,
scoreboards, branding, environment effects — plus the bot behaviour that pins every fight to 7 m.

Read [VISUAL_STYLE_GUIDE.md](./VISUAL_STYLE_GUIDE.md) before drawing anything.

## Map of the codebase

```
src/
  gameplay/     MatchDirector (the whole simulation), movement, weapons, combat, modes, spawns
  net/          NetServer, NetClient, Reconciler, Interpolator, LagCompensation, snapshot, protocol
  ai/           NavGraph, BotBrain, BehaviorTree
  physics/      PhysicsWorld (Rapier), collision layers
  maps/         Arena definitions, MapBuilder, spawn resolution
  render/       Three.js / R3F — may import from gameplay, never the reverse
  render/TeamIdentity.tsx  Territory, spawn beacons, reactive objective and match-phase lighting
  render/VenueBoards.ts    Content for the arena's LED boards, by binding name
  ui/           React HUD and menus
  engine/       GameLoop, EventBus, ObjectPool, Telemetry
server/         Dedicated server entry point
scripts/        Measurement harnesses; scripts/lib/loopbackSession.ts is shared with tests
tests/          46 tests, unit + integration
docs/           This directory
```

## Conventions that will trip you up otherwise

- **Rapier's query pipeline must be refreshed** before raycasts, and a body's translation does not
  reach its collider until `world.step()`. `PhysicsWorld.refreshQueries()` handles this with a dirty
  flag; if a raycast mysteriously returns null, that is why.
- **Collision filtering is symmetric.** Both sides must include each other's group.
- **`INTERPOLATION_DELAY_MS` in `MatchDirector` must match `Interpolator`'s default.** They are two
  halves of one decision — the client renders that far in the past and the server rewinds by the
  same amount.
- **Engine forward is `(-sin yaw, sin pitch, -cos yaw)`.** Aiming at a point means
  `atan2(-dx, -dz)`, not `atan2(dx, dz)`.
- **Do not use client-side travelled distance as a movement measure.** It sums per-tick position
  deltas, which include correction teleports. One Sprint 7 client reported 130 m of travel where the
  server recorded 46 m.
- **GPU time is view-dependent.** The same preset measured 8.68 ms and 12.43 ms from different
  vantages. Any graphics A/B must be **interleaved** (ABAB), never sequential.
- **Repeated in-tab reloads degrade the WebGL context.** After a dozen reloads the same scene read
  4 FPS with simulation time up 10× — which no graphics setting can affect. Restart the preview. If
  simulation time moves after a rendering change, suspect the browser, not the code.
- **A cost with no draw calls behind it is upload or overdraw, not geometry.** Four scrolling signs
  redrawing a canvas per frame cost 3.19 ms while adding four draw calls. Rasterise once, scroll the
  texture offset.
- **Something must always render.** `RendererStats` runs a positive-priority `useFrame`, which takes
  R3F out of automatic rendering. If you make the `EffectComposer` conditional, provide a fallback
  that renders the scene, or the screen goes black.
- **PowerShell `Get-Content | Set-Content` mangles UTF-8** in this repo. Use the editor tools or
  Python with an explicit encoding.
