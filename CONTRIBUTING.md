# Contributing to Project Photon

## Setup

Requires Node 20+.

```bash
npm install
npm run dev     # http://127.0.0.1:5180
```

## Before you claim a change is done

```bash
npm run validate    # typecheck + lint + test + build
```

Then **run the game and look at it**. This is not optional politeness. This project spent six
development phases with every automated check green while the first-person weapon covered the
crosshair and the game could not be aimed. Automated checks validate the questions you thought to
ask; playing it asks all of them at once.

## Standards

**TypeScript is strict.** `any` is a lint error. If you need an escape hatch, use `unknown` and
narrow it.

**The simulation is sacred.** `gameplay/`, `ai/`, `physics/`, `maps/`, `net/` and `util/` must never
import from `render/`, `ui/`, React or Three.js, and must never use `Math.random()` or
`import.meta.env`. That boundary is what makes the dedicated server and client prediction possible.
See [AI_HANDOFF.md](docs/AI_HANDOFF.md).

**Comment the why, not the what.** The comments in this codebase explain trade-offs, rejected
alternatives and traps. A comment restating the line below it is noise; a comment explaining why the
obvious approach was wrong is worth its space.

**Measure, do not assert.** "Faster" is not a claim. "Draw calls 167 to 110" is.

## Validating by area

| Touched | Also run |
| --- | --- |
| Networking | `npm run nettest -- --clients 3` and `npm run predict-ab` |
| Prediction / movement | `npm run predict-ab` — replay must stay bit-identical to the live path |
| Rendering | Record draw calls and frame time before and after (F3 overlay, bottom-right readout) |
| Lighting or a new arena | `__PHOTON__.probeLighting(pos, yaw, pitch)` from each spawn |
| Serialization | `npm run test` — the round-trip suite is the tripwire |

## Commit convention

Conventional Commits:

```
feat(net): consume client inputs FIFO so none are skipped
fix(render): stop EffectComposer resetting the draw-call counter
perf(render): cap concurrent impact lights at 3
docs(architecture): record the emissive scale-invariance trap
test(net): cover snapshot baseline eviction
chore(ci): add netcode integration job
```

Scopes follow the source directories: `engine`, `gameplay`, `ai`, `physics`, `net`, `render`, `ui`,
`maps`, `audio`, `config`, `util`, plus `ci`, `docs`, `deps`.

## Pull requests

The template asks how the change was validated and for before/after measurements. Both are
load-bearing; a PR claiming "improved performance" without numbers will be asked for them.

## Documentation

Update as part of the change, not afterwards:

- `PROJECT_STATUS.md` — if what works or what is broken changed
- `CHANGELOG.md` — what changed and why, with measurements
- `NEXT_TASK.md` — if you finished the current task or found a more important one
- `SESSION_LOG.md` — decisions taken, and anything that misled you

That last one matters more than it looks. Recording a failed hypothesis saves the next contributor
from repeating the investigation.
