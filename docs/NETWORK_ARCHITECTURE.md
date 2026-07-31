# Network Architecture

Companion to [ARCHITECTURE.md](./ARCHITECTURE.md). This documents replication, prediction,
reconciliation, lag compensation and snapshots in detail.

---

## The contract

**The server is authoritative. Clients send intent, never state.**

No message in the protocol carries a position, health value or score from client to server. That is
structural rather than policy, and it deletes the entire "edit a value in memory and win" class of
cheat. What remains is lying about *intent*, which is a far smaller surface and is what
`net/Validation.ts` polices.

```
client                                             server
  peripherals ─► InputFrame ────── send ──────────► validate
                     │                                  │
                     ▼                                  ▼
              predict locally                  MatchDirector.step()
                     │                                  │
                     │                                  ├─► snapshot (delta vs acked baseline)
                     ▼                                  │
              reconcile ◄──────── snapshot ─────────────┘
```

## Message flow

| Direction | Message | Cadence | Notes |
| --- | --- | --- | --- |
| C→S | `Handshake` | once | Version-gated; mismatch is rejected here rather than desyncing later |
| C→S | `Input` | 64 Hz | Carries a sliding window of unacknowledged frames |
| C→S | `Ping` | 1 Hz | RTT and packet-loss estimation |
| C→S | `Ready` / `TeamSwitch` | on demand | Lobby-phase only for team switching |
| S→C | `FullSnapshot` | on join | No baseline exists yet |
| S→C | `Snapshot` | 20 Hz | Delta against the client's acknowledged baseline |
| S→C | `MatchState` | on change | Phase and phase timer |
| S→C | `Kick` | terminal | Typed reason |

## Input encoding

An input frame is **13 bytes**: tick varint, five quantised int16 axes, one bit-flag byte. Clients
resend a window of up to 16 unacknowledged frames in every packet, so a dropped datagram costs
nothing — the next one carries the frames it would have delivered. That is why the protocol needs
no reliability layer for input.

**Client tick numbers are opaque, monotonic sequence numbers — not timestamps.** The server never
compares them against its own tick counter. The two clocks free-run at 64 Hz from different origins,
so comparing them makes the server consume inputs systematically early or late.

**The server consumes exactly one input per tick, FIFO, and never skips one.** Prediction works by
replaying every unacknowledged frame on top of authoritative state; if the server silently discarded
frames the client had already simulated, the two would disagree permanently and by a little more
each time. An earlier "take the newest, drop the rest" implementation did exactly that. The queue is
bounded instead — a client that builds a backlog loses its *oldest* frames, which shows up as one
correction rather than as accumulating drift.

## Snapshots and delta compression

Each actor carries a 16-bit field mask; only named fields are written. Positions quantise to 16-bit
fixed point over a 256 m cube (~3.9 mm), angles to 16-bit radians (~0.006°).

Measured on the running build:

| Players | Full | Delta (all moving) | Delta (idle) | Per client @ 20 Hz |
| --- | --- | --- | --- | --- |
| 6 | 215 B | 84 B | 36 B | 13.4 kbit/s |
| 16 (8v8) | 555 B | 204 B | 76 B | 32.6 kbit/s |

Round trip is lossless within quantisation — max position error 1.88 mm against a 1.95 mm step,
verified continuously by `dev/netProbe.ts`.

`SnapshotHistory` is a 64-entry ring buffer that serves three jobs simultaneously: delta baselines
for the encoder, the interpolation source for the client, and the rewind history lag compensation
needs. Building it once for all three is why replay is nearly free — the recording already exists.

## Prediction and reconciliation

The client simulates its own movement immediately, records every input by sequence, and on each
snapshot:

1. discards acknowledged inputs,
2. compares its predicted position against the server's,
3. if they differ beyond `POSITION_TOLERANCE` (5 cm), rewinds to server truth and **replays** every
   unacknowledged input through the same `stepMovement`,
4. carries the residual as a decaying **camera** offset rather than snapping the actor.

The actor snaps instantly so shooting stays consistent with the server; the camera pays the
correction off over ~80 ms so the player never sees it. Corrections beyond 2.5 m are shown honestly
— hiding a large desync looks worse than admitting it.

This only works because `stepMovement` is a pure function of `(actor, physics, fixed dt)` with a
seeded RNG. Every determinism rule in the project exists to make this replay trustworthy.

### Comparing against the right moment

Reconciliation compares the server's result against **what the client predicted for that same
tick**, read from a per-tick ring of stored predictions — never against the client's *current*
position.

This is the single most important detail in the whole system, and getting it wrong is subtle
because the game still works. At 20 Hz the client legitimately runs ~3 ticks ahead of the newest
snapshot; at sprint speed that is ~0.4 m of entirely correct lead. An implementation that compares
current-position-to-snapshot measures that lead as prediction error and corrects on essentially
every snapshot. Measured: 20-22 corrections/s before the fix, 3-4/s after.

## Interpolation and extrapolation

Remote actors render ~75 ms behind the newest snapshot — one and a half snapshot intervals, widened
adaptively by measured jitter. Two snapshots always bracket the render time, so motion is
interpolated rather than guessed and a single lost packet is invisible.

Angles interpolate the short way around; a player crossing ±π would otherwise spin 350°.

When snapshots stop arriving, dead reckoning runs for at most 120 ms and then **freezes**. An
extrapolated player who was actually strafing ends up somewhere they never were, and correcting
that afterwards looks far worse than a brief pause.

## Lag compensation

A shooter fires at what their screen shows, which is the world as of `interpolationDelay + rtt/2`
ago. Validating against present server state makes every shot at a moving target miss, and players
correctly report that their hits do not register.

So the server rewinds (`net/LagCompensation.ts`): it reconstructs where every actor was at the
shooter's view time, tests, and restores. Restoration happens in a `finally` — a world left rewound
would make every subsequent hit test in that tick wrong.

**The trade-off, stated plainly:** rewinding means a player who has already stepped behind a wall can
still be tagged by a shot that was fair on the shooter's screen. That is the conventional
"favour the shooter" choice. The alternative makes shooting feel broken for everyone.

Two guards keep it honest:
- rewind is capped at **250 ms**, so a client cannot claim arbitrary latency to shoot further into
  the past;
- a rewound position implying impossible movement is rejected rather than trusted.

## Security model

| Threat | Handled by | How |
| --- | --- | --- |
| Position/health/score editing | Protocol shape | No message carries them upward |
| Speed hacks | `validateOutcome` | Post-simulation speed and displacement check |
| Teleports | `validateOutcome` | Per-tick displacement ceiling, mantle-aware |
| Rapid fire | `validateFire` | Server-side fire interval, independent of client claims |
| Packet floods | `acceptPacket` | Rolling per-second rate limit |
| Malformed packets | `ByteReader` bounds checks | Throws `ProtocolError`; packet dropped, never partially applied |
| Replayed inputs | Monotonic sequence check | Duplicates discarded for free |

Violations accrue strikes that decay with good behaviour, so a laggy client is not slowly kicked for
being laggy.

**Not covered:** aimbots and wallhacks. Those need behavioural analysis and server-side visibility
culling respectively. Named here rather than pretended at.

## Testing

`scripts/netTest.ts` drives real `NetClient` instances over real WebSockets against a real server,
with no renderer. It is the test that answers what a screenshot cannot.

```bash
npm run server -- --port 8090 --bots 0
npm run nettest -- --port 8090 --clients 3 --seconds 8
```

Latest result (3 clients, 8 s):

| Metric | Result |
| --- | --- |
| Connected | 3/3 |
| Peer visibility | 3/3 see all peers |
| Snapshots | 175–190 received, **0 dropped** |
| Ping / jitter / loss | 2–4 ms / 6–8 ms / 0% |
| Peer position divergence | 1–25 mm |
| Bandwidth per client | 1.1 KB/s down, 2.6 KB/s up |
| Disconnect cleanup | Peer removed from surviving clients' worlds |
| Corrections/s | **14–21 (too high — see below)** |

The harness must be paced at real time. An earlier version drove ticks as fast as the loop allowed,
sent ~570 input packets/second, and was correctly kicked by flood protection.

## Prediction accuracy report

Measured with `scripts/netTest.ts` against a live dedicated server, 64 Hz tick, 20 Hz snapshots.

| Scenario | Corrections/s | Typical error |
| --- | --- | --- |
| Before fixes | 20–22 | 0.05–0.37 m |
| Solo client, no peers | **4** | 0.098 m |
| Multi-client, player in open space | **3** | 0.054 m |
| Multi-client, players in contact | 22 | 0.23 m |

Three causes were investigated and dispatched:

1. **Comparing across time** *(root cause, fixed)*. Reconciliation compared the client's *current*
   position against an *older* snapshot. See "Comparing against the right moment" above.
2. **Input skipping** *(real bug, fixed)*. The server took only the newest queued input and
   discarded the rest, so anything arriving while it sat between ticks was never simulated —
   permanent accumulating drift. Inputs are now consumed FIFO with a bounded backlog.
3. **Replay path asymmetry** *(ruled out by measurement)*. `scripts/predictionAB.ts` runs identical
   input through the live path and the replay path: **0 m divergence** over 640 ticks with no other
   actors, 1.9 mm with six. `physics.step()` makes no difference. The replay path is sound.

Also tried and rejected: raising the position tolerance above the noise floor. It moved the rate only
22→17/s while making the system blind to genuine errors, and was reverted.

## Open problems

1. **Actor-vs-actor collision divergence.** The remaining correction rate — 22/s for players in
   contact versus 3–4/s otherwise — comes from the client predicting collision against *interpolated*
   peer positions while the server uses live ones. The standard fix is to exclude remote actors from
   the local player's collision filter during prediction and let the server arbitrate contact,
   accepting a small visual overlap in exchange for stable prediction.
2. **Lag compensation is implemented but not yet called** from `ProjectileSystem` — bolts still
   resolve against present-tick positions server-side.
3. **No listen-server path.** `LocalTransport` exists and is tested, but offline play still runs the
   simulation directly rather than through it, so the claim that "single-player exercises the
   netcode" is aspirational rather than current.
4. **Client FPS is not reported** in the network overlay — the overlay reads `NetClient`, which does
   not see the render loop.
