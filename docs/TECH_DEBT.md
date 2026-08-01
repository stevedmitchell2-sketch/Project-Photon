# Technical Debt

Known debt with a cost attached. Items move here when they are real and understood; they leave when
they are paid or consciously accepted.

---

## Paid in Sprint 9

### The arena had no team identity — **fixed**

Every strip and fixture was cyan whoever held the room, so the objective banner was the only
team-state signal on screen. Territory rings, spawn beacons and reactive objective lighting now
carry it, built from emissive geometry rather than lights on the strength of the Sprint 8
fragment-bound finding. Measured interleaved at **0.59 ms and 8 draw calls**.

### Combat was tuned for a fight that never happens — **fixed**

The weapon assumed ranged engagements: falloff from 28 m, a 132 m/s projectile, a six-shot cell.
The measured engagement range is 7.0 m, where that projectile needed a 45 cm lead against a strafing
player and a single miss forced a mid-fight recharge. Retuned for the real distance, with damage
lowered to keep time-to-kill where the Sprint 8 rebalance put it.

Note this pays down a *symptom*. The cause — bots closing to contact regardless of `engageRange` —
is still open and is the first item in NEXT_TASK.

---

## Paid in Sprint 8

### 120 FPS was unmeasurable — **fixed**

The oldest item in the register, open since Sprint 4. Frames per second cannot answer the question
on a vsynced display: the interval is pinned to one refresh regardless of the work done. CPU frame
time is now bracketed across the frame, and GPU frame time comes from
`EXT_disjoint_timer_query_webgl2`.

The first measurement inverted the project's understanding of its own renderer: **CPU 1.4–1.9 ms,
GPU 12.0–12.5 ms, fragment-bound.** Draw calls were never the constraint, so the batching work of
Sprints 6–7 was optimising the wrong axis. Not wasted — the avatar instancing is still correct and
still needed at 16 players — but it was never what stood between the build and its target.

### Disabling every post effect turned off rendering — **fixed**

`RendererStats` registers a positive-priority `useFrame`, which switches R3F out of automatic
rendering. With bloom, vignette, grain and chromatic aberration all off, `PostFX` returned null,
`EffectComposer` unmounted and nothing rendered — a black screen with zero draw calls, reachable
from the settings menu. Now falls back to a direct scene render at the same priority.

### The ten-second death — **fixed, and the diagnosis was wrong**

Carried into this sprint as three candidate causes to isolate. Measurement cleared spawn placement
outright: median nearest enemy at spawn 30.3 m, none within 15 m, 2% with line of sight. The cause
was that `medium` shot like a good human. Rebalanced; default median life 10.0 s → ~14 s, deaths
inside ten seconds 50% → 32%.

### Spawn occupancy was never checked — **fixed**

Threat, sight lines and recency were all scored; nothing checked whether the point was physically
free.

---

## Paid in Sprint 7

Kept rather than deleted, because what each one turned out to be is more useful than the fact that
it is gone.

### Server degrades after a client generation disconnects — **fixed**

Carried as the highest-priority item for three sprints and misdiagnosed the whole time, first as a
client-count scaling limit and then as stale server state. It was neither: **the server was never at
fault.**

A networked client creates a local player before it connects, so the match is playable while the
handshake is in flight, and the server then assigns the id that player will really have. Nothing
merged those two identities. The consequence depended entirely on the server's id counter:

- id unoccupied locally → the snapshot reaper deleted the local player as a departed peer, and the
  client silently stopped simulating, sending input, or acting on anything it received;
- id occupied locally — **any server with bots** — → every snapshot overwrote the local player with
  a bot's state, and the camera rode the bot.

Invisible for three sprints because the only multi-client testing used a freshly started, botless
server, where locally-allocated ids 1..N coincidentally equalled server ids 1..N and stopped
matching the moment the counter advanced.

Fixed by `MatchDirector.adoptLocalActorId`, with the snapshot reaper hardened to exempt both
spellings of "me" as defence in depth. Five regression tests in
`tests/integration/actorIdentity.test.ts`, all of which run against a server whose counter has
already advanced — the case that was never exercised.

### Server-side RTT was never measured — **fixed**

`ServerClient.rttMs` was computed by storing a ping sequence on first sight and measuring on the
second. Clients send each sequence exactly once, so the second sight never came and the value stayed
at 0 for the lifetime of every session. Lag compensation therefore rewound by the fixed 75 ms
interpolation delay and nothing else, which is to say it was not doing its job at all.

Cost, measured: hit rate on a strafing target at 250 ms RTT was 2.8%; with RTT measurement working
it is 8.5–11%.

Replaced with a measurement that needs no protocol change — input packets already echo the newest
snapshot tick, and the server knows when it sent that snapshot.

### Every player forced onto red on any botless server — **fixed**

`defaultBalanceConfig(teams, maxPerTeam)` was being passed `settings.botsPerTeam`. On a server
started with `--bots 0` the cap was zero, `pickTeamForJoin` found no team with room and returned
null, and every client fell through to the `teams[0]` default. Since friendly fire is off in team
modes, **nobody on the server could damage anybody.** Team play was impossible on exactly the
configuration used for every automated test.

### Kicked clients leaked their actor — **fixed**

`kick()` removed the client record but not its actor. Every timeout, rate-limit and invalid-input
kick left an abandoned actor in the arena for the life of the server — replicated to everyone,
occupying a spawn, costing a capsule. Now routed through the same cleanup as a voluntary disconnect.

### Draw calls scaled with player count — **fixed**

The avatar rig is fifteen meshes, drawn per player: 75 draw calls at five bots, 240 at a full
sixteen. Now instanced by (geometry, material), so the cost is a constant ~18 batches regardless of
roster. Measured: 146 draw calls at 5 bots and 146 at 11.

---

## High — affects correctness

### Residual prediction corrections — narrowed, not closed

No longer a mystery, and no longer a blocker. Three further hypotheses were eliminated this sprint
with measurements rather than reasoning:

- **co-location of clients in one event loop** — disproven; process-per-client shows the same
  bimodal split, and adding idle peers to a single-process session leaves error flat at 28–29 mm;
- **the server discarding queued inputs** — disproven; a counter shows 0 drops at every latency;
- **reconciliation comparing across time** — disproven *for the quiet client*, whose error is
  minimised at reconciliation offset 0.

What remains is one precise observation: the server reports every client moving identically
(46.2 m), the quiet client reconciles correctly at offset 0, and the noisy ones minimise at offset
~10 — close to their 13-tick acknowledgement lag. That is the signature of a stale acknowledged tick
for some clients and not others.

**Cost:** a correction every snapshot on affected clients. Visible as micro-stutter under latency;
not visible in single-player. Next step is written out in NEXT_TASK item 3.

### The venue is a room, not an arena

Team identity landed in Sprint 9, but the arena around it has no holographic displays, no LED
scoreboards, no branding or advertising, and no introduction or victory sequences. It reads as a
well-lit hall rather than a venue staging a match.

---

## Medium — affects velocity or confidence

### 120 FPS is not achievable at current visual settings

Now measured rather than unknown. Closing 12.2 ms to 8.33 ms needs a 32% cut, roughly
`renderScale` 0.6 — a serious quality loss. The target is deliberately **not** being met by gutting
resolution. The real work is per-pixel: light count per fragment, material cost on non-metallic
architecture, transparent overdraw.

### Bots close to 7 m before shooting

Median engagement range is identical at every difficulty and does not respond to `engageRange`.
Sprint 9 tuned the weapon to suit it, so this is no longer a combat-feel problem — it is a wasted
design surface. Falloff bands, ADS and projectile lead exist and are never used, and the arena's
long sight lines do nothing.

### Arena props still unbatched

Avatars are done; props (2–8 meshes each) are the remaining unbatched geometry.

### Adaptive interpolation buffer has never run

Held at its 75 ms floor at every latency in the sweep, because injected latency is jitter-free. The
widening logic is untested code on a path that matters under real network conditions.

### Upstream bandwidth scales with RTT, uncapped

2.7 KB/s at 0 ms to 13.3 KB/s at 250 ms, because each input packet resends the unacknowledged
window and that window is proportional to RTT. Working as designed; the resend window should be
capped before public play.

### `--legacy-peer-deps` required

ESLint 9 against an older plugin peer range. Works, but should be resolved properly.

### Harness co-located with source

`scripts/lib/loopbackSession.ts` is imported by both `scripts/` and `tests/integration/`. Fine at
this size; would want a proper test-support package if it grows.

---

## Consciously accepted

- **Primitive avatars.** The rig interface is designed so an authored character swaps in without
  touching what drives it, and instancing does not change that — the pose function is unchanged.
- **Single-threaded server.** At 16 clients it uses 22% of one core. Nothing argues for a split.
- **Every client receives every actor.** Measured fine at the design target of 16.
- **`LocalTransport` used for the latency sweep** rather than a real network. Everything above the
  wire is the real session code; only the wire is substituted, and it is the only way to get a
  controlled, repeatable link.
