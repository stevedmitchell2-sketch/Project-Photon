# Network Benchmark

All figures measured against a live dedicated server. Where a number is a projection rather than an
observation it says so explicitly.

**Method:** `npm run server -- --port 8110 --bots 0`, then
`npm run nettest -- --port 8110 --clients N --seconds 6`.

---

## Client-count scaling

| Clients | Server tx | Server rx | Snapshot size | Client down | Client up | Corrections/s | Peer divergence | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 1.6 KB/s | 7.0 KB/s | 39 B | 0.8 KB/s | 3.2 KB/s | 3–22 | 0.118 m | **PASS** |
| 3 | — | — | — | 1.1 KB/s | 2.6 KB/s | 3–4 | 0.001–0.025 m | **PASS** |
| 4 | 12.3 KB/s | **0.0 KB/s** | 151 B | 0 | 0 | — | — | **FAIL** |
| 8 | 48.4 KB/s | **0.0 KB/s** | 283 B | 0 | 0 | — | — | **FAIL** |
| 16 | not run | | | | | | | |

### The 4+ client failure

The server is **healthy** in these runs. It accepts every connection, reports the correct client
count, and transmits at a rate that scales sensibly with load (12.3 KB/s at four clients, 48.4 KB/s
at eight, with snapshots growing 39 B → 151 B → 283 B exactly as delta compression predicts).

What fails is the client side: `rx = 0.0 KB/s` means **no client sent a single packet**, and each
reported zero snapshots received *and* zero dropped — so no message reached their decoder at all.

**Leading hypothesis: this is a harness limitation, not a server defect.** `scripts/netTest.ts`
co-locates every client in one Node process, and each client is a *complete* game client — its own
`PhysicsWorld`, its own 2271-node navigation bake, and its own `MatchDirector` stepping at 64 Hz.
Eight of those in one event loop plausibly starves socket I/O, which would produce exactly this
signature: the server sending happily into sockets nobody is draining.

This is unresolved and must not be reported as a passing 8v8 result.

**To settle it:** run each client in its own process (`--clients 1` × N, spawned separately) and
re-measure. If clients then receive normally, the harness is at fault and needs restructuring. If
they still do not, the server's per-client send path has a real bug above three connections.

### Snapshot size scaling — the one solid server-side result

| Clients | Snapshot | Bytes/client/s @ 20 Hz | Projected per-client kbit/s |
| --- | --- | --- | --- |
| 2 | 39 B | 780 | 6.2 |
| 4 | 151 B | 3020 | 24 |
| 8 | 283 B | 5660 | 45 |

Growth is close to linear in actor count, which is what delta compression should produce. A 16-player
server extrapolates to roughly 550 B per snapshot and ~88 kbit/s per client — comfortably inside any
broadband connection, but **extrapolated, not measured**.

## Prediction accuracy

Measured at 2 and 3 clients (see [NETWORK_ARCHITECTURE.md](./NETWORK_ARCHITECTURE.md) for the full
investigation).

| Scenario | Corrections/s | Typical error |
| --- | --- | --- |
| Before Phase 5 fixes | 20–22 | 0.05–0.37 m |
| Solo client, no peers | 4 | 0.098 m |
| Multi-client, open space | 3 | 0.054 m |
| Multi-client, players in contact (before Phase 7) | 22 | 0.23 m |

Phase 7 removed actor-vs-actor collision, which was the last known source of contact-case
divergence. The 2-client run above still shows one client at 22/s, so **this is not yet confirmed
resolved** — it needs a clean re-measurement once the harness issue is settled.

## Render profile

Measured in-game, standing in the centre lane of Arena 01 with bots fighting.

| Metric | Before Phase 7 | After Phase 7 |
| --- | --- | --- |
| Draw calls | 167 | **110** |
| Triangles | 14,081 | 12,603 |
| Active point lights | 20 | **17** |
| Shader programs | 28 | 35 |
| Frame time (median) | 16.8 ms | 16.7 ms |
| Frame time (p95) | — | 17.3 ms |
| Simulation | 0.6 ms/tick | 0.7 ms/tick |
| JS heap | 37 MB | 43 MB |

### The 120 FPS target is currently unmeasurable

Frame time sits at 16.7 ms — **exactly 1/60 s**. The display is vsync-capped at 60 Hz, so the
project's 120 FPS target cannot be observed in this environment at all, and "60 FPS" here means
"hitting the cap", not "at the limit".

Headroom must be measured another way before any optimisation claim can be made: disable vsync, or
render to an offscreen target in a loop and time it. Until then, the honest statement is that the
frame is comfortably inside a 16.7 ms budget and its true cost is unknown.

### Bottlenecks identified

1. **Dynamic light count.** 20 live point lights against a configured cap of 8 — impact flashes,
   prop beacons and the muzzle light were all outside the budget. Every lit surface shader evaluates
   every light, so this is charged against the whole frame. Reduced to 17; the arena's own 12
   fixtures are now the floor and should be the next target.
2. **Draw calls from individual prop and avatar meshes.** 137 plain meshes versus 21 instanced. Each
   bot is ~12 separate meshes and each prop 2–8. Batching avatars and props the way the arena
   geometry is already batched is the obvious win.
3. **Not geometry-bound.** 12.6k triangles is trivial. Any optimisation effort spent on mesh
   complexity would be wasted.

## Outstanding

- Resolve the 4+ client harness/server question — **blocks every figure above 3 clients**.
- Re-measure prediction corrections after the actor-collision change.
- Establish a vsync-independent frame-time measurement.
- 16-client run has never been attempted.

---

# Sprint 6 — Validation results (2026-07-31)

Two long-standing hypotheses were tested and **both disproven**. Method: `npm run nettest` with the
new `--scenario` flag against a dedicated server.

## Client scaling — the limit was never real

| Clients | Server state | Snapshots each | Dropped | Peers visible | Result |
| --- | --- | --- | --- | --- | --- |
| 3 | fresh | 128–133 | 0 | all | PASS |
| 4 | fresh | 129–135 | 0 | all | PASS |
| **8** | **fresh** | **179–192** | **0** | **all 7/7** | **PASS** |
| 4 | reused | 0 | — | — | FAIL |
| 8 | reused | 0 | — | — | FAIL |

**Conclusion: maximum stable client count is at least 8, and the failure was never about client
count.** Every failing run in three sprints was a *second* run against a server that had already
served and lost a previous batch of clients. Every first run passes.

The real defect is **stale server state after a client generation disconnects**, now recorded in
TECH_DEBT.md as the highest-priority correctness item. 16 clients remain untested.

## Geometry hypothesis — disproven

Sprint 5 hypothesised that level-geometry contact drove the residual correction rate, since the
harness gave each client a different movement pattern from a different spawn.

Tested with `--scenario open`: **identical inputs** for every client, driving straight out of spawn
across open floor.

| Client | Travelled | Comparisons | Lookup misses | Corrections/s | Error |
| --- | --- | --- | --- | --- | --- |
| 1 | 7.9 m | 176 | 1 | **0** | 0.000 m |
| 2 | 8.2 m | 177 | 1 | 22 | 0.724 m |
| 3 | 8.2 m | 177 | 1 | 22 | 0.724 m |

Identical inputs, identical environment, near-identical distance travelled, identical comparison
counts — and still bimodal. **Geometry is not the cause.**

The lookup-miss instrumentation added this sprint also rules out a second candidate: the perfect
client is genuinely comparing (176 comparisons, 1 miss), not silently skipping evaluation.

**What remains:** the *first-connecting* client corrects zero times; every other client corrects
~22/s. The harness steps all clients back-to-back within one event-loop turn, so only the first
sends in a favourable phase relative to the server tick. That is the next hypothesis, and it is
about the harness rather than the engine.

## Input starvation — fixed and measured

Sprint 5's fix, re-measured:

| Metric | Before | After |
| --- | --- | --- |
| Starved ticks (3 clients) | 19.7 / 12.3 / 3.4% | 6.6 / 4.1 / 1.4% |
| Best-case corrections/s | 22 | 0–2 |
| Best-case error | 0.37 m | 0.000–0.054 m |

## Not measured this sprint

Stated plainly rather than estimated:

- **Latency sweep (20–250 ms).** Not run. Lag compensation remains validated only at ~1 ms RTT,
  where rewind is a no-op.
- **16-client run.** Not attempted.
- **CPU / GPU utilisation under multi-client load.** Not instrumented.
- **Rendering optimisation.** No batching work was done this sprint, so the 110 draw calls / 17
  lights figures from Sprint 4 stand unchanged.
