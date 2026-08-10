# Project Photon — Unreal Engine migration assessment

**Status:** assessment only. No gameplay changed, no renderer removed, no Unreal project created.
**Assessed at:** tip `0b46676`, tree clean, 145 tests passing, 65 commits ahead of origin.

Figures below are measured from the repository and from the running application, not estimated.
Where a number could not be verified in this session it is marked **(unverified)**.

---

## 1. Current architecture

### 1.1 Shape of the codebase

| Area | Files | Lines | Notes |
|---|---:|---:|---|
| `src/render/` | 23 | 6,332 | R3F components, instancing, post, view model, avatars |
| `src/gameplay/` | 14 | 3,509 | Deterministic simulation |
| `src/net/` | 10 | 3,242 | Protocol, snapshots, reconciliation, lag compensation |
| `src/maps/` | 6 | 2,944 | Two arenas as literal brush data + builder |
| `src/ui/` | 8 | 1,931 | HUD, menus |
| `src/assets/` | 6 | 1,881 | Registry, glTF importer, animator |
| `src/ai/` | 4 | 1,379 | Behaviour tree, bot brain, nav graph |
| `src/engine/`, `config/`, `audio/`, `input/`, `physics/`, `state/`, `dev/`, `util/` | 25 | 4,892 | |
| **Total `src/`** | **~110** | **~26,200** | |
| `scripts/` | 18 | — | Audits, latency sweeps, asset tooling, Blender drivers |
| `tools/blender/` | 9 `.py` | — | Character build, clip import, bake, export |
| `tests/` | 13 files | — | 145 tests |

### 1.2 The architectural rule that matters most

The simulation is **headless, deterministic and fixed-step at 64 Hz**. `MatchDirector.step(dt)`
imports nothing from React or Three.js, and `gameplay/`, `ai/`, `physics/`, `maps/`, `net/` and
`input/` may not import from `render/`, `ui/` or `state/`. This is the single most valuable property
of the codebase and the reason the netcode, bot ladder and determinism tests exist at all.

It is also the property that makes migration *possible to reason about*: the game logic is already
separated from the renderer that is being questioned.

### 1.3 Systems present

- **Movement** — `MovementSystem.ts`; sprint, crouch, slide, jump, air control, stance machine.
- **Camera** — `render/Scene.tsx` `CameraRig`; FOV 65 vertical (~90.6° horizontal at 1.6),
  `targetFov = graphics.fov * view.fovScale + speedFov`, eased at `delta * 14`.
- **Shooting / weapons** — `WeaponSystem.ts` + `config/weapons.ts`. Fully data-driven schema.
- **Projectiles** — `ProjectileSystem.ts`; real travelling entities, not hitscan.
- **Damage** — `CombatSystem.ts`; falloff, headshot multiplier.
- **Teams / match flow / scoring** — `MatchFlow.ts`, `TeamBalance.ts`, `Statistics.ts`, `modes/`.
- **Spawning** — `SpawnSystem.ts` (Spawn System 2.0).
- **Bots** — `BehaviorTree.ts`, `BotBrain.ts`, `NavGraph.ts`, `botDifficulty.ts`; difficulty ladder
  measured as separating on Apex.
- **HUD/UI** — React + Zustand (`persist`, currently schema v3).
- **Networking** — authoritative server (`server/index.ts`, Node + `ws`), snapshot history,
  interpolation, client reconciliation, server-side rewind lag compensation with a rewind cap and an
  impossible-movement rejection guard. Validated by latency sweeps at 20–250 ms.
- **Input** — `InputManager.ts` with a rebindable `keyBindings` table, mouse pseudo-codes
  (`Mouse0`…), pointer-lock gating, and **gamepad polling already present** using the W3C standard
  mapping (e.g. button 7 → `fire`).
- **Spectator / replay** — **not implemented.** Listed as a future requirement.

### 1.4 Weapon architecture — what works, what is inert

`WeaponConfig` is a rich, genuinely data-driven schema: `cellCapacity`, `fireInterval`,
`rechargeDuration`, `trickleDelay`/`trickleRate`, `ventCostPerShot`, projectile speed/lifetime/
radius/gravity, damage, `headshotMultiplier`, `falloffStart`/`falloffEnd`/`minDamageScale`, six
spread terms including `spreadPerShot`/`spreadMax`/`spreadRecovery`, recoil pitch/yaw/recovery,
`adsTime`/`adsFovScale`/`adsSensitivityScale`, camera shake and rumble triple.

**Weapon IDs (5):** `photon_rifle` (PH-6), `ph2_sidearm` (PH-2 Vector), `ph9_smg` (PH-9 Swift),
`ph4_marksman` (PH-4 Meridian), `ph7_heavy` (PH-7 Bastion).

**Works today:** the schema, per-weapon ballistics/spread/recoil/ADS, the charge-cell and trickle
model, the projectile system, lag-compensated hit validation, the PH-6 first-person presentation
(hip/ADS poses, look inertia, strafe roll, acceleration response, idle breathing, sprint lowering,
recoil at a 40 ms half-life), FOV compensation holding apparent weapon size across FOV and ADS.

**Inert / missing:**
- **No weapon selection.** The four new weapons are unreachable by a player — no input action, no
  view-model swap. The roster exists in data only.
- **No magazine/reserve/reload.** The model is a recharging energy cell, not ammo + reload. There is
  no `reload` state machine, no reserve pool, no reload animation hook.
- **No weapon-switch timing**, no per-weapon view model, no per-weapon projectile visuals.
- **No grenades or throwables of any kind.**
- **No sockets on the PH-6 asset** (see §2), so `publishMuzzle` never runs for the local player and
  first-person bolts do not originate at the barrel.
- **Third-person weapon** is a static clone parented to `SOCKET_weapon_right`; no weapon animation.

---

## 2. Asset inventory

### 2.1 On disk

| Asset | Size | Notes |
|---|---:|---|
| `characters/MaintenanceRobot_raw_v01.glb` | 58.5 MB | Raw Tripo output; not game-ready |
| `characters/PhotonServiceUnit_v01.glb` | 14.4 MB | Finished robot character |
| `characters/HeroAthlete_v01.glb` | 5.1 MB | The competitor players wear |
| `weapons/HeroLaserRifle_v01.glb` | 9.3 MB | PH-6 |
| **Total** | **~84 MB** | 4 GLB files. No OBJ, no loose textures — all embedded. |

Manifest declares 10 entries; 4 exist on disk. The other 6 (`wall_panel_large`, `wall_corner`,
`floor_competition`, `ceiling_rig`, `cover_barrier`, `prop_charging_station`,
`prop_equipment_locker`) are **declared but absent** — the registry is designed so a missing asset
falls back to procedural geometry, which is why the game runs without them.

### 2.2 PH-6 Photon Rifle — measured live

- **1 mesh, 27,986 triangles**, single material.
- Node named `tripo_node_9a4be8dc` (renamed from a `_GAME` suffix convention during export work).
- **Zero sockets.** No `SOCKET_muzzle`, `SOCKET_grip` or `SOCKET_sight`.
- Origin at the **bounding-box centre**, not the grip. `IMPORTED_GRIP` in `ViewModel.tsx` is the
  documented runtime stand-in.
- **Long axis is +X**; the engine points weapons down −Z, so the manifest carries
  `yawOffset ≈ 1.626 rad` (~93°). Verified by a broadside diagnostic capture, not assumed.
- Manifest `scale: 0.938` (remesh exports at 0.981 m, spec calls for 0.92 m).
- Carries an **unused 4096 base-colour texture** (~112 MB VRAM) — flagged, not yet removed.

**Unreal readiness:** imports directly as a Static Mesh. Needs Blender work for sockets, grip
origin, part split (`PART_core`/`PART_emitter`/`rail_00–06`), normal+AO bake from the HD source, and
removal of the unused 4K texture. **In Unreal, sockets can be authored in the Static Mesh Editor
directly** — the Blender socket work becomes optional rather than blocking.

### 2.3 HeroAthlete — measured live

- **4 SkinnedMesh parts** under `HeroAthlete_v01_GAME`, Mixamo-derived skeleton (`mixamorigHips`,
  `mixamorigSpine`, … `mixamorigRightHand`).
- Sockets present: `SOCKET_weapon_right`, `SOCKET_weapon_left`, `SOCKET_helmet`, `SOCKET_backpack`.
- **12 animation clips** imported and live (idle, walk, run, sprint, crouch, jump, land, turn, etc.),
  driven by `CharacterStateMapper.ts` with hysteresis and a state-mapper test suite.
- Rendered through a **24-slot avatar pool** using `SkeletonUtils.clone`.

**Unreal readiness:** a Mixamo-standard skeleton is the best possible case — imports as a Skeletal
Mesh, and Mixamo clips retarget cleanly via IK Rig / IK Retargeter. Note the three.js quirk that
`PropertyBinding.sanitizeNodeName` strips colons from `mixamorig:Head` **does not apply in Unreal**;
bone names import intact.

### 2.4 Arena geometry

Not an asset — **arena data**. Apex is 915 brushes expressed as TypeScript literals across 1,461
lines, plus a derived 515-module architectural detail layer. Classic is 699 lines.

This is the asset class that **does not transfer** and should not: see §4.

### 2.5 Audio and VFX

`src/audio/AudioEngine.ts` (747 lines) is procedural Web Audio with a per-surface acoustic table
(`cutoff`/`level`/`ring` per surface kind). **No audio files exist.** VFX are Three.js meshes and
shader patches; no particle system.

### 2.6 Blender automation that already exists

`photon_build_character.py`, `photon_setup_character.py`, `photon_import_clips.py`,
`photon_glb_to_fbx.py`, `photon_bake.py`, `photon_material_pass.py`, `photon_export.py`,
`photon_robot_finish.py`, `photon_fix_zone_colors.py`, plus TS drivers (`buildCharacter.ts`,
`setupCharacter.ts`, `toFbx.ts`, `poseCheck.ts`, `assetInspect.ts`, `clipPlan.ts`).

`photon_glb_to_fbx.py` is **directly reusable** — FBX is Unreal's preferred import path.

---

## 3. Photon → Unreal mapping

| Photon (actual) | Unreal equivalent |
|---|---|
| React app shell + `GameCanvas` | `GameInstance` + `Level` + `GameModeBase` |
| `MatchDirector.step(dt)` @ 64 Hz | `AGameState` + server tick; **no direct equivalent to the fixed-step determinism** |
| `MovementSystem.ts` | `UCharacterMovementComponent` (custom movement modes for slide) |
| `CameraRig` in `Scene.tsx` | `UCameraComponent` on `ACharacter` + `APlayerCameraManager` |
| `ViewModel.tsx` (hip/ADS poses, sway, recoil) | FP arms Skeletal Mesh + `AnimInstance` + `UCameraComponent` with separate FOV |
| `IMPORTED_GRIP` stand-in | Real `SOCKET_grip` on the Static/Skeletal Mesh |
| `config/weapons.ts` `WEAPONS` record | `UDataAsset` (Primary Data Assets) or `UDataTable` row struct |
| `ProjectileSystem.ts` | `AProjectileBase` + `UProjectileMovementComponent`, replicated |
| `CombatSystem.ts` falloff/headshot | `UGameplayStatics::ApplyPointDamage` + custom damage type, or GAS |
| `SpawnSystem.ts` | `AGameModeBase::ChoosePlayerStart` override |
| `TeamBalance.ts`, `Statistics.ts` | `AGameState` / `APlayerState` replicated properties |
| `BehaviorTree.ts` + `BotBrain.ts` | `AAIController` + Behavior Tree + Blackboard + `EQS` |
| `NavGraph.ts` | `UNavigationSystemV1` navmesh (replaces the hand-built graph) |
| `maps/arena02_apex.ts` brush data | `.umap` Level authored in the editor |
| `MapBuilder` instanced batching | Nanite, or `UInstancedStaticMeshComponent` where Nanite is unsuitable |
| `architecture.ts` derived detail | Modular Static Mesh kit placed in-editor (or PCG) |
| `PhotonMaterials.ts` substance recipes | Material + Material Instances (a Master Material per family) |
| `PhotonTextures.ts` `heightToNormal` | Authored normal maps, or Substance / Material functions |
| World-UV `onBeforeCompile` patch | `WorldAlignedTexture` material node — **built in** |
| `PostFX.tsx` EffectComposer | Post Process Volume |
| `AudioEngine.ts` procedural + surface table | MetaSounds + `USoundAttenuation` + Physical Materials |
| `InputManager.ts` + `bindings.ts` | Enhanced Input (`UInputAction`, `UInputMappingContext`) |
| `ui/` React + Zustand | UMG Widgets + `UGameInstanceSubsystem` for settings |
| `settingsStore` `persist` + migrations | `USaveGame` / `UGameUserSettings` |
| `net/` protocol, snapshots, reconciliation | Unreal replication + `CharacterMovementComponent` prediction |
| `LagCompensation.ts` server rewind | **No built-in equivalent** — must be rebuilt (see §11) |
| `tools/capture/harness.js` | Automation Framework / `Gauntlet`, or Movie Render Queue |

---

## 4. Keep / Port / Rebuild / Retire

### KEEP — design and data, ported by hand

| Item | Why |
|---|---|
| `config/weapons.ts` values | Tuned against measured playtests (median-life measurements, the 34→28 damage correction). The *numbers* are the asset; they become Data Asset rows. |
| `botDifficulty.ts` ladder | Measured as separating Hard from Medium on Apex. Re-express as BT parameters. |
| Spawn System 2.0 rules | Measured; Classic's 17.1% red/blue asymmetry is a known open issue to avoid re-introducing. |
| Movement tuning constants | `MOVEMENT` speeds, slide/crouch thresholds — feed CMC configuration. |
| Arena **layout metrics** | Sight lines, cover spacing, the ±14/±10 lighting positions, engagement-distance findings. |
| Lag-compensation *approach* | Rewind cap + impossible-movement rejection is hard-won design; the code will not port but the design must. |
| Asset contract (`PART_`/`SOCKET_`/`MAT_`/`LOD` naming) | Already Unreal-compatible conventions. |
| Blender automation | Especially `photon_glb_to_fbx.py`. |

### REBUILD IN UNREAL — Unreal is materially better

| Item | Why |
|---|---|
| Renderer, lighting, shadows | Lumen, virtual shadow maps, Nanite. This session spent most of its effort hand-rolling what Unreal ships: world-space UVs via shader patching, near-plane fights with no view-model camera, manual bloom discipline, per-light intensity tuning. |
| Arena levels | 1,461 lines of brush literals versus an editor. This is the largest single productivity gain available. |
| First-person presentation | AnimBP + montages + a dedicated view-model FOV. The near-plane ceiling documented in `ViewModel.tsx` (`NEAR_PLANE_MARGIN`) **only exists because there is one shared camera**; Unreal's separate FP camera removes the constraint entirely. |
| Weapon/character animation | `AssetAnimator` + `CharacterStateMapper` are a competent hand-rolled state machine; AnimBP state machines with blendspaces are strictly better and support montages for reload/switch. |
| VFX | Niagara. There is currently no particle system at all. |
| Audio | MetaSounds. The surface acoustic table becomes Physical Materials. |
| Input | Enhanced Input replaces the bindings table and gives controller support properly. |
| UI | UMG. |
| Networking transport/replication | Unreal replication replaces the hand-written protocol/serialisation. |
| Navigation | Navmesh replaces `NavGraph.ts`. |

### RETIRE — exists only because of the current runtime

| Item | Why |
|---|---|
| `MapBuilder` instanced batching | Solving a draw-call problem Nanite/ISM solve natively. |
| `worldUvStore` + `onBeforeCompile` UV patch | `WorldAlignedTexture` is a material node. |
| `PhotonTextures.heightToNormal` | Procedural texture generation to avoid shipping binaries. |
| `render/ArenaMesh` per-instance `aUvScale` | Same. |
| `preserveDrawingBuffer` capture harness + `/__capture` middleware | Replaced by Automation/MRQ. |
| Zustand `persist` migrations | `UGameUserSettings`. |
| `MuzzleRegistry` | Sockets on the weapon mesh. |
| Custom `Interpolator`/`Reconciler`/`snapshot` | CMC prediction + replication. **Caveat in §11.** |
| The 24-slot avatar pool | An optimisation for a renderer without instanced skinning. |

---

## 5. Recommended Unreal project architecture

```
PhotonUE/
  Source/Photon/
    Core/        APhotonGameMode, APhotonGameState, APhotonPlayerState, APhotonPlayerController
    Character/   APhotonCharacter (CMC subclass: slide), UPhotonMovementComponent
    Weapons/     APhotonWeaponBase, UPhotonWeaponData (UPrimaryDataAsset),
                 UWeaponInventoryComponent, APhotonProjectile, AGrenadeBase
    Combat/      UHealthComponent, UPhotonDamageType, ULagCompensationComponent
    AI/          APhotonAIController, BT tasks/services
    UI/          UPhotonHUD, widget classes
  Content/
    Characters/  SK_Athlete, SK_ServiceUnit, Anims/, IK_Retarget/
    Weapons/     SM_PH6, ... , FP_Arms
    Arenas/      L_Apex, L_Classic, L_Arena03, L_Arena04
    Kit/         Modular architecture meshes (wall bays, mullions, frames, vents, fixtures)
    Materials/   M_Master_Structural, M_Master_Metal, M_Master_Emissive + instances
    VFX/         NS_Muzzle, NS_Bolt, NS_Impact_*, NS_Grenade_*
    Audio/       MetaSounds
```

**Player:** `APhotonCharacter` owns CMC + FP camera + FP arms + a `WeaponInventoryComponent`.
Slide is a **custom movement mode** on a CMC subclass, not an ad-hoc velocity hack — this is what
makes it replicate and predict correctly.

---

## 6. Weapon architecture (Photon 2.0)

`UPhotonWeaponData : UPrimaryDataAsset` — one asset per weapon, carrying the existing schema plus
the fields the current system lacks:

- Identity: id, display name, category, FP/TP mesh, FP AnimBP.
- Ballistics: projectile class, speed, lifetime, radius, gravity.
- Damage: base, headshot multiplier, falloff start/end/min scale.
- Feed: **magazine size, reserve ammo, reload time, reload-cancel rules** *(new)*, or the existing
  charge-cell model for energy weapons — the two coexist behind a `FeedMode` enum.
- Handling: fire interval, fire mode (auto/burst/semi/charge), burst count, spread set, recoil set.
- ADS: time, FOV scale, sensitivity scale, FP ADS transform.
- Presentation: muzzle Niagara, projectile Niagara, impact Niagara per Physical Material, MetaSounds,
  montages (fire/reload/equip/unequip/inspect).
- **Equip/unequip times** *(new)*.

`UWeaponInventoryComponent` holds N slots, handles switching with equip/unequip timing, replicates
the active index, and is the single place a weapon becomes "current". Selection binds to D-pad,
number keys, and last-weapon toggle.

Firing lives in the weapon actor, driven by data — **no per-weapon branching in the renderer**,
which is the rule the current TS codebase already follows and must keep.

---

## 7. Projectiles and grenades

**Projectiles:** `APhotonProjectile` with `UProjectileMovementComponent`, replicated, team colour
driven by a Material Parameter Collection or per-instance dynamic material. Fired **cosmetically on
the client immediately** and authoritatively on the server — the standard split. Impact resolves a
Niagara system chosen by the hit surface's Physical Material, which is the direct Unreal analogue of
the existing per-surface acoustic table.

**Grenades:** `AGrenadeBase` with fuse, bounce, and an overridable `OnDetonate`. Three subclasses:
energy (damage), EMP (disables HUD/abilities in radius), area/smoke (vision occlusion via a Niagara
volume). Throw is a montage + predicted trajectory spline. Extensible without touching the character.

---

## 8. Arena visual strategy

**Do not import the current arena.** Its 915 brushes exist because the renderer needed instanced
boxes; re-importing them carries the exact "futuristic boxes" problem into an engine that solves it.

Instead:
1. Author a **modular kit** in Blender/Tripo — wall bay, mullion, header, kick, vent, hatch, fixture
   housing, corner return, barrier. This is the same kit `architecture.ts` derives, promoted from
   generated brushes to authored meshes with real bevels and bakes.
2. Rebuild Apex in-editor from the kit, **preserving the measured layout metrics** (sight lines,
   cover spacing, spawn geometry) — the gameplay is validated, the geometry is not.
3. Lighting: Lumen GI, a Post Process Volume with disciplined bloom, and the pool-based key lighting
   already proven this session (pull fixtures in, shorten radius, let falloff describe the floor).
4. Cyan as accent language, carrying over the hierarchy rule established here.

Target reads: expensive, manufactured, athletic, broadcast-ready. Not military, not warehouse.

---

## 9. Tripo → Blender → Unreal pipeline

- **Tripo** — silhouette and hero-prop generation. Existing account/CLI workflow stands.
- **Blender** — topology cleanup, metric scale, origins, sockets, UVs, material separation, LOD
  prep, collision (`UCX_` prefixed meshes import as collision automatically), FBX export.
  `photon_glb_to_fbx.py` is directly reusable; `photon_bake.py` and `photon_material_pass.py`
  transfer with modest edits.
- **Unreal** — materials, lighting, Niagara, gameplay, animation, final presentation.

Retarget Mixamo clips with IK Rig / IK Retargeter. Sockets can be added in the Static Mesh Editor,
so the PH-6 socket gap **stops being a blocker** the moment it is imported.

---

## 10. Controller — Enhanced Input

One `IMC_Default` with `UInputAction`s: Move (Vector2D), Look (Vector2D), Fire, ADS, Grenade,
GrenadeAlt, Jump, CrouchSlide, ReloadInteract, WeaponSwitch, WeaponSelect (D-pad), Menu, Scoreboard,
Melee, Sprint. Bindings match the requested PlayStation scheme; keyboard/mouse mapped in the same
context so both work simultaneously without a mode switch.

Settings: stick sensitivity, ADS multiplier (the existing `adsSensitivityScale` per weapon feeds
this), radial dead zones, invert Y, vibration (the existing `rumbleStrong`/`rumbleWeak`/`rumbleMs`
per weapon map to Force Feedback), aim response curve, optional aim assist.

---

## 11. Multiplayer — the honest assessment

**What Unreal gives you free:** transport, actor replication, RPCs, relevancy, and — importantly —
`CharacterMovementComponent` client prediction and server reconciliation for movement. That
replaces `Interpolator.ts`, `Reconciler.ts`, `snapshot.ts`, `serialize.ts` and `protocol.ts`.

**What Unreal does not give you:** server-side rewind lag compensation. There is **no built-in
equivalent** to `LagCompensation.ts`. Shipping shooters implement it themselves. The existing
design — rewind to the shooter's view time, cap the rewind, and reject rewinds implying impossible
movement — must be **rebuilt as a `ULagCompensationComponent`** maintaining a bounded transform
history. The knowledge transfers; the code does not.

**Also not free:**
- Projectile-vs-rewind interaction: bolts are travelling entities, so the rewind window has to
  account for flight time, not just fire time.
- Deterministic simulation is **lost**. Unreal is not deterministic in the way `MatchDirector` is,
  and the determinism tests will not survive. This is a real loss: it is what makes the current
  latency sweeps and the process-per-client harness meaningful.
- The 145-test suite largely does not port. Unreal's Automation/Gauntlet is a different discipline.
- Bots re-implemented on BT/EQS; the measured difficulty ladder must be re-tuned, not copied.

---

## 12. Staged migration — vertical slice first

**Stage 0 — spike (do not commit to migration before this).** Empty UE 5.x project; import the PH-6
and HeroAthlete; retarget two Mixamo clips; stand in a grey box. Purpose: prove the assets import
cleanly and the team is productive in the editor. Small, cheap, high information.

**Stage 1 — single-player vertical slice.** Character + CMC + FP camera + FP arms; PH-6 as a Data
Asset; fire → projectile → damage → death → respawn; one Behavior Tree bot; a grey-box Apex with
correct layout metrics. **Playable on a controller.**

**Stage 2 — multiplayer.** Listen server + client; replicate movement, firing, projectiles, health,
team, respawn. Then build the `ULagCompensationComponent` and validate under simulated latency at
the same 20–250 ms band the current build was validated against.

**Stage 3 — content.** Second weapon, grenade, Niagara VFX, MetaSounds, UMG HUD.

**Stage 4 — visual.** Modular kit, Lumen lighting pass, materials, the arena rebuilt properly.

**Stage 5 — expansion.** Full roster, arenas 3–4, spectator/replay (Unreal's Replay System is a real
advantage here — the current codebase has nothing).

**Run both builds in parallel until Stage 2 passes.** The Three.js build stays the reference for
gameplay tuning and stays playable. Do not delete it.

---

## 13. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Loss of browser distribution** | **Decisive** — see §15 | Answer this before Stage 0 |
| Lag compensation must be rebuilt from scratch | High | Stage 2 gate; port the design, validate at 20–250 ms |
| Loss of determinism and the 145-test suite | High | Accept; replace with Gauntlet coverage of what matters |
| Unreal learning curve (C++ + editor + AnimBP + Niagara) | High | Stage 0 spike is the cheap probe |
| 84 MB of assets, one raw 58 MB Tripo mesh | Low | Retopo/decimate in Blender; already scripted |
| Re-tuning bots, spawns, movement feel | Medium | The measured targets exist; re-tune against them |
| Scope inflation — rebuilding everything at once | High | The staged plan exists precisely to prevent this |
| Two codebases in parallel | Medium | Time-box the overlap to Stage 2 |

---

## 14. Performance considerations

Current measured budget (viewpoint `02_gameplay_mid`, rAF-pinned, guarded):
**GPU 14.94 ms, CPU 2.39 ms, 183 draws, 41 programs, 234 k triangles, 19 lights.**

Established facts worth carrying:
- **The frame is fragment-bound, and the arena is ~96% of it.** 151,755 triangles measured at
  −0.15 ms. Do not optimise triangle counts on instinct — measure.
- The 120 FPS target is unmet on the current runtime and was explicitly deferred.

In Unreal the constraint changes shape: Lumen and virtual shadow maps are the new dominant cost, and
Nanite makes triangle count close to free while making **overdraw and material complexity** the
things to watch. The measurement discipline transfers even though every number resets. `stat GPU`,
`stat Unit` and Insights replace the WebGL timer queries.

---

## 15. Recommendation

### **Migrate to Unreal — phased, gated on Stage 0 — provided browser delivery is not a hard requirement.**

The deciding question is not technical quality. It is **distribution**. Photon today is
clone-and-run in a browser with no install. Unreal means downloadable builds; Pixel Streaming is
real but costs per concurrent viewer and is not a substitute for casual browser access. **If browser
delivery is a product requirement, stay on Three.js — nothing else in this analysis outweighs it.**

Assuming it is not, the case for migrating is strong and is grounded in what this project has
actually spent its time on:

1. **The visual ceiling is the stated problem, and it is an engine problem.** Recent sessions went
   into hand-rolling world-space UVs through `onBeforeCompile`, deriving normal maps procedurally,
   hand-placing 19 lights, and fighting a shared near plane that caps how large a weapon can be
   drawn. Unreal ships all of it. The `NEAR_PLANE_MARGIN` constraint in `ViewModel.tsx` exists
   *solely* because there is one camera.
2. **The arena is the biggest productivity gap.** 1,461 lines of brush literals for one level, and
   3–4 more are planned. An editor is the correct tool and the difference is not marginal.
3. **Every named target feature is native in Unreal and hand-rolled here** — controller support,
   ADS, weapon switching, reload animation, grenades, VFX, spectator/replay.
4. **The assets are already in the best possible shape for it.** A Mixamo-standard skeleton, GLB
   meshes, and an asset contract (`SOCKET_`/`PART_`/`MAT_`/`LOD`) that matches Unreal conventions.
   The socket gaps that block work here are trivial in the Static Mesh Editor.
5. **The valuable part of this codebase is design, not code** — tuned weapon values, a measured bot
   ladder, spawn rules, engagement-distance findings, and the lag-compensation design. All of that
   survives a rewrite. The renderer, batching and UV machinery are the parts being retired, and they
   are precisely the parts that exist to work around the current runtime.

**What migrating genuinely costs**, stated plainly: the deterministic 64 Hz simulation, ~3,200 lines
of working validated netcode, 145 tests, and the browser build. That is not a small bill. The
netcode in particular is good work that measured well at 20–250 ms — and Unreal will *not* hand back
lag compensation for free.

**Therefore: run Stage 0 first.** It is a few days, it is throwaway, and it converts the biggest
unknowns — asset import fidelity and editor productivity — into evidence. Commit to the migration
only if Stage 0 goes well. Do not delete the Three.js build before Stage 2 passes.

---

## Verification notes

Measured this session: file/line counts, asset sizes and count, PH-6 mesh stats and socket absence,
HeroAthlete rig/socket/clip presence, live perf at a pinned viewpoint, weapon IDs, test count.

Tick rate confirmed in source: `TICK_HZ = 64` in `src/engine/GameLoop.ts`, with `TICK_DT` re-exported
through `src/engine/Game.ts`.

**Unverified:** PhotonServiceUnit and MaintenanceRobot triangle/bone counts (the browser pane became
unresponsive during the final live query — neither is currently loaded in a match, so both need an
explicit inspection pass via `scripts/assetInspect.ts`), and the per-asset texture inventories inside
the GLB containers. Neither gap changes the recommendation: both are character assets on the same
Mixamo-derived path as HeroAthlete, which was verified.
