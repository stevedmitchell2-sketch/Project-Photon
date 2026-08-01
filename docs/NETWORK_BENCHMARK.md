# Network Benchmark

Measurements, not estimates. Every table here was produced by a script in `scripts/`, and the
command that produced it is named above it so it can be re-run.

Working philosophy: **Observe → Measure → Fix → Play Again.**

---

## Harnesses

| Script | Command | What it answers |
| --- | --- | --- |
| `netTest.ts` | `npm run nettest -- --port 8090 --clients 3` | End-to-end smoke test over real WebSockets against a separately launched server. |
| `latencySweep.ts` | `npm run latency-sweep -- --seconds 20` | Prediction, hit registration, responsiveness and bandwidth across a latency range, over `LocalTransport` with injected delay. |
| `predictionAlign.ts` | `npm run predict-align -- --latency 150 --peers 2 --index 1` | Whether reconciliation compares a prediction against the server state for the *same* tick. |
| `processScale.ts` | `npm run scale -- --clients 16 --seconds 15` | Client count, CPU, memory and bandwidth with every client in its own process. |
| `predictionAB.ts` | `npm run predict-ab` | Whether the replay path is bit-identical to the live path. |

`LocalTransport` is used for the sweep deliberately: it implements the same `Transport` interface as
the WebSocket path with `simulatedLatencyMs` built in, so the identical session code runs over a
controlled link. Everything above the wire is real — real `NetServer`, real `MatchDirector`, real
serialization, delta compression, prediction and reconciliation.

---

## Latency sweep

`npm run latency-sweep -- --seconds 20`

**Scenario.** A duel, because it is the only arrangement in which lag compensation is observable.
The TARGET strafes continuously; the SHOOTER aims at the position it *renders* — the interpolated
sample a player would actually see — and fires. Prediction figures are read from the target, because
the target is the one that moves: a stationary actor predicts itself perfectly at any latency, and
reporting its error would show a flat 1 mm and say nothing.

### Lag compensation ON

| RTT set | RTT seen | Mean err | Max err | Corr/s | Shots | Hits | Hit % | Ack lag | Down | Up | Srv Hz |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 ms | 1 ms | 174 mm | 283 mm | 18.8 | 47 | 12 | 25.5% | 46 ms | 1.1 KB/s | 2.7 KB/s | 64.0 |
| 20 ms | 35 ms | 356 mm | 579 mm | 20.1 | 47 | 11 | 23.4% | 88 ms | 1.1 KB/s | 4.9 KB/s | 64.0 |
| 40 ms | 56 ms | 387 mm | 886 mm | 20.3 | 47 | 10 | 21.3% | 108 ms | 1.1 KB/s | 6.2 KB/s | 64.0 |
| 60 ms | 75 ms | 556 mm | 897 mm | 20.3 | 47 | 8 | 17.0% | 135 ms | 1.1 KB/s | 7.2 KB/s | 64.0 |
| 80 ms | 93 ms | 586 mm | 1212 mm | 20.3 | 47 | 8 | 17.0% | 155 ms | 1.1 KB/s | 8.5 KB/s | 64.0 |
| 100 ms | 113 ms | 745 mm | 1222 mm | 20.7 | 47 | 9 | 19.1% | 174 ms | 1.1 KB/s | 9.4 KB/s | 64.0 |
| 150 ms | 166 ms | 941 mm | 1555 mm | 21.1 | 47 | 5 | 10.6% | 217 ms | 1.1 KB/s | 11.8 KB/s | 64.0 |
| 200 ms | 211 ms | 1128 mm | 1885 mm | 21.1 | 47 | 6 | 12.8% | 279 ms | 1.2 KB/s | 13.2 KB/s | 64.0 |
| 250 ms | 264 ms | 1371 mm | 2211 mm | 21.0 | 47 | 4 | 8.5% | 331 ms | 1.1 KB/s | 13.3 KB/s | 64.0 |

Snapshot drops: **0 at every latency.** Input drops: **0.** Starvation: **0.8–2.1%.**
"RTT seen" is the client's own ping measurement; it reads ~13 ms high because it includes a server
tick of scheduling on top of the injected link delay.

### Lag compensation OFF — the control

`npm run latency-sweep -- --latencies 0,100,250 --seconds 15 --lagcomp off`

| RTT | Hit % (comp ON) | Hit % (comp OFF) |
| --- | --- | --- |
| 0 ms | 22.2% | 19.4% |
| 100 ms | 19.1% | 8.3% |
| 250 ms | 8.5–11.1% | **2.8%** |

**Lag compensation works, and is worth roughly 2–4× hit rate at latency.** At 250 ms it is the
difference between a weapon that connects sometimes and one that does not connect at all.

This is the first sprint in which that claim is backed by a number, and the reason is that it was
not actually working until this sprint — see *Server-side RTT was never measured* below.

### Conclusions

1. **Tick stability is unaffected by latency.** The server holds 64.0 Hz from 0 to 250 ms.
2. **Downstream bandwidth is flat** at ~1.1 KB/s per client. Snapshot cost does not depend on the link.
3. **Upstream grows ~5×** across the range, 2.7 → 13.3 KB/s. Each input packet carries the window of
   unacknowledged frames, and that window is proportional to RTT. The protocol working as designed —
   loss tolerance bought with upstream — but it is the one cost that scales with latency, and it
   should be capped before public play.
4. **Responsiveness degrades linearly**, 46 ms of acknowledgement lag at 0 RTT to 331 ms at 250 ms.
   The ~46 ms floor is the jitter buffer (2 ticks) plus the 20 Hz snapshot interval.
5. **Hit registration degrades gracefully to ~100 ms, then falls off.** Playable to 150 ms;
   noticeably compromised at 200–250 ms.
6. **The interpolation buffer never widened** from its 75 ms floor at any latency. The adaptive
   widening logic exists, but injected latency is jitter-free so nothing triggered it. Still untested.

### Server-side RTT was never measured

The rewind amount is `rtt/2 + interpolationDelay`, and `rtt` came from `ServerClient.rttMs`, which
was computed in the `Ping` handler like this: on first sight of a sequence number, store the time;
on second sight, measure. **A client sends each sequence exactly once**, so the second sight never
arrived and `rttMs` stayed at 0 for the lifetime of every session. Lag compensation rewound by the
fixed 75 ms interpolation delay and nothing else.

Replaced with a measurement that needs no protocol change: every input packet already echoes the
newest snapshot tick the client has applied, and the server knows when it sent that snapshot. The
gap is a genuine server → client → server round trip. It is taken once per snapshot, because inputs
arrive at 64 Hz and snapshots at 20 Hz — the second and third echoes of the same tick would inflate
the estimate with the time they spent waiting to be sent.

---

## Prediction: what the residual corrections actually are

Four sprints have carried a "residual ~22/s corrections" item. This sprint measured it properly and
**eliminated three hypotheses**, two of which were recorded as leading candidates.

### They are real, and they are not the harness

`npm run scale -- --clients 4 --seconds 12` — every client in its own OS process, own event loop:

| Client | Corrections/s | Mean error |
| --- | --- | --- |
| PROC1 | 2.2 | 24 mm |
| PROC2 | 19.9 | 480 mm |
| PROC3 | 7.3 | 81 mm |
| PROC4 | 19.9 | 581 mm |

Still bimodal with no co-location whatsoever. **The "clients share one event loop" hypothesis is
disproven.** Confirmed independently: adding 0, 1 or 3 idle peers to a single-process session left
the measured client's error flat at 28–29 mm.

### They are not dropped inputs

`MAX_INPUT_BACKLOG` discards the oldest queued input when a client runs ahead, and every discard is
a movement step the server never simulates — a permanent disagreement until the next correction. A
counter was added (`inputHealth().dropped`). Measured across the whole latency sweep: **0 dropped
inputs at every latency.** Disproven.

### Reconciliation is aligned — for the quiet client

`predictionAlign.ts` measures prediction error against the stored prediction at
`acknowledgedTick + n` across a range of `n`. A correct implementation bottoms out at `n = 0`.

Single client, 150 ms RTT, 47 m travelled:

```
  offset  mean error
      -1       60 mm
       0       28 mm   <-- minimum
       1       63 mm
       5      265 mm
      10      521 mm
```

A clean V centred on zero. **Reconciliation compares like with like, and the true prediction error
of a sprinting client at 150 ms RTT is 28 mm** — inside the 50 mm correction tolerance.

### The open question, stated precisely

Three clients, identical input patterns, 150 ms RTT, one session:

| Client | Corrections | Client-measured path | **Server-measured path** | Error at offset 0 | Best offset |
| --- | --- | --- | --- | --- | --- |
| CLIENT1 | 45 | 46.9 m | **46.2 m** | 24 mm | 0 |
| CLIENT2 | 294 | 130.2 m | **46.2 m** | 1612 mm | 10 |
| CLIENT3 | 216 | 53.4 m | **46.2 m** | — | — |

The server says all three actors moved **identically**. The 84 m of extra client-side path on
CLIENT2 is entirely correction snapping: a client that corrects constantly accumulates per-tick
position deltas that were teleports, not travel. Any past measurement using client-side travelled
distance as a proxy for movement was measuring corrections.

The discriminating column is the last one. For the quiet client, error is minimised at offset 0. For
the noisy ones it is minimised at **offset ~10**, close to their acknowledgement lag of 13 ticks.
That is the signature of the server's reported `lastInputTick` lagging the state it actually
simulated, for some clients and not others.

**Now a specific, testable lead rather than a mystery.** First item in `NEXT_TASK.md`. Not a
regression — present and unexplained since Sprint 4.

---

## Client scaling

`npm run scale -- --clients N --seconds 15`, each client a separate OS process.

| Clients | Completed | All peers visible | Snapshots dropped | Server RSS | Server CPU | Aggregate down | Aggregate up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 4/4 | yes | 0 | 94 MB | — | 6.8 KB/s | 16.8 KB/s |
| 8 | 8/8 | yes | 0 | 117 MB | — | 23.4 KB/s | 32.5 KB/s |
| **16** | **16/16** | **yes** | **0** | **137 MB** | **22.2%** | **86.4 KB/s** | **64.7 KB/s** |

Server input starvation at 16 clients: **0.2–0.4% per client.**
Per-client cost, measured inside each client process: **~20% of one core, ~122 MB RSS.**

### Conclusions

1. **Maximum stable client count is at least 16** — the server's configured `maxClients` and the
   design target.
2. **The server is not the constraint.** At full roster it uses 22% of one core and 137 MB. The
   harness costs 16× more CPU than the thing it is testing.
3. **Bandwidth scales as expected.** Downstream per client rises 1.7 → 5.4 KB/s as actor count
   grows, because every client currently receives every actor. Interest management is the lever if
   player counts rise above 16; it is not needed at 16.
4. **Thread utilisation:** the server is single-threaded and stays there. Nothing here argues for a
   worker split.

---

## Three retracted scaling limits

This document has now claimed three different maximum client counts. The history is the useful part:

| Sprint | Claimed limit | Actual cause |
| --- | --- | --- |
| 4 | "does not scale past 4" | `NetClient.connect()` resolved on socket-open instead of on handshake acknowledgement. Clients were "connected" and transmitting nothing. |
| 6 | "at least 8; failures beyond" | Every failing run was a *second* run against a reused server. Fresh servers always passed. |
| 7 | **at least 16** | The Sprint 6 residue was the actor-identity bug: clients never adopted their server-assigned actor id, so any server whose id counter had advanced past 1 broke them. |

Three consecutive sprints, three "the server has a limit" findings, three client-side or harness
causes. The standing note in `NEXT_TASK.md` — *when a system looks broken, first check that the
thing measuring it is honest* — has now been paid for three times.
