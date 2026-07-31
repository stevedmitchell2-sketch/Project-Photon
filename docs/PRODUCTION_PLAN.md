# PROJECT PHOTON — Production Plan

**Genre:** First-person laser tag arena shooter
**Pillars:** CoD-weight movement · Halo-readable arena combat · Quake map flow · real laser-tag fiction
**Platform:** Browser (WebGPU-first, WebGL2 fallback), desktop + gamepad
**Target:** 120 FPS at 1080p on a mid-range discrete GPU; 60 FPS floor on integrated

---

## 1. Design Contract

The whole game is driven by **data, not code branches**. Teams, weapons, movement feel, arenas,
game modes and bot difficulty are all typed config records. A designer can ship a new mode or
arena without touching a system.

| Concern | Owner module | Data source |
| --- | --- | --- |
| Who is playing | `gameplay/MatchDirector` | `config/gameModes.ts` |
| How they move | `gameplay/PlayerController` | `config/movement.ts` |
| What they shoot | `gameplay/WeaponSystem` | `config/weapons.ts` |
| Where they fight | `maps/MapBuilder` | `maps/arena*.ts` |
| What it looks like | `render/*` | `config/graphics.ts` |
| How it sounds | `audio/AudioEngine` | `audio/sfx.ts` |

### Simulation contract (this is the load-bearing decision)

The simulation is a **deterministic fixed-step tick at 64 Hz**, fully separated from rendering.
Rendering interpolates between the last two ticks. Nothing gameplay-relevant reads
`requestAnimationFrame` delta. This exists so that the same `stepMatch()` used locally today can
run unchanged on an authoritative Node server later, with clients rolling back and replaying
inputs against it. Every gameplay system therefore obeys three rules:

1. It mutates only `MatchState`, never React state, never Three.js objects.
2. It takes `(state, input, dt)` where `dt` is always `1/64`.
3. It uses the seeded RNG in `util/rng.ts`, never `Math.random()`.

Renderers and the HUD *read* `MatchState` and never write it.

---

## 2. Architecture

```
src/
  engine/      Tick loop, clock, event bus, object pools, entity registry
  config/      Typed, hot-swappable design data (teams, weapons, movement, modes, graphics)
  physics/     Rapier world, collision layers, character controller, sweep queries
  input/       Keyboard / mouse / gamepad -> normalized InputFrame; remapping; deadzones
  gameplay/    Player controller, weapons, projectiles, combat, spawns, match director, modes
  ai/          Nav graph, A* pathing, behavior trees, bot brains, squad coordination
  maps/        Arena data + procedural builder (geometry, colliders, nav sampling, spawns)
  render/      R3F scene graph, instanced arena mesh, FX, view model, post-processing
  audio/       WebAudio graph, procedural SFX, spatialization, reverb zones, music, announcer
  net/         Wire protocol, transport abstraction, snapshot encode/decode, prediction hooks
  state/       Zustand stores: settings, UI, match mirror (read-only projection of the sim)
  ui/          HUD, menus, settings, scoreboard, accessibility
  util/        Math, seeded RNG, ids, timers
```

**Dependency direction is strictly one-way:** `util → engine → physics → gameplay/ai → render/ui`.
Render and UI may import gameplay types; gameplay may never import render or React.
This is what makes the headless server build possible.

---

## 3. Milestones

### M1 — Playable Core *(built)*
Engine tick, Rapier world, full CoD movement set, laser rifle with 6-shot recharge, travelling
team-coloured bolts with impact FX, health/shield combat, Arena 01, bots with behavior trees,
HUD, procedural audio, bloom post-processing, settings, Team Deathmatch + Free For All.

### M2 — Modes & Feel
Capture the Flag, King of the Hill, Domination, Elimination, Training. Objective tracker HUD,
carry/drop mechanics, round flow, warmup/overtime, spectator + killcam camera.

### M3 — Arenas 02–04
Cyber Factory (moving conveyors as kinematic bodies), Space Station (low-gravity volumes),
Neon Temple (floating platforms, holograms). Per-arena reverb zones and LED wall shaders.

### M4 — Art & Audio Pass
Authored character models (Mixamo rig + retarget), motion-matching locomotion, weapon view-model
animation set, VO announcer, licensed/commissioned electronic soundtrack, texture streaming.

### M5 — Netcode
Node + `ws` authoritative server running the same `stepMatch`, client prediction + reconciliation,
entity interpolation, lag compensation for hitscan-adjacent checks, lobby/matchmaking service.

### M6 — Tools & Ship
In-game map editor, spawn/lighting/bot-path editors, weapon tuning panel, replay system,
telemetry, performance budgets enforced in CI, accessibility audit.

---

## 4. Performance Budget (per 8.3 ms frame @ 120 FPS)

| Stage | Budget |
| --- | --- |
| Simulation tick (amortized) | 1.2 ms |
| Physics (Rapier) | 1.0 ms |
| AI (time-sliced, 8 bots) | 0.5 ms |
| Scene graph + culling | 0.8 ms |
| Draw submission | 2.0 ms |
| Post-processing | 2.0 ms |
| Slack | 0.8 ms |

Enforcement techniques: instanced arena geometry (one draw call per material), object pooling for
every projectile/decal/particle, frustum + portal culling, LOD on characters, AI time-slicing
(each bot re-plans on its own cadence, never all in one tick), and a Performance Mode preset that
drops post-processing to bloom-only at half resolution.

---

## 5. Risk Register

| Risk | Mitigation |
| --- | --- |
| WebGPU support gaps | WebGL2 path is the default target; WebGPU is opt-in and feature-detected |
| Motion matching needs a large mocap set | M1–M3 ship a blend-tree locomotion system with the same public API; motion matching swaps in behind it |
| Netcode retrofit pain | Fixed-step deterministic sim + input-frame abstraction enforced from day one |
| Bloom-heavy scenes wash out silhouettes | Team-colour rim lights are separate from emissive intensity; colourblind palette validated against contrast targets |
| Browser audio autoplay policy | Audio graph constructs on first user gesture (the click that locks the pointer) |
