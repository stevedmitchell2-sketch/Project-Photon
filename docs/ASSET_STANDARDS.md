# Photon Asset Standards

The rules an asset must satisfy. Enforced by `npm run asset-audit` and by the importer at runtime.

The machine-readable source of truth is `src/assets/contract.ts`. This document explains it.

---

## 1. Formats

| Format | Status |
| --- | --- |
| `.glb` | **Preferred.** Binary glTF, one file, no missing siblings |
| `.gltf` | Accepted |
| `.fbx` | Compatibility path. Converted on import, loses material fidelity — audit warns |
| `.blend`, `.max`, `.ma` | **Never shipped.** Working files, not assets |

Draco compression is supported and optional.

## 2. Transforms

- **Units: metres.** A 1.8 m character is 1.8 units tall.
- **Up: +Y. Forward: −Z.** glTF convention. Blender's exporter converts from Z-up with "+Y Up".
- **Apply all transforms before export.** An unapplied scale becomes a node scale the runtime fights.
- **Origin at the mount point.** A weapon's origin is its grip; a wall module's origin is its
  bottom-centre on the grid; a character's origin is between the feet.

## 3. Naming

### Files

```
PascalCaseName_vNN.glb        HeroLaserRifle_v01.glb
```

The two-digit version suffix is **mandatory**. It is how an asset is iterated without cache
ambiguity: drop `_v02` beside `_v01` and switch by editing one manifest line. Browsers cache by URL,
so a new filename is also how a replaced asset actually reaches players.

### Textures

```
AssetName_zone_MAP.ext        HeroLaserRifle_shell_ORM.png
```

`MAP` is one of `BC` (base colour, sRGB), `N` (normal, linear), `ORM` (linear), `E` (emissive, sRGB).

### Nodes

| Prefix | Purpose | Example |
| --- | --- | --- |
| `SOCKET_` | Attachment point; transform read, never rendered | `SOCKET_muzzle` |
| `PART_` | Runtime-animated part, addressed by suffix | `PART_rail_03` |
| `MAT_` | Material zone, mapped by the manifest | `MAT_shell` |
| `TEAM_` | Takes team colour at runtime | `TEAM_trim` |
| `LOD0`… | Level of detail | `LOD1` |
| `COL_` | Collision geometry | `COL_body` |

Prefixes are mutually unambiguous — no prefix is a prefix of another — and this is unit-tested, so
node classification is never order-dependent.

## 4. Required sockets

| Kind | Required |
| --- | --- |
| Weapon | `muzzle`, `grip`, `sight` |
| Character | `helmet`, `backpack`, `weapon_right`, `weapon_left` |
| Module, prop, decal, VFX | none |

A missing required socket is an **error**: the runtime mounts by name, so without it the asset
cannot be attached.

## 5. Animated parts

Optional — a missing part is skipped, so a simpler asset still works — but named so an artist knows
what the animation looks for.

| Kind | Parts |
| --- | --- |
| Weapon | `core`, `emitter`, `rail_00` … `rail_06`, `cell_00` … |
| Character | `visor`, `backpack_core` |

Rails and cells are **discovered, not counted**: ship any number and the animation spreads across
however many it finds.

## 6. Budgets

Budgets are enforced, not advisory. `asset-audit` fails on a violation.

| Kind | Triangles | Zones | Texture | Memory | LODs | LOD drop |
| --- | --- | --- | --- | --- | --- | --- |
| Weapon | 28,000 | 6 | 2048px | 12 MB | 2 | 50% |
| Character | 18,000 | 4 | 2048px | 10 MB | 3 | 45% |
| Module | 2,500 | 2 | 1024px | 4 MB | 2 | 50% |
| Prop | 4,000 | 3 | 1024px | 4 MB | 2 | 50% |
| Decal | 32 | 1 | 1024px | 2 MB | 1 | — |
| VFX | 512 | 1 | 512px | 2 MB | 1 | — |

### Why these numbers

**The frame is fragment-bound.** Sprint 8 measured eight dynamic lights at 2.3 ms of a 12.3 ms frame
and post-processing, shadows and volumetrics together at about 0.1 ms. Geometry is comparatively
cheap here; per-pixel work and texture memory are not. That is why the texture budgets are tight
relative to industry norms while the triangle budgets are generous.

**Material zones scale differently by kind.** A weapon zone costs one draw call per frame — there is
one weapon. A character zone costs one per player per frame, and avatars are drawn as instanced
batches keyed by (geometry, material), so every extra zone multiplies batches by team count. A module
zone is worse again: modules are placed hundreds of times, and a kit sharing one material set
collapses an entire arena into a handful of draw calls.

The weapon's six zones cover four static plus **two animated** — team trim and the energy core mutate
emissive every frame and cannot share a cached material with anything else.

## 7. Textures

**ORM packing is mandatory** for anything beyond a base colour: occlusion in R, roughness in G,
metalness in B, one file. Separate roughness and metalness maps are an **error**, not a warning —
three samples per fragment instead of one, on a budget that is already over.

Roughness maps **multiply** the material's roughness value; they do not replace it. A mid-grey map
halves roughness. Keep roughness data in the 0.7–1.0 band unless a surface is genuinely polished.
This rule cost Sprint 11 a full iteration.

## 8. LODs

Name them `LOD0`, `LOD1`, `LOD2`. Each level must remove at least the drop percentage above — an LOD
that saves nothing costs a draw call for nothing, and the audit warns.

## 9. Materials

An asset declares **zones**, not materials. The manifest maps each zone to a substance from the
Photon material library, and the importer substitutes it — so the asset inherits the project's
lighting response, readability rules and team colouring automatically.

The authored base colour survives; the substance supplies the physical response, the file supplies
the hue.

Available substances are listed in [MATERIAL_LIBRARY.md](./MATERIAL_LIBRARY.md).

## 10. Collision

`COL_` meshes are extracted, removed from the render tree and returned separately. Keep them convex
and coarse — collision geometry is not visual geometry, and a collision mesh matching render detail
is a performance mistake in both systems.

**Not yet wired into Rapier.** Extracted and available; the arena still builds collision from brushes.

## 11. Checklist

Before committing an asset:

- [ ] Metres, +Y up, transforms applied
- [ ] Origin at the mount point
- [ ] `PascalCaseName_vNN.glb`
- [ ] Required sockets present and named
- [ ] Animated parts named if the asset animates
- [ ] Material zones named and mapped in the manifest
- [ ] Textures ORM-packed and named
- [ ] LODs present and each saving its share
- [ ] Inside budget
- [ ] `npm run asset-audit` passes
