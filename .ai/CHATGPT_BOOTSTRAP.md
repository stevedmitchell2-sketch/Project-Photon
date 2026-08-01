# ChatGPT Bootstrap — Project Photon

Paste this file into a fresh ChatGPT session to bring it up to speed. It is deliberately
self-contained: assume the model has never seen this repository.

For Claude Code or any agent with repository access, prefer [`docs/AI_HANDOFF.md`](../docs/AI_HANDOFF.md)
— it is fuller and links out. This file is the standalone version.

---

## What this is

**Project Photon** — a first-person laser tag arena shooter that runs in the browser, with
authoritative-server multiplayer. TypeScript, React Three Fiber (Three.js), Rapier physics, Zustand,
Vite. Node + `ws` for the dedicated server. Vitest for tests.

Pre-alpha. Playable end to end against bots. Validated across three networked clients.

Repository: `Project-Photon` (private). Default branch `main`.

## The one architectural rule

**The simulation is headless, deterministic, and fixed-step at 64 Hz.**

`MatchDirector.step(dt)` is the entire game. It reads `MatchState` plus one `InputFrame` per actor,
mutates that state and the Rapier world, and emits events. It imports **nothing** from `render/`,
`ui/`, React, or Three.js.

Everything else is either an input source feeding it (peripherals, bot brains, network) or a
presentation layer reading it (renderers, HUD, audio).

This is what lets the identical simulation run on a Node dedicated server, and what makes client
prediction's replay trustworthy. Violating it breaks both.

Concrete consequences:
- No `Math.random()` in the simulation — use the seeded `Rng` in `util/rng.ts`.
- No `import.meta.env` in shared code — it does not exist under Node. Use `util/env.ts`.
- `dt` is always `1/64`. Nothing gameplay-relevant reads `requestAnimationFrame` delta.
- Presentation-only state lives on `Actor.fx`, written by the sim and read by renderers.

## Layout

```
src/
  engine/     Fixed-step loop, event bus, object pools, Game orchestration
  gameplay/   Simulation: movement, weapons, projectiles, combat, spawns, triggers, props,
              match flow, team balance, statistics, modes/
  ai/         Navigation graph, behaviour trees, bot brains, difficulty profiles
  physics/    Rapier facade (PhysicsWorld), collision layers
  net/        Protocol, serialization, snapshots, transports, prediction, NetServer/NetClient,
              lag compensation, validation
  render/     R3F scene, instanced arena, FX, view model, post-processing
  ui/         HUD, menus, network overlay
  maps/       Arena data format, builder, arena01_classic, spawn validation
  audio/      Fully synthesised spatial audio engine
  config/     Typed design data: teams, weapons, movement, modes, graphics, lighting, combat
  util/       Math, seeded RNG, environment detection
  dev/        DEV-only probes (lighting, netcode)
server/       Dedicated server entry point
scripts/      Validation harnesses (netTest, predictionAB)
tests/        Vitest unit + integration
docs/         All documentation
```

The layout is flat by deliberate decision — ~17k lines across 78 files, already separated along the
seams a package split would use. Revisit `apps/` + `packages/` when a second application (editor,
launcher) needs to share `gameplay` and `net`.

## Commands

```bash
npm install                                       # Node 20+
npm run dev                                       # client on 127.0.0.1:5180
npm run validate                                  # typecheck + lint + test + build
npm run server -- --port 8090 --bots 0            # dedicated server
npm run nettest -- --port 8090 --clients 3        # multi-client integration test
npm run predict-ab                                # prediction replay fidelity, no server needed
```

In a dev build the running game is `window.__PHOTON__`:

```js
__PHOTON__.stepTicks(64)                          // advance one second of simulation
__PHOTON__.probeLighting({x:0,y:2,z:0}, 0, 0)     // offscreen luminance report
__PHOTON__.probeNet()                             // snapshot round-trip + bandwidth
```

## Traps already paid for — do not rediscover

**Physics (Rapier)**
- `queryPipeline` is only rebuilt by `world.step()`. Querying before the first step sees an empty
  structure — this once made *every raycast in the game* return null.
- Setting a body's translation does not move its collider until `world.step()`. `PhysicsWorld`
  tracks a dirty flag and calls `propagateModifiedBodyPositionsToColliders()` before any query.
- Collision filtering is **symmetric** — both sides must accept the other. Character capsules once
  omitted `PROJECTILE`, and every bolt passed through every player, silently.
- A grounded character needs a downward push *every tick*; `computedGrounded()` reports on motion
  resolved this tick, so a tick with no downward velocity reads as airborne.
- Actors deliberately do **not** collide with each other (see `layers.ts` for why).

**Rendering**
- Metals need an environment map. `metalness > 0` with no `scene.environment` samples pure black.
- Light intensity is physical: illuminance ≈ `intensity / d²`. Under ~100 for a ceiling fixture is
  black.
- Emissive is **not scale-invariant**. A value tuned on a wall 10 m away blows out on a view model
  0.4 m from the eye — this made the weapon a glowing slab covering the crosshair for six phases.
- Arena-spanning geometry must not cast shadows (`noShadow` on the brush).
- `EffectComposer` resets `gl.info` between passes; `info.autoReset` is disabled deliberately.

**Networking**
- Reconciliation compares the server's result against the client's **stored prediction for that same
  tick** — never against the client's current position. The client legitimately runs ~3 ticks ahead.
- The server consumes **every** input, FIFO, one per tick. Skipping inputs the client already
  predicted with causes permanent accumulating drift.
- Client tick numbers are opaque monotonic sequence numbers, not timestamps.

**Level design**
- Any barrier crossing where a ramp, staircase or bridge meets a deck needs an opening, or headroom
  drops below crouch height and the navigation bake correctly severs the floor. Introduced twice.

## Known issues

Ranked. Authoritative list is `docs/PROJECT_STATUS.md`.

1. Network runs above 3 clients fail — server healthy and transmitting, clients receive nothing.
   Leading hypothesis is the test harness, not the server. **Blocks all scaling figures.**
2. 120 FPS target unmeasurable — display is vsync-capped at 60; frame time sits at exactly 1/60 s.
3. Draw calls dominated by 137 unbatched prop and avatar meshes vs 21 instanced.
4. Listen server, objective-aware bots, multiplayer UI, spectator, replay all outstanding.

## How to be useful here

1. Read `docs/NEXT_TASK.md`. Do that task.
2. **Prefer measurement over argument.** There are harnesses for lighting, netcode, prediction and
   multi-client behaviour. Use them; add one when a question has no instrument.
3. **Run the game and look at it.** Every playtest so far has produced findings that no automated
   check caught.
4. `npm run validate` before claiming anything is done.
5. Update `PROJECT_STATUS.md`, `CHANGELOG.md`, `NEXT_TASK.md`; append to `SESSION_LOG.md` including
   anything that misled you.

**Report honestly.** If a number is a projection, say so. If several hypotheses failed, say so and
build a diagnostic rather than guessing again. The most useful entries in the session log are
records of being wrong.

**Do not** rebuild working systems, restructure into a monorepo, or add rendering features whose
cost has not been measured.
