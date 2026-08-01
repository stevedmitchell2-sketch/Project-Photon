# Photon Material Library

The named substances every surface in the game is made of, and how to use them.

Source: `src/render/materials/PhotonMaterials.ts` and `PhotonTextures.ts`.

---

## The idea

A material in Photon is a **named physical substance**, not a colour.

`brushedAluminium` is a substance. "The wall material" is not, because a wall might be aluminium or
composite depending on what the arena says it is. **Colour is supplied by the caller** — from the
arena palette, from a team, or from an imported asset's authored base colour.

This matters for three reasons:

1. **One place to change.** A change to how carbon fibre responds to light changes every object made
   of it, including imported assets, without touching any of them.
2. **Imported assets inherit the project.** A `.glb` declares zones by node name; the manifest maps
   each to a substance. The asset picks up Photon's lighting response and readability rules rather
   than shipping its own flat textures.
3. **Shader programs stay flat.** Materials are cached by (substance, colour, options). Three.js
   compiles a program per unique configuration, so an uncached library would multiply program count
   by object count. The whole game currently runs on **32 programs**.

## The substances

### Metals

| Substance | Roughness | Metalness | Texture | Use |
| --- | --- | --- | --- | --- |
| `brushedAluminium` | 0.50 | 0.46 | Brushed streaks | Structural metal, pillars, weapon frame |
| `titanium` | 0.62 | 0.60 | Brushed streaks | Ribs, trusses, heat fins — darker, less reflective |
| `paintedAlloy` | 0.56 | 0.42 | Panel seams | Furniture, housings, brackets |

### Composites and polymers

| Substance | Roughness | Metalness | Texture | Use |
| --- | --- | --- | --- | --- |
| `carbonFibre` | 0.60 | 0.34 | Woven twill | Cover, barriers, weapon shell. Reads as *sports equipment*, not armour plate |
| `compositePolymer` | 0.88 | 0.16 | Panel seams | The bulk of walls. Deliberately unremarkable |
| `rubberGrip` | 0.95 | 0.00 | Grip pattern | Grips and pads. Near-zero specular is what reads as "hand goes here" |

### Floors

| Substance | Roughness | Metalness | Texture | Use |
| --- | --- | --- | --- | --- |
| `competitionFloor` | 0.30 | 0.64 | Panel seams | The playing surface |
| `antiSlipFloor` | 0.55 | 0.66 | Grip + bump | Walkways, ramps, catwalks |
| `hexPanel` | 0.40 | 0.55 | Hex + bump | The signature motif. Used sparingly |

### Transparent and emissive

| Substance | Kind | Use |
| --- | --- | --- |
| `temperedGlass` | Standard, transparent | Observation glazing |
| `energyGlass` | Basic, additive | Barriers, gates, shield emitters. **Highest overdraw cost in the library** — thin surfaces only |
| `ledStrip` | Basic, unlit | Guidance and trim lighting. Reads at full strength in a dark corridor |
| `holoPanel` | Basic, additive | Display faces |
| `energyEmitter` | Standard, emissive | Emitter tips, charge cells, weapon core. Lit rather than unlit, so it still receives environment response and does not read as a flat sticker |

## Procedural textures

Photon ships **no image assets**. Five roughness/bump maps are generated deterministically on canvas
at load, from a fixed seed so a surface looks identical in every session and every screenshot.

| Texture | Structure | Substances |
| --- | --- | --- |
| `brushedMetal` | Fine directional streaks | Aluminium, titanium |
| `carbonWeave` | Interleaved twill slats | Carbon fibre |
| `antiSlip` | Offset grip studs | Rubber, anti-slip floor |
| `panelSeam` | Laid panels with seams | Composite, competition floor, painted alloy |
| `hexPanel` | Hexagonal tiling | Hex panel |

They are shared across substances rather than authored per surface, because every extra map is a
sample per fragment on a budget that is already over.

## Three rules learned the hard way

### Roughness maps multiply

Three.js multiplies the map's green channel into `roughness`; it does not replace it. **A mid-grey
map halves the roughness.** The first version of this library drew every texture around 40% grey,
which turned every wall in the arena into semi-polished plastic and washed the whole scene out.

Textures live in the **0.7–1.0 band** and modulate downward. The material owns the intended
roughness; the texture says only where a surface is locally smoother.

### The arena is lit for a specific material response

Metalness and roughness here are close to the values the lighting was tuned against, deliberately.
A pass using physically nicer numbers — aluminium at 0.82 metalness, composite at 0.05 — cost the
scene its contrast: walls went from mid-dark to pale grey, because low metalness shows more diffuse
albedo and the environment map lifted the rest.

**The texture variation was the win. The lighting response was already correct.**

### Emissive is not scale-invariant

What matters is the **solid angle** a surface occupies, not what it is made of. A value tuned on a
wall 10 m away reads as a glowing slab on a view model 0.4 m from the near plane. Substances used at
view-model scale pass `worldScale: false` and get roughly a fifth of the world value.

## Using the library

```ts
// Shared and cached — two objects asking for the same substance and colour get the same instance,
// which is what lets the renderer batch them.
const wall = photonMaterial('compositePolymer', { color: 0x353f4d });

// Animated materials must be unique. A shared instance would drive every other object made of the
// same substance.
const core = photonMaterial('energyEmitter', {
  color: teamGlow,
  worldScale: false,
  unique: true,
});
```

**Never mutate a returned material** unless you asked for `unique: true`.

## Surface kind → substance

The arena declares what a brush is *for*; this decides what it is *made of*. Keeping them separate is
what lets a future arena reuse the same kinds with a different material language.

| SurfaceKind | Substance |
| --- | --- |
| `floor` | `competitionFloor` |
| `wall` | `compositePolymer` |
| `catwalk`, `ramp` | `antiSlipFloor` |
| `barrier` | `carbonFibre` |
| `pillar` | `brushedAluminium` |
| `glass` | `temperedGlass` |
| `led`, `trim` | `ledStrip` |

## Not yet built

- **Trim sheet materials.** Would let one texture serve many modules; the largest remaining
  efficiency win once authored assets exist.
- **Decal materials.** Specified in the contract, no implementation.
- **Master/instance hierarchy.** The cache is flat. Parameter inheritance would help once the
  substance count grows past about twenty.
- **`MeshPhysicalMaterial` transmission for glass.** Tried and reverted: real transmission forces a
  separate full-scene pass, indefensible on a frame 30% over budget, and it misbehaves on the
  instanced meshes all arena glass uses.
