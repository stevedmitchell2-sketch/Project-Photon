# NEXT TASK

**Read first:** [CONTENT_ROADMAP.md](./CONTENT_ROADMAP.md), [ASSET_STANDARDS.md](./ASSET_STANDARDS.md),
[ASSET_PIPELINE.md](./ASSET_PIPELINE.md).

Working philosophy: **Observe -> Measure -> Fix -> Play Again.**

The pipeline exists and is proven end to end. **The next sprint makes content, not systems.**

---

## 1. Author Phase 1, in the roadmap's order

Not the manifest's order. CONTENT_ROADMAP explains why:

1. **Wall panel + corner** — two modules replace most of the arena's visible surface. Highest impact
   per hour of anything available.
2. **Competition floor tile** — in almost every frame.
3. **Hero rifle** — the pipeline is already validated against it, so it is the lowest-risk hero
   asset. Full brief in [HERO_WEAPON_SPEC.md](./HERO_WEAPON_SPEC.md).
4. Ceiling light rig, cover barrier, charging station, equipment locker.
5. **Hero athlete last**, because it needs the one remaining piece of engineering.

`npm run asset-audit` is the progress report. When it shows nine of nine present, Phase 1 is done.

## 2. Skeletal animation playback

The only thing content is still blocked on. The importer loads and exposes clips; nothing drives
them, because no rigged asset exists to test against.

**Build it alongside the first character, not before.** A playback system built with nothing to play
is how you get a system that fits no real asset. Requirements are in
[CHARACTER_PIPELINE.md](./CHARACTER_PIPELINE.md), which is explicit about what is implemented and
what is merely specified.

## 3. Migrate the arena to modules, incrementally

`MapBuilder` builds brushes from primitives. The module path adds a second source — a brush kind may
resolve to a kit module instead of a box — and the two coexist, so Arena 01 can be migrated a wall
at a time rather than in one rewrite. See [MODULAR_KIT.md](./MODULAR_KIT.md).

## 4. Known pipeline gaps

Named in ASSET_PIPELINE section "What this pipeline does not do yet". None blocks Phase 1:

- no build-time LOD generation, KTX2 transcoding or mesh optimisation
- `COL_` meshes are extracted but not yet fed into Rapier
- no asset dependency graph

## 5. Still open from earlier sprints

- **120 FPS unmet.** GPU 10-13 ms against 8.33. Fragment-bound; levers are lights per fragment,
  material cost and transparent overdraw.
- **Difficulty is two tiers, not four**, blocked on an arena with sight lines beyond ~10 m. That is
  a *content* requirement now, and belongs to whoever authors Arena 02.
- **Environment atmosphere** — fog, dust, steam, arcs. Budget them; transparent overdraw is the
  third-largest GPU cost.

## Standing note

Eight sprints running, the highest-value change has been to an instrument or to plumbing rather than
to a game system. The rules that came out of it:

- **when a system looks broken, check the instrument first;**
- **when a playtest names a culprit, measure before you fix it;**
- **when a graphics change looks like a win, interleave the A/B before believing it;**
- **when a cost has no draw calls behind it, it is upload or overdraw, not geometry.**

Sprint 12 adds a fifth, and it is about tooling rather than measurement:

- **build the thing that checks the work before doing much of the work.** The audit tool found a
  real specification error on its first run, before a single asset existed to violate it.
