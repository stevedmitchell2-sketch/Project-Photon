# CHARACTER INTEGRATION REPORT

> **Updated 2026-08-06 (pipeline execution pass).** The original audit is preserved below from §1.
> Phases 6 and 7 have since been executed: an engine-side character path now exists behind the
> blockout fallback and has been tested end to end with a rigged reference character. R1 is fixed
> — see [R1_FIX_REPORT.md](./R1_FIX_REPORT.md). Companion documents:
> [CHARACTER_ASSET_AUDIT.md](./CHARACTER_ASSET_AUDIT.md),
> [CHARACTER_OPTIMIZATION_PLAN.md](./CHARACTER_OPTIMIZATION_PLAN.md).

---

## UPDATE — engine integration complete, content work outstanding

### What changed since the audit

| | Then | Now |
|---|---|---|
| R1 projectile origin | 0.442 m off the muzzle | **0.000 m** — fixed and regression-tested |
| Character asset path | none; `PlayerAvatars` never called `useAsset` | **`AssetAvatars`**, live behind a fallback gate |
| Skeletal animation in game | never exercised | **5 actors animating from a skinned glTF** |
| Weapon on a character | impossible | **attached to `SOCKET_weapon_right`, muzzle published** |
| Third-person muzzle | estimated analytically | **exact, from the attached weapon's socket** |

### Phase 7 — the integration layer

```
   Simulation (unchanged)
        actor: position, yaw, velocity, stance, grounded, team
                     │
             useImportedCharacters()          ← one gate: has an asset resolved?
                ╱                  ╲
     PlayerAvatars              AssetAvatars
  (primitive blockout,        (skinned glTF, AssetAnimator,
   18 instanced batches)       weapon socket, per-slot team materials)
```

Built as a **sibling component, not a branch**. The blockout's whole design is that fifteen body
parts collapse into eighteen `InstancedMesh` batches so draw calls stay constant regardless of
player count; a skinned mesh cannot join that scheme, because every skeleton differs every frame.
Those are two renderers, not two configurations of one. Keeping them separate means the fallback —
the thing that must keep working — is untouched code.

`useImportedCharacters()` returns false for a clean checkout, which is the normal state, so the
blockout stays the default rather than the exception.

### Verified in a live match

| Check | Result |
|---|---|
| Spawn works | ✅ 5 remote actors, 5 avatars rendered |
| Skinned animation | ✅ mixer drives the skeleton; state resolves from actor velocity/stance |
| Team colour | ✅ per-slot material instances, no cross-contamination |
| Weapon attaches to hand socket | ✅ cloned rifle parented to `SOCKET_weapon_right` |
| Muzzle socket exists and publishes | ✅ actor at (−3.00, 0.02, −13.17) → muzzle at (−2.44, 1.38, −12.60) |
| Projectile origin is the barrel | ✅ 0.442 m → **0.000 m** |
| First-person view | ✅ unchanged; view model publishes its own socket |
| Third-person view | ✅ avatars render, animate and carry weapons |
| Multiplayer replication | ✅ `nettest` PASS — 2 clients, 257 snapshots, 0 dropped, 0.002–0.037 m divergence |
| Fallback intact | ✅ blockout renders identically when no asset is present |

### Two bugs found by verifying rather than by reasoning

**1. `worldToLocal` mutates in place.** The first R1 implementation published the muzzle *after*
converting it to view-model space, so the registry reported a 31.885 m error instead of 0.442 m and
would have drawn every bolt near the world origin. Every unit test passed. Caught only by re-running
the live measurement.

**2. Not every team-coloured material has an `emissive` channel.** `ledStrip` resolves to a
`MeshBasicMaterial`. Assuming `MeshStandardMaterial` threw on the first avatar and — because the
frame loop is a single pass over all actors — silently stopped every remaining player from being
drawn. Four of five characters were invisible with no error surfaced to the user.

Both are now covered: 11 tests for the muzzle maths, and the material write is channel-guarded.

### Performance — the path, not the asset

Interleaved A/B, 5 remote actors, Apex:

| | Blockout | Imported | Delta |
|---|---|---|---|
| GPU | 7.82 ms | 7.77 ms | −0.04 ms (noise) |
| CPU | 2.99 ms | 3.35 ms | **+0.36 ms** |
| Draw calls | 184 | 214 | **+30** |

The reference character is a 156-triangle blockout, so this measures the machinery — roughly
**0.07 ms CPU and 6 draw calls per character** — not the eventual asset. Projection to a real 15k
character is in the optimisation plan.

### What is still blocked

The **Tripo robot itself** cannot be integrated: it has no skeleton, and at 1,938,280 triangles and
256 MB of texture memory it is 107.7× and 25.6× over budget. Classification **B — needs retopology
first**. The full route is in
[CHARACTER_OPTIMIZATION_PLAN.md](./CHARACTER_OPTIMIZATION_PLAN.md).

When a rigged, retopologised version arrives, integration is: copy the file, add a manifest entry,
point `CHARACTER_ASSET_ID` at it. No code changes.

### Completion checklist

| Requirement | Status |
|---|---|
| R1 identified, fixed independently, baseline verified | ✅ build, 97 tests, `nettest` PASS |
| Character is rigged **or a rigging plan documented** | ✅ plan documented; robot **not** rigged |
| Character can hold the weapon | ✅ **proven** with the reference character; robot blocked on rig |
| Weapon fires correctly from the barrel | ✅ **0.000 m**, first and third person |
| Works in a playable Photon test environment | ✅ **playable** — deployed, moved, fired, 5 animated opponents |
| First- and third-person compatibility evaluated | ✅ both |
| Existing character fallback still working | ✅ untouched; default on a clean checkout |
| Core gameplay systems unmodified | ✅ simulation untouched; all changes are in `render/` |

**Recommended next action:** send the robot for retopology and rigging per the optimisation plan.
Everything on the engine side is done and tested.

---

# ORIGINAL AUDIT (2026-08-06)

**Asset:** `futuristic maintenance robot 3d model.glb` · 55.8 MB · generated by **Tripo**
**Inspected:** 2026-08-06 · **Target:** replacement for the procedural player avatar
**Tooling:** `npm run asset-inspect -- "<file>" --kind character`

---

## VERDICT

**Do not integrate yet. The model is not rigged.**

It has no skeleton, no skinned mesh and no animation clips. That is the one defect in this report
that cannot be fixed downstream — every other problem here is pipeline work on geometry that already
exists, but a skeleton is authoring. Nothing in the importer, the material system or the animation
system can synthesise one.

Per the brief's own gate, character integration stops here and the rigging workflow is documented in
§9.

**This is worth saying clearly, though: the model itself is very good.** The mesh is flawless, the
material work is genuinely production-quality, and the design sits comfortably inside Photon's art
direction — the cyan accents are almost exactly the house colour. It is worth the rigging and
optimisation investment. It is not worth shipping as-is.

---

## 1. Asset quality assessment

### Geometry — excellent quality, catastrophic density

| | Measured | Budget | |
|---|---|---|---|
| Triangles | **1,938,280** | 18,000 | **107.7× over** |
| Vertices | 1,014,407 | — | |
| Meshes / primitives / nodes | 1 / 1 / 1 | — | one welded lump |
| Materials | 1 | 4 | ok |

Automated health check — **the mesh is clean**:

| Check | Result |
|---|---|
| NaN / infinite positions | **0** |
| Degenerate index triples | **0** |
| Zero-area triangles | **0** (0.0000%) |
| Non-unit normals | **0** (0.000%) |
| UVs outside 0–1 | **0** (0.000%) |
| Index range vs vertex count | exact, 0…1,014,406 |

No holes, no inverted faces, no broken shading, a single clean UV island set. That is better than
most hand-authored assets and it means the density is a *retopology* problem, not a repair problem.

The triangle count is characteristic of a marching-cubes/AI-generated surface: uniform, extremely
fine tessellation with no regard for silhouette. Nearly two million triangles is being spent on a
form that a competent game character carries at 15–20k.

**No `TANGENT` attribute.** A normal map is present, so three.js computes tangents at load. That
costs time on a million-vertex mesh and can produce seams at UV boundaries.

### Materials and textures — real PBR, wildly oversized

| Texture | Size | VRAM (RGBA8 + mips) |
|---|---|---|
| `..._basecolor.jpg` | 4096 × 4096 | 85.3 MB |
| `..._rm.jpg` (roughness/metal) | 4096 × 4096 | 85.3 MB |
| `..._normal.jpg` | 4096 × 4096 | 85.3 MB |
| **Total** | | **256.0 MB** vs a **10 MB** budget — **25.6× over** |

The maps themselves are good: correct ORM-style packing, a real normal map, sensible metal/rough
separation. On disk they are only 2.6 MB total because JPEG compresses them well — **the 256 MB is
what they cost decompressed on the GPU, which is the number that matters.**

One observation from the back view: **texture detail is strongly front-loaded.** The chest, head and
limbs carry panel lines, labels and wear; the back is comparatively flat. Typical of generated
assets, and relevant because in a third-person shooter the back of the character is what players
look at most.

`extensionsUsed` declares `KHR_materials_volume` and `FB_ngon_encoding`. Neither is actually used by
the material; both are harmless.

---

## 2. Rigging status — **BLOCKING**

| Check | Result |
|---|---|
| Skeleton / armature | **absent** — `skins: 0` |
| Skinned mesh | **absent** — no `JOINTS_0` / `WEIGHTS_0` |
| Humanoid bone structure | n/a |
| Bone naming / retarget compatibility | n/a |
| Animation clips | **absent** — `animations: 0` |

Cannot support idle, walk, sprint, aiming, shooting, crouching or hit reactions. It is a static prop
that happens to be shaped like a character.

**The good news is that it is an unusually good candidate for rigging.** Visual inspection confirms:

- clean bipedal humanoid proportions — head, neck, torso, pelvis, two arms, two legs;
- **individually modelled fingers with visible knuckle articulation** on both hands;
- discrete mechanical joint volumes at shoulder, elbow, hip, knee and ankle — the pivot points are
  already visually obvious, which makes bone placement unambiguous;
- a relaxed, near-A-pose stance with limbs clear of the body, which is what auto-riggers want.

Nothing about the mesh fights a rig. See §9 for the workflow.

---

## 3. Animation readiness

None. No clips ship with the file and none can be authored against a skeleton that does not exist.

Photon's side of this is **ready and proven**: `AssetAnimator` handles cross-faded clip playback,
one-shot events and a candidate-name table so an asset can ship `run`, `run_forward` or `sprint` and
still satisfy the engine. `useAssetAnimation` drives it from the render clock, leaving the fixed-step
simulation untouched. Both were verified this cycle against a generated reference character whose
skeleton the mixer measurably moves.

So the moment a rigged version of this model exists, the engine can play it. The gap is entirely on
the content side.

---

## 4. Scale and orientation

Photon uses real-world metric scale. Target: **1.95 m** tall, ~0.70 m wide, ~0.45 m deep.

| | Measured (raw) | Scaled to 1.95 m | Target | |
|---|---|---|---|---|
| Height | 0.979 m | 1.950 m | 1.95 m | ✓ |
| Width | 0.587 m | **1.168 m** | 0.70 m | **67% too wide** |
| Depth | 0.264 m | 0.526 m | 0.45 m | 17% too deep |

**Uniform scale cannot satisfy both height and width.** Matching height gives a 1.17 m shoulder span;
matching width gives a 1.17 m tall character. The robot's proportions are genuinely broader than the
target silhouette — its width-to-height ratio is 0.60 against the target's 0.36.

This is a **design decision, not a bug**. Three options:

1. **Accept the broader silhouette** and set the collision capsule to the real width. A 1.17 m span
   is a heavy-frame robot and reads deliberately; it also changes cover behaviour and hit
   probability, so it needs a playtest.
2. **Scale to 1.95 m and narrow the arms inward** during retopology — cheap while the mesh is being
   rebuilt anyway.
3. **Scale to ×1.19** (1.17 m tall) and treat it as a small support unit rather than a player
   character.

Recommendation: **option 2**, folded into the retopology pass.

Everything else about the transform is correct:

- **Origin at the feet** — `minY = 0.000`. ✓
- **Centred in X and Z** — bounds are symmetric to within a millimetre. ✓ It will rotate about its own
  axis rather than orbiting.
- **Facing +Z.** Photon's engine forward is **−Z** (yaw 0 faces −z). The model needs a **180° Y
  rotation** on import. This is a one-line manifest concern, not an asset defect.
- Collision capsule: the existing 1.8 m actor capsule is close on height but far too narrow for a
  1.17 m span. Resolve after the width decision above.

---

## 5. Weapon integration — blocked, but assessed

Cannot be completed without bones: attaching a weapon needs a `weapon_right` socket parented to a
hand bone, and there are no bones.

What the inspection does establish:

- **The hands can hold a weapon.** Both have five separated digits with modelled knuckles, so a hand
  rig can close them around a grip.
- **They currently cannot.** The hands are modelled **open and relaxed**, fingers extended. A weapon
  parented to an open hand looks like it is floating beside it. This needs either finger bones posed
  into a grip, or a baked grip pose as a blend-shape/second bind.
- **No sockets of any kind.** All four required character sockets are missing: `helmet`, `backpack`,
  `weapon_right`, `weapon_left`.

The engine side is ready and proven. Photon's socket system was verified this cycle against a
reference weapon: `SOCKET_muzzle`, `SOCKET_grip`, `SOCKET_sight` and `SOCKET_eject` all bind, and the
weapon renders in game through the same path. Sockets are plain named transforms — an artist adds
four empties and the engine finds them with no code change.

---

## 6. Projectile validation — **a real defect found, independent of this character**

This one is worth reading carefully, because the measurement exposed an existing bug.

**Where the simulation spawns a bolt** (`WeaponSystem.ts`):

```
origin = eyePosition + aim × 0.42 m,  minus 0.14 m in Y
```

**Measured in a live match**, standing still:

| | Position |
|---|---|
| Simulation projectile origin | (−24.678, 1.560, −20.730) |
| Actual visible muzzle (`SOCKET_muzzle`, world) | (−24.467, 1.517, −20.344) |
| **Discrepancy** | **0.442 m** |

Decomposed: the visible weapon sits **0.21 m to the right** of the aim axis and its muzzle is
**0.39 m further forward** than where the bolt actually appears.

So, against the brief's checklist:

| | |
|---|---|
| Fires from character origin | **No** — correctly offset from the eye ✓ |
| Fires from the muzzle point | **No** — 0.442 m short of it ✗ |
| Correct direction | **Yes** ✓ — direction comes from the same aim vector, unaffected |
| Correct team colour | **Yes** ✓ |
| Correct network replication | **Yes** ✓ — origin is computed in the deterministic simulation, so server and client agree exactly |

**This is not a bug in the simulation and must not be fixed there.** The origin is authoritative: it
determines what the bolt collides with, it is replicated, and it is re-simulated during lag
compensation. It cannot read a Three.js socket transform without putting presentation inside the
deterministic path and breaking prediction — the one architectural rule this project has held since
M1.

**The correct fix is renderer-side:** draw the tracer's first segment from the visual muzzle and
converge it onto the simulated path over the first two or three metres. This is standard practice in
shooters — the visual tracer origin and the authoritative origin are deliberately different objects.

**In third person the error gets worse.** The simulated origin stays on the eye/aim axis, but the
visible weapon will be in a hand roughly 0.3 m to the side and 0.35 m below the eye, giving an
expected discrepancy of **0.45–0.55 m** and a visibly wrong firing line from every observer's point
of view. Third person cannot ship without the renderer-side fix.

I have **not** changed this. Altering projectile visuals during a blocked character audit is scope
creep, and the fix deserves its own before/after. It is logged as required fix **R1**.

---

## 7. Third-person readiness — promising

Assessed statically (no rig, so animation could not be evaluated).

**Silhouette: strong.** Placed in Apex at 6–14 m and viewed at gameplay framing, the robot reads
instantly and unambiguously. The head shape, shoulder blocks and articulated legs give it a clear
outline against both the pale floor and the dark upper structure.

**Art-direction fit: excellent.** The cyan panel accents sit almost exactly on Photon's house cyan.
Placed in the arena it looks like it belongs there, which is not something a generated asset usually
manages.

**Scale in the space: good.** At 1.95 m it relates correctly to the 5 m mezzanine, the 12.6 m
containment wall and the cover blocks.

Unresolved until rigged: animation naturalness, weapon handling believability, clipping during
movement, and camera collision behaviour. Camera distances could not be meaningfully tested against
a static mesh.

One concern to carry forward: at 1.17 m wide it will occlude more of a third-person camera's view
than a 0.70 m character, which interacts with the width decision in §4.

---

## 8. Multiplayer test — not run

Deliberately. There is nothing character-specific to replicate yet: with no rig there are no
animation states to synchronise and no weapon attachment to verify across clients.

What the network layer already guarantees, unchanged by this asset: actor transforms, weapon state
and projectile origins are all computed in the deterministic simulation and replicated as state, not
as presentation. A character mesh is a client-side rendering choice — swapping it cannot affect
replication correctness. The 16-client scaling harness (`npm run scale`) remains valid.

The real multiplayer risk from this asset is **performance, not correctness** — see §9, R2.

---

## 9. Performance impact — **the second blocking problem**

Measured live in Apex, same camera, same match, clean context. Baseline → six robots visible →
robots removed:

| | Baseline | 6 robots in frame | Restored |
|---|---|---|---|
| **GPU frame time** | **7.72 ms** | **22.52 ms** | 7.61 ms |
| CPU frame time | 2.28 ms | 2.26 ms | 2.52 ms |
| Draw calls | 204 | 187 | 178 |
| Triangles in frustum | 59,645 | **11,688,687** | 59,121 |
| Shader programs | 32 | 32 | — |

With a **single** robot in the frustum: GPU **12.16 ms** — **+4.44 ms for one character.**

Restoring the baseline exactly (7.61 vs 7.72 ms) confirms the entire delta was the asset and not
context drift.

**Reading the numbers:**

- **Draw calls barely move**, because each robot is one mesh with one material. The cost is entirely
  vertex and fragment throughput — 11.7 million triangles against an arena that renders in 59,645.
- **+14.8 ms for six characters** against a 16.6 ms total budget at 60 FPS, on top of an arena that
  already spends 7.7 ms. Six players would put the frame at roughly **30 ms — about 33 FPS.**
- Photon targets **16 players**. Extrapolating, sixteen would be ~31 million triangles in frustum.
- **256 MB of texture memory for one character**, before any other asset loads.
- Load time **552–1031 ms** for a single 55.8 MB file.

CPU is unaffected (2.26 vs 2.28 ms), which is consistent: this is purely a GPU throughput problem.

---

## 10. Required fixes

Ordered by what blocks what.

### Blocking — content work, cannot be done in the engine

**C1 · Rig the model.** The gate for everything else.

Recommended workflow, cheapest first:

1. **Auto-rig.** Upload the (decimated) mesh to Mixamo or Accurig. Both handle a clean A-pose biped
   well, and this mesh is unusually cooperative. Mixamo returns a standard humanoid skeleton plus a
   large clip library — idle, walk, run, crouch, strafe, jump, hit reactions — which covers most of
   the brief's required states immediately. **Mixamo does not rig fingers**; accept simplified hands
   for a first pass or move to step 2.
2. **Manual rig** in Blender with Rigify if fingers matter, which they will for weapon grip. Place
   the metarig, generate, weight-paint the mechanical joints — hard-surface robots weight far more
   easily than organic characters because each panel belongs to exactly one bone.
3. **Name bones to a recognised convention** (Mixamo `mixamorig:` or Unreal `UE4/UE5 Mannequin`), so
   retargeting a clip library needs no manual bone map. `asset-inspect` checks for this.
4. **Add the four sockets** as empties parented to bones: `SOCKET_weapon_right` and
   `SOCKET_weapon_left` on the hand bones, `SOCKET_helmet` on head, `SOCKET_backpack` on chest.
5. **Pose the fingers into a grip** on the right hand, or ship a grip pose the animation system can
   blend to. The hands are currently open and will not hold a weapon convincingly.
6. **Export clips** named to the `CLIP_CANDIDATES` vocabulary in `AssetAnimator.ts`, or anything in
   its candidate lists.

**C2 · Retopologise to budget.** 1,938,280 → 18,000 triangles is a 99.07% reduction. Do not attempt
this with a decimation modifier at that ratio; the result will not hold the silhouette. Retopologise,
then bake the existing 4K maps down onto the new mesh — the maps are good and the detail they carry
is exactly what lets a low-poly version look like this one. **Do this before rigging**, so the rig
binds to the final mesh.

**C3 · Resize textures.** 4096 → 2048, and merge to the project's ORM packing. Target ≤10 MB VRAM.
The three maps at 2048 come to 64 MB, so this needs 1024 for at least two of the three, or a shared
atlas across characters.

**C4 · Split into material zones.** One welded mesh means no team colour, no `PART_` animation hooks
and no per-region materials. Split at minimum into `MAT_suit`, `MAT_armor`, `MAT_trim` (team
coloured) and `MAT_visor` (team coloured, emissive), and add `PART_visor`. Fold into the retopology
pass.

**C5 · Author LOD1 and LOD2.** Character budget requires three levels dropping 45% each. The importer
builds the `THREE.LOD` automatically from `LOD0`/`LOD1`/`LOD2` sibling groups.

**C6 · Export `TANGENT`.** Avoids runtime tangent generation and UV-seam artefacts.

### Blocking — engine work

**R1 · Tracer origin.** Draw the bolt's visual origin from `SOCKET_muzzle` and converge onto the
simulated path over the first 2–3 m. Measured error today is **0.442 m in first person** and will be
0.45–0.55 m in third person. The simulation origin must not change.

### Non-blocking

**R2 · Decide the width question** (§4) before the retopology pass, since the answer changes the mesh.
**R3 · Rotate 180° on import** so the model faces engine-forward (−Z).
**R4 · Back-side texture detail** is noticeably sparser than the front; matters more in third person.

---

## FINAL RECOMMENDATION

**Keep the asset. Do not integrate it yet. Send it for retopology and rigging.**

The mesh is clean, the material work is genuinely good, and the design fits Photon's art direction
better than anything else in the project. The two blocking problems — no rig, and 108× the triangle
budget — are both well-understood, both solvable by standard content work, and neither implies
anything wrong with the model as a design.

**The engine is ready for it.** Every system this character will need — glTF import, socket binding,
material zones, `THREE.LOD` construction, skinned meshes, `AnimationMixer` playback with cross-fading
— exists and was proven against reference assets this cycle. When a rigged, retopologised version
arrives, integration is a manifest entry and a `PlayerAvatars` wiring change, not new systems.

**Suggested sequence:** retopologise to 18k → bake the 4K maps down to 2K → split material zones →
auto-rig with Mixamo → verify with `npm run asset-inspect` → wire into `PlayerAvatars` behind the
existing procedural fallback → playtest.

Fix **R1** independently and now; it is a live defect affecting the current build regardless of which
character ships.

### Completion checklist, per the brief

| Requirement | Status |
|---|---|
| Character is rigged **or a rigging plan is documented** | ✅ plan documented (C1) — model is **not** rigged |
| Character can hold the weapon | ❌ blocked on rig; hands assessed as capable but posed open |
| Weapon fires correctly from the barrel | ❌ **defect found and measured** — 0.442 m offset, fix specified (R1) |
| Character works in a playable Photon test environment | ⚠️ renders correctly in Apex and was measured there; **not playable** without a rig |
| First-person and third-person compatibility evaluated | ✅ both evaluated — third person is promising, and gated on R1 |
