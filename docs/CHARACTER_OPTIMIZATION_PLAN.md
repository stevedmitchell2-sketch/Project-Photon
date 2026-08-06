# CHARACTER OPTIMIZATION PLAN

Route from the Tripo source asset to a production Photon character.
Covers Phases 3, 4, 5 and 6. Classification from `CHARACTER_ASSET_AUDIT.md`: **B — needs retopology
first.**

**Nothing here requires an engine change.** Every step is content work against a contract the engine
already implements and that has been tested end to end (see `CHARACTER_INTEGRATION_REPORT.md` §7).

---

## The route

```
  Tripo source  1,938,280 tris · 3 × 4096 maps · no rig
        │
        ├── 1. decide proportions          ← blocks everything, changes the mesh
        │
        ├── 2. retopologise                → 12–16k tris, deformation loops
        │
        ├── 3. bake source → game mesh     → 2K ORM-packed maps
        │
        ├── 4. split zones + sockets       → MAT_/PART_/SOCKET_ names
        │
        ├── 5. rig + clips                 → humanoid skeleton, named clips
        │
        ├── 6. author LOD1 / LOD2          → 3 levels, 45% drop each
        │
        └── 7. verify + integrate          → asset-inspect, then drop in
```

Steps 1 and 2 are the only ones that cannot be parallelised. Everything after step 2 operates on the
low-poly mesh.

---

## Step 1 — Decide the proportions (blocks everything)

Uniform scale cannot hit both targets: matching 1.95 m height gives a **1.168 m** shoulder span
against the 0.70 m spec.

| Option | Result | Cost | Consequence |
|---|---|---|---|
| **A. Narrow the arms** *(recommended)* | 1.95 m × ~0.75 m | free during retopology | Matches spec; loses some of the heavy-frame character |
| B. Accept the width | 1.95 m × 1.168 m | free | Reads as a heavy unit; **changes cover behaviour and hit probability — needs a playtest** and a wider collision capsule |
| C. Scale to width | 1.17 m × 0.70 m | free | Becomes a small support unit, not a player character |

**Recommended: A.** Narrowing the shoulder and upper-arm volumes during retopology costs nothing
extra because the topology is being rebuilt anyway, and it keeps the existing 1.8 m capsule valid.

Decide this first. Retopologising before deciding means doing it twice.

---

## Step 2 — Retopology

**Target: 12,000–16,000 triangles** at LOD0.

The brief's range for a maintenance robot is 10–20k; the middle of it leaves headroom for the LOD
chain and sits comfortably under the 18,000 character budget in `contract.ts`.

**Do not decimate.** 1,938,280 → 15,000 is a 99.2% reduction. A decimation modifier at that ratio
does not preserve a silhouette, and more importantly it cannot create the edge loops a deforming
character needs — the source has none. Decimation preserves shape; retopology creates structure.

Requirements:

- **Deformation loops** at shoulder, elbow, wrist, hip, knee and ankle — 2–3 loops per joint. This
  is the whole reason for the step.
- **Remove hidden geometry.** The source models interior volumes that are never visible: geometry
  inside the torso shell, behind panel plates, and inside the joint housings. On a hard-surface
  robot this is typically 15–25% of the triangle count for zero visual return.
- **Remove internal faces** at every panel intersection. Tripo output overlaps solids rather than
  booleaning them, so there are complete face sets buried inside other volumes.
- **Keep the silhouette.** The head shape, shoulder blocks, forearm cuffs and foot plates are what
  make this character recognisable at 25 m — spend triangles there and take them from flat panels.
- **UV unwrap fresh.** The source UVs belong to the source topology and cannot transfer.

Suggested tools: Blender's QuadRemesher / Quad Flow, or ZBrush ZRemesher with guides at the joints.
Manual retopology gives the best loops and is realistic for one hero character.

---

## Step 3 — Bake and optimise textures

```
  high-poly source (1.94M tris, 3 × 4096 maps)
            ↓  project onto
  low-poly game mesh (12–16k tris, fresh UVs)
            ↓  bake
  Base Color · Normal · ORM (occlusion/roughness/metallic) · Emissive
            ↓  resize
  2048² production maps
```

**Targets**

| Map | Size | Format | Notes |
|---|---|---|---|
| Base Color | 2048² | sRGB | |
| Normal | 2048² | linear | tangent space; **export `TANGENT`** with the mesh |
| ORM | 2048² | linear | **packed**: occlusion R, roughness G, metallic B |
| Emissive | 1024² | sRGB | new — the source has none; needed for team-coloured LEDs |

**ORM packing is mandatory.** The source already ships roughness and metallic together in one `rm`
map, so most of the work is done; add ambient occlusion into R. On a fragment-bound frame this is
the difference between one texture sample per fragment and three.

**Budget check.** Three 2048² maps at RGBA8 with mips is **64 MB**, still over the **10 MB**
character budget. Options, in order of preference:

1. **1024² for ORM and Emissive**, 2048² for Base Color and Normal → 32 MB. Still over.
2. **Compress to KTX2 / Basis** — the accepted formats list already includes `.ktx2`. BC7 or ETC1S
   brings 2048² RGBA from 21 MB to roughly 5 MB, which lands the whole set inside budget. **This is
   the real answer** and it is a pipeline step, not an art compromise.
3. Share a texture atlas across all characters, if more than one ships.

**Recommendation: option 2.** Bake at 2K, compress to KTX2, and re-run `asset-inspect` to confirm.
The budget assumed uncompressed textures; supercompression is what makes 2K affordable.

**Also:** bake the back at the same fidelity as the front. The source's detail is front-loaded, and
in third person the back is what players look at.

---

## Step 4 — Structure: zones, parts and sockets

The source is one welded mesh with one material. Split it during retopology, when the mesh is being
rebuilt anyway.

### Material zones (`MAT_` prefix, first segment is the zone)

The budget is **4 zones** for a character — each is a draw call per player, and there may be sixteen.

| Zone | Substance | Covers | Team coloured |
|---|---|---|---|
| `MAT_suit` | `compositePolymer` | torso shell, upper legs, hips | no |
| `MAT_armor` | `carbonFibre` | shoulder blocks, forearm cuffs, shin and foot plates, head casing | no |
| `MAT_trim` | `ledStrip` | the cyan accent strips | **yes** |
| `MAT_visor` | `energyEmitter` | head optic | **yes** |

Multiple meshes may share a zone — `MAT_armor_shoulder_l`, `MAT_armor_shin_r` and `MAT_armor` all
bind to `armor`. Only the first segment is read.

The brief's finer list (head / torso / arms / hands / legs / feet / panels / LEDs) is the right way
to think about the *mesh* split, but those eight groups must collapse onto these four **materials**
or the draw-call cost multiplies by team count.

### Animated parts (`PART_` prefix)

| Part | Purpose |
|---|---|
| `PART_visor` | pulses with health / team state |
| `PART_backpack_core` | ambient emissive |

**A node carries one prefix.** An animated emissive part is a `PART_` transform *containing* a
`MAT_` mesh:

```
  PART_visor
    └─ MAT_visor_glass
```

Authoring `PART_visor` as the mesh itself leaves the `visor` zone bound to nothing. This is a real
mistake the reference assets made first time.

### Sockets (`SOCKET_` prefix) — empties parented to bones

| Socket | Bone | Purpose |
|---|---|---|
| `SOCKET_weapon_right` | right hand | weapon attachment — **required** |
| `SOCKET_weapon_left` | left hand | required |
| `SOCKET_helmet` | head | required |
| `SOCKET_backpack` | chest / upper spine | required |

Sockets are transforms, never geometry. The importer hides them; a socket with a mesh on it shows up
as a stray box floating at the muzzle.

### Collision

`COL_body` — a simple capsule or box hull, never rendered, handed to the physics layer.

---

## Step 5 — Rigging and clips

### Skeleton

**Route 1 — auto-rig (recommended for the first pass).** Once the mesh is at 12–16k, Mixamo or
Accurig will accept it. Both handle a clean A-pose biped well and this mesh is unusually cooperative
— discrete mechanical joints make bone placement unambiguous. Mixamo also returns a large clip
library covering most of the required states immediately.

**Mixamo does not rig fingers.** For a first pass that is acceptable if the hands are baked into a
grip pose; for proper weapon handling, go to route 2.

**Route 2 — manual rig** in Blender with Rigify. Necessary if fingers must articulate. Hard-surface
robots weight far more easily than organic characters, because each panel belongs to exactly one
bone — much of the weighting is assign-to-nearest with almost no blending.

### Bone naming

Use a recognised convention — Mixamo `mixamorig:` or the Unreal mannequin set — so retargeting a
clip library needs no manual bone map. `asset-inspect` checks joint names against a humanoid pattern
and reports whether retargeting is realistic.

### The hands

**The hands are modelled open and will not hold a weapon convincingly.** Either:

- pose the right hand closed around a grip at bind time, and rely on `SOCKET_weapon_right`; or
- rig the fingers and author a grip pose the animation system blends to.

The first is cheaper and sufficient for a first integration.

### Clips

Name to the vocabulary in `AssetAnimator.ts` — `CLIP_CANDIDATES` accepts several spellings per
state, so `run`, `run_forward` and `sprint` all resolve.

| State | Priority | Notes |
|---|---|---|
| `idle` | required | |
| `walk` | required | |
| `run` | required | |
| `crouch` | required | |
| `jump` / `fall` | required | `movementState()` distinguishes by vertical velocity |
| `slide` | required | Photon has a slide stance |
| `fire` | required | one-shot; `playOnce` returns to the previous state |
| `reload` | high | mapped from `vent` / `recharge` too |
| `death` | high | |
| aim / ADS | medium | can be an additive layer or a blend |

---

## Step 6 — LODs

Three levels, each dropping at least 45%:

| Level | Triangles | Switches at |
|---|---|---|
| `LOD0` | 12–16k | 0 m |
| `LOD1` | ≤ 8k | ~8.5 m |
| `LOD2` | ≤ 4.5k | ~21 m |

Authored as **sibling groups under the asset root**, named `LOD0`, `LOD1`, `LOD2`. Not nested. The
importer builds a `THREE.LOD` automatically and derives switch distances from the model's own
bounding radius, so a 1.95 m character and a 0.6 m rifle swap at the same apparent size.

**Every `PART_` node must exist in every level.** A part present only at LOD0 stops animating the
moment the level switches, which reads as the character dying rather than as a detail reduction.

---

## Step 7 — Verify and integrate

```bash
npm run asset-inspect -- "path/to/MaintenanceRobot_v01.glb" --kind character
```

Expected: **0 blocking**. Then:

1. Copy to `public/assets/characters/`.
2. Add the manifest entry — including `yawOffset: Math.PI` if it still faces +Z, and `scale` if it
   is not authored at 1.95 m.
3. Point `CHARACTER_ASSET_ID` in `AssetAvatars.tsx` at the new id (currently `hero_athlete`).
4. Run the game. The blockout hands over automatically once the asset resolves.

No other code changes.

---

## Performance expectations

Measured with the rigged reference character, 5 remote actors, interleaved A/B in Apex:

| | Blockout | Imported | Delta |
|---|---|---|---|
| GPU | 7.82 ms | 7.77 ms | **−0.04 ms** (noise) |
| CPU | 2.99 ms | 3.35 ms | **+0.36 ms** |
| Draw calls | 184 | 214 | **+30** (6 per character) |

**Read this carefully: it measures the path, not the eventual asset.** The reference character is a
156-triangle blockout, so its GPU cost is nil. What the numbers do establish is that the *machinery*
— skinning, mixers, per-slot materials, weapon attachment — costs about 0.07 ms of CPU per character
and roughly 6 draw calls.

Projecting to a real 15k-triangle character with four zones:

- **Draw calls:** ~5 per character (4 zones + weapon). Sixteen players ≈ **80 calls**, against the
  blockout's constant 18. Significant but affordable on a 204-call frame.
- **Triangles:** 16 × 15,000 = 240,000, plus LOD reduction at distance. Against an arena that
  renders 59,645, this roughly quintuples scene geometry — but the frame is fragment-bound, not
  vertex-bound, so expect a smaller GPU cost than that ratio suggests.
- **CPU:** ~0.07 ms per skinned character ≈ **1.1 ms** for sixteen. Real, and worth watching against
  a 2–3 ms budget.

**For comparison, the unoptimised source measured +4.44 ms of GPU for a single instance and +14.8 ms
for six.** The optimisation work in this document is what turns that into something shippable.

---

## Checklist

- [ ] **Step 1** — proportions decided (recommend: narrow arms to ~0.75 m span)
- [ ] **Step 2** — retopologised to 12–16k with deformation loops, hidden and internal geometry removed
- [ ] **Step 3** — maps baked to 2K, ORM packed, compressed to KTX2, back detail matched to front
- [ ] **Step 4** — 4 material zones, `PART_visor`, 4 sockets, `COL_body`
- [ ] **Step 5** — humanoid rig, conventional bone names, right hand posed for grip, clips named to vocabulary
- [ ] **Step 6** — LOD0/1/2 authored, every `PART_` present in each
- [ ] **Step 7** — `asset-inspect` reports 0 blocking, manifest entry added, playtested
