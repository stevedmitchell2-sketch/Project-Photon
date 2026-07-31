# Architecture

Companion to [PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md). This describes what exists today and the
invariants that must survive future work.

## The one rule

**The simulation is headless, deterministic, and fixed-step.** `MatchDirector.step(dt)` is the
entire game. It reads `MatchState` plus one `InputFrame` per actor, mutates `MatchState` and the
Rapier world, and emits events. It imports nothing from `render/`, `ui/`, React, or Three.js.

Everything else in the codebase is either an input source feeding it, or a presentation layer
reading it. Keeping that boundary intact is what makes the authoritative server (M5) a matter of
running the same function on Node rather than a rewrite.

```
peripherals ─┐
bot brains  ─┼─► InputFrame ─► MatchDirector.step() ─► MatchState ─► renderers / HUD
network     ─┘                        │
                                      └─► EventBus ─► audio, FX, rumble
```

## Tick order

Ordering inside `step()` is deliberate and load-bearing:

1. **Bot brains** produce input frames. Human input was already written by the input pipeline.
2. **Movement** for every actor, in stable id order.
3. **Weapons** — firing happens after movement so the muzzle is at this tick's position.
4. **Regeneration and respawn timers.**
5. **Projectiles** — swept last, so bolts resolve against where actors actually ended up.
6. **Physics step** for dynamic props.
7. **Killfeed trim.**

## Coordinate and unit conventions

- Metres, seconds, radians. No magic units anywhere in config.
- Yaw 0 looks down **−Z**; positive yaw turns left; positive pitch looks up. `forwardFromLook` and
  `groundBasis` in `util/math.ts` are the only places this is encoded — use them.
- `Actor.position` is the **feet** position. Rapier stores capsule **centres**. `syncBody` in
  `MovementSystem` is the single conversion point. Do not add another.

## Physics gotchas worth knowing

These cost real debugging time and are easy to reintroduce:

- **`queryPipeline` is not automatically current.** It is rebuilt by `world.step()` only. Arena
  construction and the navigation bake both run before the first step, and actors move within a
  tick before projectiles query them. `PhysicsWorld` tracks a dirty flag and lazily calls
  `propagateModifiedBodyPositionsToColliders()` + `queryPipeline.update()` before any query.
- **Setting a body's translation does not move its collider.** Propagation happens inside
  `world.step()`. Without the explicit propagate call above, a capsule that moved or resized this
  tick is still tested at its previous transform.
- **Rapier's interaction filter is symmetric.** Both the query and the collider must accept each
  other. Character capsules must name `PROJECTILE` in their filter or every bolt passes through
  every player, silently.
- **A grounded character needs a downward push every tick.** `computedGrounded()` reports on the
  motion resolved this tick, so a tick with zero downward velocity reads as airborne. The movement
  code re-applies a −2 m/s bias whenever grounded.

## Navigation

`NavGraph` is baked from the built collision world, not authored. It casts down each cell of a
1.5 m grid to find every walkable surface, then links surfaces a character could step between.

- Sampling casts use `GROUP_NAV_QUERY` and `solid = false`, so rays that begin inside a slab report
  the face they exit through and the scan can walk down through catwalks.
- Geometry marked `noNav` in arena data (ceilings, railings, roof lips) is solid but excluded from
  sampling, via the `WORLD_NONAV` collision layer.
- A* uses a closed set and a **consistent** heuristic: horizontal distance plus `0.4 × |Δy|`, the
  cheapest per-metre vertical cost any edge can have. Raising that coefficient makes the heuristic
  inadmissible and A* starts returning failures on long routes.

**Level-design consequence:** any barrier that crosses where a ramp, staircase or bridge meets a
deck must have an opening, or headroom drops below crouch height and the bake correctly refuses to
link across it — severing the upper floor. `segmentsAlong()` in `arena01_classic.ts` builds railings
and roof lips from an explicit list of openings per side. This bug has now been introduced twice:
once for the ramps, once for the staircases. When adding any new route onto the ring, add its
opening in the same commit.

**Staircases** are emitted by `buildStairs()` with risers kept under the character controller's
autostep height, so climbing needs no jump and no special-casing — the bake links them like any
other walkable surface. Check the direction: a flight authored from the ring *up* toward the arena
centre terminates in mid-air, which is how the first pair shipped.

## Lighting — the rules that keep the arena visible

Four independent things each render the arena black. All four were live at once in the first build,
and none of them throws an error. If an arena looks unlit, check these in order:

1. **Metals need an environment map.** `MeshStandardMaterial` with `metalness > 0` takes most of
   its colour from reflected environment light. With `scene.environment` unset, reflective floors
   and catwalks sample pure black regardless of how many lights are present. `ArenaEnvironment`
   prefilters a `RoomEnvironment` into a PMREM cube — no network, no assets. Removing it halves
   scene luminance (measured: 0.378 → 0.170).
2. **Light intensity is in physical units.** Illuminance falls off as `intensity / d²`. A ceiling
   fixture 7 m above the deck needs an intensity in the hundreds. Values in the 20–40 range are
   from the pre-r155 legacy model and land around 0.05 — black.
3. **Arena-spanning geometry must not cast shadows.** The 60 × 60 ceiling slab occluded the key
   light and put every surface below it in full shadow. Brushes carry `noShadow` for this.
4. **Albedo needs headroom under ACES.** Near-black base colours have no tonal separation left
   after tone mapping. Surfaces sit mid-dark, and `toneMappingExposure` runs at 1.35.

**Validate, don't eyeball.** `src/dev/lightingProbe.ts` renders an arena offscreen from a given eye
pose and reports luminance statistics with a verdict. It is DEV-only and lazily imported, so it
never enters the production bundle. Every new arena gets probed from each spawn, the centre, the
upper deck and a maze corridor before it is called done.

**The probe and the scene must share their constants.** Both read `config/lighting.ts`. They briefly
kept separate copies and drifted immediately: a rebalance that cut ambient by 3× measured as having
no effect at all, because the probe was still rendering with the old value. A validator that does
not measure what the game actually renders is worse than no validator, because it manufactures
confidence.

**Global fill bounds how dark any room can be.** Ambient and image-based lighting are scene-wide
terms that no geometry occludes. Roofing and sealing a room removes its *direct* light but not those,
so a "dark room" bottoms out around 75% of open-floor luminance. Genuinely dark spaces need baked
ambient occlusion or per-zone light probes — an M4 art-pass item, not something more geometry fixes.

## Spawn orientation

`SpawnPoint.yaw` follows the same convention as everything else: yaw 0 looks down −Z, so to face
direction `d` the yaw is `atan2(-d.x, -d.z)`, and to look at the arena centre from `(x, z)` it is
`atan2(x, z)`. Getting the sign backwards points every spawn at the wall behind it, which is
indistinguishable from the arena failing to load. Arena 01 uses a shared `facingCentre()` helper
rather than hand-written per-corner angles.

## Trigger volumes

`TriggerSystem` owns axis-aligned volumes and their occupancy: per-team counts, controlling team,
contested flag, hold time, and enter/exit edges. Volumes are built automatically from each arena's
`objectives`, and ad-hoc zones can be registered at runtime.

Occupancy is **recomputed from scratch every tick** rather than tracked incrementally. That is
deliberate: actors teleport on respawn, and an incremental scheme leaves stale occupants inside a
volume the moment someone dies in it. With 6 volumes and 6 actors the full rebuild is 36 point-in-box
tests and does not register against the tick budget.

This is the shared primitive behind the HUD objective tracker, powered doors, and the capture/hold
scoring that M2's modes need — three things that would each otherwise grow their own proximity code.

## Bot perception

Two independent channels, deliberately not merged:

- **Sight** writes `target` and `lastKnownPosition`, gated by FOV, range and line of sight, and is
  the only thing that permits firing.
- **Hearing** writes `heardPosition` and an `investigateTimer`, and drives a separate `investigate`
  branch that sits between `search` and `roam`.

Keeping them separate is what makes hearing believable rather than cheap: a bot walks toward gunfire
and clears the corner, but can never shoot at something it has not actually seen. Firing carries
42 m, sprinting 17 m, walking 9 m. Walls do not block hearing — distance does.

## Interactive props

Props are arena data (`PropSpec[]`), split by whether they can affect play:

- **Simulated** — currently only doors, because a door's collider opens a route and a sightline.
  `PropSystem` runs inside the tick, holds one 0..1 openness per door, and moves a kinematic body.
  One byte per door serializes for netcode.
- **Render-clock only** — energy gates, fans, beacons, displays, machinery. Deterministic from
  elapsed time, animated in `ArenaProps`, costing the tick budget nothing and running at display
  rate rather than tick rate.

Doors are kinematic bodies, not teleporting statics, so the character controller resolves against
them as moving obstacles instead of letting actors sink in. They move *before* `physics.step()` so
the next tick's character sweeps see the new position.

## Spawns

Authored spawn coordinates are validated against built geometry by `resolveSpawns()`. Blocked
spawns are relocated to the nearest clear navigation node, weighted to stay on the same floor, and
reported loudly in development. If validation rejects *everything* it falls back to the authored
list and says so — a broken validator must never be able to brick a match.

## Rendering

- The arena is one `InstancedMesh` per (surface kind, colour, glow) batch. Arena 01 is ~100 brushes
  in 12 batches.
- Bolts, sparks, decals and impact flashes are pooled and instanced; nothing in the impact path
  allocates.
- The camera reads `Game.view`, recomputed each rendered frame by interpolating between the last
  two ticks. Look angles are applied directly rather than interpolated — input latency is more
  noticeable than angular jitter.
- The HUD is pushed as a snapshot at ~20 Hz, decoupled from the 64 Hz tick, so React re-renders are
  not on the simulation's critical path.

## Verified behaviour

Measured against the running build rather than assumed:

| Property | Measured |
| --- | --- |
| Simulation cost | 0.35 ms/tick, 6 actors, unminified dev build |
| Navigation graph | 2252 nodes, avg degree 6.1, 95% reachable from spawn |
| Walk / sprint speed | 5.2 / 8.4 m/s — matches config exactly |
| Slide | Entry 11.13 m/s (8.4 + 3.2 boost), capsule drops to 0.95 m, ground contact stable |
| Jump arc | 0.95 m after 12 ticks — matches v₀ = 7.1, g = 22 |
| Weapon cycle | 6 shots then forced recharge; spread builds and recovers |
| Combat | Damage, shield absorption, headshots, killfeed, assists, scoring all confirmed |
| 90 s bot match | 306 shots, 306 impacts (no leaked projectiles), 18 kills, bots use both floors |

## Not yet built

Milestones 2–6 in the production plan. Specifically: game modes beyond Team Deathmatch / Free For
All / Bot Practice, arenas 02–04, authored character and weapon art, motion matching, voice-over,
the netcode layer, and the editor tools.


---

# Networking

## The contract

**The server is authoritative. Clients send intent, never state.**

There is no message in the protocol that carries a position, a health value or a score from client
to server. That is not a policy — it is a structural property, and it removes the entire "edit a
value in memory" class of cheat by construction. What remains is lying about *intent*, which is a
much smaller surface and is what `net/Validation.ts` polices.

```
client                                        server
  peripherals ─► InputFrame ──── send ───────► validate ─► MatchDirector.step()
       │                                              │
       │                                              ├─► snapshot (delta vs client baseline)
  predict locally                                     │
       │                                              ▼
       └──── reconcile ◄──────── snapshot ────────────┘
```

## Why single-player uses the network path

`LocalTransport` is a pair of in-process endpoints. Offline play runs `NetServer` in the browser and
talks to it through serialization, exactly as an online client would.

This costs single-player some work it does not strictly need. The payoff is that the replication
path is exercised on *every* playthrough, so encoding bugs surface during ordinary development
rather than the first time two people connect. Given that serialization bugs do not throw — they
quietly desynchronise — that trade is worth making.

## Prediction and reconciliation

The client simulates its own movement immediately, records every input by tick, and sends a sliding
window of unacknowledged frames in each packet (so a dropped datagram costs nothing — the next one
carries the missing frames).

Each snapshot carries the last input tick the server consumed. On arrival the client:

1. discards acknowledged inputs,
2. compares its predicted position against the server's,
3. if they differ beyond 2 cm, rewinds to the server state and **replays** every unacknowledged
   input through the same `stepMovement`,
4. carries the residual as a decaying *camera* offset rather than snapping the actor.

The actor snaps instantly so shooting stays consistent with the server; the camera pays the
correction off over ~80 ms so the player never sees it. Corrections beyond 2.5 m are shown honestly
— hiding a large desync looks worse than admitting it.

**This only works because `stepMovement` is a pure function of (actor, physics, fixed dt) with a
seeded RNG.** Every determinism rule in this document exists to make that replay trustworthy.

## Interpolation and lag compensation

Remote actors render ~75 ms behind the newest snapshot (one and a half snapshot intervals, widened
adaptively by measured jitter). Two snapshots always bracket the render time, so motion is
interpolated rather than guessed and a single lost packet is invisible.

That delay is *why* lag compensation exists. A shooter is aiming at where a target was
`interpolationDelay + rtt/2` ago, so the server rewinds its snapshot history by exactly that much
when validating a shot. **The two constants are halves of one decision and must agree.**

The trade-off is explicit: rewinding means a player who has already broken line of sight can still
be tagged by a shot that was fair on the shooter's screen. That is the conventional choice —
favour the shooter — and it is capped by `maxRewindTicks` so a client cannot claim arbitrary
latency to shoot into the past.

## Delta compression

Snapshots encode against the most recent baseline the receiving client acknowledged. Each actor
carries a 16-bit field mask; only named fields are written. Positions quantise to 16-bit fixed point
over a 256 m cube (~3.9 mm), angles to 16-bit radians.

Measured on the running build:

| Players | Full snapshot | Delta (all moving) | Delta (idle) | Per client @ 20 Hz |
| --- | --- | --- | --- | --- |
| 6 | 215 B | 84 B | 36 B | 13.4 kbit/s |
| 16 (8v8) | 555 B | 204 B | 76 B | 32.6 kbit/s |

Round-trip is lossless within quantisation: max position error 1.88 mm against a 1.95 mm step.
Verified continuously by `dev/netProbe.ts` (`__PHOTON__.probeNet()`).

## Portability rule

Shared modules (`gameplay/`, `ai/`, `maps/`, `physics/`, `net/`, `util/`) must **never** touch
`import.meta.env` — it is a Vite injection that does not exist under Node, and reading it throws.
Use `util/env.ts`. This was found the hard way: the dedicated server booted, baked navigation, and
then died constructing the match. Only `render/` and `ui/` may assume a bundler.

## Match flow

The lifecycle state machine lives in the simulation, not the UI:

```
lobby → warmup → countdown → active → [sudden death] → ended → scoreboard → lobby
```

Driving it from a UI screen would make the phase a client opinion. Instead the server owns the
machine and replicates `phase` and `phaseRemaining`; clients render what they are told. A tie at the
final whistle goes to sudden death rather than being called a draw.

## Game modes

Modes are strategy objects (`gameplay/modes/`). A mode decides three things: what scores, when the
match ends, and whether players respawn. It never touches movement, weapons or physics — those are
identical in every mode, which is why adding a mode cannot destabilise combat.

Mode-specific state (CTF carriers, Domination node ownership) lives on the mode, not on `Actor`,
because `Actor` replicates to every client every snapshot. CTF therefore costs zero bytes in the
six modes that do not use it.
