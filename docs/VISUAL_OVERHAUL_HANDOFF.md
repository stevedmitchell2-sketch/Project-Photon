# Arena visual overhaul — handoff

**State:** tip `2ca823c`, tree clean, 145 tests passing, 63 commits ahead of origin (unpushed).

## Reproducible comparison — read this first

`tools/capture/harness.js` is served off disk by the dev server and never imported by app code. It
owns the six viewpoints as **fixed poses**, which is the thing that was missing: before/after had
been compared across cameras that were re-typed each session and quietly different every time.

```js
const m = await import('/tools/capture/harness.js');
await m.install();
await window.__harness.shoot(m.VIEWPOINTS[1], 'myprefix_');
```

Guards: camera stillness (15 mm), `atPose` (the camera reached the requested pose, not merely held
still), and per-viewpoint perf — draws and triangles are frustum-dependent, so one aggregate reading
taken at whichever viewpoint happened to be last compares two different scenes.

Capture sets on disk: `base_*` (before), `p1_*` (architecture), `p2_*` (cyan), `p3_*` (lighting).

## Done

- **`src/maps/architecture.ts`** — derives a detail layer from the arena that already exists.
  Mullions, header, kick plate, recessed infill, pillar plinths, service louvres. 515 modules from
  915 brushes. Deterministic (hashed position), `noCollide`/`noNav`, appended after the collider
  loop so gameplay cannot be affected, and batched through the existing instancing.
- **Cyan hierarchy** — `led`/`trim` defaults 2.4/3.0 → 1.35/1.2, plus a recessed light channel in a
  minority of bays so cyan appears as a fixture rather than an outline traced round every edge.
- **Lighting** — ceiling array pulled to ±10 and shortened to 26 m so it makes pools instead of one
  wash; the 900/44 atrium wash cut to 300/26. This is what put gradient back on the floor.
- **Two new surface kinds** (`frame`, `vent`) with graphite and structural-ceramic substances.

## What is not done — the honest state

The arena is **better, not transformed**. Against the acceptance bar ("no longer the blocky
prototype"), the floor and lighting clearly pass; the walls do not yet. The detail layer reads at
mid distance on the gallery, but most surfaces are still large flat expanses at gameplay range.

Highest value remaining, in order:

1. **Floor (Phase 3) — untouched and the largest single surface in every frame.** Competition
   markings, team zones, material transitions. Nothing here has been done.
2. **Wall bays are still too plain up close.** The kit needs depth variation between bays — some
   recessed, some proud — rather than one treatment applied uniformly.
3. **Upper volume and central landmark** (Phases 8/9) — untouched.
4. **Authored Tripo/Blender modules** (light fixtures, service stations, consoles) — authorised but
   not started. The procedural kit was the right first move because it is derived and cannot drift
   from the arena, but authored props are what would carry Phase 7.

## Perf — not yet a controlled comparison

Measured at viewpoint 02: GPU 14.94 ms, 183 draws, 234 k triangles. The pre-change baseline
aggregate was 10.82 ms / 117 draws / 102 k tris, but **that was recorded at a different viewpoint**,
so the delta is not trustworthy. Before optimising anything, re-measure both arms at the same
viewpoint — the harness now records per-viewpoint perf, so this is one run per arm. Triangles roughly
doubling is expected and cheap (the frame is fragment-bound); the draw-call rise needs checking, as
three new kinds should cost ~3 batches, not ~60.

## Carried forward

- The frame is **fragment-bound**, and the arena is ~96% of it. Geometry is not the cost; pixels are.
- **Diagnostics must verify what they measured.** This session: a walk/sprint guard "passed" with
  `speed [0,0]` against a band of `[0,0]`, and a service collar was identified only by A/B after its
  underside rendered as a bright diamond on every pillar face.
