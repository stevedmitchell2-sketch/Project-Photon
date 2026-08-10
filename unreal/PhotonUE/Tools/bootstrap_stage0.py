"""
PROJECT PHOTON — Unreal Stage 0 asset bootstrap
===============================================

Run headless from the repository root once a C++ toolchain is installed and the module compiles:

    "C:/Program Files/Epic Games/UE_5.8/Engine/Binaries/Win64/UnrealEditor-Cmd.exe" \\
        "<abs path>/unreal/PhotonUE/PhotonUE.uproject" \\
        -run=pythonscript -script="<abs path>/unreal/PhotonUE/Tools/bootstrap_stage0.py"

## Why this script exists rather than a list of manual editor steps

Enhanced Input actions, Input Mapping Contexts and Data Assets are binary `.uasset` files. They
cannot be authored as text, which means the alternative to this script is a page of "now click New
> Input > Input Action, name it IA_Fire..." — instructions that rot, are never re-run identically,
and cannot be diffed. Stage 0 needs to be reproducible to be worth anything as a spike, so the
assets are generated.

## What it does NOT do

It does not build a level, materials, Niagara systems or Blueprints. Level layout and Niagara graphs
are not practically scriptable through the Python API, and pretending otherwise would produce
something that has to be redone by hand anyway. Those are editor work, listed explicitly in
docs/UNREAL_STAGE0.md so they are not mistaken for done.

## Verification status

UNVERIFIED. This has never been executed — no C++ toolchain exists on the machine it was written on,
so the project cannot compile and the editor cannot open it. Expect to fix API details on first run;
Unreal's Python API for Enhanced Input has changed shape across 5.x releases.
"""

import unreal

CONTENT = "/Game/Photon"


def _asset_tools():
    return unreal.AssetToolsHelpers.get_asset_tools()


def _make(path, name, cls, factory=None):
    """Creates an asset, or returns the existing one. Idempotent so the script can be re-run."""
    full = "{}/{}".format(path, name)
    if unreal.EditorAssetLibrary.does_asset_exist(full):
        unreal.log("exists, skipping: {}".format(full))
        return unreal.EditorAssetLibrary.load_asset(full)
    asset = _asset_tools().create_asset(name, path, cls, factory)
    unreal.log("created: {}".format(full))
    return asset


# ---------------------------------------------------------------------------------------------
# Enhanced Input
# ---------------------------------------------------------------------------------------------

# Controller-first, exactly as specified. Keyboard/mouse is mapped into the *same* context so both
# work simultaneously without a mode switch — the reference build's InputManager already worked this
# way (one bindings table, mouse pseudo-codes alongside key codes) and it is the right model.
INPUT_ACTIONS = [
    ("IA_Move", unreal.InputActionValueType.AXIS2_D),
    ("IA_Look", unreal.InputActionValueType.AXIS2_D),
    ("IA_Fire", unreal.InputActionValueType.BOOLEAN),
    ("IA_ADS", unreal.InputActionValueType.BOOLEAN),
    ("IA_Jump", unreal.InputActionValueType.BOOLEAN),
    ("IA_CrouchSlide", unreal.InputActionValueType.BOOLEAN),
    ("IA_ReloadInteract", unreal.InputActionValueType.BOOLEAN),
    ("IA_WeaponSwitch", unreal.InputActionValueType.BOOLEAN),
    ("IA_WeaponSelect", unreal.InputActionValueType.AXIS1_D),
    ("IA_Grenade", unreal.InputActionValueType.BOOLEAN),
    ("IA_GrenadeAlt", unreal.InputActionValueType.BOOLEAN),
    ("IA_Sprint", unreal.InputActionValueType.BOOLEAN),
    ("IA_Melee", unreal.InputActionValueType.BOOLEAN),
    ("IA_Pause", unreal.InputActionValueType.BOOLEAN),
    ("IA_Scoreboard", unreal.InputActionValueType.BOOLEAN),
]


def build_input():
    path = "{}/Input".format(CONTENT)
    actions = {}
    for name, value_type in INPUT_ACTIONS:
        action = _make(path, name, unreal.InputAction, unreal.InputActionFactory())
        if action:
            action.set_editor_property("value_type", value_type)
            unreal.EditorAssetLibrary.save_loaded_asset(action)
            actions[name] = action

    context = _make(path, "IMC_Photon", unreal.InputMappingContext,
                    unreal.InputMappingContextFactory())

    # NOTE: `map_key` is the 5.x helper; on some engine versions the mapping array must be built
    # manually via `mappings`. If this raises, that is the first thing to change.
    keys = {
        "IA_Fire": [unreal.InputCoreProcessor  # placeholder to force an explicit review on first run
                    ] if False else [unreal.Keys.GAMEPAD_RIGHT_TRIGGER, unreal.Keys.LEFT_MOUSE_BUTTON],
        "IA_ADS": [unreal.Keys.GAMEPAD_LEFT_TRIGGER, unreal.Keys.RIGHT_MOUSE_BUTTON],
        "IA_Jump": [unreal.Keys.GAMEPAD_FACE_BUTTON_BOTTOM, unreal.Keys.SPACE_BAR],
        "IA_CrouchSlide": [unreal.Keys.GAMEPAD_FACE_BUTTON_RIGHT, unreal.Keys.C],
        "IA_ReloadInteract": [unreal.Keys.GAMEPAD_FACE_BUTTON_LEFT, unreal.Keys.R],
        "IA_WeaponSwitch": [unreal.Keys.GAMEPAD_FACE_BUTTON_TOP, unreal.Keys.Q],
        "IA_Grenade": [unreal.Keys.GAMEPAD_LEFT_SHOULDER, unreal.Keys.G],
        "IA_GrenadeAlt": [unreal.Keys.GAMEPAD_RIGHT_SHOULDER, unreal.Keys.H],
        "IA_Sprint": [unreal.Keys.GAMEPAD_LEFT_THUMBSTICK, unreal.Keys.LEFT_SHIFT],
        "IA_Melee": [unreal.Keys.GAMEPAD_RIGHT_THUMBSTICK, unreal.Keys.V],
        "IA_Pause": [unreal.Keys.GAMEPAD_SPECIAL_RIGHT, unreal.Keys.ESCAPE],
        "IA_Scoreboard": [unreal.Keys.GAMEPAD_SPECIAL_LEFT, unreal.Keys.TAB],
    }
    for action_name, key_list in keys.items():
        action = actions.get(action_name)
        if not action:
            continue
        for key in key_list:
            try:
                context.map_key(action, key)
            except Exception as exc:  # noqa: BLE001 — API shape varies by engine version
                unreal.log_warning("map_key failed for {} / {}: {}".format(action_name, key, exc))

    unreal.EditorAssetLibrary.save_loaded_asset(context)
    return actions, context


# ---------------------------------------------------------------------------------------------
# Weapon data
# ---------------------------------------------------------------------------------------------

# Ported from src/config/weapons.ts. Distances and speeds are x100 because Unreal is centimetres and
# the reference build was metres — the single most likely porting error, so it is applied here once
# and only here.
#
# Two weapons for Stage 0, chosen because they are the most different pair in the roster: a balanced
# medium-range rifle against a fast, self-limiting SMG.
WEAPONS = [
    dict(name="DA_PH6_PhotonRifle", weapon_id="photon_rifle", display="PH-6 Photon Rifle",
         capacity=8, fire_interval=0.17, recharge=1.85, trickle_delay=2.4, trickle_rate=0.55,
         speed=21500.0, lifetime=1.6, radius=9.0,
         damage=28.0, headshot=1.7, falloff_start=2800.0, falloff_end=5500.0, min_scale=0.62,
         spread_base=0.35, spread_moving=1.15, spread_air=2.4, spread_ads=0.08,
         spread_shot=0.34, spread_max=3.6, spread_recovery=3.2,
         recoil_pitch=0.85, recoil_yaw=0.22, recoil_half_life=0.11,
         ads_time=0.16, ads_fov=0.72, ads_sens=0.68,
         shake=0.35, rumble_strong=0.28, rumble_weak=0.55, rumble_time=0.07),

    dict(name="DA_PH9_Swift", weapon_id="ph9_smg", display="PH-9 Swift",
         capacity=14, fire_interval=0.085, recharge=1.7, trickle_delay=2.2, trickle_rate=0.9,
         speed=17500.0, lifetime=1.1, radius=7.0,
         damage=15.0, headshot=1.5, falloff_start=1200.0, falloff_end=2600.0, min_scale=0.4,
         spread_base=0.7, spread_moving=1.1, spread_air=2.8, spread_ads=0.32,
         spread_shot=0.62, spread_max=5.2, spread_recovery=5.0,
         recoil_pitch=0.5, recoil_yaw=0.3, recoil_half_life=0.07,
         ads_time=0.13, ads_fov=0.85, ads_sens=0.8,
         shake=0.2, rumble_strong=0.16, rumble_weak=0.38, rumble_time=0.045),
]

FIELD_MAP = {
    "weapon_id": "weapon_id", "capacity": "capacity", "fire_interval": "fire_interval",
    "recharge": "recharge_duration", "trickle_delay": "trickle_delay", "trickle_rate": "trickle_rate",
    "speed": "projectile_speed", "lifetime": "projectile_lifetime", "radius": "projectile_radius",
    "damage": "damage", "headshot": "headshot_multiplier",
    "falloff_start": "falloff_start", "falloff_end": "falloff_end", "min_scale": "min_damage_scale",
    "spread_base": "spread_base", "spread_moving": "spread_moving", "spread_air": "spread_air",
    "spread_ads": "spread_ads", "spread_shot": "spread_per_shot", "spread_max": "spread_max",
    "spread_recovery": "spread_recovery",
    "recoil_pitch": "recoil_pitch", "recoil_yaw": "recoil_yaw",
    "recoil_half_life": "recoil_recovery_half_life",
    "ads_time": "ads_time", "ads_fov": "ads_fov_scale", "ads_sens": "ads_sensitivity_scale",
    "shake": "camera_shake", "rumble_strong": "rumble_strong", "rumble_weak": "rumble_weak",
    "rumble_time": "rumble_duration",
}


def build_weapons():
    path = "{}/Weapons".format(CONTENT)
    factory = unreal.DataAssetFactory()
    factory.set_editor_property("data_asset_class", unreal.PhotonWeaponData)
    made = []
    for spec in WEAPONS:
        asset = _make(path, spec["name"], unreal.PhotonWeaponData, factory)
        if not asset:
            continue
        asset.set_editor_property("display_name", unreal.Text(spec["display"]))
        for key, prop in FIELD_MAP.items():
            asset.set_editor_property(prop, spec[key])
        unreal.EditorAssetLibrary.save_loaded_asset(asset)
        made.append(spec["name"])
    return made


# ---------------------------------------------------------------------------------------------
# PH-6 mesh import
# ---------------------------------------------------------------------------------------------

def import_ph6():
    """Imports RawAssets/PH6_PhotonRifle.fbx as a Static Mesh.

    Sockets are deliberately added in the Static Mesh Editor rather than here: the reference build
    spent real time on the fact that the GLB carries none, and Unreal makes adding them a two-minute
    job on the imported asset. That is the cheapest possible resolution to that long-standing gap.
    """
    task = unreal.AssetImportTask()
    task.filename = unreal.Paths.project_dir() + "RawAssets/PH6_PhotonRifle.fbx"
    task.destination_path = "{}/Weapons".format(CONTENT)
    task.automated = True
    task.replace_existing = True
    task.save = True
    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_as_skeletal", False)
    options.set_editor_property("import_materials", True)
    task.options = options
    _asset_tools().import_asset_tasks([task])
    return task.imported_object_paths


def run():
    unreal.log("=== Photon Stage 0 bootstrap ===")
    actions, context = build_input()
    unreal.log("input actions: {}".format(len(actions)))
    weapons = build_weapons()
    unreal.log("weapon data assets: {}".format(weapons))
    imported = import_ph6()
    unreal.log("imported: {}".format(imported))
    unreal.log("=== done — remaining work is editor-side, see docs/UNREAL_STAGE0.md ===")


if __name__ == "__main__":
    run()
