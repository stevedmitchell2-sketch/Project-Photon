# Unreal Stage 0 — blocked on toolchain, groundwork laid

**Stage 0 is NOT complete.** A playable vertical slice was not produced and cannot be produced on
this machine. This document records exactly why, exactly what was done, and exactly what is needed.

The Three.js Photon runtime is untouched: no file under `src/`, `tests/`, `public/` or `scripts/` was
modified. All Unreal work is isolated in `unreal/PhotonUE/`.

---

## The blocker — verified, not assumed

Unreal Engine **5.8 is installed** at `C:\Program Files\Epic Games\UE_5.8`, and `UnrealEditor.exe`,
`UnrealEditor-Cmd.exe`, UnrealBuildTool and the bundled Python 3 are all present.

**There is no C++ toolchain.** Searched and absent:

| Component | Result |
|---|---|
| Visual Studio (any edition) | not installed — no `Microsoft Visual Studio` under either Program Files |
| Standalone MSVC / `cl.exe` | not found anywhere on `C:` outside the engine |
| Windows SDK | `C:\Program Files (x86)\Windows Kits` does not exist |
| clang | not on PATH |
| `vswhere.exe` | not present |
| dotnet | **present** (UBT itself runs) |

Confirmed by running the real build rather than inferring:

```
> Build.bat PhotonEditor Win64 Development -Project=.../PhotonUE.uproject
Using bundled DotNet SDK version: 10.0 win-x64
Creating makefile for PhotonEditor (no existing makefile)
Platform Win64 is not a valid platform to build. SDK validation failed:
  Sdk: not found. Required version 10.0.19041.0.
Result: Failed (OtherCompilationError)
```

One useful positive signal in that output: UBT reached **"Creating makefile"**, which means
`PhotonUE.uproject`, `Photon.Target.cs`, `PhotonEditor.Target.cs` and `Photon.Build.cs` were all
parsed and accepted. The build scripts are structurally valid; only the platform SDK is missing.

### Why this blocks essentially all of Stage 0

- **A C++ project cannot compile**, so none of the gameplay module can run, and the editor cannot
  open a project whose module fails to build.
- The obvious fallback — a **Blueprint-only project** — does not need a compiler, but authoring
  Blueprint *event graphs* requires the editor GUI. I can drive a browser; I cannot drive the Unreal
  editor's viewport and graph editor. Python can create assets but cannot practically author node
  graphs.
- Therefore neither path reaches "launch it, grab the controller, move, look, shoot" from here.

### What unblocks it

Install **Visual Studio 2022 Build Tools** with:
- Desktop development with C++
- Windows 11 SDK (10.0.22621 or the 10.0.19041 UBT named)
- MSVC v143 x64/x86 build tools

Then `Build.bat PhotonEditor Win64 Development -Project=...` should compile, and
`Tools/bootstrap_stage0.py` can be run to generate the input and weapon assets.

---

## What was actually produced

### Verified working

| Item | Evidence |
|---|---|
| `unreal/PhotonUE/` project skeleton | UBT parsed `.uproject`, both `.Target.cs`, and `Photon.Build.cs` |
| **PH-6 converted to FBX** | `RawAssets/PH6_PhotonRifle.fbx`, 1.7 MB, 27,986 faces, bounds 0.981 × 0.116 × 0.301 m — matches the measured long axis exactly. Produced by the existing `tools/blender/photon_glb_to_fbx.py` on Blender 5.2, reused unchanged. |

The Blender script printed a warning that the model is wider than tall and Mixamo's auto-rigger will
refuse it. That warning is correct and irrelevant here — it exists for character uploads, and the
PH-6 is importing as a Static Mesh.

### Written but UNVERIFIED (never compiled)

- `Source/Photon/PhotonCore.h` / `.cpp` — `EPhotonTeam` (four teams), `PhotonTeamColor()`,
  `UPhotonWeaponData`, `APhotonProjectile`, `UPhotonHealthComponent`.
- `Source/Photon/Photon.cpp` — primary game module.
- `Config/DefaultEngine.ini` — Lumen, virtual shadow maps, restrained bloom.
- `Tools/bootstrap_stage0.py` — generates 15 Enhanced Input actions, the `IMC_Photon` context with
  the requested PlayStation mapping plus simultaneous keyboard/mouse, two weapon Data Assets ported
  from `src/config/weapons.ts`, and the PH-6 FBX import.

Every one of these files carries an explicit unverified marker. Expect to fix API details on first
run — Unreal's Python API for Enhanced Input has changed shape across 5.x, and `map_key` in
particular is flagged in the script as the first thing to check.

### Design decisions worth keeping from this pass

- **Units.** Unreal is centimetres, the reference build is metres. Every speed and distance is ×100.
  This is applied in exactly one place (the weapon data) and called out as the most likely porting
  error.
- **`UPhotonWeaponData` holds the line the reference build already held**: no weapon behaviour
  hardcoded outside data. The PH-6's eight-shot cell is a field, not a constant — which is precisely
  what let four weapons be added to the TS build without touching the simulation.
- **`EPhotonFeedMode`** distinguishes the recharging energy cell from magazine + reserve + reload, so
  the roster can hold both. The reference build only ever implemented the cell.
- **Friendly fire is rejected inside `UPhotonHealthComponent`**, not at the projectile, so every
  future damage source inherits the rule without knowing about it.
- **Health/team are `Replicated`**, and damage is authority-gated, so the multiplayer shape is right
  from the start rather than retrofitted.

---

## Acceptance criteria — honest status

**Met: 1 of 33.** "Existing Three.js Photon remains untouched."

**Blocked by the missing toolchain (30):** project launches, controller, keyboard/mouse, move, look,
sprint, jump, crouch, FP camera, PH-6 appears, PH-6 positioned, ADS, fire, recoil, projectile,
projectile VFX, hit detection, damage, bot exists, bot damaged, bot dies, respawn, second weapon,
weapon switching, grenade, team colours, HUD, arena playable, arena lighting depth, arena not boxes,
central landmark, multiplayer architecture *(source written, unverifiable)*.

**Partially met (2):** "Build is reproducible" — the skeleton and bootstrap are scripted and
committed, but reproducibility is unproven since it has never run. "PH-6 appears correctly" — the
asset is converted and ready, but nothing has rendered it.

I am not marking anything else as done. Writing C++ that has never been compiled is groundwork, not a
vertical slice, and the eight required screenshots do not exist because there is nothing to
screenshot.

---

## Next session, in order

1. **Install VS 2022 Build Tools + Windows SDK.** Nothing else in Stage 0 can proceed first.
2. `Build.bat PhotonEditor Win64 Development` — expect compile errors in `PhotonCore.cpp`; fix them.
   This is the first honest checkpoint.
3. Run `Tools/bootstrap_stage0.py`; fix the Enhanced Input API calls.
4. Add `SOCKET_muzzle`, `SOCKET_grip`, `SOCKET_sight` to the imported `SM_PH6` in the Static Mesh
   Editor. This closes a gap that has blocked the TS build for several sessions and takes minutes here.
5. Write `APhotonCharacter` (CMC subclass with a custom slide movement mode), `APhotonPlayerController`,
   `APhotonGameMode`/`GameState`/`PlayerState`, `UPhotonInventoryComponent`, `APhotonWeapon`,
   `AGrenadeBase`, `APhotonAIController`. **None of these exist yet** — deliberately not written,
   because more uncompilable C++ inflates apparent progress without adding confidence.
6. Grey-box arena, then the modular kit; Niagara for muzzle/bolt/impact; UMG HUD.
7. Only then the eight acceptance screenshots.

## What should not be migrated

Unchanged from `docs/UNREAL_MIGRATION_PLAN.md` §4: the instanced batching, the world-UV
`onBeforeCompile` patch, procedural normal generation, the capture harness, the Zustand persistence
migrations, `MuzzleRegistry`, and the 24-slot avatar pool. All exist to work around the current
runtime.
