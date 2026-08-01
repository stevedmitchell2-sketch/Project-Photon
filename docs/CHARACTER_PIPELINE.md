# Character Pipeline

Production brief for `HeroAthlete_v01.glb`, and the requirements a rigged character must satisfy.

This is the **least-proven path in the pipeline** and the document is explicit about which parts are
implemented and which are specified but untested. Everything about weapons and modules has been
exercised end to end; nothing about skeletal characters has, because no rigged asset exists yet.

---

## 1. Design intent

**Elite competitors, not soldiers.**

Athletic armour over a competition suit. No military webbing, no camouflage, no pouches. The design
language is closer to motorsport or speed skating than to a shooter: protective plating where impact
happens, close-fitting elsewhere, and the team's colour carried as trim rather than as a paint job.

**Silhouette outranks detail.** The readable part of a player at 20 m is the outline. A distinctive
helmet shape and a back-mounted energy cell do more for identification than any amount of surface
work.

## 2. Dimensions

| | |
| --- | --- |
| Height | **1.80 m** standing |
| Capsule radius | 0.36 m — the collision the simulation uses |
| Origin | Between the feet, on the ground plane |
| Up / Forward | +Y / −Z |

The 1.8 m figure is not stylistic. `MOVEMENT.standHeight` is 1.8 and the physics capsule is built
from it; a character authored at a different height will not match its own collision, its eye line
or its crouch.

## 3. Skeleton

### Bone naming

Bones are matched **by name**, following the same principle as node naming — a rig whose bones are
named correctly works with no code written for it.

Photon uses the **Mixamo naming convention**, without the `mixamorig:` prefix:

```
Hips
  Spine, Spine1, Spine2
    Neck → Head
    LeftShoulder  → LeftArm  → LeftForeArm  → LeftHand
    RightShoulder → RightArm → RightForeArm → RightHand
  LeftUpLeg  → LeftLeg  → LeftFoot  → LeftToeBase
  RightUpLeg → RightLeg → RightFoot → RightToeBase
```

Mixamo was chosen because it is the most widely produced rig format — Mixamo itself, most retargeting
tools, and most generative character tools emit or accept it. A project-specific naming scheme would
mean retargeting every asset by hand.

**Minimum viable rig: 22 bones.** Fingers, twist bones and facial rig are optional and ignored.

### Requirements

- Single skeleton root, no multiple armatures
- Y-up, rest pose is **A-pose** (arms at ~45°), not T-pose
- Uniform scale of 1.0, transforms applied
- Maximum 4 bone influences per vertex

## 4. Sockets

| Socket | Parent bone | Purpose |
| --- | --- | --- |
| `SOCKET_helmet` | `Head` | Helmet attachment for variants |
| `SOCKET_backpack` | `Spine2` | Energy cell — the intended silhouette signature |
| `SOCKET_weapon_right` | `RightHand` | Primary weapon mount |
| `SOCKET_weapon_left` | `LeftHand` | Support hand placement |

All four are **required** and their absence fails the audit.

`SOCKET_weapon_right` must align with the rifle's `SOCKET_grip`: the weapon's grip socket is placed
onto the character's hand socket, so their orientations have to agree or the weapon will be held at
an angle.

## 5. Material zones

Four zones, which is the character budget. Tight on purpose: avatars are drawn as instanced batches
keyed by (geometry, material), so every extra zone multiplies batch count by team count.

| Zone | Substance | Team | Covers |
| --- | --- | --- | --- |
| `MAT_suit` | `compositePolymer` | — | Under-suit, limbs |
| `MAT_armor` | `carbonFibre` | — | Chest plate, shoulder guards, shin and forearm plating |
| `MAT_trim` | `ledStrip` | **Yes** | Team trim: chest, shoulders, back, helmet crest |
| `MAT_visor` | `energyEmitter` | **Yes** | Helmet visor |

### Where team colour goes

Trim must be visible **from every angle**. A player identifies a target from behind and above as
often as head-on, so trim on the chest alone is a design failure. Required placements: chest, both
shoulders, upper back, helmet crest.

Colour is never the only carrier — the overhead marker ring supplies shape as well as hue for
colourblind players, and it is rendered by the game, not the asset.

## 6. Budgets

| | |
| --- | --- |
| Triangles (LOD0) | **18,000** |
| Material zones | 4 |
| Texture size | 2048px max |
| Texture memory | 10 MB |
| LOD levels | **3**, each ≤55% of the previous |

Three LODs rather than the weapon's two, because up to sixteen characters are on screen at once and
most of them are far away. LOD1 should hold at 10 m, LOD2 beyond 25 m.

## 7. Animation

### What exists

The importer loads animation clips and exposes them by name. **Nothing drives them yet.**

The current avatar is animated procedurally: leg cycle from horizontal speed, torso lean, head
pitch from aim, right arm tracking the weapon. That code is written against a joint interface, so a
rigged character can either keep using it or switch to clips.

### Required clips

Ship these named exactly. They map to states the simulation already produces.

| Clip | Trigger | Notes |
| --- | --- | --- |
| `Idle` | Stationary | Looping |
| `Run` | Speed > walk threshold | Looping, root motion **removed** |
| `Walk` | Below sprint | Looping, root motion removed |
| `CrouchIdle` / `CrouchWalk` | Crouch stance | Looping |
| `JumpStart` / `JumpLoop` / `JumpLand` | Air state | One-shot, loop, one-shot |
| `Slide` | Slide stance | One-shot |
| `Death` | Elimination | One-shot |

**Root motion must be removed.** The simulation owns position — it is authoritative, deterministic
and networked. An animation that moves the character will desync it from its own collision capsule
and from the server.

### State machine compatibility

The simulation already exposes everything a blend tree needs on `Actor`: `velocity`, `grounded`,
`stance`, `alive`, `airTime`, `lean`, `pitch`. No new gameplay state is required — the character
system reads what movement already computes.

## 8. What is implemented vs specified

Stated plainly, because this is the part of the pipeline most likely to surprise someone.

**Implemented and tested:**
- Node-name socket and part extraction
- Material zone substitution, including team colouring
- LOD group detection
- Budget and naming validation
- Fallback to the procedural avatar when the asset is absent

**Specified but untested:**
- Bone-name matching (no rigged asset exists to test against)
- Clip playback (loaded and exposed; nothing drives them)
- Socket-to-socket weapon mounting
- LOD switching at distance

**Not started:**
- Retargeting or bone remapping for non-Mixamo rigs
- Blend trees or a state machine
- Cloth, IK, or procedural secondary motion

## 9. Recommended order

Build the **rig and skeletal playback alongside the first character**, not before it. A playback
system built with nothing to play is how you get a system that fits no real asset — and this is the
one remaining piece of engineering that content is genuinely blocked on.

Everything else in the pipeline was proven against a real consumer before being declared finished;
the character path is the exception, and it should stop being one as soon as an asset exists.

## 10. Delivery checklist

- [ ] 1.80 m tall, origin between the feet, metres, +Y up, −Z forward
- [ ] A-pose rest, transforms applied, uniform scale
- [ ] Mixamo bone names, no prefix, ≥22 bones
- [ ] Max 4 influences per vertex
- [ ] All four sockets present, `SOCKET_weapon_right` aligned to the rifle's grip
- [ ] Four `MAT_` zones; trim visible from front, back, above
- [ ] Three LODs, each ≤55% of the previous
- [ ] Textures ORM-packed and named
- [ ] Under 18,000 triangles and 10 MB
- [ ] Clips named per the table, root motion removed
- [ ] Exported as `HeroAthlete_v01.glb`
- [ ] `npm run asset-audit` passes
