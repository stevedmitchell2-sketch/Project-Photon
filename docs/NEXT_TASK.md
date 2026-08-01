# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md), [BACKLOG.md](./BACKLOG.md),
[NETWORK_BENCHMARK.md](./NETWORK_BENCHMARK.md).

Working philosophy: **Observe → Measure → Fix → Play Again.**

Sprint 7 closed the infrastructure blockers. The centre of gravity moves to **gameplay** now, and
the ordering below reflects that: the one remaining networking item is a diagnosis, not a blocker.

---

## 1. You die ten seconds after every spawn

The highest-value item in the project, and the first one that came from *playing* rather than
measuring. Reproduced on every deployment of the Sprint 7 playtest: spawn, orient, be tagged before
finding an opponent. Scores ran 7–15 in 50 seconds at 6 players per team — a ten-minute match would
hit the score limit in under three.

Three candidate causes, and they must be **separated before any is tuned**:

| Candidate | How to isolate |
| --- | --- |
| Spawn placement near live combat | Log spawn position and nearest-enemy distance at spawn; the telemetry `occupancy` heatmap and `deaths` heatmap together will show whether spawns sit in fight zones. |
| Bot accuracy at medium difficulty | Set `botDifficulty` to `easy` and re-play. If time-to-death triples, bot aim is the dominant term. |
| Time to kill | 34 damage × 5 bolts at 0.17 s = 0.68 s of sustained fire. Raise `maxShield` or lower `damage` in a branch and play it. |

Do not tune all three at once. Each one changes the feel of the game in a different direction, and
tuning them together makes it impossible to attribute the result.

## 2. Bloom is blowing out the centre of the frame

The dominant visual artefact, and it is not the light shafts — those were diagnosed as the offender
during Sprint 7, fixed, and found not to have been the main problem. Bloom bleeding off the emissive
fixtures puts two large white-cyan teardrops in the middle of the screen from most positions on the
deck, washing out anything behind them.

`PostFX.tsx` owns the bloom pass. The likely levers are threshold and the emissive intensity on the
fixtures themselves — the shaft fix already established that fixture emissives are very hot.

## 3. Finish the residual-correction diagnosis

Not a blocker, and no longer a mystery. Sprint 7 eliminated three hypotheses and narrowed it to one
specific observation, recorded in full in NETWORK_BENCHMARK.md:

- the server reports all clients moving **identically** (46.2 m each);
- the quiet client's prediction error is minimised at reconciliation offset **0** (28 mm — correct);
- the noisy clients' error is minimised at offset **~10**, close to their 13-tick acknowledgement lag.

That is the signature of `ServerClient.lastInputTick` lagging the state the server actually
simulated, for some clients and not others. **Next step:** instrument `stepOnce` to record, per
client per snapshot, the tick whose input was last consumed against the tick the snapshot captured,
and check whether they diverge for the noisy clients. If they do, the acknowledgement is stale and
the fix is in `sendSnapshot`; if they do not, prediction is genuinely diverging and the next suspect
is client-side collision filtering against replicated actors, which use `GROUP_BOT` on the client and
`GROUP_PLAYER` on the server.

## 4. Visual foundation — the rest of Sprint 7's Part B

Sprint 7 delivered avatar instancing and the shaft fade and did **not** reach the rest. Highest
value first, all still open:

1. **Crosshair** — small, thin, grey; nearly invisible against a pale wall.
2. **Team-coloured environment** — every fixture is cyan regardless of who holds the room.
3. **Impact and muzzle FX** — the pooled systems exist; this is authoring, not architecture.
4. **Holographic displays, LED walls, scoreboards** — arena presentation, entirely unstarted.
5. **Volumetric fog, dust, vents, conduits** — environment, entirely unstarted.
6. **Audio** — recharge, impacts, ambience, footstep surface variation, all unstarted.

## 5. Batch the remaining props

Avatars are done — draw calls no longer scale with player count. Arena props are not, and are the
remaining unbatched geometry. Measure before and after with the in-HUD draw counter.

## 6. Make 120 FPS measurable

Open since Sprint 4 and now the oldest unaddressed item in the project. Frame time is pinned at
exactly 1/60 s by vsync, so **no optimisation claim above 60 FPS can be verified** — including the
avatar instancing this sprint, whose benefit had to be demonstrated through draw calls instead.

## Standing note

Five sprints running, the highest-value change has been to an *instrument* or to *plumbing* rather
than to a game system: making the renderer visible, fixing the draw-call counter, fixing a handshake
promise, instrumenting input starvation, and now discovering that server-side RTT had never been
measured at all and that clients never adopted their server-assigned actor id.

Sprint 7 paid for this note a third time on client scaling specifically — three sprints, three
"the server has a limit" findings, three client-side or harness causes.

**When a system looks broken, first check that the thing measuring it is honest.**

The corollary Sprint 7 added: **when something looks broken on screen, play it before fixing it.**
The light-shaft work was done against a misdiagnosis that a screenshot supported and playing refuted.
