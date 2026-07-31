# NEXT TASK

**Read first:** [PLAYTEST_REPORT.md](./PLAYTEST_REPORT.md) and
[NETWORK_BENCHMARK.md](./NETWORK_BENCHMARK.md).

Working philosophy: **Observe → Measure → Fix → Play Again.** Every fix is verified by running the
game, not by reasoning about it.

---

## 1. Settle the 4+ client failure — blocks all scaling work

The server accepts eight clients and transmits correctly (48.4 KB/s, snapshots 39 → 151 → 283 B
exactly as delta compression predicts). But `rx = 0.0 KB/s` — no client sends or receives anything.

**Hypothesis to test first:** `scripts/netTest.ts` co-locates every client in one Node process, and
each is a *complete* game client with its own `PhysicsWorld`, 2271-node navigation bake and 64 Hz
simulation. Eight in one event loop plausibly starves socket I/O.

**Test:** spawn each client as its own process (`--clients 1` × N) and re-measure.
- If clients then receive normally → the harness needs restructuring; make it process-per-client.
- If they still do not → the server's per-client send path has a real bug above three connections,
  and that is a production blocker.

**Do not report any 8v8 or 16-player figure until this is settled.** Everything above three clients
in the benchmark is currently unknown, not passing.

## 2. Re-measure prediction after the actor-collision change

Phase 7 removed actor-vs-actor collision, which was the last known source of contact-case
divergence. The 2-client run still showed one client at 22/s, so this is **not confirmed resolved**.

Re-run `npm run nettest -- --clients 3` once item 1 is settled. Target: under 5 corrections/s
regardless of whether players are in contact.

## 3. Establish a vsync-independent frame-time measurement

Frame time is pinned at exactly 1/60 s, so the 120 FPS target cannot be observed and "60 FPS" means
"hitting the cap". Every optimisation claim is unverifiable until this is fixed.

**Options:** disable vsync in the browser/GPU driver for profiling runs, or render the scene to an
offscreen target in a tight loop and time it directly (the lighting probe already does offscreen
rendering and is a reasonable starting point).

## 4. Batch props and avatars

The remaining draw-call cost: 137 individual meshes versus 21 instanced. Each bot is ~12 meshes and
each prop 2–8. The arena geometry is already batched through `MapBuilder`'s render batches; the
dressing and characters are not.

Not geometry-bound — 12.6k triangles is trivial — so effort spent on mesh complexity is wasted.
Batching is the whole win.

## 5. Then the standing gameplay backlog

Unchanged, in dependency order:

- **Lag compensation → projectiles.** Implemented, tested, still never called.
- **Listen-server path.** Route offline through `NetServer` + `LocalTransport`.
- **Objective-aware bots.** Five of seven modes unplayable offline.
- **Multiplayer UI.** `MatchFlow` and `Statistics` already produce what the screens need.
- **Spectator**, then **replay** — both on `SnapshotHistory`.

## 6. Visual polish, in observed-impact order

From playing it, not from a feature list:

1. **Light shafts** still read as objects rather than atmosphere — the single most visually
   intrusive element. Fade by view angle: subtle head-on, visible obliquely.
2. **Weapon orientation** looks angled at rest; check for residual yaw in the idle sway.
3. **Mid-tone flatness** — surfaces away from a fixture fall to uniform grey. More contrast between
   lit and unlit areas.

## Recommended Phase 8 order

1. Settle the 4+ client failure (blocks all scaling)
2. Re-measure prediction corrections
3. Vsync-independent frame timing
4. Batch props and avatars, then re-profile
5. **Play again** — two iterations have produced findings each time
6. Lag compensation → projectiles
7. Listen server → objective bots → multiplayer UI
8. Visual polish

## Standing note

The two highest-value changes across the last two sessions were both to *instruments*, not to the
game: making the renderer visible at all, and fixing the draw-call counter. When something cannot be
measured, fixing the measurement usually outranks whatever was going to be measured.
