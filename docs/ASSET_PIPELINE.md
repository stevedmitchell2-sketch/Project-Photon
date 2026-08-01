# Photon Asset Pipeline

How content gets from a modelling tool into the game.

Read [ASSET_STANDARDS.md](./ASSET_STANDARDS.md) for the rules an asset must satisfy, and
[CONTENT_ROADMAP.md](./CONTENT_ROADMAP.md) for what to make first. This document is the *process*.

---

## The one idea

**Photon defines a contract, not a format.**

The runtime never looks for a mesh at a hardcoded index or assumes a hierarchy. It looks for **named
nodes** inside a standard glTF file. An asset whose nodes follow the naming rules works with no code
written for it.

That choice is deliberate and it is what keeps the pipeline open:

- a custom format would need a custom exporter, which locks content creation to whoever wrote it;
- node naming works out of **any** tool that can name an object and export glTF — Blender, Maya,
  3ds Max, Houdini, Substance, an online converter, or a generative model;
- **nothing in this pipeline is Blender-specific.** Blender is the documented workflow because it is
  free and complete, not because it is required.

The contract is `src/assets/contract.ts`. It is short, and it is the only file an artist strictly
needs to understand.

## The flow

```
  Modelling tool                 Blender · Maya · Houdini · generative
  (any that exports glTF)
        │
        ▼
  Texturing                      Substance Painter · ArmorPaint · Quixel
        │                        Export ORM-packed, see ASSET_STANDARDS
        ▼
  glTF export (.glb)             Binary, +Y up, metres, -Z forward
        │
        ▼
  public/assets/<kind>/          Naming: PascalCase_vNN.glb
        │
        ▼
  Manifest entry                 src/assets/manifest.ts — id, zones, kind
        │
        ▼
  npm run asset-audit            Naming, budgets, zones, orphans
        │
        ▼
  Photon Importer                Sockets · parts · LODs · collision · materials
        │
        ▼
  Runtime validation             Dev-only console findings as the asset loads
        │
        ▼
  Game                           Falls back to procedural if absent
```

## Step by step

### 1. Model

Any tool. The requirements are in ASSET_STANDARDS; the ones that catch people out:

- **Metres, +Y up, −Z forward.** glTF's convention. Blender's exporter converts from Z-up
  automatically — leave "+Y Up" checked.
- **Apply transforms before export.** An unapplied scale becomes a node scale the runtime then has
  to fight.
- **Name the nodes.** This is the whole contract. `SOCKET_muzzle`, `PART_core`, `MAT_shell`.

### 2. Texture

Export **ORM-packed**: occlusion in R, roughness in G, metalness in B, one file. Three separate maps
cost three samples per fragment instead of one, and the frame is fragment-bound — this is an audit
*error*, not a style note.

Naming: `AssetName_zone_MAP.png` where MAP is `BC`, `N`, `ORM` or `E`.

### 3. Export

`.glb` (binary) preferred — one file, no missing-sibling problems. `.gltf` accepted. `.fbx` accepted
as a compatibility path for tools and generators that cannot emit glTF, but it is converted on import
and loses material fidelity, so the audit warns.

Draco compression is optional and supported.

### 4. Place and register

Drop the file in `public/assets/<kind>/`, then add a manifest entry naming its material zones.

**The manifest entry may exist before the file does.** That is intentional: the manifest is the
*specification an artist works to*, and the audit reports which specified assets are still missing.
The list in `src/assets/manifest.ts` is therefore also the content backlog.

### 5. Audit

```bash
npm run asset-audit
```

Reports what exists, what is still to author, budget and naming violations, and files on disk that
no manifest entry claims. `--strict` fails on warnings too, for CI.

### 6. Run

The game picks the asset up automatically. If it is absent, the procedural fallback renders instead —
which is why the repository stays clone-and-run with no binary assets and CI never needs the content
pipeline.

## The node contract

| Prefix | Meaning |
| --- | --- |
| `SOCKET_` | Attachment point. Transform is read, node is never rendered. |
| `PART_` | Runtime-animated part. Addressed by the name after the prefix. |
| `MAT_` | Material zone. Mapped to a library substance by the manifest. |
| `TEAM_` | Takes team colour at runtime. |
| `LOD0`, `LOD1` … | Level of detail. |
| `COL_` | Collision geometry. Never rendered; handed to physics. |

Nodes without a prefix are ordinary geometry. **An asset following none of these conventions still
loads** — it simply has no sockets, no animated parts and no material zones.

### Materials are substituted, not imported

An imported mesh does not bring its own look into the scene by default. It declares zones by node
name; the manifest maps each zone to a substance from the Photon material library. So every asset
automatically inherits the project's lighting response, readability rules and team colouring — and a
change to how carbon fibre looks changes every asset made of it.

The authored **base colour survives** the substitution: the substance supplies the physical response,
the file supplies the hue.

Set `useSourceMaterial: true` on a zone to keep what the file shipped with. That is an escape hatch
for hero assets with authored texture sets, not the default, and the audit lists every use so the
exceptions stay visible.

## Proof that it works: the weapon

The clearest demonstration is that **the procedural rifle follows the asset contract too.**

`ViewModel.tsx` names its primitive meshes `PART_core`, `PART_rail_00`, `SOCKET_muzzle` and so on,
then scans its own subtree with the same function the importer uses. The animation — charge rails,
core pulse, emitter heat, muzzle light — addresses parts by name and has **no idea** whether it is
driving primitives or an imported mesh.

Dropping `HeroLaserRifle_v01.glb` into `public/assets/weapons/` swaps one branch of a ternary. The
muzzle light even relocates to the asset's own `SOCKET_muzzle`.

That is the standard every other system should be brought to.

## Preparing for generated assets

Generative tools are a first-class source, not a special case. They emit standard glTF, so they hit
the same contract as a human artist. Three practical notes:

1. **Generated meshes are usually unnamed.** A generated asset needs a naming pass — in Blender, a
   script, or the generator's own export settings — before sockets and parts work. Without it the
   asset still renders; it just cannot animate or mount.
2. **Generated topology is usually dense and unoptimised.** The triangle budgets in the contract
   exist partly for this. Run the audit before assuming an asset is usable.
3. **Generated materials are usually unpacked.** The ORM rule catches this, and it is the most
   common audit error from any automated source.

The pipeline does not care where geometry comes from. It cares that it is named, budgeted and packed.

## Hot reload

Vite HMR reloads the module graph, and `clearAssetCache()` drops loaded assets so a changed manifest
takes effect without a full refresh. Replacing a `.glb` on disk currently needs a browser refresh —
the browser caches it by URL, which is also why the version suffix in the filename exists.

## What this pipeline does not do yet

Named honestly, because a pipeline document that overstates itself is worse than none:

- **No build-time processing.** No automatic LOD generation, no texture transcoding to KTX2, no
  mesh optimisation. Assets are shipped as authored.
- **No collision generation.** `COL_` meshes are extracted and handed back but not yet fed into
  Rapier — the arena still builds collision from brushes.
- **No skeletal animation playback.** Clips are loaded and exposed; nothing drives them yet, because
  no rigged asset exists to test against.
- **No dependency graph.** Textures referenced from inside a `.glb` are discovered on load, not
  tracked ahead of time.

Each is a known gap with a place in the roadmap rather than an oversight.
