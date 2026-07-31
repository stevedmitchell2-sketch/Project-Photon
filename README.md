# PROJECT PHOTON

A first-person laser tag arena shooter for the browser, with authoritative-server multiplayer.

Movement weight modelled on modern military shooters, arena readability from Halo, map flow from
Quake, and the fiction of a real laser tag hall — neon, catwalks, and six shots before your cell
has to cycle.

> **Status: pre-alpha.** The game is playable end to end against bots and validated across three
> networked clients. See [PROJECT_STATUS.md](docs/PROJECT_STATUS.md) for exactly what works and
> [NEXT_TASK.md](docs/NEXT_TASK.md) for what is being worked on next.

## Screenshots

<!-- Replace with captures from `npm run dev`. -->
| Arena | Combat | Network overlay |
| --- | --- | --- |
| _screenshot pending_ | _screenshot pending_ | _screenshot pending_ |

---

## Features

**Movement** — sprint, slide with momentum carry, crouch, jump with coyote time and input buffering,
ledge-detected mantle, lean with wall probing, autostep and slope handling.

**Combat** — the PH-6 photon rifle: six shots per cell, forced recharge, idle trickle recovery,
discounted manual vent. Bolts are real travelling entities with swept collision, damage falloff,
headshots, stance-based spread and recoil that moves your actual aim.

**Multiplayer** — authoritative server, client-side prediction with replay-based reconciliation,
entity interpolation with adaptive delay, delta-compressed snapshots, lag compensation, and
server-side input validation.

**Arena** — two floors, ramps, staircases, a perimeter catwalk ring, maze corridors, a roofed dark
room, a central objective room, and interactive props: powered doors with real collision, energy
gates, extraction fans, beacons and live match-clock displays.

**AI** — bots that path a navigation graph baked from real collision geometry, take cover, flank,
retreat, and investigate gunfire they cannot see. Four difficulty profiles.

**Modes** — Team Deathmatch, Free For All, Capture the Flag, King of the Hill, Domination,
Elimination, Last Team Standing, plus Training and Bot Practice.

**Accessibility** — colourblind palette with distinct team glyphs, subtitles, camera shake and view
bob reduction, high-contrast HUD, enemy outlines, full input remapping, per-bus audio sliders.

## Technology

| Layer | Choice |
| --- | --- |
| Language | TypeScript (strict) |
| Rendering | Three.js via React Three Fiber, WebGL2 |
| Physics | Rapier (WASM) |
| State | Zustand |
| Build | Vite |
| Server | Node + `ws` |
| Testing | Vitest |

## Architecture in one paragraph

The simulation is **headless, deterministic and fixed-step at 64 Hz**. `MatchDirector.step(dt)` is
the entire game: it reads `MatchState` plus one `InputFrame` per actor, mutates that state and the
physics world, and emits events. It imports nothing from React or Three.js. Everything else is
either an input source feeding it (peripherals, bot brains, the network) or a presentation layer
reading it (renderers, HUD, audio). That boundary is what lets the identical simulation run on a
dedicated Node server, and what makes client prediction's replay trustworthy.

Full detail in [ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Installation

Requires **Node 20+**.

```bash
npm install
```

## Development

```bash
npm run dev
```

Opens on `http://127.0.0.1:5180`. Enter Arena → Deploy, then click the canvas to lock the pointer.

**Controls** — WASD move · Shift sprint · Space jump/mantle · Ctrl or C crouch (slide while
sprinting) · Q/E lean · R vent and recharge · LMB fire · RMB aim · Tab scoreboard · Esc pause ·
**F3 network overlay**. Gamepad supported with deadzone and response-curve settings.

In a development build the running game is exposed as `window.__PHOTON__`:

```js
__PHOTON__.stepTicks(64)                        // advance one second of simulation
__PHOTON__.probeLighting({x:0,y:2,z:0}, 0, 0)   // offscreen luminance report for the arena
__PHOTON__.probeNet()                           // snapshot encode/decode round-trip and bandwidth
__PHOTON__.nav.nodeCount                        // navigation graph size
```

## Build

```bash
npm run build      # production client bundle into dist/
npm run preview    # serve the built bundle
npm run validate   # typecheck + lint + test + build, as CI runs it
```

## Testing

```bash
npm run test           # unit and integration suites
npm run test:watch
npm run test:coverage
```

| Suite | Location | Covers |
| --- | --- | --- |
| Unit | `tests/unit/` | Serialization, quantisation, RNG determinism, look/basis conventions |
| Integration | `tests/integration/` | Snapshot delta compression, history eviction, baseline handling |
| Netcode | `scripts/netTest.ts` | Multiple real clients over real sockets against a real server |
| Prediction | `scripts/predictionAB.ts` | Live simulation path vs reconciler replay path, per tick |

The last two need a running server and are documented under Multiplayer below.

## Multiplayer

Start a dedicated server:

```bash
npm run server -- --port 8090 --bots 0
```

Options: `--port`, `--max`, `--mode`, `--arena`, `--bots`, `--seed`.

Validate it with real clients:

```bash
npm run nettest -- --port 8090 --clients 3 --seconds 8
```

Check prediction fidelity (no server needed):

```bash
npm run predict-ab
```

Measured behaviour and current limitations are in
[NETWORK_BENCHMARK.md](docs/NETWORK_BENCHMARK.md) — including a **known failure above three
clients** that is not yet resolved.

## Repository layout

```
photon/
├── src/
│   ├── engine/      Fixed-step loop, event bus, object pools, game orchestration
│   ├── gameplay/    Simulation: movement, weapons, projectiles, combat, spawns, modes, triggers
│   ├── ai/          Navigation graph, behaviour trees, bot brains, difficulty profiles
│   ├── physics/     Rapier facade, collision layers
│   ├── net/         Protocol, serialization, snapshots, transports, prediction, server/client
│   ├── render/      React Three Fiber scene, instanced arena, FX, view model, post-processing
│   ├── ui/          HUD, menus, network overlay, styles
│   ├── maps/        Arena data format, builder, arenas, spawn validation
│   ├── audio/       Synthesised spatial audio engine
│   ├── config/      Typed design data: teams, weapons, movement, modes, graphics, lighting
│   ├── util/        Math, seeded RNG, environment detection
│   └── dev/         Development-only probes (lighting, netcode)
├── server/          Dedicated server entry point
├── scripts/         Validation harnesses (netTest, predictionAB)
├── tests/           Unit and integration suites
├── docs/            All project documentation
└── .github/         CI workflow, issue and PR templates
```

**On the flat layout:** the project is ~17k lines across 78 files, already cleanly separated along
the seams a package split would use. Breaking it into workspace packages now would mean ten build
configs and a rewrite of every import path, in exchange for organisation the codebase does not yet
need. Revisit when a second application (editor, launcher) needs to share `gameplay` and `net` — at
that point `apps/` and `packages/` earns its cost. See [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Documentation

| Document | Purpose |
| --- | --- |
| [AI_HANDOFF.md](docs/AI_HANDOFF.md) | **Start here** if you are an AI agent picking this up |
| [PROJECT_STATUS.md](docs/PROJECT_STATUS.md) | What works, what is measured, what is broken |
| [NEXT_TASK.md](docs/NEXT_TASK.md) | The exact next task and its definition of done |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Invariants, tick order, conventions, and known traps |
| [NETWORK_ARCHITECTURE.md](docs/NETWORK_ARCHITECTURE.md) | Replication, prediction, lag compensation |
| [NETWORK_BENCHMARK.md](docs/NETWORK_BENCHMARK.md) | Measured bandwidth, scaling, render profile |
| [RENDERING_GUIDE.md](docs/RENDERING_GUIDE.md) | Lighting rules, materials, performance budget |
| [PLAYTEST_REPORT.md](docs/PLAYTEST_REPORT.md) | Findings from actually playing it |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow, standards, how to validate a change |
| [CHANGELOG.md](docs/CHANGELOG.md) | Release history with the reasoning behind each change |
| [SESSION_LOG.md](docs/SESSION_LOG.md) | Narrative history: decisions taken and lessons learned |
| [ROADMAP.md](docs/ROADMAP.md) | Milestones M1–M6 and their status |
| [PRODUCTION_PLAN.md](docs/PRODUCTION_PLAN.md) | Original scope, budgets, risk register |

## Roadmap

| Milestone | Scope | Status |
| --- | --- | --- |
| M1 Playable Core | Engine, physics, movement, weapons, combat, Arena 01, bots, HUD, audio | ✅ Complete |
| Vertical Slice | Interactive props, triggers, stairs, dark room, per-surface audio, bot hearing | ✅ Complete |
| Multiplayer Foundation | Protocol, snapshots, prediction, server, validation, all 7 modes | ✅ Complete |
| Multiplayer Validation | NetClient, lag compensation, debug overlay, 3-client proof | ✅ Complete |
| Playtest & Stabilise | Play, measure, fix — in progress | 🟨 Current |
| M3 Arenas 02–04 | Cyber Factory, Space Station, Neon Temple | ⬜ |
| M4 Art & Audio | Authored characters, motion matching, VO, soundtrack | ⬜ |
| M6 Tools | Map, spawn, lighting and bot-path editors; replays | ⬜ |

## License

Unlicensed / all rights reserved. Not currently open for redistribution.
