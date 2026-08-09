# Visual overhaul — handoff

**State at handoff:** tip `37684de`, tree clean, 145 tests passing, 48 commits ahead of origin
(unpushed). No work in progress. Nothing half-applied.

---

## What is established

**The cause of the "grey extruded boxes" look is identified and fixed in principle.**

Every arena brush is `BoxGeometry(1, 1, 1)` scaled per instance. `BoxGeometry` UVs are 0–1 per face
and instance scaling never touches UVs, so **every face showed the same tile count whatever its
physical size** — a panel seam 2.25 m wide on a 9 m wall against 0.25 m on a 1 m barrier. The detail
was the wrong physical size, and wrong in proportion to how large the surface was. No amount of
lighting or `normalScale` could have revealed it.

`captures/07_worlduv_gameplay_mid.png` is the proof: the moment UV density was corrected, the
normal maps became unmistakably visible. They were never ineffective — they were being sampled at a
scale where nothing could reveal them.

### Implementation, already committed and working

In `src/render/ArenaMesh.tsx`:

- per-instance `vec2 aUvScale` instanced attribute
- `onBeforeCompile` patching `vMapUv` / `vNormalMapUv` / `vRoughnessMapUv`, each behind its `USE_*`
  define so a material lacking that map still compiles
- `customProgramCacheKey` to keep one shared program
- scoped to `WORLD_UV_KINDS = new Set(['wall'])`
- divides out the texture's own baked `repeat`, which `finish()` sets when the canvas is built —
  omitting that stacked the two and produced a 12.5 cm dimple pattern (capture 07)

Baking UVs into geometry is **not** an option: instances in a batch have different dimensions and
share one geometry, so baking means one geometry per brush and the end of instancing.

---

## Phase 1 — CLOSED, both halves passed

**Performance** (controlled A/B, same scene/camera/lighting/frame, 30 samples per arm):

| | draws | programs | triangles | GPU ms | CPU ms |
|---|---|---|---|---|---|
| world UV on | 208 | 53 | 41,639 | 11.67-12.38 | 2.83-3.10 |
| world UV off | 208 | 53 | 41,639 | 10.95-12.49 | 2.22-2.39 |

Draws and programs identical. The earlier "237 / 36" figure was a different scene and is
**not** a regression. Batching and `customProgramCacheKey` confirmed working.

**Visual** (captures 13 on / 14 off, 1.92 x 5 m interior composite panel, raycast-asserted at
2.00 m and 68% frame fill):

- **on** — ~15-18 panel courses up 5 m (~0.3 m spacing), and the foreground panel agrees with the
  gallery walls behind it
- **off** — ~7-8 coarse courses (~0.65 m), visibly stretched on the larger background surfaces

That agreement between near and far surfaces is the whole point. Without world UVs, texture density
is a function of brush size, so two surfaces disagree about how big a panel is.

### Choosing the proof surface took five attempts, all my error

Largest-area picked the unlit outer shell. `sy>=3 && max(sx,sz)>=4` matched nothing, because
interior walls are tall and thin. Pillars are `brushedAluminium` — a fine grain, not the
`compositePolymer` that carries seams. `face>=3` excluded every interior panel, which are 1.1-1.9 m
wide. And the approach-side sign was inverted, putting the camera behind the wall.

Dumping the actual instance data instead of guessing a sixth threshold is what ended it. The
raycast assertion is what stopped four of those from being reported as results.

### Open tuning candidate, not a blocker

At ~0.3 m the courses read closer to masonry than to large composite panels. `compositePolymer` is
at 0.5 m/tile; 0.6-0.75 would give fewer, larger panels. Judge it in the six-viewpoint pass.

### Not yet done from Phase 2

The six established viewpoints have **not** been re-captured since world UVs went in. Do that first
next session — `captures/01-06` are still the pre-UV baseline.

---

## Surface census (measured, useful for choosing test surfaces)

| Kind | Instances | Interior (<25 m) | Tallest |
|---|---|---|---|
| catwalk | 299 | 169 | 0.9 m |
| wall | 138 | 61 | 28 m |
| **pillar** | **128** | **52** | **26 m** |
| led | 84 | 43 | 13.6 m |
| glass | 111 | 36 | 3 m |
| trim | 43 | 33 | 0.5 m |
| barrier | 106 | 16 | 2.2 m |

**Pillars are the right proof surface** — 52 interior, 26 m tall, standing in the lit atrium at the
distance players actually walk past them.

---

## Next session, in order

### Phase 1 — the proof that keeps failing on selection

1. Add `'pillar'` to `WORLD_UV_KINDS`; expose the set on the dev handle so it can be emptied at
   runtime without rebuilding.
2. Select: `kind === 'pillar'`, `Math.hypot(px, pz) < 20`, `sy > 5`, nearest to origin.
3. Camera 2 m off the face, `y = 1.9`, perpendicular.
4. **Verify before capturing.** Raycast from the camera and assert the first hit is the intended
   instance; log the instance, distance and hit; fail the diagnostic if it is not visible. Three
   diagnostics in a row produced plausible PNGs that were not showing what I believed they were —
   this guard would have caught all three immediately.
5. Capture `11_worlduv_lit_pillar` and judge the *image*.
6. Controlled A/B, ~30 frames per arm, identical scene/camera/lighting: `WORLD_UV_KINDS = []` vs
   `['pillar']`. Report ranges for GPU, CPU, draws, programs, triangles, FPS from `renderStats`
   (`gpuAvailable` is true, so the GPU timer is real — do not scrape the HUD).

**Stop if the pillar shows no relief.** Next suspect is tangent handling: three.js derives tangents
in-shader from UV derivatives when a mesh has no tangent attribute, and per-instance UV scaling
changes those derivatives. Symptom would be relief that is present but lit from the wrong direction.

### Phase 2 — rollout, only if both pass

Roll `WORLD_UV_KINDS` across the structural kinds. Targets already in `METRES_PER_TILE`: panel seams
0.5, brushed metal 0.1, carbon 0.15, anti-slip 0.15, hex 0.35. Capture all six baseline viewpoints,
compare, measure.

### Phase 3 — normals

`normalScale` currently 0.55–1.0, chosen **before** the physical scale was corrected. Expect to
reduce it. Smallest measured adjustment.

### Phase 4 — the arena overhaul proper

Lighting, cyan as an architectural language, bloom discipline, mid-scale detail, upper volume,
central landmark. Each as its own measured batch.

---

## Two measured facts worth carrying

- **The frame is fragment-bound, and the arena is ~96% of it.** 11.3–11.7 ms GPU with zero
  characters; five athletes add ~1.0 ms. Geometry is not the cost — pixels are.
- **The world-UV shader patch costs no measurable GPU** (14.21 ms against a 14.0–14.3 ms reference).
  The approach is sound; only the draw/program question is open.

## The recurring failure mode in this project

Eight times now, an instrument has reported success while looking at the wrong thing: the pose check
passing 36 samples with zero probes bound; a sandboxed `tripo --version` on a file that did not exist
on disk; `stage_bake` printing "bake complete" after three failures; a game mesh named `tripo_node_*`
that every export rule classified as a bake source; three capture diagnostics aimed at the wrong
surface.

**Diagnostics must verify what they measured, not merely that they ran.** That is the single most
valuable habit to carry into the visual work, where "it looks different" is easy to assert and hard
to check.
