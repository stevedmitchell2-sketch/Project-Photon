# Hero Weapon Specification — PH-6 Photon Rifle

Production brief for `HeroLaserRifle_v01.glb`.

This is a **drop-in specification**. An asset built to it requires no code changes: the runtime
already drives a rifle through named nodes, and the procedural fallback in `ViewModel.tsx` follows
the identical contract. Place the file in `public/assets/weapons/` and it replaces the primitives.

---

## 1. Design intent

**Competition sports equipment, not a military weapon.**

The silhouette should read as an instrument — a long low body, an exposed energy spine, a visible
core. The parts that do the work are on show, the way a track bike or a racing shell shows its
structure.

- No magazine, no ammunition, no shell ejection. It does not fire bullets.
- No camouflage, no armour plating, no tactical rails bristling with attachments.
- Clean, maintained, engineered. This is equipment a league certifies.

The exposed energy spine running the length of the body is the **signature**: it is what makes a
Photon weapon identifiable in a screenshot.

## 2. Dimensions and orientation

| | |
| --- | --- |
| Overall length | **0.92 m** ±0.05 |
| Height (body, excl. sight) | 0.20 m |
| Width | 0.09 m |
| Units | Metres |
| Up / Forward | +Y / **−Z** (muzzle points −Z) |
| Origin | At the grip, where the hand closes |

The origin at the grip matters: the runtime positions the weapon by its rest transform and the grip
is the pivot everything sways around. An origin at the muzzle or the model's bounding-box centre
will swing incorrectly.

The runtime renders at `VIEW_MODEL_SCALE = 0.55`. **Author at life size** — the scale is applied for
framing, not to correct the asset.

### Orthographic layout for the modelling file

Provide four orthographic reference views before modelling: side (−X), top (+Y), front (−Z), and a
three-quarter. The side view is the important one; a laser rifle's read is almost entirely its
profile.

## 3. Required sockets

Empties, zero scale, never rendered. Rotation matters — the runtime reads full transforms.

| Socket | Location | Purpose |
| --- | --- | --- |
| `SOCKET_muzzle` | Emitter tip, on the bore axis | Bolt spawn point and muzzle light position |
| `SOCKET_grip` | Where the right hand closes | Mount reference; character right-hand attach |
| `SOCKET_sight` | Centre of the sight ring | ADS reference point |

**Missing sockets fail the audit.** The muzzle socket is the one that most affects feel: the muzzle
light and bolt origin both follow it, so an asset with a differently-placed barrel works correctly
with no code change.

## 4. Animated parts

Named nodes the runtime drives every frame. All optional — a missing part is skipped — but the
weapon loses that behaviour.

| Part | Behaviour |
| --- | --- |
| `PART_core` | Emissive pulses with remaining charge. Steady when loaded, faint and fast when empty |
| `PART_emitter` | Emissive rises as the cell drains, plus a kick on each shot — reads as heat build-up |
| `PART_rail_00` … `PART_rail_NN` | A travelling band runs stock→muzzle while recharging; slow idle breath when ready |
| `PART_cell_00` … `PART_cell_NN` | Charge indicator segments. Lit for remaining shots, dimmed and scaled down when spent |

**Rails and cells are discovered, not counted.** Ship any number; the animation spreads the band
across however many it finds, and the cell indicator uses the weapon config's capacity. Seven rails
and eight cells match the current design.

Parts must have their own material (see zones) because the runtime mutates `emissiveIntensity` on
them directly.

## 5. Material zones

Six zones, which is the weapon budget. Four static, two animated.

| Zone | Substance | Team | Covers |
| --- | --- | --- | --- |
| `MAT_shell` | `carbonFibre` | — | Receiver, stock rear, structural body |
| `MAT_frame` | `brushedAluminium` | — | Upper shroud, barrel, flanks, sight ring |
| `MAT_grip` | `rubberGrip` | — | Grip, fore grip |
| `MAT_vent` | `titanium` | — | Heat fins, exhaust ports, barrel slots, rail channel |
| `MAT_trim` | `ledStrip` | **Yes** | Team trim along the upper flank |
| `MAT_core` | `energyEmitter` | **Yes** | Energy core, emitter tip, charge rails |

The team zones take the wearer's colour at runtime and receive unique material instances. The
authored base colour survives on non-team zones — the substance supplies the physical response, the
file supplies the hue.

## 6. Budgets

| | |
| --- | --- |
| Triangles (LOD0) | **28,000** |
| Material zones | 6 |
| Texture size | 2048px max |
| Texture memory | 12 MB |
| LOD levels | 2 (`LOD0`, `LOD1`), LOD1 at ≤50% of LOD0 |

The weapon has the highest triangle budget in the project because it is on screen 100% of the time
and occupies a large solid angle. It is a single instance, so a material zone costs one draw call per
frame rather than one per player.

## 7. Textures

Per zone, ORM-packed:

```
HeroLaserRifle_shell_BC.png     base colour, sRGB
HeroLaserRifle_shell_N.png      normal, linear
HeroLaserRifle_shell_ORM.png    occlusion / roughness / metalness, linear
HeroLaserRifle_core_E.png       emissive, sRGB
```

Separate roughness and metalness maps are an **audit error** — three samples per fragment instead of
one on a fragment-bound frame.

Roughness data belongs in the **0.7–1.0 band**: roughness maps multiply the material value rather
than replacing it.

## 8. Rigging

**No skeleton required.** The rifle is driven by transform animation on named nodes, which the
runtime does procedurally — sway, kick, ADS blend and the charge rails are all computed, not baked.

If you ship animation clips, they are loaded and exposed but nothing drives them yet. Prefer leaving
parts as static nodes and letting the runtime animate them; that is what keeps the weapon responsive
to game state rather than playing a fixed loop.

## 9. Shader expectations

Standard PBR metallic-roughness. No custom shaders, no vertex animation, no shader-graph
dependencies — the importer substitutes Photon library materials by zone, so anything exotic in the
file is discarded.

If a zone genuinely needs its authored material, set `useSourceMaterial: true` on it in the manifest.
That is an escape hatch, and the audit lists every use so exceptions stay visible.

## 10. Delivery checklist

- [ ] Metres, +Y up, −Z forward, transforms applied
- [ ] Origin at the grip
- [ ] Overall length 0.92 m ±0.05
- [ ] `SOCKET_muzzle`, `SOCKET_grip`, `SOCKET_sight` present
- [ ] `PART_core`, `PART_emitter`, rails and cells named
- [ ] Six `MAT_` zones, matching the table above
- [ ] `LOD0` and `LOD1`, LOD1 at ≤50%
- [ ] Textures ORM-packed and named
- [ ] Under 28,000 triangles and 12 MB
- [ ] Exported as `HeroLaserRifle_v01.glb`
- [ ] `npm run asset-audit` passes

## 11. Integration

```
public/assets/weapons/HeroLaserRifle_v01.glb
```

That is the whole step. The manifest entry already exists, the zones are already mapped, and
`ViewModel.tsx` switches from primitives to the asset automatically.

To verify, check the browser console in development: the importer reports any contract violation as
it loads, and `npm run asset-audit` reports the manifest-level rules.
