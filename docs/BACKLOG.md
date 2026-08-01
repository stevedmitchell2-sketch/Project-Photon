# Backlog

Work that is known, scoped, and not yet scheduled. `NEXT_TASK.md` holds the *current* task; this
holds everything behind it.

Ordered within each section by value. An item earns a place here only when it is specific enough to
start — vague aspirations belong in `ROADMAP.md`.

---

## Networking

| Item | Notes |
| --- | --- |
| **Residual prediction corrections** | Two of three clients correct at 22/s (= every snapshot) while one sits at 2/s. Bimodal, so structural rather than gradual. Current hypothesis: contact with level geometry — collide-and-slide amplifies a sub-millimetre position difference into a divergent slide. See NEXT_TASK. |
| **8-client failure** | 4 clients pass, 8 fail with the server transmitting and clients receiving nothing. Test process-per-client before suspecting the server. |
| **Lag compensation under real latency** | Wired and running but only exercised at ~1 ms RTT, where rewind is a no-op. Needs a 20–250 ms sweep via `LocalTransport.simulatedLatencyMs`. |
| **Client clock sync** | The jitter buffer absorbs drift server-side. A client that measured its own buffer depth and nudged its send rate would remove starvation entirely rather than cushioning it. |
| **Listen server** | Route offline play through `NetServer` + `LocalTransport` so the netcode is exercised on every playthrough — currently claimed in ARCHITECTURE.md but not true. |
| **Snapshot interest management** | Every client receives every actor. Fine at 16; a visibility/distance filter is the lever if player counts rise. |

## Gameplay

| Item | Notes |
| --- | --- |
| **Objective-aware bots** | Five of seven modes are unplayable offline. Add a `capture-objective` branch between `engage` and `search`; `investigate` is the template. |
| **Overtime / sudden death verification** | `MatchFlow` implements the phase; it has never been observed firing in a real match. |
| **Round transitions for Elimination** | Round restart logic exists in the mode but no round-boundary respawn wave. |
| **Weapon framework generalisation** | `WeaponSystem` is written around one weapon. The config is already data-driven; the system needs a second weapon to prove the seams. |

## Rendering

| Item | Notes |
| --- | --- |
| **Batch props and avatars** | 137 individual meshes vs 21 instanced. Each bot is ~12 meshes, each prop 2–8. Arena geometry is already batched; this is the remaining draw-call win. Not geometry-bound — 12.6k triangles. |
| **Vsync-independent frame timing** | 120 FPS target is unmeasurable while frame time is pinned at exactly 1/60 s. Until this exists, no optimisation claim can be verified. |
| **Global dynamic-light budget** | `graphics.maxDynamicLights` caps arena fixtures only. Impact flashes, prop beacons and the muzzle light are outside it. Should be one budget. |
| **Light shafts read as objects** | Most visually intrusive element on screen. Fade by view angle — subtle head-on, visible obliquely. |
| **Weapon idle orientation** | Barrel reads angled at rest; likely residual yaw in the idle sway. |
| **Mid-tone flatness** | Surfaces away from a fixture fall to uniform grey. More contrast between lit and unlit regions. |

## Content

| Item | Notes |
| --- | --- |
| **Arenas 02–04** | Cyber Factory, Space Station, Neon Temple. The data format and builder support them; each needs authoring plus a lighting-probe pass. |
| **Authored characters** | Avatars are primitive blockouts. The rig interface is designed so a Mixamo character swaps in without touching what drives it. |
| **Voice-over** | Announcer is a synthesised stinger plus a subtitle. Real VO is the M4 audio pass. |

## UI

| Item | Notes |
| --- | --- |
| **Multiplayer UI** | No server browser, lobby, ready check, or end-of-match screen. `MatchFlow` and `Statistics` already produce everything the screens need. |
| **Spectator** | Free camera, follow, cycling. Presentation-only, so it does not touch the simulation. |
| **Replay** | `SnapshotHistory` is already a complete match recording; playback is seeking in it through the existing interpolation path. |

## Tooling and infrastructure

| Item | Notes |
| --- | --- |
| **A telemetry sink** | `engine/Telemetry.ts` defines the interface; none ships. A JSON writer on the server would make match data available immediately. |
| **Movement-path telemetry** | Shots, hits, deaths and respawns are recorded. Movement paths and engagement distance are not, and both are wanted for Photon Director. |
| **CI netcode job unverified** | The workflow runs the harness against a real server; it has never been exercised on an Actions runner. |
| **`--legacy-peer-deps` required** | ESLint 9 against an older plugin peer range. Works, but should be resolved properly. |
| **No LICENSE file** | README declares all rights reserved; needs an explicit file before any public push. |
| **README screenshots** | Placeholders. Three captures from a running session. |

## Deliberately not doing

Recorded so they are not re-proposed:

- **Monorepo split into `apps/` + `packages/`.** ~17k lines across 78 files, already separated along
  the seams a split would use. Revisit when a second application needs to share `gameplay` and `net`.
- **WebGPU backend.** A renderer swap, not a visual feature. Everything planned works on WebGL2, and
  the frame budget it would be justified against is currently unmeasurable.
- **Bit-packed wire format.** ~15% smaller for a large increase in debugging cost. Delta compression
  already removes the dominant term.
