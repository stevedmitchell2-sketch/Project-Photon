# Rendering Guide

Practical rules for working on Photon's renderer. Everything here is a conclusion from something
that went wrong, not general advice.

---

## Four ways to render a black arena

All four were live simultaneously in the first build. **None of them throws an error** — the arena
simply goes black, and you only find out by looking.

1. **Metals need an environment map.** `MeshStandardMaterial` with `metalness > 0` takes most of its
   colour from reflected environment light. With `scene.environment` unset, reflective floors and
   catwalks sample pure black regardless of how many lights are in the scene. `ArenaEnvironment`
   prefilters Three's bundled `RoomEnvironment` into a PMREM cube — no network, no assets. Removing
   it halves scene luminance (measured 0.378 → 0.170).

2. **Light intensity is physical.** Illuminance falls off as `intensity / d²`. A ceiling fixture 7 m
   above the deck needs an intensity in the hundreds. Values of 20–40 are from the pre-r155 legacy
   model and land around 0.05 — black.

3. **Arena-spanning geometry must not cast shadows.** The 60 × 60 ceiling slab occluded the key
   light and shadowed every surface below it. Brushes carry `noShadow` for this.

4. **Albedo needs headroom under ACES.** Near-black base colours have no tonal separation left after
   tone mapping. Surfaces sit mid-dark and `toneMappingExposure` runs at 1.35.

## Emissive is not scale-invariant

The single most repeated mistake here. **What matters is the solid angle an object occupies, not its
material.**

A value tuned on a wall 10 m away is wrong on a view model 0.4 m from the near plane. The
first-person weapon used world-geometry emissive values (2.4–3.0) plus `toneMapped: false` charge
cells, and bloomed into a featureless glowing slab that covered the crosshair.

Rules of thumb:
- World geometry trim: 2–4
- Anything within 1 m of the camera: under 1
- `toneMapped: false` only for things that must ignore exposure entirely (bolts, HUD-like elements),
  never for a large near-field surface

## Global fill bounds how dark any room can be

Ambient and image-based lighting are scene-wide and no geometry occludes them. Sealing and roofing a
room removes its *direct* light but not those, so a "dark room" bottoms out around 75% of open-floor
luminance.

Genuinely dark spaces need baked ambient occlusion or per-zone light probes. Do not keep adding
geometry expecting darkness.

Fill is deliberately restrained (`ambient 0.42`, `hemisphere 0.3`) precisely so unlit space can fall
off at all. Raising it flattens every lighting decision in the level.

## One source of truth for lighting constants

`config/lighting.ts` is read by both the renderer (`render/Scene.tsx`, `render/GameCanvas.tsx`) and
the offscreen validator (`dev/lightingProbe.ts`).

They briefly kept separate copies and drifted immediately: a rebalance that cut ambient by 3×
measured as having *no effect at all*, because the probe was still rendering with the old value.
**A validator that does not measure what the game renders is worse than no validator** — it
manufactures confidence.

## Validate lighting numerically

```js
__PHOTON__.probeLighting({ x: 0, y: 2, z: 0 }, yaw, pitch)
```

Renders the arena offscreen from an eye pose and reports mean/median/percentile luminance, black
fraction and a verdict. DEV-only and lazily imported, so it never enters the production bundle.

Every new arena gets probed from each spawn, the centre, the upper deck and a maze corridor before
it is called done. Targets live in `LUMINANCE_TARGETS`.

## Performance

Measured on Arena 01 with bots fighting:

| Metric | Value |
| --- | --- |
| Draw calls | 110 |
| Triangles | 12,603 |
| Active point lights | 17 |
| Frame time (median / p95) | 16.7 / 17.3 ms |
| JS heap | 43 MB |

**The 120 FPS target is currently unmeasurable.** Frame time sits at exactly 1/60 s — the display is
vsync-capped, so "60 FPS" means hitting the cap, not approaching the limit. Establish a
vsync-independent measurement before making any optimisation claim.

### What actually costs

1. **Dynamic lights.** Every lit surface shader evaluates *every* light, so a light is charged
   against the whole frame, not the pixels near it. `graphics.maxDynamicLights` caps the arena's own
   fixtures but does **not** globally cap impact flashes, prop beacons or the muzzle light — that
   gap produced 20 live lights against a configured cap of 8. Anything adding a light must account
   for it.
2. **Draw calls from unbatched meshes.** 137 individual meshes versus 21 instanced. Each bot is ~12
   meshes and each prop 2–8. Arena geometry is already batched through `MapBuilder`; dressing and
   characters are not. This is the next win.
3. **Not geometry.** 12.6k triangles is trivial. Effort spent on mesh complexity is wasted.

### Instancing

The arena renders as one `InstancedMesh` per (surface kind, colour, glow) batch — ~100 brushes in 12
batches. Glow is part of the batch key because `emissiveIntensity` is a material uniform, so two
brushes of the same kind and colour but different glow cannot share a mesh.

### Draw-call counting

`EffectComposer` resets `gl.info` between passes, so sampling it during `useFrame` — even at
priority 1000 — reads a cleared counter and reports `1`. `info.autoReset` is disabled in
`GameCanvas`, and `RendererStats` reads then resets once per frame at priority 1000. Do not
re-enable autoReset.

## Pooling

Projectiles, sparks, decals and impact flashes are pooled and instanced. Impacts are the
highest-frequency visual event in the game — six bolts a second per player — so an allocation in
that path is a per-second GC hazard, not a one-off cost.

## Open visual issues

From playtesting, in order of impact:

1. **Light shafts read as objects, not atmosphere.** The vertical cyan column is the most visually
   intrusive element on screen. Fade by view angle: subtle head-on, visible obliquely.
2. **Weapon orientation looks angled at rest** — likely residual yaw in the idle sway.
3. **Mid-tone flatness** — surfaces away from a fixture fall to uniform grey. More contrast between
   lit and unlit regions would help both readability and atmosphere.

---

## Measuring the frame (Sprint 8)

For four sprints the only performance number was frames per second, and it could not answer the
120 FPS question. **Vsync pins the interval between frames to one display refresh** — 16.67 ms on a
60 Hz panel — no matter how much work the frame did. A frame doing 2 ms of work and one doing 15 ms
both report 60 FPS, right up until the second tips over and reports 30. It is a cliff detector, not
a budget, and three sprints of rendering optimisation had to be argued through draw-call counts
because of it.

`RendererStats` now measures the two numbers that matter:

- **CPU frame time** — bracketed by `useFrame` callbacks at priority `-1000` and `+1000`, so it
  spans the frame's actual work and excludes the block on vsync.
- **GPU frame time** — `EXT_disjoint_timer_query_webgl2`. Never polled to completion (that stalls
  the CPU on the GPU and changes the frame being measured); results are collected when ready,
  typically two or three frames later. Samples flagged `GPU_DISJOINT_EXT` are discarded.

Both appear in the HUD readout and in telemetry. `frameBudgetMs` is `max(cpu, gpu)` — CPU and GPU
overlap, so the larger is the honest bound.

### What the first measurement found

| | |
| --- | --- |
| CPU | **1.4–1.9 ms** |
| GPU | **12.0–12.5 ms** |
| 120 FPS budget | 8.33 ms |
| Draw calls | ~145 |
| Triangles | ~20k |

**The frame is GPU-bound with the CPU nearly idle, and it is fragment-bound rather than
draw-call-bound.** Attribution, measured by toggling one setting at a time:

| Change | GPU |
| --- | --- |
| baseline | 12.3 ms |
| all post-processing off | 12.2 ms |
| + shadows off | 12.3 ms |
| + volumetric off | 12.5 ms |
| `maxDynamicLights` 8 → 0 | **9.9 ms** |
| `renderScale` 1.0 → 0.5 | **4.8 ms** |
| `renderScale` 1.0 → 0.25 | **3.0 ms** |

Resolution is the dominant term and dynamic lights are second (~2.3 ms). Post-processing, shadows
and the volumetric shafts are all effectively free. **Draw calls were never the constraint** — which
means the batching work of Sprints 6–7 was optimising the wrong axis, and the reason nobody noticed
is that the instrument could not tell.

### 120 FPS is not currently achievable

Reaching 8.33 ms from 12.2 ms needs a 32% cut, which is roughly `renderScale` 0.6 — a serious
quality loss. The real lever is **per-pixel cost**: fewer lights evaluated per fragment, cheaper
materials on non-metallic surfaces, less transparent overdraw. That is architectural work, not a
settings tweak, and it is the first rendering item in `NEXT_TASK.md`.

The target is not being quietly met by gutting resolution.

### Two traps when measuring

1. **GPU time is view-dependent.** The same preset measured 8.68 ms from one vantage and 12.43 ms
   from another minutes later. Any A/B must be **interleaved** (ABABAB) so view drift cancels, never
   sequential. A promising 3 ms "saving" from lowering bloom intensity evaporated to −0.08 ms under
   an interleaved test.
2. **Repeated in-tab reloads degrade the WebGL context.** After roughly a dozen reloads the same
   scene reported 4 FPS, GPU 28 ms, CPU 36 ms and — the giveaway — simulation time up 10× to 5.9 ms,
   which no graphics setting can affect. A fresh preview restored 60 FPS / 13.1 ms / 1.6 ms. **If
   the simulation time moves, suspect the browser, not the code.**

## Bloom is a readability setting, not a performance one

`bloomIntensity` was reduced across all three presets in Sprint 8 (0.55/0.85/1.1 → 0.35/0.5/0.68).
Interleaved measurement puts the GPU difference at **−0.08 ms — nothing**. The change is entirely
about legibility: at the old values the emissive fixtures bled into two large white-cyan blooms that
sat in the middle of the screen from most positions on the deck and washed out whatever was under
the crosshair. The neon still reads as neon at the lower values.

Related, and still open: the light shafts were diagnosed from a screenshot as the offender here in
Sprint 7 and fixed, and were not the main problem. Bloom was.

## Turning off every post effect used to turn off rendering

`RendererStats` registers a `useFrame` at a positive priority, which switches R3F out of automatic
rendering and hands the loop to whoever renders manually — normally `EffectComposer`. With bloom,
vignette, grain and chromatic aberration all disabled, `PostFX` returned `null`, the composer
unmounted, and nothing rendered: a black screen with **zero draw calls**, reachable from the
settings menu. `PostFX` now falls back to a `PlainRender` component that draws the scene directly at
the same priority the composer would have used.
