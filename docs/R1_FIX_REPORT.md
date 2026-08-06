# R1 FIX REPORT

**Issue:** projectiles are not drawn leaving the weapon barrel.
**Status:** **fixed and verified.** Baseline stability confirmed; safe to proceed to asset work.
**Date:** 2026-08-06

---

## 1. The issue

Found by measurement during the character asset audit, not by report. It predates that work and is
unrelated to it.

The simulation spawns a bolt at a fixed offset from the shooter's eye:

```ts
// WeaponSystem.ts
const MUZZLE_FORWARD = 0.42;
const MUZZLE_DOWN = 0.14;
origin = eyePosition + aim × MUZZLE_FORWARD, minus MUZZLE_DOWN in Y
```

That point is **not where the weapon is.** Measured live in Apex, standing still:

| | Position |
|---|---|
| Simulation origin | (−24.678, 1.560, −20.730) |
| Visible `SOCKET_muzzle` (world) | (−24.467, 1.517, −20.344) |
| **Error** | **0.442 m** |

Decomposed: the visible weapon sits **0.21 m to the shooter's right** of the aim axis, and its muzzle
is **0.39 m further forward** than the point bolts appear from. Bolts therefore materialise behind
and inboard of the barrel.

Direction, team colour and network replication were all correct. Only the origin was wrong, and only
visually.

## 2. Why it was not fixed in the simulation

The obvious fix — read `SOCKET_muzzle` in `WeaponSystem` — is wrong, and it is worth writing down
why, because it will look tempting again.

That origin is **authoritative**. It decides what the bolt collides with, it is replicated to every
client, and it is re-simulated during lag compensation when the server rewinds. Making it depend on
a Three.js transform would:

- put presentation inside the deterministic simulation, breaking the one architectural rule this
  project has held since M1;
- make the origin depend on whether a client had finished loading its view model, so two clients
  running the same inputs would produce different shots;
- desynchronise client prediction from server authority, which is the class of bug that took three
  sprints to find last time.

A cosmetic misalignment is not a good enough reason to break any of that.

## 3. The fix

**Presentation-only correction, in the renderer.** The bolt is drawn starting at the muzzle and
converges onto the authoritative path over its first **3 metres**. This is standard practice: the
visual tracer and the authoritative ray have always been different objects.

Three small pieces:

**`src/render/MuzzleRegistry.ts`** (new) — where each actor's muzzle currently is, in world space.

- `publishMuzzle(actorId, world)` — whatever draws an actor's weapon records its exact socket
  position each frame.
- `muzzleFor(actor, out)` — returns the published position, or estimates one from the actor's
  transform when there is none.
- `muzzleOffset(actor, position, direction, distanceTravelled, out)` — the vector to add to a drawn
  bolt.

The offset calculation is **stateless**, which matters: projectiles are pooled and the renderer may
first observe one several ticks after it spawned, so anything recorded at spawn time would be
unreliable. A bolt flies in a straight line, so its origin is recoverable at any moment:

```
origin  = position − direction × distanceTravelled
offset  = (muzzle − origin) × (1 − min(1, distanceTravelled / 3))
```

**`src/render/ViewModel.tsx`** — publishes the local player's real `SOCKET_muzzle` world position
each frame, and clears it on unmount. Because it reads the socket rather than a constant, an
imported weapon with a different barrel length corrects itself with no code change.

**`src/render/ProjectileRenderer.tsx`** — adds the offset to each bolt's drawn position.

### Remote players

`PlayerAvatars` draws no weapon at all — a remote player's right arm tracks aim but carries nothing —
so there is no socket to read. `muzzleFor` estimates from the actor's transform instead (0.26 m
right, 0.62 m forward, 0.22 m below the eye), matching where the avatar's right arm actually points.

An estimate is worth having: it puts the bolt at the shooter's hand rather than their sternum, which
is the difference a spectator notices. When a real third-person weapon exists it publishes a real
socket and the estimate stops being used.

### Degradation

Zero offset when the shooter is unknown, and zero once past the convergence distance. **Behaviour is
byte-identical to before the fix in every case where a muzzle cannot be determined** — this adds a
correction, it does not replace a code path.

## 4. A bug the fix introduced, and how it was caught

The first implementation published the wrong vector:

```ts
muzzleSocket.getWorldPosition(TMP_A);
muzzle.current.position.copy(group.worldToLocal(TMP_A));  // mutates TMP_A in place
publishMuzzle(actor.id, TMP_A);                            // ...publishes local space
```

`worldToLocal` transforms its argument **in place**. By the time `publishMuzzle` ran, `TMP_A` held
the muzzle in view-model space — `(0, 0.012, −0.6)` — so the registry reported a **31.885 m** error
against the simulated origin instead of the real 0.442 m, and would have drawn every bolt near the
world origin.

The unit tests all passed. It was caught by re-running the live measurement that found the original
defect, which is the point of keeping that measurement runnable. Fixed by publishing before
converting.

## 5. Verification

### Numeric — the original measurement, re-run

| | Before | After |
|---|---|---|
| Simulation origin | (−24.678, 1.560, −20.730) | unchanged |
| Published muzzle (world) | — | (−24.467, 1.517, −20.344) |
| Drawn bolt position at spawn | (−24.678, 1.560, −20.730) | **(−24.467, 1.517, −20.344)** |
| **Distance from drawn bolt to muzzle** | **0.442 m** | **0.000 m** |
| Offset remaining at 3 m travelled | — | **0.000** |

### Visual

Confirmed in Apex: bolts leave the barrel tip and the muzzle flash sits on the emitter. A bolt was
photographed in flight departing the weapon rather than a point behind it.

### Regression suite

11 new tests in `tests/unit/muzzleRegistry.test.ts`, covering:

- a published socket position is returned exactly, and **copied rather than aliased** (a retained
  reference would let the caller's scratch vector rewrite the registry every frame);
- clearing an actor falls back to the estimate;
- the estimate leads forward and to the shooter's right, and rotates with them;
- a freshly spawned bolt is drawn exactly at the muzzle;
- **the spawn point is reconstructed correctly for a bolt already in flight** — the case that broke
  the first design;
- the offset decays monotonically and reaches exactly zero at the convergence distance and beyond;
- an unknown shooter is a no-op.

## 6. Baseline stability — the Phase 1 gate

| Check | Result |
|---|---|
| **Build** | ✅ `vite build` clean, 9.79 s |
| Typecheck | ✅ clean |
| Lint | ✅ clean, `--max-warnings 0` |
| **Test suite** | ✅ **97 passed** / 10 files (was 86) |
| Arena audit | ✅ Apex PASS, 28/28 spawns reachable |
| **Gameplay test** | ✅ deployed into Apex, moved, fired, bolts spawn and travel, impacts register |
| **Multiplayer connection test** | ✅ **PASS** |

Multiplayer detail — 2 clients, 12 s of match:

| | TESTER1 | TESTER2 |
|---|---|---|
| Snapshots | 257 received, 0 dropped | 257 received, 0 dropped |
| Ping | 1 ms (jitter 5 ms, loss 0%) | 1 ms (jitter 5 ms, loss 0%) |
| Peer divergence | 0.002 m | 0.037 m |
| Bandwidth | down 1.1 KB/s, up 6.0 KB/s | down 1.1 KB/s, up 6.0 KB/s |
| Clean disconnect | peer removed from survivor's world: **yes** | |

`corrections/s 22` is the **pre-existing** prediction-correction issue tracked since Sprint 7,
unchanged by this fix and not a regression.

**Baseline stability confirmed. Cleared to proceed.**

## 7. Also fixed

Six Apex neutral spawns were authored inside geometry and relocated by the spawn resolver on every
server start:

- four on the ±13 diagonals, sitting exactly where the long field barriers are;
- two more clipping the Champion's Walk threshold strip by 10 cm in Y.

The resolver was handling all six correctly — that is what it is for — but a spawn authored inside
geometry is still an authoring defect, and six relocation warnings on every boot is noise that
trains people to ignore the log. Moved to clear ground, preserving the arena's 180° pairing. The
server now boots silent.

## 8. Residual risk

- **Third person is corrected but unproven.** The remote-player estimate is analytic and has been
  unit-tested, but no third-person camera exists yet to look down. When one does, verify the bolt
  leaves the visible hand.
- **The convergence distance is a judgement, not a measurement.** 3 m looks right at current bolt
  speed; if projectile speed changes materially, re-check that the bend is not visible.
- **`PlayerAvatars` still draws no weapon**, so remote players fire from an empty hand. That is a
  content gap, not a bug in this fix, and it resolves when the character work lands.

## 9. Recommended next action

Proceed to Phase 2. The build is stable, the regression is covered, and the projectile origin is
correct in first person and corrected-by-estimate in third.
