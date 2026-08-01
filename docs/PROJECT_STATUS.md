# PROJECT STATUS — PROJECT PHOTON

**Last updated:** 2026-07-31 · **Phase:** Networking sprint - 4-client multiplayer working, lag compensation live, telemetry added.
**Build:** `tsc --noEmit` clean · `vite build` clean · dev server on port 5180

---

## One-line status

The game is playable end to end — spawn, move, shoot, tag, respawn, score, win — against bots on a
two-floor arena, with the arena now correctly lit and visible. Interactive props (powered doors,
energy gates, fans, beacons, live match-clock displays, ambient machinery) are in.

## What works, verified by measurement

| Area | State | Evidence |
| --- | --- | --- |
| Fixed-step sim | 64 Hz, deterministic, headless | **0.423 ms/tick** with 6 actors, props and triggers (budget 1.2 ms) |
| Movement | Sprint, slide, crouch, jump, mantle, lean, coyote/buffer | Walk 5.2 / sprint 8.4 m/s; slide entry 11.13 m/s; jump arc matches v₀=7.1, g=22 |
| Weapon | 6-shot cell, forced recharge, trickle, vent, ADS, spread, recoil | Full cycle traced tick by tick |
| Combat | Shields → health, headshots, assists, killfeed, scoring | 60 s bot match: 106 shots, 106 impacts, 9 kills |
| Arena | Two floors, ramps, **staircases**, catwalks, maze, **dark room**, objective room, spawn zones, flank routes | 151 brushes |
| Navigation | Baked from real collision, multi-floor | 2271 nodes, 95% reachable; stair path climbs 0 → 5 m |
| Bots | Patrol, engage, retreat to cover, search, **investigate noises**, both floors | 715 noise events per 60 s; bots seen actively investigating |
| Lighting | IBL + physical lights + fog | Probe verdict "good" at spawn, centre, upper deck, corridors; 0% black pixels |
| Props | 26 props, 4 powered doors, gates, fans, beacons, live clock displays | Door opens on approach, slides 4 m, closes on departure |
| HUD | Vitals, charge cells, minimap, killfeed, scores, timer, crosshair, subtitles, **objective tracker**, **notifications** | Rendered from a 20 Hz snapshot |
| Audio | Synthesised spatial SFX, **per-surface footsteps**, **ricochets**, **ambient hum**, **countdowns**, zone reverb, adaptive music | Six distinct impact surfaces observed |
| Accessibility | Colourblind palette + glyphs, subtitles, shake/bob reduction, remapping | Six-tab settings menu |

## Phase 2 brief — coverage

**Already delivered in M1:** first-person controller (sprint/crouch/jump/head bob/camera sway),
laser blaster (primary fire, visible travelling beam, muzzle flash, heat/cooldown, hit detection,
impact particles, audio, recharge animation), laser-tag scoring with shield depletion, temporary
disable on tag, configurable respawn timer and post-respawn invulnerability, two-floor arena with
ramps, catwalks, maze corridors, cover walls, neon barriers, glow strips, elevated sniper
positions, central objective room, spawn zones and flanking routes, HUD, audio, and bots that
patrol, seek cover, chase, retreat and navigate both floors.

**Added this session:** the visibility fix (see CHANGELOG), plus the interactive environment layer —
moving doors with real collision, energy gates, rotating fans, warning beacons, electronic displays
bound to the live match clock, scrolling signage, and ambient machines.

**Added in the Phase 2 pass:** trigger volumes, staircases, a roofed dark room, per-surface
footsteps, ricochets, ambient hum, countdown callouts, bot hearing with an investigate behaviour,
the HUD objective tracker and the notification stack.

**Still outstanding from the brief:** interactive buttons as a player-actuated mechanic (the trigger
primitive exists; nothing consumes it as a button yet), objective *voice* prompts (text and stinger
only — real VO is the M4 audio pass), and level-streaming readiness. See NEXT_TASK.md.

## Known issues

1. **Visuals still unconfirmed by eye.** The lighting probe says the arena is well exposed from
   every sampled pose, and props/geometry are verified numerically — but nobody has actually looked
   at a rendered frame. The browser pane in this environment never composites, so React Three Fiber
   never mounts. This is the single highest-value thing for the next session.
2. **A genuinely dark room is not achievable** with the current lighting model. Ambient and IBL are
   global terms that no geometry occludes, so the roofed dark room measures 0.219 mean luminance
   against 0.284 on the open floor — dimmer, not dark. Real darkness needs baked ambient occlusion
   or per-zone light probes (M4).
3. **Moving doors briefly raise tick cost** by dirtying the physics query cache, forcing a
   `queryPipeline` rebuild for the rest of that tick. Measured at 0.775 ms during a door transition
   versus 0.423 ms steady state — inside budget either way.
4. **Player-vs-player collision is on but untuned.** Bots may body-block in the 4 m doorways.
5. `rapier` bundle chunk is 2.0 MB (761 kB gzipped) — the compat build inlines its WASM.
6. Modes beyond Team Deathmatch / Free For All / Bot Practice are defined but not implemented; the
   lobby correctly shows them disabled.

## Performance observations

- Simulation: **0.423 ms/tick** at 64 Hz with 6 actors, 4 doors, 26 props and 6 trigger volumes,
  unminified dev build. That is ~3% of a 120 FPS frame budget.
- Trigger occupancy is recomputed from scratch every tick (volumes × actors = 36 checks) rather than
  tracked incrementally, so a teleporting respawn can never leave a stale occupant behind. The cost
  did not register against the tick budget.
- Arena renders in **12 instanced batches** rather than ~100 draws.
- Projectiles, sparks, decals and impact flashes are pooled — zero steady-state allocation in the
  combat path.
- AI re-plans on a staggered 0.6–1.0 s cadence per bot, so pathfinding never spikes on one tick.
- Bundle: 338 kB app + 683 kB three + 2.0 MB rapier + 141 kB react (gzip: 102 / 176 / 761 / 45 kB).

---

## Phase 3 — Multiplayer foundation (added 2026-07-31)

### Networking systems

| System | State | Evidence |
| --- | --- | --- |
| Wire protocol | Versioned, handshake-gated | `net/protocol.ts` |
| Binary serialization | Bounds-checked, varints | Round trip lossless |
| Delta snapshots | 16-bit field mask per actor | 84 B for 6 players, 204 B for 16 |
| Transport abstraction | Local + WebSocket, auto-reconnect | Server accepts both |
| Client prediction | Input recording, replay, camera-smoothed correction | `net/Reconciler.ts` |
| Interpolation / extrapolation | Adaptive delay from measured jitter | 75 ms at zero jitter |
| Lag compensation | Snapshot rewind implemented | **Not yet wired to projectiles** |
| Authoritative server | Runs the same MatchDirector | Boots under Node, 27 MB heap |
| Dedicated server | `npm run server` over `ws` | Nav bake 2271 nodes / 73 ms |
| Validation / anti-cheat | Rate limit, sanitise, fire rate, outcome check | `net/Validation.ts` |
| Game modes | All 7 competitive modes | `gameplay/modes/` |
| Match lifecycle | 7-phase state machine, replicated | `gameplay/MatchFlow.ts` |
| Team balancing | Headcount then rating | `gameplay/TeamBalance.ts` |
| Stats / MVP / XP | Accuracy, damage, streaks, contribution | `gameplay/Statistics.ts` |

### Bandwidth (measured, not estimated)

| Players | Full | Delta moving | Delta idle | Per client @ 20 Hz |
| --- | --- | --- | --- | --- |
| 6 | 215 B | 84 B | 36 B | 13.4 kbit/s |
| 16 (8v8) | 555 B | 204 B | 76 B | 32.6 kbit/s |

A 16-player server therefore pushes roughly 520 kbit/s upstream in total. All four target formats
(2v2, 4v4, 6v6, 8v8) are comfortably inside a normal connection.

### Known limitations

1. **`NetClient` is not written.** The server, protocol, prediction and interpolation modules all
   exist and are unit-verified, but no end-to-end two-client match has been run. This is the single
   most important gap.
2. **Lag compensation is not wired into projectile resolution** — `rewind()` is implemented and
   tested but `ProjectileSystem` still resolves against present-tick positions.
3. **No multiplayer UI** — no server browser, lobby ready screen, or end-of-match/XP screen.
4. **Spectator, replay, voice and chat are not started.**
5. **No aimbot/wallhack defence** — out of scope for input validation by nature.
6. **Bots ignore objectives** in the new modes.
7. ~~Nobody has looked at a rendered frame.~~ **RESOLVED** - first playtest 2026-07-31, see
   [PLAYTEST_REPORT.md](./PLAYTEST_REPORT.md). Three blockers found and fixed (weapon covering the
   crosshair, view-model bloom blowout, oversized light shafts); four issues open (click-to-fire,
   actor collision shoving idle players, 37-60 FPS against a 120 target, broken draw-call readout).

---

## Phase 4 - Multiplayer validation (added 2026-07-31)

### Validated end to end

Three real `NetClient` instances over real WebSockets against the dedicated server, 8 s match:

| Metric | Result |
| --- | --- |
| Clients connected | 3/3 |
| Peer visibility | 3/3 see all peers |
| Snapshots | 175-190 each, **0 dropped** |
| Ping / jitter / loss | 2-4 ms / 6-8 ms / 0% |
| Peer position divergence | 1-25 mm |
| Bandwidth per client | 1.1 KB/s down, 2.6 KB/s up |
| Disconnect cleanup | Peer removed from survivors' worlds |
| Verdict | **PASS** |

Reproduce with `npm run server -- --port 8090 --bots 0` then
`npm run nettest -- --port 8090 --clients 3`.

### Added this phase

- `net/NetClient.ts` - prediction, reconciliation, interpolation sampling, RTT/jitter/loss tracking
- `net/LagCompensation.ts` - server rewind, 250 ms cap, impossible-movement rejection
- `ui/hud/NetOverlay.tsx` - F3 developer overlay with latency graph
- `scripts/netTest.ts` - headless multi-client validation harness
- `Game` network modes (`offline` / `client`)
- `docs/NETWORK_ARCHITECTURE.md`

### Production blockers

1. ~~Prediction correction rate~~ **RESOLVED.** Two root causes found and fixed (comparing across
   time; server skipping inputs). Now 3-4 corrections/s with 0.05-0.10 m error for a player in open
   space. Residual 22/s for players in *physical contact* is actor-collision divergence - diagnosed,
   fix specified, not yet implemented.
2. **Lag compensation is not called** - `ProjectileSystem` still resolves against present-tick
   positions server-side.
3. **No multiplayer UI** - no server browser, lobby, ready check, or end-of-match screen.
4. **Stress tested at 3 clients only** - 8v8 and 16-player figures are projections from snapshot
   measurements, not observed under socket load.
5. **Bots ignore objectives**, so five of seven modes cannot be played offline.
6. **No spectator or replay** beyond the `SnapshotHistory` foundation.
7. ~~Nobody has looked at a rendered frame.~~ **RESOLVED** - first playtest 2026-07-31, see
   [PLAYTEST_REPORT.md](./PLAYTEST_REPORT.md). Three blockers found and fixed (weapon covering the
   crosshair, view-model bloom blowout, oversized light shafts); four issues open (click-to-fire,
   actor collision shoving idle players, 37-60 FPS against a 120 target, broken draw-call readout).

---

## Phase 7 - Playtest-driven fixes (2026-07-31)

Two playtest iterations. Every fix verified by running the game.

### Fixed and verified

| Issue | Verification |
| --- | --- |
| Click-to-lock also fired the weapon | Spawns at 6/6 charge (was 4/6) |
| Idle player shoved across the arena and killed | Holds spawn at (-25, 0, -21.5) |
| Draw-call readout stuck at "1 DRAW" | Reports 110-167, matching the visible scene |
| Weapon covering the crosshair | Crosshair visible, weapon reads correctly |
| Weapon blooming into a glowing slab | Restrained accent, no blowout |
| Light shafts filling the screen | Much smaller (still prominent) |

### Render profile

| Metric | Before | After |
| --- | --- | --- |
| Draw calls | 167 | **110** |
| Active point lights | 20 | **17** |
| Triangles | 14,081 | 12,603 |
| Frame time median / p95 | 16.8 ms | 16.7 / 17.3 ms |
| Simulation | 0.6 ms/tick | 0.7 ms/tick |
| JS heap | 37 MB | 43 MB |

### Blockers

1. **4+ client network runs fail.** Server healthy and transmitting; clients receive and send
   nothing. Likely a harness limitation (eight full game clients in one Node event loop), but
   unresolved - **blocks all scaling figures above three clients**. See NETWORK_BENCHMARK.md.
2. **120 FPS target unmeasurable** - vsync-capped at 60. Needs a vsync-independent measurement.
3. **Prediction corrections not re-measured** after the actor-collision change; the 2-client run
   still showed one client at 22/s.
4. Lag compensation still not wired into `ProjectileSystem`.
5. Listen server, objective-aware bots, multiplayer UI, spectator and replay all still outstanding.

---

## Networking sprint (2026-07-31)

### Changed since last status

| Item | Before | After |
| --- | --- | --- |
| 4-client multiplayer | FAIL - no snapshots, no input sent | **PASS** - all peers visible, 0 dropped |
| Lag compensation | Implemented, never called | **Live** - per-shooter rewind by measured RTT |
| Telemetry | None | Ring-buffered events, heatmaps, pluggable sinks |
| Tests | 29 | **41** |

### Measured

3 clients with bots and lag compensation active: PASS, 128-133 snapshots each, 0 dropped,
tx 8.1 KB/s / rx 9.3 KB/s server-side, 25 MB heap.

### Open blockers

1. **8 clients fail.** Server healthy and transmitting (41.7 KB/s, snapshots scaling correctly);
   clients receive nothing. 4 works, 8 does not - the boundary is now known.
2. **Prediction corrections at 22/s.** Phase 7 blamed actor-vs-actor collision and removed it. The
   rate did not change, so that attribution was wrong and the cause is unidentified. The A/B harness
   shows the replay path is bit-identical to the live path, so it is not the simulation.
3. **120 FPS target unmeasurable** - vsync-capped at 60.
4. Draw calls dominated by 137 unbatched prop and avatar meshes vs 21 instanced.
5. Listen server, objective-aware bots, multiplayer UI, spectator and replay outstanding.
