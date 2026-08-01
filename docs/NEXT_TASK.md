# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md) and
[NETWORK_BENCHMARK.md](./NETWORK_BENCHMARK.md).

Working philosophy: **Observe → Measure → Fix → Play Again.**

---

## 1. Prediction corrections: 22/s, cause unknown

Top open question — and the previous explanation was **wrong**.

Phase 7 attributed the 22/s correction rate to actor-vs-actor collision (the client resolving
contact against interpolated peers, the server against live ones) and removed actor collision
entirely. **The correction rate did not change.** That was not the cause.

Already ruled out, with evidence:

| Hypothesis | Verdict |
| --- | --- |
| Replay path asymmetry | Ruled out — `npm run predict-ab` shows `stepMovement` reproduces the full `MatchDirector.step()` bit-identically (0 m over 640 ticks) |
| Comparing across time | Real bug, fixed in Phase 5 |
| Server skipping inputs | Real bug, fixed — inputs now consumed FIFO |
| Actor-vs-actor collision | Removed in Phase 7, **no change** |
| Tolerance below the noise floor | Tried and reverted; masked real errors |

**Next step: instrument the disagreement rather than hypothesise about it.** For a single
correction, log the acknowledged tick, the stored prediction for that tick, the server's position,
the list of replayed inputs, and the resulting position. One captured example will say more than a
sixth hypothesis.

First thing to check: whether the client's stored prediction tick and the server's acknowledged tick
actually refer to the same simulation step, given each side advances its own counter.

## 2. The 8-client failure

4 clients pass; 8 fail. The server accepts all 8, transmits 41.7 KB/s with correctly-scaling
snapshots, and receives nothing back. The boundary between 4 and 8 is the clue.

**Test:** run each client in its own process rather than co-located, to settle whether this is
harness event-loop saturation (8 full game clients, each with physics, a navigation bake and a
64 Hz simulation, in one Node process) or a real server-side send-path limit.

Note the precedent: the *previous* "server does not scale" conclusion turned out to be a client-side
promise resolving too early. Suspect the measuring apparatus first.

## 3. Validate lag compensation under real latency

Now wired and running, but only exercised at ~1 ms RTT — where rewind is a no-op and proves nothing.
Use `LocalTransport.simulatedLatencyMs` to sweep 20–250 ms and confirm hit registration stays
consistent. Record results in NETWORK_BENCHMARK.md.

## 4. Batch props and avatars

137 individual meshes vs 21 instanced; each bot is ~12 meshes, each prop 2–8. Arena geometry is
already batched through `MapBuilder`. Not geometry-bound — 12.6k triangles is trivial — so batching
is the entire win.

## 5. Standing backlog

- **Listen server** — route offline play through `NetServer` + `LocalTransport`.
- **Objective-aware bots** — five of seven modes unplayable offline.
- **Multiplayer UI** — `MatchFlow` and `Statistics` already produce what the screens need.
- **Spectator**, then **replay** — both build on `SnapshotHistory`.
- **A telemetry sink** — `engine/Telemetry.ts` defines the interface; none ships. A JSON file writer
  on the server would make match data available for analysis immediately.

## 6. Visual polish, in observed-impact order

1. Light shafts still read as objects rather than atmosphere — fade by view angle.
2. Weapon orientation looks angled at rest; check for residual yaw in the idle sway.
3. Mid-tone flatness — surfaces away from a fixture fall to uniform grey.

## Recommended next sprint

1. Instrument one prediction correction end to end (item 1)
2. Process-per-client harness test (item 2)
3. Latency sweep for lag compensation (item 3)
4. **Play the game** — every playtest so far has produced findings
5. Batch props and avatars, then re-profile

## Standing note

Across the last three sessions the highest-value changes were all to *instruments* rather than to
the game: making the renderer visible, fixing the draw-call counter, and fixing a handshake promise
that made clients look unscalable. When something cannot be measured honestly, fixing the
measurement usually outranks whatever was going to be measured.
