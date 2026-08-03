# NEXT TASK

**Read first:** [PROJECT_STATUS.md](./PROJECT_STATUS.md), [ASSET_PIPELINE.md](./ASSET_PIPELINE.md),
[ARENA_DESIGN.md](./ARENA_DESIGN.md).

Working philosophy: **Observe -> Measure -> Fix -> Play Again.**

---

## The direction changed after Sprint 16

> "Future visual quality will not come from additional procedural geometry. It will come from
> replacing procedural geometry with authored production assets. Do not spend future sprints adding
> more box geometry. Assume every major object currently in the level is temporary. The objective is
> replacement, not refinement."

So: **do not propose new procedural geometry as the answer to a visual problem.** `ArenaArchitecture`,
`ArenaVenue`, `PhotonCore`, `ViewModel`, `PlayerAvatars` and both arena files are scaffolding with a
replacement date. Work is judged by whether a real `.glb` can drop in and take over.

```bash
npm run make-reference-assets   # writes real .glb files into public/assets/ (git-ignored)
npm run asset-audit             # registry state, budgets, unclaimed files
```

Delete `public/assets/` to return to the procedural fallbacks. Both paths are supported and both
are exercised.

---

## 1. Characters are the biggest gap, and now the only one that is blocked on content

The pipeline can load a skinned mesh, build its LOD chain, bind its zones and play its clips — all
proven against a generated reference asset. What it cannot do is make one look like a person.

`PlayerAvatars` still poses a hand-rolled box skeleton and has **no asset path at all**: it is the
one major renderer that never calls `useAsset`. Wiring it is the next engine task, and it is
genuinely engine work rather than art:

- resolve `hero_athlete` per actor, falling back to the procedural rig;
- drive `useAssetAnimation` from the actor's movement state (the states are already computed);
- keep the instanced draw path for the fallback, because sixteen skinned meshes is not the same
  cost as sixteen instanced boxes — **measure this before assuming it is fine.**

## 2. Environment assets have no path at all

`hero_rifle` is the only consumer of the registry in the entire codebase. The five module entries
and two prop entries can be loaded but nothing places them: arena brushes are boxes, and `PropSpec`
has a fixed `kind` union with no `asset` field.

The missing piece is a way for arena data to say *this brush is a placeholder for `wall_panel_large`*
so a kit piece can replace a run of boxes without re-authoring the arena. That is the change that
makes the modular kit worth authoring.

**Instancing is the open question.** A hundred imported crates must not be a hundred draw calls, and
nothing in `AssetLoader` produces an `InstancedMesh` today.

## 3. Materials: the substitution rule now has two branches, and only one is tested

`applyZone` keeps authored PBR maps and lets the substance tune the response, rather than replacing
the material wholesale. That is the correct behaviour for a production asset and it has **never been
run against a file that actually has maps** — the reference assets ship flat colours, so only the
untextured branch is exercised.

Next asset with a normal map is the test. Until then, treat that branch as unverified.

## 4. Still open from Sprint 16

- **Play Apex.** Structurally validated, looked at, never played.
- **Measure the difficulty ladder on it.** Median sight line 11.8 m against Classic's 8.6 — the
  reason `hard` has measured the same as `medium` since Sprint 10.
- **Classic's symmetry defect.** Red and blue 17.1% apart; four-fold symmetric in name only.
- **120 FPS unmet.** GPU ~10.3 ms against 8.33 ms, fragment-bound.
- Atmosphere, and the two art notes: truss fixture pods read as free-floating cubes, and the upper
  half of Apex is flatter in contrast than the lower.

## Standing note

Fourteen sprints of rules:

- when a system looks broken, check the instrument first;
- when a playtest names a culprit, measure before you fix it;
- when a graphics change looks like a win, interleave the A/B before believing it;
- when a cost has no draw calls behind it, it is upload or overdraw, not geometry;
- build the thing that checks the work before doing much of the work;
- if the detail is a rhythm, generate it; if it is a silhouette, model it;
- a landmark has to be visible from where players actually stand;
- do not disturb a working preview mid-sprint;
- geometry that reads as absent is usually inside something;
- a level is not correct because it compiles, collides and renders;
- **a pipeline that has never carried a real file is a design document.** Sprint 12 specified,
  validated, budgeted and documented an asset system, and the first genuine glTF put through it
  found six defects in half a minute — two of them in the contract itself. If content cannot be
  generated yet, **generate a reference version of it**; the cost is a few hundred lines and it is
  the only way to know the specification is true.
