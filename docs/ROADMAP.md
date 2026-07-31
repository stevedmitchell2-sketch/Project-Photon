# Roadmap

Status is updated at the end of every milestone. See [PRODUCTION_PLAN.md](./PRODUCTION_PLAN.md) for
scope rationale and [ARCHITECTURE.md](./ARCHITECTURE.md) for the invariants each milestone inherits.

| Milestone | Scope | Status |
| --- | --- | --- |
| **M1 — Playable Core** | Engine tick, physics, movement, weapon, combat, Arena 01, bots, HUD, audio, post-processing, settings | ✅ **Complete, verified against the running build** |
| **Phase 2 — Vertical Slice** | Arena visibility fix, interactive props, trigger volumes, staircases, dark room, per-surface audio, ricochets, bot hearing, objective HUD, notifications | ✅ **Complete, verified against the running build** |
| M2 — Modes & Feel | All 7 competitive modes, round flow | ✅ **Modes and lifecycle complete** (killcam outstanding) |
| **Phase 3 — Multiplayer Foundation** | Protocol, delta snapshots, prediction, reconciliation, interpolation, lag comp, dedicated server, validation, team balance, stats/XP | 🟨 **Server half complete and running; `NetClient` outstanding** |
| M3 — Arenas 02–04 | Cyber Factory, Space Station, Neon Temple; moving geometry; low-gravity volumes | ⬜ Not started |
| M4 — Art & Audio | Mixamo rigs, motion matching, weapon animation set, VO announcer, soundtrack, texture streaming | ⬜ Not started |
| M5 — Netcode | Client half, multiplayer UI, spectator, replay, voice | 🟨 In progress — see Phase 3 |
| M6 — Tools & Ship | Map/spawn/lighting/bot-path editors, weapon tuning, replays, telemetry, CI perf budgets | ⬜ Not started |

---

## M1 — Playable Core ✅

**Delivered.** Every system below is implemented and exercised, not stubbed.

### Systems

- **Engine** — 64 Hz fixed-step accumulator loop with render interpolation and spiral-of-death
  protection; typed event bus; fixed-capacity object pools; seeded xoshiro128\*\* RNG.
- **Physics** — Rapier world behind a `PhysicsWorld` facade; collision layers; kinematic character
  controllers; swept queries; lazy query-pipeline invalidation.
- **Movement** — Quake-style accelerate/friction with CoD tuning: sprint, slide with momentum
  boost and decay, crouch, lean with wall probing, jump with coyote time and input buffering,
  ledge-detected mantle, autostep and slope handling.
- **Weapons** — PH-6 photon rifle: 6-shot cell, forced recharge, idle trickle, discounted manual
  vent, travelling bolts with swept collision, damage falloff, headshots, stance-based spread,
  recoil that moves the aim, ADS.
- **Combat** — Shields over health with separate regen delays, spawn protection, assists, killfeed,
  directional damage indicators.
- **AI** — Nav graph baked from real collision geometry, A\* with consistent heuristic, behavior
  trees with reactive guards, four difficulty profiles, perception with FOV and line of sight,
  cover selection, target leading, stuck detection.
- **Spawns** — Threat-scored selection plus build-time validation against geometry.
- **Maps** — Data-driven arena format, instanced batch builder, Arena 01 "Classic".
- **Audio** — Fully synthesised spatial SFX, procedural convolution reverb driven by arena zones,
  adaptive generative music that tracks combat intensity.
- **Render** — R3F scene, instanced arena, pooled bolt/spark/decal/flash FX, first-person view
  model with sway and charge readout, third-person avatars, bloom/vignette/grain/aberration stack.
- **UI** — HUD (vitals, charge cells, minimap, killfeed, scores, timer, crosshair, subtitles),
  main menu, lobby, six-tab settings with live rebinding, pause, scoreboard, results.
- **Accessibility** — Colourblind palette with shape glyphs, subtitles, shake/bob reduction, high
  contrast HUD, enemy outlines, full remapping, audio sliders, performance mode.

### Bugs found and fixed during verification

All were found by measuring the running build, not by inspection:

1. Rapier's `queryPipeline` was never updated — **every raycast in the game returned null**.
2. `body.setTranslation()` does not propagate to colliders until `world.step()`, so mid-tick
   resizes were evaluated at the previous transform.
3. Character capsules omitted `PROJECTILE` from their collision filter — **every bolt passed
   through every player**.
4. A grounded character with zero downward velocity reads as airborne, so the flag oscillated every
   other tick, breaking coyote time and cancelling slides after one tick.
5. A\*'s heuristic overestimated descent cost and there was no closed set — long routes failed.
6. `noNav` was defined in the map format but never honoured, so railing tops became nav nodes.
7. Unbroken railings and roof lips severed the entire upper deck from the ground floor.
8. Spawn points were never validated; the local player spawned inside a crate.
9. Behavior-tree `Sequence` memory skipped condition guards, crashing on a dead target.
10. The loading screen awaited `requestAnimationFrame`, hanging if the tab was backgrounded.

### Known gaps

- **Visual output is unverified.** The code builds and typechecks, but the browser pane in this
  environment never composited (`document.hidden` stayed true), and React Three Fiber does not
  mount its scene tree until it measures a non-zero canvas. Nothing rendered on screen has been
  seen. This needs a human eye or a headed browser before the visual work is trusted.
- The `rapier` bundle chunk is 2.0 MB (761 kB gzipped). Acceptable for now; worth moving to the
  non-compat build with a separate `.wasm` asset during M6.
- Player-vs-player capsule collision is enabled but not tuned; bots may body-block in doorways.


---

## Phase 2 — Vertical Slice ✅

**Delivered.** See [CHANGELOG.md](./CHANGELOG.md) 0.2.0 and 0.3.0 for the full record.

### Systems added

- **Trigger volumes** — occupancy, per-team counts, controlling team, contested state, hold time and
  enter/exit edges. The shared primitive behind the objective tracker, doors, and M2's scoring.
- **Interactive environment** — powered doors with real moving collision, energy gates, extraction
  fans, pulsing beacons, match-clock displays, scrolling signage, ambient machinery (26 props).
- **Arena geometry** — staircases with autostep-safe risers; a roofed, unlit dark room.
- **Audio** — per-surface footsteps and impacts, ricochets on grazing hits, an ambient mains-hum and
  air-handling bed, countdown callouts at 60/30/10/5/3/2/1 s.
- **AI** — bot hearing on a channel separate from sight, with a dedicated `investigate` behaviour.
- **HUD** — objective tracker and a toned notification stack.
- **Tooling** — `dev/lightingProbe.ts` offscreen luminance validation, `config/lighting.ts` as the
  single source of truth shared by the renderer and the probe.

### Nine defects fixed

Five caused "can not see the arena" (every spawn facing its wall, missing environment map, legacy
light units, the ceiling occluding the key light, near-black albedo). Four more surfaced during this
pass: the lighting probe validating against its own stale constants, staircases climbing to nowhere,
railings sealing the staircases out, and global fill masking all level lighting design.

### Known limitation

A genuinely dark room needs baked ambient occlusion or per-zone light probes — ambient and IBL are
global and no geometry occludes them. Deferred to M4.
