# Project Photon — Cursor Collaboration Handoff

Status labels used throughout: **VERIFIED** (observed at runtime or on screen), **PARTIALLY
VERIFIED**, **UNVERIFIED** (code exists, behaviour never observed), **BLOCKED**, **NOT IMPLEMENTED**.

---

## 1. Current commit

- Branch `main`, tip **`344ed5d`** — this handoff commit. The last functional change is `4b6e125`
  ("Unreal: import the PH-6 from GLB so it arrives with its materials").
- Working tree clean. **84 commits ahead of origin, unpushed** (by standing instruction — do not push
  without asking).
- Two runtimes coexist. `src/` is the **Three.js reference build** (~26,200 lines, 145 passing tests)
  and is the authority for gameplay design and tuning values. `unreal/PhotonUE/` is the migration
  target. **Do not modify `src/`, `tests/`, `public/` or `scripts/` for Unreal reasons.**

## 2. Unreal environment

| Item | State |
|---|---|
| Unreal Engine | 5.8 at `C:\Program Files\Epic Games\UE_5.8` |
| Compiler | MSVC 14.44.35207 (VS 2022 Build Tools) — **VERIFIED**, builds |
| Windows SDK | 10.0.22621.0 **and** 10.0.26100.0 installed. UE 5.8 requires 22621; 26100 alone fails |
| .NET Framework SDK | 4.8 (NETFXSDK) — required by SwarmInterface |
| Build result | `Result: Succeeded`, `UnrealEditor-Photon.dll` links and loads — **VERIFIED** |
| `Fab` plugin | Disabled in `.uproject`; its module fails to load and takes editor startup down |
| Build settings | `BuildSettingsVersion.V7` (V5 conflicts with the shared editor build environment) |

### Build command

```
& "C:\Program Files\Epic Games\UE_5.8\Engine\Build\BatchFiles\Build.bat" PhotonEditor Win64 Development -Project="C:/Users/Home/Desktop/100 men vs gorilla/photon/unreal/PhotonUE/PhotonUE.uproject" -WaitMutex
```

## 3. What is VERIFIED

Runtime-verified via a headless boot with `-PhotonSelfTest` (27 assertions, 0 failures):

- Character spawns, is possessed, has an `UEnhancedInputComponent`
- **Input binds: `ok=8 missing=0`**; **mapping context: `requested=27 actual=27`**, context added
- Inventory builds 2 weapons; PH-6 active initially
- Switch to PH-9 → active and visible; PH-6 hidden. Switch back → PH-6 active
- PH-6/PH-9 stats differ: `ph6 interval=0.170 dmg=28.0 | ph9 interval=0.085 dmg=15.0`
- Fire accepted; shot counter advances; **cooldown refuses an immediate second shot**
- Projectile spawns with correct owner and instigator, starts near the muzzle, **speed 21500 cm/s**
  (exactly the PH-6 data value — proof weapon data reaches the projectile)
- Target takes damage `100.0 → 72.0`, **friendly fire rejected**, dies at zero, resets

Visually verified **on screen** (from user screen recordings, the only reliable visual channel so far):

- Arena renders: floor, four walls, cover blocks, platform, sky gradient
- The PH-6 renders in first person, **lower-right, correct size, pointing downrange**
- Projectile point lights illuminate the level (bolts visible in the dark)

## 4. Structurally implemented but NOT visually verified

- **Weapon textures.** GLB import brought `basecolor_jpg`, `rm_png`, `normal_jpg` and material
  `tripo_mat_9a4be8dc`; both data assets repointed to `HeroLaserRifle_v01`. **Never seen on screen** —
  the last recording predates this. **Do not claim the weapon is textured without a screenshot.**
- **Exposure/lighting tone-down.** Sun 6 lux, fills 6000 cd, sky 1.0, exposure band 0.25–0.7.
  Applied with the editor closed, but the arena was blown out white in the last recording, which
  predates the fix.
- **Controller input.** 27 mappings present and correct in C++. **No physical controller has ever
  been tested.** Binding verified ≠ hardware verified.
- Movement/sprint/crouch/jump and mouse look: bound and counted, but **no observed on-screen motion**.
- `UPhotonHealthComponent` replication and authority gating — never tested with a second client.

## 5. NOT IMPLEMENTED

- **Muzzle flash** — nothing happens at the weapon when firing
- **Recoil / weapon kick / camera shake** — values exist in data, unused
- **First-person arms or hands** — the weapon floats, attached directly to the camera
- **Hit feedback / hit marker / impact effects / sound** — no audio at all
- **Grenades** (`AGrenadeBase`) — not started
- **HUD/UMG** — no crosshair, health, ammo or weapon readout
- **Reload / magazine feed** — `EPhotonFeedMode::Magazine`, `ReserveAmmo`, `ReloadTime` exist in the
  data model but no logic consumes them
- **ADS** — `AdsTransform` and `IA_ADS` exist; nothing blends to them
- **Weapons beyond PH-6/PH-9**; **bots/AI**; **multiplayer session flow**; **spectator/replay**
- Niagara VFX; authored arena assets; the modular kit

## 6. Current assets

### `Content/` is now tracked

`Content/` was gitignored until this handoff, which meant a fresh clone had no levels, Input Actions,
weapon Data Assets or imported mesh — an empty project. It is now committed (23 MB, 26 assets) so the
project is runnable immediately after clone.

The Python scripts in `unreal/PhotonUE/Tools/` remain the source of truth and can regenerate all of it
if content is ever lost or needs changing. Run with the editor **closed**, in this order:

1. `Tools/bootstrap_stage0.py` — 15 `IA_*` Input Actions, `IMC_Photon`, both weapon Data Assets
2. `Tools/import_glb_weapon.py` — imports the PH-6 from GLB with materials, repoints data assets
3. `Tools/fix_lighting.py` — rebuilds `L_PhotonGrey` lighting rig, 3 targets (idempotent)
4. `Tools/fix_weapon_pose.py` — sets hip/ADS transforms on both weapons

Still ignored: `Binaries/`, `Intermediate/`, `Saved/`, `DerivedDataCache/`, `.vs/`, `*.sln`.

### Tracked content



- `Content/Photon/Weapons/` — `DA_PH6_PhotonRifle`, `DA_PH9_Swift`, `PH6_PhotonRifle` (FBX, legacy),
  `tripo_mat_9a4be8dc`, `GLB/HeroLaserRifle_v01/` (mesh + 3 textures + material)
- `Content/Photon/Input/` — 15 `IA_*` + `IMC_Photon` (**`IMC_Photon` has ZERO key bindings** — the
  runtime C++ context in `APhotonPlayerController` is authoritative)
- `Content/Photon/Maps/L_PhotonGrey` — 24 actors: 12 StaticMeshActor, 3 PhotonTarget, 5 PointLight,
  1 DirectionalLight, 1 SkyLight, 1 SkyAtmosphere, 1 PlayerStart

### Tracked source assets

- `unreal/PhotonUE/RawAssets/PH6_PhotonRifle.fbx` — **legacy, do not use.** FBX lost the textures.
- `public/assets/weapons/HeroLaserRifle_v01.glb` (9.3 MB) — **the real source.** 27,986 tris, no sockets.
- `public/assets/characters/HeroAthlete_v01.glb` (5.1 MB) — Mixamo skeleton, 4 skinned parts,
  `SOCKET_weapon_right/left/helmet/backpack`, 12 clips. **This is the asset for first-person arms.**
- `public/assets/characters/PhotonServiceUnit_v01.glb` (14.4 MB), `MaintenanceRobot_raw_v01.glb`
  (58.5 MB, raw Tripo, not game-ready)

## 7. Current controls

Keyboard/mouse and gamepad share one context, so both are always live. Defined in C++ in
`APhotonPlayerController::BuildMappingContext`.

| Action | Keyboard/Mouse | Gamepad |
|---|---|---|
| Move | — (**gamepad only, see risk 9.1**) | Left stick (`Gamepad_Left2D`) |
| Look | Mouse (`Mouse2D`) | Right stick (`Gamepad_Right2D`) |
| Fire | LMB | Right trigger |
| ADS | RMB | Left trigger |
| Jump | Space | A / Face Button Bottom |
| Crouch | Ctrl | B / Face Button Right |
| Sprint | Shift | L3 / Left Thumbstick |
| Reload/Interact | R | X / Face Button Left |
| Weapon switch | Q | Y / Face Button Top |
| Weapon select | 1, 2 | D-pad left/right |
| Grenade | G | LB |
| Pause | Esc | Start |
| Scoreboard | Tab | Back |

## 8. Current gameplay architecture

```
Source/Photon/
  Photon.cpp          IMPLEMENT_PRIMARY_GAME_MODULE
  PhotonCore.h/.cpp   EPhotonTeam (4 teams), PhotonTeamColor(), EPhotonFeedMode, EPhotonFireMode,
                      UPhotonWeaponData (all weapon stats), APhotonProjectile, UPhotonHealthComponent
  PhotonPlayer.h/.cpp APhotonCharacter, APhotonPlayerController, APhotonGameMode, RunSelfTest()
  PhotonWeapon.h/.cpp APhotonWeapon, UPhotonInventoryComponent, APhotonTarget
```

Design rules that must be preserved:

- **No weapon behaviour outside `UPhotonWeaponData`.** A new weapon is a new Data Asset, never a new
  class or a switch branch. This is what let the Three.js build add four weapons without touching the
  simulation.
- **Cooldown lives on the weapon**, so player input, bots and the self-test are rate-limited identically.
- **Friendly fire is rejected inside `UPhotonHealthComponent`**, so every future damage source
  (grenades, hazards, melee) inherits the rule without knowing about it.
- **`Health`/`Team`/`ActiveIndex` are replicated**, damage is authority-gated.
- Movement is `ACharacter` + `UCharacterMovementComponent` — do not hand-roll; UE's client prediction
  is the reason for choosing it.
- `WeaponRoot` is a `USceneComponent` parented to the camera. Weapons attach there. This is the
  Unreal-native fix for the near-plane ceiling that capped weapon size in the Three.js build.

## 9. Known bugs / risks

1. **`IA_Move` has no keyboard binding.** Only `Gamepad_Left2D` is mapped. WASD needs four 1D keys
   plus negate/swizzle modifiers, which was deferred. **WASD movement does not work today.** High
   priority and easy to miss because the self-test only counts binds, not which keys.
2. ~~`Content/` is gitignored~~ — **resolved in this handoff commit.** Content is now tracked, so a clone is runnable. `Tools/*.py` remain the regeneration path.
3. **Editor-open writes are silently discarded.** Running an asset script while Unreal is open loses
   the changes. Unreal writing `Saved/Logs/PhotonUE_2.log` is the tell — that only happens when a
   second instance starts because the first holds the lock. This cost three launch cycles.
4. **`Config/DefaultEngine.ini` has duplicate `[/Script/Engine.RendererSettings]` sections** from
   successive appends. Functional but should be consolidated.
5. `IMC_Photon` exists with zero bindings — dead weight; the C++ context is authoritative. Do not
   "fix" it by populating the asset unless the C++ path is removed too.
6. `APhotonTarget` lives in `PhotonWeapon.h` for expedience; it belongs in its own file.
7. `RunSelfTest` damages the target directly rather than by landing a bolt, so **projectile→target
   impact is not covered end to end**. `OnImpact` is untested.
8. VC++ redistributable reports as outdated at every launch. Non-fatal, noisy.
9. Legacy `PH6_PhotonRifle` (FBX) asset still exists alongside the GLB import; risk of repointing to
   the wrong one.

## 10. Next 5–10 tasks

Each has an objective, dependency, verification method and PASS condition. **No task may be reported
complete on a successful compile alone.**

**T1 — Bind WASD to `IA_Move`.**
File `Source/Photon/PhotonPlayer.cpp`, `APhotonPlayerController::BuildMappingContext`.
Objective: map `W/A/S/D` to `IA_Move` with `UInputModifierNegate` and `UInputModifierSwizzleAxis` so
keyboard movement produces the same `FVector2D` as the left stick.
Dependency: none. Verification: launch `L_PhotonGrey`, press W/A/S/D.
PASS: the character visibly moves in all four directions. **Do not claim PASS from the bind count** —
count already reads `ok=8` while `IA_Move` has no keyboard key.

**T2 — Visually confirm the textured PH-6 and exposure.**
Objective: launch and capture a screenshot; confirm the weapon shows its base colour/normal maps and
the arena is not blown out white.
Dependency: `import_glb_weapon.py` and `fix_lighting.py` already applied.
Verification: screenshot from PIE. PASS: weapon reads as a textured object; floor shows shading rather
than white. If still white, check `slot 0` on `HeroLaserRifle_v01` and that the data assets point at
the **GLB** mesh, not the FBX one.

**T3 — Muzzle flash + recoil in `APhotonWeapon::TryFire`.**
File `Source/Photon/PhotonWeapon.cpp`.
Objective: on each shot, pulse a `UPointLightComponent` at the muzzle (~60 ms), apply
`Data->RecoilPitch` (0.85°) to the controller with `RecoilRecoveryHalfLife` (0.11 s → 133 ms to 10%),
and add a short weapon kick along −X of the hip transform.
Dependency: `UPhotonWeaponData` already carries every value.
Verification: fire in PIE and record. PASS: a visible flash at the barrel and the weapon/view kicks
and settles. **Do not claim PASS from `ShotsFired` incrementing.**

**T4 — Extend `RunSelfTest` to cover projectile→target impact.**
File `Source/Photon/PhotonPlayer.cpp`.
Objective: spawn a target directly in the firing line, fire, wait for travel, and assert the target's
health dropped **via `APhotonProjectile::OnImpact`** rather than a direct damage call.
Dependency: T3 not required. Verification: `-PhotonSelfTest` headless run.
PASS: a new assertion `projectile_hit_target_via_impact = PASS`. This closes risk 9.7.

**T5 — First-person arms.**
Objective: import `HeroAthlete_v01.glb` as a Skeletal Mesh, create an arms-only variant, add an
AnimBP with an idle pose, attach the weapon to `SOCKET_weapon_right` instead of directly to the camera.
Dependency: T2/T3 first — arms on an untextured weapon with no flash will not read as progress.
Verification: screenshot. PASS: hands/arms visible holding the weapon, moving with the camera.
This is a session of work, not an increment.

**T6 — Minimal UMG HUD.**
Objective: crosshair, health, current weapon name, ammo/charge. Read from `UPhotonHealthComponent`
and `UPhotonInventoryComponent::GetActiveWeaponId()`; do not duplicate state in the widget.
Verification: screenshot showing values change when damaged and when switching weapons.

**T7 — Physical controller test.**
Objective: connect a pad and exercise move/look/fire/jump/crouch/switch.
PASS: all seven respond. **Until this is done, controller support must be described as
"configured, hardware-untested".**

**T8 — Consolidate `Config/DefaultEngine.ini`.**
Objective: merge the duplicate `[/Script/Engine.RendererSettings]` sections; keep SM6, Lumen, VSM,
`r.GenerateMeshDistanceFields`, and the exposure band. Verification: launch; no black screen, no
"Lumen has no ray tracing data" or SM6 warning. PASS: arena renders as before.

**T9 — Gate every asset script behind a process check.**
Files `unreal/PhotonUE/Tools/*.py`.
Objective: refuse to run (non-zero exit, clear message) if `UnrealEditor.exe` is running, instead of
silently having writes discarded. Verification: run one with the editor open. PASS: it refuses.

**T10 — Grenade foundation (`AGrenadeBase`).**
Objective: one energy grenade — throw from `IA_Grenade`, projectile movement with gravity, fuse,
radial damage through `UPhotonHealthComponent` so friendly fire is inherited.
Verification: self-test assertions (spawned, velocity non-zero, fuse elapsed, damage applied) plus a
recording. PASS: both.

## 11. Verification rules

Carried from hard experience on this project. These are not style preferences.

1. **Never report "working" from a successful compile.**
2. **Assert the resulting state, not the absence of an exception.** `map_key` returned cleanly while
   mapping zero keys; `MapKey` "succeeded" and `len(mappings)` was 0.
3. **Visual claims require visual evidence.** Ten headless verification passes could not see that the
   renderer's prerequisites were unmet. Three user screen recordings found it in single frames.
   **Ask for a recording early, not as a last resort.** `ffmpeg` is available for frame extraction:
   `ffmpeg -i clip.mp4 -vf "fps=1/4,scale=1280:-1" out_%02d.png`
4. **Count, don't announce.** `"input bound"` printed unconditionally while all eight binds failed.
   Log `ok=N missing=N`.
5. **A guard derived from a zero measurement is not a guard.** A walk/sprint check "passed" with
   `speed [0,0]` against a band of `[0,0]`. Assert absolute floors.
6. **Verify the subject, not just the instrument.** "Actor exists" ≠ "actor points the right way";
   "weapon spawned" ≠ "weapon has a mesh"; "light exists" ≠ "scene is lit".
7. **Runtime scene inspection is authoritative for lighting**, not source config.
8. **Never write assets with the Unreal Editor open.**
9. For Three.js capture work (`src/`): pin camera poses inside `requestAnimationFrame`, never
   `setInterval` — a 25 ms timer against a 16.6 ms frame produced metre-scale drift.

## 12. How to launch Photon

**Unreal:**

```
& "C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe" "C:/Users/Home/Desktop/100 men vs gorilla/photon/unreal/PhotonUE/PhotonUE.uproject"
```

Opens `L_PhotonGrey` (set as editor startup map). Press **Play**. Wait for the "Preparing Shaders"
counter to clear before judging anything visual — the world renders black until it does.

**Headless self-test:**

```
& "C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "C:/.../PhotonUE.uproject" /Game/Photon/Maps/L_PhotonGrey -game -nullrhi -unattended -nosplash -stdout -PhotonSelfTest
```

Results appear as `PHOTONTEST ... PASS/FAIL` and `PHOTONVERIFY ...`. **`unreal.log` output goes to
`Saved/Logs/`, not stdout.**

**Three.js reference build:** `npm run dev` in the repo root; 145 tests via `npx vitest run`.

## 13. Path and tooling traps

- **Always use forward slashes in paths passed to Unreal.** UE's argument parser reads `\100` in
  `...\Desktop\100 men vs gorilla\...` as an **octal escape** and silently rewrites the path to
  `Desktop@ men vs gorilla`, then reports the file missing. This will bite any new tooling.
- **Python `unreal.Rotator` is `(roll, pitch, yaw)`** — C++ `FRotator` is `(pitch, yaw, roll)`.
  Positional args in C++ order pitched a PlayerStart 90° and aimed the sun at the sky. Use keywords.
- `unreal.Transform`'s `rotation` parameter takes an **FRotator**, not an FQuat.
- Light actors expose `light_component`, **not** `directional_light_component`.
- `SetLightColor` takes **LinearColor** (0–1 floats), not `Color` (0–255).
- `InputActionValueType` members are `AXIS2D`/`AXIS1D` — **no underscore**.
- **`unreal.Keys` does not exist**, and `FKey` cannot be constructed from Python. Bind keys in C++.
- `InputActionFactory` / `InputMappingContextFactory` are not exposed; pass `None` to `create_asset`.
- Ten Unreal Python API assumptions were wrong in this migration. **Probe first** — write a small
  script that prints `dir()` of the type and run it, rather than guessing twice.

## 14. Three.js → Unreal porting notes

- **Units: Unreal is centimetres, the Three.js build is metres. Multiply by 100.** Applied in exactly
  one place (`UPhotonWeaponData`) on purpose.
- **Axes: Unreal is X-forward/Y-right/Z-up. Three.js was −Z-forward.** The PH-6's long axis is +X, so
  it needs **no yaw** in Unreal; carrying the Three.js `yawOffset ≈ 93°` across rotated it broadside.
- **Two ported values were already wrong for convention reasons.** Treat every remaining ported
  transform as suspect and re-derive rather than convert.
- **Prefer GLB/glTF over FBX for Unreal.** `photon_glb_to_fbx.py` exists because *Mixamo* rejects
  GLB — that constraint does not apply to Unreal, which reads glTF natively and preserves textures.
  Routing the PH-6 through FBX is why it rendered white.
- Values worth keeping from the reference build: weapon stats (`src/config/weapons.ts`, 5 weapons),
  movement speeds (walk 5.2 m/s → 520, sprint 8.4 → 840), the measured bot difficulty ladder, Spawn
  System 2.0 rules, and the lag-compensation *design* (rewind cap + impossible-movement rejection).
- **What should NOT be ported** (see `docs/UNREAL_MIGRATION_PLAN.md` §4): instanced batching, the
  world-UV `onBeforeCompile` shader patch, procedural normal generation, the capture harness, Zustand
  persistence migrations, `MuzzleRegistry`, the 24-slot avatar pool. All exist to work around the
  Three.js runtime.
- **Unreal does not give you lag compensation.** There is no built-in server rewind;
  `src/net/LagCompensation.ts` must be rebuilt as a component. The design transfers, the code does not.
