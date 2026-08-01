# Backlog

Work that is known, scoped, and not yet scheduled. `NEXT_TASK.md` holds the *current* task; this
holds everything behind it.

Ordered within each section by value. An item earns a place here only when it is specific enough to
start — vague aspirations belong in `ROADMAP.md`.

---

## Networking

| Item | Notes |
| --- | --- |
| **Residual prediction corrections** | Narrowed, not closed. Server says all clients move identically; the quiet client reconciles correctly at offset 0 (28 mm), the noisy ones at offset ~10 — the signature of a stale acknowledged tick. Co-location and dropped inputs both **disproven** this sprint. Next step in NEXT_TASK item 3. |
| **Upstream bandwidth scales with RTT** | 2.7 KB/s at 0 ms to 13.3 KB/s at 250 ms, because each packet resends the unacknowledged window. Working as designed, but uncapped. Cap the resend window before public play. |
| **Adaptive interpolation buffer untested** | Held at its 75 ms floor at every latency in the sweep, because injected latency is jitter-free. The widening logic has never actually run. |
| **Client clock sync** | The jitter buffer absorbs drift server-side. A client that measured its own buffer depth and nudged its send rate would remove starvation entirely rather than cushioning it. |
| **Listen server** | Route offline play through `NetServer` + `LocalTransport` so the netcode is exercised on every playthrough — currently claimed in ARCHITECTURE.md but not true. |
| **Snapshot interest management** | Every client receives every actor. Measured fine at 16 (86 KB/s aggregate, server at 22% of one core); a visibility/distance filter is the lever only if player counts rise above that. |

## Gameplay

| Item | Notes |
| --- | --- |
| **Difficulty is two tiers, not four** | Easy/medium sit at ~14 s median life, hard/expert at ~8.7 s — ordered between the pairs, flat within them. Seven measured iterations could not separate them further: range and accuracy trade against each other inside the 6–13.5 m span Arena 01 allows. Blocked on a long-sight-line arena. |
| **Objective-aware bots** | Five of seven modes are unplayable offline. Add a `capture-objective` branch between `engage` and `search`; `investigate` is the template. |
| **Overtime / sudden death verification** | `MatchFlow` implements the phase; it has never been observed firing in a real match. |
| **Round transitions for Elimination** | Round restart logic exists in the mode but no round-boundary respawn wave. |
| **Weapon framework generalisation** | `WeaponSystem` is written around one weapon. The config is already data-driven; the system needs a second weapon to prove the seams. |

## Rendering

| Item | Notes |
| --- | --- |
| **Batch props** | Avatars are done — instanced in Sprint 7, draw calls no longer scale with player count. Arena props (2–8 meshes each) are the remaining unbatched geometry. Not geometry-bound — 12.6k triangles. |
| **Per-pixel cost blocks 120 FPS** | GPU 12.0–12.5 ms against an 8.33 ms budget, CPU idle at 1.4–1.9 ms. Fragment-bound: lights per fragment (2.3 ms), full PBR on non-metallic architecture, transparent overdraw. Draw calls are not the constraint. |
| **Dynamic-light budget is a flat cap** | `maxDynamicLights` caps arena fixtures only; impact flashes, prop beacons and the muzzle light sit outside it. Should be one budget culled by distance and screen influence. |
| **Vsync-independent frame timing** | 120 FPS target is unmeasurable while frame time is pinned at exactly 1/60 s. Until this exists, no optimisation claim can be verified. |
| **Global dynamic-light budget** | `graphics.maxDynamicLights` caps arena fixtures only. Impact flashes, prop beacons and the muzzle light are outside it. Should be one budget. |
| **Weapon idle orientation** | Barrel reads angled at rest; likely residual yaw in the idle sway. |
| **Mid-tone flatness** | Surfaces away from a fixture fall to uniform grey. More contrast between lit and unlit regions. |

## Content

| Item | Notes |
| --- | --- |
| **Asset pipeline (glTF import)** | The identified ceiling of procedural art. Code does proportion, silhouette, material response and state-driven animation well; it does surface density badly — bevels, panel gaps, edge wear, cable runs, moulded detail. The architecture is already prepared: weapon animation is written against part references, avatars are instanced by (geometry, material), materials are keyed by substance. |
| **Modular environment kit** | Wall, floor, ceiling and cover modules that snap on a grid. Should be authored, not generated, and is the largest single visual win available. |
| **Character models and animation** | Avatars are primitive blockouts. The rig interface is fixed and instancing must be preserved on swap. |
| **Free-floating holograms** | Wall-mounted boards are done. Floating logos, objective markers, directional indicators and team introduction sequences are not. |
| **A long-sight-line arena** | Arena 01 stops offering sight lines beyond ~10 m, which caps the bot difficulty ladder and leaves the weapon's falloff bands, ADS and projectile lead unexercised. Arenas 02–04 need at least one long hall, and their bot profiles raised with `aimErrorDegrees` re-derived. |
| **Environment FX** | Volumetric fog beyond `fogExp2`, dust, heat shimmer, steam vents, electrical arcs, conduit pulses. Budget these explicitly — transparent overdraw is the third-largest GPU cost and particles are exactly the wrong work for a fragment-bound frame. |
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
