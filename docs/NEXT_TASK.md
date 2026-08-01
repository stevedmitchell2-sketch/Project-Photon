# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md), [BACKLOG.md](./BACKLOG.md).

Working philosophy: **Observe → Measure → Fix → Play Again.**

---

## 1. The residual 22/s prediction corrections — now a *bimodal* problem

Sprint 5 found and fixed a genuine systematic cause. It is worth reading what changed before
picking this up, because the shape of the problem is different now.

### What was found

When no input was available for a client on a given tick, the server **re-simulated with that
client's previous input** — advancing the actor by a movement step the client never predicted. Two
64 Hz clocks that are not phase-locked starve constantly, so this was continuous, systematic drift.
At sprint speed one starved tick is 0.13 m; observed errors were 0.05–0.37 m.

**The correlation was decisive:**

| Client | Starved ticks | Corrections/s |
| --- | --- | --- |
| A | 3.4% | **2** |
| B | 12.3% | 22 |
| C | 19.7% | 22 |

### What was done

1. A starved actor now **holds position** instead of replaying stale input — the server never
   simulates a step the client did not.
2. An **input jitter buffer** (`TARGET_INPUT_BUFFER = 2`) primes a cushion before consuming, so
   ordinary clock drift no longer empties the queue. Starvation fell from 19.7/12.3/3.4% to
   **6.6/4.1/1.4%**.

### What remains

Corrections are still **2 / 22 / 22**. That is *bimodal*, not a continuum — and 22/s is exactly the
20 Hz snapshot rate, meaning two clients correct on **every single snapshot** while one almost never
does. Starvation reduction did not move them, so the remaining cause is structural.

**Leading hypothesis: contact with level geometry.** The harness gives each client a different
movement pattern from a different spawn. The one client that stays clean sprints through open floor;
the two that correct constantly run into walls. Collide-and-slide amplifies a sub-millimetre
starting difference into a divergent slide along a surface, and once diverged it re-diverges every
tick.

**How to test it:** run three clients with *identical* patterns in open floor away from geometry.
If all three drop to ~2/s, geometry contact is confirmed and the fix is to make collide-and-slide
resolution insensitive to sub-quantisation position differences — most likely by snapping the
replay's starting position to the same quantisation grid the snapshot uses, so client and server
begin each slide from bit-identical state.

`server.inputHealth()` reports per-client starvation, and the server health line prints it.

## 2. The 8-client failure

4 clients pass; 8 fail. The server accepts all 8, transmits 41.7 KB/s with correctly-scaling
snapshots, and receives nothing back.

**Test:** run each client in its own process rather than co-located. Precedent matters here — the
previous "server does not scale" conclusion turned out to be a client-side promise resolving too
early. Suspect the measuring apparatus first.

## 3. Validate lag compensation under real latency

Wired and running, but only exercised at ~1 ms RTT where rewind is a no-op and proves nothing.
Sweep 20–250 ms via `LocalTransport.simulatedLatencyMs` and record in NETWORK_BENCHMARK.md.

## 4. Then the vertical-slice polish the Sprint 5 brief asked for

Sprint 5 spent its budget on the networking foundation (Steps 1–2 and 8) and did **not** reach the
first-person feel, weapon, HUD and visual work in Steps 3–7. Those remain the largest visible
improvement available, and they are now unblocked:

1. **Batch props and avatars** — 137 unbatched meshes vs 21 instanced. Measurable, mechanical.
2. **First-person feel** — head tilt while sprinting, landing impulse tuning, FOV transition curves.
   `MOVEMENT` already exposes every constant these need.
3. **Weapon polish** — recharge animation, muzzle flash, bolt lighting, scorch decals. The pooled FX
   systems already exist; this is tuning and authoring, not new architecture.
4. **HUD polish** — transitions, reactive crosshair, shield pulse.

Do these **after** playing the game, not before. Every playtest so far has produced findings.

## Recommended Sprint 6

1. Identical-pattern open-floor test to confirm the geometry hypothesis (item 1)
2. Process-per-client harness test (item 2)
3. Latency sweep (item 3)
4. **Play the game**
5. Batch props and avatars, re-profile
6. First-person feel and weapon polish

## Standing note

Four sprints running, the highest-value change has been to an *instrument* or to *plumbing* rather
than to a game system: making the renderer visible, fixing the draw-call counter, fixing a handshake
promise, and now instrumenting input starvation. The pattern is consistent enough to plan around —
when a system looks broken, first check that the thing measuring it is honest.
