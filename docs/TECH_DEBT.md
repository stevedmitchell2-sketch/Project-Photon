# Technical Debt

Known debt with a cost attached. Items move here when they are real and understood; they leave when
they are paid or consciously accepted.

---

## High — affects correctness

### Server degrades after a client generation disconnects

**Evidence:** every failing multi-client run has been a *second* run against the same server process.
Every first run passes, including 8 clients. A fresh server serves 8 clients cleanly (179–192
snapshots each, 0 dropped); the same server then serves 0 snapshots to the next batch.

This was misdiagnosed for three sprints as a client-count scaling limit. It is not — it is stale
state left behind when clients disconnect. Suspects: `NetServer.disconnect` not fully clearing
per-client state, actor id reuse colliding with `ensureReplicatedActor`, or the match flow parking
in a phase that suppresses snapshots once occupancy drops to zero.

**Cost:** blocks any long-lived server, which is every real deployment.

### Residual prediction corrections, ~22/s on all but one client

Six hypotheses examined; four wrong, two of which were previously reported as fixes. Now known
*not* to be: replay path asymmetry, comparing across time, input skipping, actor collision,
tolerance, arena geometry, or prediction-lookup misses (measured at 1 miss per ~177 comparisons).

Remaining observation: with identical inputs in open floor, the first-connecting client corrects
**0** times while every other client corrects ~22/s. Suspect the harness sends all clients' inputs
back-to-back within one event-loop turn, so only the first lands in a favourable phase relative to
the server tick.

**Cost:** unknown player-visible impact; corrections are smoothed through the camera. Not
demonstrably harmful, but not understood, which is its own risk.

## Medium — affects performance or maintenance

| Item | Cost |
| --- | --- |
| 137 unbatched prop and avatar meshes vs 21 instanced | Dominant draw-call cost. Arena geometry is already batched; dressing and characters are not. |
| Dynamic-light budget is not global | `graphics.maxDynamicLights` caps arena fixtures only; impact flashes, beacons and the muzzle light sit outside it. Produced 20 live lights against a cap of 8. |
| 120 FPS target unmeasurable | Frame time pinned at exactly 1/60 s by vsync. No optimisation claim can be verified until an independent measurement exists. |
| `--legacy-peer-deps` required to install | ESLint 9 against an older plugin peer range. |
| Harness co-locates full game clients | Each test client builds its own physics world and navigation graph. Fine at 8; a process-per-client harness would isolate client behaviour from harness load. |

## Low — cosmetic or deferred

| Item | Cost |
| --- | --- |
| Light shafts read as objects rather than atmosphere | Most visually intrusive element on screen. |
| Weapon idle orientation looks angled | Residual yaw in idle sway. |
| CI netcode job never run on a real Actions runner | Unknown whether the background server and `wait-on` behave there. |
| No LICENSE file | README declares all rights reserved; needs an explicit file before any public push. |
| README screenshots are placeholders | Three captures from a running session. |

## Consciously accepted

Not debt — decisions with a rationale, recorded so they are not relitigated.

- **Flat `src/` layout** rather than a monorepo. Revisit when a second application needs to share
  `gameplay` and `net`.
- **Byte-aligned wire format** rather than bit-packed. ~15% larger, far easier to debug.
- **Actors do not collide with each other.** Players can briefly overlap; in exchange a player can
  hold a position and is not shoved by bots pathing through them.
- **Favour-the-shooter lag compensation.** A player who has broken line of sight can still be tagged
  by a shot that was fair on the shooter's screen.
