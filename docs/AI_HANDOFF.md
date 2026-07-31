# AI Handoff

**Read this first if you are an AI agent picking up Project Photon.** It is the shortest path to
being useful without re-deriving what has already been settled.

Keep it current after every milestone.

---

## Where the project is

Pre-alpha. Playable end to end against bots, validated across three networked clients over real
WebSockets. Not yet validated above three clients — see Known Issues.

**Current sprint:** playtest-driven stabilisation. Observe → Measure → Fix → Play Again. No new
gameplay systems unless a playtest identifies a blocker that needs one.

**The exact next task is in [NEXT_TASK.md](./NEXT_TASK.md).** Do that unless told otherwise.

## The one rule

**The simulation is headless, deterministic and fixed-step at 64 Hz.**

`MatchDirector.step(dt)` is the entire game. It reads `MatchState` plus one `InputFrame` per actor,
mutates that state and the Rapier world, and emits events. It imports **nothing** from `render/`,
`ui/`, React or Three.js.

Everything else is an input source feeding it, or a presentation layer reading it. This is what
allows the identical simulation to run on a Node server, and what makes client prediction's replay
trustworthy. If you are about to import a renderer type into `gameplay/`, stop.

Consequences you must respect:

- No `Math.random()` in the simulation — use the seeded `Rng` in `util/rng.ts`.
- No `import.meta.env` in shared code — it does not exist under Node. Use `util/env.ts`.
- `dt` is always `1/64`. Nothing gameplay-relevant reads `requestAnimationFrame` delta.
- Presentation state (view bob, FX) lives on `Actor.fx` and is written by the sim, read by renderers.

## Architecture at a glance

```
peripherals ─┐
bot brains  ─┼─► InputFrame ─► MatchDirector.step() ─► MatchState ─► renderers / HUD
network     ─┘                        │
                                      └─► EventBus ─► audio, FX, rumble
```

Directory map is in the [README](../README.md#repository-layout). Deeper detail:
[ARCHITECTURE.md](./ARCHITECTURE.md) and [NETWORK_ARCHITECTURE.md](./NETWORK_ARCHITECTURE.md).

## Traps that have already cost this project time

Do not rediscover these.

**Physics (Rapier)**
- `queryPipeline` is only rebuilt by `world.step()`. Anything querying before the first step sees an
  empty acceleration structure — this once made *every raycast in the game* return null.
- Setting a body's translation does not move its collider until `world.step()`. `PhysicsWorld` has a
  dirty flag and calls `propagateModifiedBodyPositionsToColliders()` before any query.
- Collision filtering is **symmetric**. Both sides must accept the other. Character capsules once
  omitted `PROJECTILE` and every bolt passed through every player, silently.
- A grounded character needs a downward push *every tick*; `computedGrounded()` reports on motion
  resolved this tick, so a tick with zero downward velocity reads as airborne.

**Rendering**
- Metals need an environment map. `metalness > 0` with no `scene.environment` samples pure black.
- Light intensity is physical: illuminance ≈ `intensity / d²`. Values under ~100 for a ceiling
  fixture render as black.
- Emissive is **not scale-invariant**. A value tuned on a wall 10 m away blows out on a view model
  0.4 m from the eye. This made the weapon a glowing slab that covered the crosshair.
- Arena-spanning geometry must not cast shadows (`noShadow` on the brush) or it shadows everything.
- `EffectComposer` resets `gl.info` between passes. `info.autoReset` is disabled and
  `RendererStats` resets once per frame; do not re-enable it.

**Networking**
- Reconciliation must compare the server's result against the client's **stored prediction for that
  same tick**, never against the client's current position. The client legitimately runs ~3 ticks
  ahead; measuring that lead as error corrects on every snapshot.
- The server must consume **every** input, FIFO, one per tick. Skipping inputs the client already
  predicted with causes permanent accumulating drift.
- Client tick numbers are opaque monotonic sequence numbers, not timestamps.

**Level design**
- Any barrier crossing where a ramp, staircase or bridge meets a deck needs an opening, or headroom
  drops below crouch height and the navigation bake correctly severs the floor. This has been
  introduced twice. Add the opening in the same commit as the route.

## Known issues

Ranked. Full detail in [PROJECT_STATUS.md](./PROJECT_STATUS.md).

1. **Network runs above 3 clients fail.** Server is healthy and transmitting; clients receive and
   send nothing. Leading hypothesis is the harness co-locating full game clients in one Node event
   loop. **Unresolved — blocks all scaling figures.**
2. **120 FPS target is unmeasurable** — display is vsync-capped at 60. Frame time sits at exactly
   1/60 s, so "60 FPS" means hitting the cap, not the limit.
3. **Prediction corrections not re-measured** after actor collision was removed.
4. **Lag compensation implemented but never called** by `ProjectileSystem`.
5. Draw calls dominated by 137 unbatched prop and avatar meshes vs 21 instanced.
6. Listen server, objective-aware bots, multiplayer UI, spectator and replay all outstanding.

## Commands

```bash
npm install            # Node 20+
npm run dev            # client on 127.0.0.1:5180
npm run validate       # typecheck + lint + test + build — run before claiming done
npm run test
npm run server -- --port 8090 --bots 0
npm run nettest -- --port 8090 --clients 3 --seconds 8
npm run predict-ab     # prediction replay fidelity, no server needed
```

## How to work on this

**Validate by running it, not by reasoning about it.** This project spent six phases with every
automated check green while the weapon covered the crosshair and the game could not be aimed. The
two highest-value changes in its history were both to *instruments* — making the renderer visible,
and fixing a broken draw-call counter — not to the game.

Concretely:

1. Read `NEXT_TASK.md`, do that task.
2. Prefer measurement over argument. There are harnesses for lighting, netcode, prediction and
   multi-client behaviour; use them, and add one when a question has no instrument.
3. Run the game and look at it. Every playtest so far has produced findings.
4. `npm run validate` before claiming anything is done.
5. Update `PROJECT_STATUS.md`, `CHANGELOG.md` and `NEXT_TASK.md`. Append to `SESSION_LOG.md` with
   decisions taken and anything that misled you — the log exists so the next agent does not repeat
   an investigation.

**Report honestly.** If a measurement is a projection, say so. If three hypotheses failed, say so
and stop guessing — build the diagnostic instead. Several entries in the session log are records of
being wrong, and they are the most useful parts of it.

**Do not** rebuild working systems, restructure into a monorepo (see the README's rationale), or
add rendering features whose cost has not been measured.
