# CHARACTER ASSET AUDIT

**Asset:** `futuristic maintenance robot 3d model.glb` · 55.8 MB · Tripo
**Tool:** `npm run asset-inspect -- "<file>" --kind character`
**Date:** 2026-08-06

---

## CLASSIFICATION: **B — needs retopology first**

Not **A** (ready for rigging), and not **C** (needs a complete rebuild).

**Why not A.** At 1,938,280 triangles no auto-rigger will accept it — Mixamo's upload ceiling is well
under this and Accurig's is similar. Weight painting a million-vertex mesh by hand is impractical,
and every subsequent pipeline step would be dragging two million triangles through it for a mesh
that will be thrown away when the low-poly version is built.

**Why not C.** The mesh is *clean*. Zero degenerate triangles, zero NaNs, unit normals throughout, a
complete non-overlapping UV set, and genuinely good PBR maps. The topology is unusable for
deformation but the **surface it describes is correct and worth keeping** — a retopology pass can
project all of it onto a new mesh. Rebuilding from scratch would discard good work.

The route is therefore: retopologise → bake the existing maps down → split zones → rig.

---

## Geometry

| Check | Result | Budget | Verdict |
|---|---|---|---|
| Triangle count | **1,938,280** | 18,000 | ✗ **107.7× over** |
| Vertex count | 1,014,407 | — | |
| Mesh separation | **1 mesh, 1 primitive, 1 node** | logical zones | ✗ one welded lump |
| Material count | 1 | 4 | ✓ |
| Normals | present, **100% unit length** | — | ✓ |
| UV availability | `TEXCOORD_0`, **100% inside 0–1** | — | ✓ |
| Tangents | **absent** | required with a normal map | ✗ generated at load |
| Topology quality | uniform dense tessellation, no edge loops | deformation-ready | ✗ see below |

### Topology, specifically

The density is characteristic of a marching-cubes or photogrammetry-style surface: even, extremely
fine, and **indifferent to the form underneath it**. There are no edge loops around the joints, no
poles placed for deformation, and no relationship between the wire and the panel breaks in the
design.

That is the real problem, and it is separate from the triangle count. A mesh can be dense and still
deform well if the loops are right; this one would not deform correctly even after decimation,
because a decimator preserves silhouette rather than adding the loops a shoulder needs.

### Health check — clean

| | |
|---|---|
| NaN / infinite positions | **0** |
| Degenerate index triples | **0** |
| Zero-area triangles | **0** (0.0000%) |
| Non-unit normals | **0** (0.000%) |
| UVs outside 0–1 | **0** (0.000%) |
| Index range | exact, 0…1,014,406 |

No holes, no inverted faces, no broken shading, no repair work needed.

---

## Rigging

| Check | Result |
|---|---|
| Contains a skeleton? | **No** — `skins: 0` |
| Skinned mesh? | **No** — no `JOINTS_0` / `WEIGHTS_0` |
| Supports humanoid animation? | Not as delivered |
| Can use the existing Photon character controller? | **Yes, once rigged** — see below |
| Needs auto-rigging? | **Yes**, and it is a good candidate |

### Can it use the existing controller?

**Yes, and nothing in the controller has to change.** This was verified rather than assumed: the
`AssetAvatars` path built in Phase 7 drives a skinned glTF from the same actor state the primitive
blockout reads — position, yaw, velocity, stance, grounded — and was tested end to end with a rigged
reference character. Five actors rendered, animated, team-coloured and armed.

The character controller is in the simulation and knows nothing about meshes. Any rigged humanoid
that satisfies the naming contract drops into that path.

### Why it is a good auto-rigging candidate

- clean bipedal humanoid proportions: head, neck, torso, pelvis, two arms, two legs;
- **individually modelled fingers with knuckle articulation** on both hands;
- discrete mechanical joint volumes at shoulder, elbow, hip, knee, ankle — the pivots are visually
  unambiguous, so bone placement is not guesswork;
- relaxed near-A-pose with limbs clear of the body, which is what auto-riggers want.

The one caveat: **the hands are modelled open**. A weapon parented to an open hand floats beside it.
Finger bones or a baked grip pose are needed — see the optimisation plan.

---

## Scale and orientation

| | Measured | Scaled to 1.95 m | Target | |
|---|---|---|---|---|
| Height | 0.979 m | 1.950 m | 1.95 m | ✓ |
| Width | 0.587 m | **1.168 m** | 0.70 m | ✗ 67% too wide |
| Depth | 0.264 m | 0.526 m | 0.45 m | ~17% over |

- **Origin at feet** — `minY = 0.000` ✓
- **Centred in X/Z** — symmetric to within a millimetre ✓
- **Faces +Z**; Photon's forward is **−Z** ✗ — needs `yawOffset: Math.PI` in its manifest entry
  (support for this was added in Phase 7, so it is a data fix, not a code fix)

**Uniform scale cannot satisfy both height and width.** Its width-to-height ratio is 0.60 against
the target's 0.36. This is a design decision, not a defect — resolve it before retopology, since the
answer changes the mesh.

---

## Materials and textures

| Texture | Size | VRAM (RGBA8 + mips) |
|---|---|---|
| basecolor | 4096² | 85.3 MB |
| rm (roughness/metal) | 4096² | 85.3 MB |
| normal | 4096² | 85.3 MB |
| **Total** | | **256.0 MB** vs **10 MB** budget — **25.6× over** |

Only 2.6 MB on disk — JPEG compresses them well. The 256 MB is the decompressed GPU cost, which is
the number that matters.

**Quality is good**: correct ORM-style packing, a real normal map, sensible metal/rough separation.
Detail is **front-loaded** — the back is comparatively flat, which matters in third person.

---

## Photon contract

| | Present | Required |
|---|---|---|
| `SOCKET_` nodes | **none** | `helmet`, `backpack`, `weapon_right`, `weapon_left` |
| `PART_` nodes | **none** | `visor`, `backpack_core` |
| `MAT_` zones | **none** | `suit`, `armor`, `trim`, `visor` |
| LOD levels | **0** | 3 |

All of these are added during retopology and rigging. None require the engine to change — the
importer, LOD construction, zone binding, socket binding and animation playback are all implemented
and proven against reference assets.

---

## Summary

| Area | Status |
|---|---|
| Mesh integrity | ✅ flawless |
| Material and texture quality | ✅ genuinely good |
| Art-direction fit | ✅ excellent — the cyan accents sit on Photon's house colour |
| Triangle budget | ❌ 107.7× over |
| Texture budget | ❌ 25.6× over |
| Deformation topology | ❌ not deformation-ready |
| Mesh separation | ❌ single welded lump |
| Rig | ❌ absent |
| Scale | ⚠️ half target; proportions broader than spec |
| Orientation | ⚠️ faces +Z (manifest fix) |
| Contract compliance | ❌ no sockets, parts, zones or LODs |
| **Engine readiness for it** | ✅ **complete and tested** |

**Recommended next action:** proceed to `CHARACTER_OPTIMIZATION_PLAN.md`. The blocking work is all
content-side; the engine is waiting.
