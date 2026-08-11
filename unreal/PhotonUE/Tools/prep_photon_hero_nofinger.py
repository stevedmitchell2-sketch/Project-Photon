"""
Photon no-finger-bones hero prep.

Authoritative source: Mixamo T-Pose (2).fbx (33 bones, Index-only fingers, 100% weighted).
Hand strategy: forearm + hand + static closed-grip pose; weapon on SOCKET_weapon_right.
Locomotion: copy matching Mixamo bone curves from HeroAthlete_v01.glb (bones that exist only).

Does NOT manufacture thumb/middle/ring/pinky bones.

Run:
  "C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe" -b -P Tools\\prep_photon_hero_nofinger.py
"""
from __future__ import annotations

import json
import math
import os
import shutil
from pathlib import Path

import bpy
from bpy_extras.anim_utils import (
    action_ensure_channelbag_for_slot,
    action_get_channelbag_for_slot,
    action_get_first_suitable_slot,
)
from mathutils import Euler, Matrix, Vector


def action_fcurves(action):
    """Blender 5.x layered Actions expose fcurves via channelbags, not action.fcurves."""
    if action is None:
        return []
    if hasattr(action, "fcurves") and not getattr(action, "is_action_layered", False):
        return list(action.fcurves)
    slot = action_get_first_suitable_slot(action, "OBJECT")
    if slot is None and len(action.slots):
        slot = action.slots[0]
    if slot is None:
        return []
    bag = action_get_channelbag_for_slot(action, slot)
    return list(bag.fcurves) if bag else []


def new_object_action(name: str):
    """Create a layered Action with an OBJECT slot + empty channelbag."""
    if name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[name])
    action = bpy.data.actions.new(name)
    slot = action.slots.new(id_type="OBJECT", name="Armature")
    bag = action_ensure_channelbag_for_slot(action, slot)
    return action, bag, slot

SRC_FBX = Path(os.environ.get(
    "PHOTON_HERO_FBX",
    r"C:\Users\Home\Downloads\T-Pose (2).fbx",
))
CLIP_GLB = Path(os.environ.get(
    "PHOTON_CLIP_GLB",
    r"C:\Users\Home\Desktop\100 men vs gorilla\photon\public\assets\characters\HeroAthlete_v01.glb",
))
OUT_DIR = Path(os.environ.get(
    "PHOTON_HERO_OUT",
    str(Path(__file__).resolve().parents[1] / "Content" / "Photon" / "Characters" / "HeroPrep"),
))
TARGET_HEIGHT_M = float(os.environ.get("PHOTON_HERO_HEIGHT_M", "1.95"))

# SOCKET_weapon_right — bone-local cm, UE/right-handed (X forward along grip toward muzzle bias).
# Tuned for Mixamo RightHand: grip sits in palm with barrel roughly along +X after UE import.
SOCKET_WEAPON_RIGHT = {
    "bone": "mixamorig:RightHand",
    "name": "SOCKET_weapon_right",
    "location_cm": (8.0, 2.5, 0.0),
    "rotation_deg_xyz": (0.0, 90.0, 0.0),
    "scale": (1.0, 1.0, 1.0),
    "coordinate_convention": (
        "Blender bone-local before FBX export; UE Import with "
        "ConvertScene / ForceFrontX. Position in centimetres. "
        "Weapon attach: KeepWorld or socket relative; FP viewmodel "
        "still uses Camera→WeaponRoot HipTransform (not this socket)."
    ),
}

# Closed-grip: rotate hand + index chain only (no new bones). Degrees, bone local XYZ Euler.
GRIP_POSE = {
    "mixamorig:RightHand": (0.0, 0.0, -35.0),
    "mixamorig:RightHandIndex1": (0.0, 0.0, -55.0),
    "mixamorig:RightHandIndex2": (0.0, 0.0, -70.0),
    "mixamorig:RightHandIndex3": (0.0, 0.0, -55.0),
    "mixamorig:LeftHand": (0.0, 0.0, 30.0),
    "mixamorig:LeftHandIndex1": (0.0, 0.0, -50.0),
    "mixamorig:LeftHandIndex2": (0.0, 0.0, -65.0),
    "mixamorig:LeftHandIndex3": (0.0, 0.0, -50.0),
}

ARM_BONE_TOKENS = (
    "Shoulder", "Arm", "ForeArm", "Hand", "HandIndex",
)

CLIP_MAP = {
    "Breathing Idle": "A_PhotonHero_Idle",
    "Walking": "A_PhotonHero_Walk",
    "Running": "A_PhotonHero_Run",
    "Fast Run": "A_PhotonHero_Sprint",
}

REPORT: dict = {
    "pipeline": "no-finger-bones",
    "source": str(SRC_FBX),
    "clip_source": str(CLIP_GLB),
    "stages": [],
    "warnings": [],
    "errors": [],
    "exports": {},
    "socket": SOCKET_WEAPON_RIGHT,
}


def log(msg: str) -> None:
    print(f"[PhotonNoFinger] {msg}")


def stage(name: str, **data) -> None:
    REPORT["stages"].append({"stage": name, **data})
    log(f"== {name} == {json.dumps(data, default=str)[:500]}")


def warn(msg: str) -> None:
    REPORT["warnings"].append(msg)
    log(f"WARN {msg}")


def err(msg: str) -> None:
    REPORT["errors"].append(msg)
    log(f"ERROR {msg}")


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def ensure_object_mode() -> None:
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def find_armature():
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    return arms[0] if arms else None


def find_meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def bone_basename(name: str) -> str:
    return name.split(":")[-1]


def import_hero() -> tuple:
    if not SRC_FBX.is_file():
        raise FileNotFoundError(SRC_FBX)
    bpy.ops.import_scene.fbx(
        filepath=str(SRC_FBX),
        automatic_bone_orientation=False,
        ignore_leaf_bones=False,
        force_connect_children=False,
    )
    arm = find_armature()
    meshes = find_meshes()
    if arm is None or not meshes:
        raise RuntimeError("FBX missing armature or mesh")
    stage(
        "import_hero",
        armature=arm.name,
        bones=len(arm.data.bones),
        bone_names=sorted(b.name for b in arm.data.bones),
        meshes=[(m.name, len(m.data.vertices), len(m.vertex_groups)) for m in meshes],
    )
    return arm, meshes


def measure_height_m(objs) -> float:
    coords = []
    for o in objs:
        for corner in o.bound_box:
            coords.append(o.matrix_world @ Vector(corner))
    if not coords:
        return 0.0
    zs = [c.z for c in coords]
    ys = [c.y for c in coords]
    xs = [c.x for c in coords]
    # Mixamo FBX often arrives Y-up in Blender; pick the dominant axis span.
    spans = {
        "x": max(xs) - min(xs),
        "y": max(ys) - min(ys),
        "z": max(zs) - min(zs),
    }
    axis = max(spans, key=spans.get)
    REPORT["height_axis"] = axis
    return spans[axis]


def scale_to_height(arm, meshes) -> float:
    ensure_object_mode()
    height = measure_height_m([arm] + meshes)
    if height < 1e-4:
        raise RuntimeError("cannot measure height")
    factor = TARGET_HEIGHT_M / height
    arm.scale = tuple(s * factor for s in arm.scale)
    bpy.context.view_layer.update()
    # Apply scale on armature so bind pose matches.
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Snap feet to Z=0 after scale (use world bounds of meshes).
    coords = []
    for m in meshes:
        for corner in m.bound_box:
            coords.append(m.matrix_world @ Vector(corner))
    min_z = min(c.z for c in coords)
    arm.location.z -= min_z
    bpy.context.view_layer.update()
    stage("scale", source_height_m=height, factor=factor, target_m=TARGET_HEIGHT_M)
    return factor


def apply_grip_pose(arm) -> None:
    ensure_object_mode()
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    for bname, rot_deg in GRIP_POSE.items():
        pb = arm.pose.bones.get(bname)
        if pb is None:
            warn(f"grip bone missing: {bname}")
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = Euler(tuple(math.radians(a) for a in rot_deg), "XYZ")
    bpy.context.view_layer.update()
    # Bake grip into rest pose so static mesh export and bind pose match closed hands.
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    stage("grip_rest_pose", applied=list(GRIP_POSE.keys()))


def add_socket(arm) -> dict:
    ensure_object_mode()
    bone_name = SOCKET_WEAPON_RIGHT["bone"]
    if bone_name not in arm.data.bones:
        # fallback without prefix
        for b in arm.data.bones:
            if bone_basename(b.name) == "RightHand":
                bone_name = b.name
                break
    if bone_name not in arm.data.bones:
        err("RightHand bone missing — socket not created")
        return {}

    sock_name = SOCKET_WEAPON_RIGHT["name"]
    empty = bpy.data.objects.get(sock_name)
    if empty is None:
        empty = bpy.data.objects.new(sock_name, None)
        empty.empty_display_type = "ARROWS"
        empty.empty_display_size = 0.05
        bpy.context.scene.collection.objects.link(empty)

    empty.parent = arm
    empty.parent_type = "BONE"
    empty.parent_bone = bone_name
    empty.matrix_parent_inverse.identity()
    # Blender empties use metres; our doc is cm.
    loc_cm = SOCKET_WEAPON_RIGHT["location_cm"]
    empty.location = Vector(loc_cm) * 0.01
    empty.rotation_euler = Euler(
        tuple(math.radians(a) for a in SOCKET_WEAPON_RIGHT["rotation_deg_xyz"]), "XYZ"
    )
    empty.scale = Vector(SOCKET_WEAPON_RIGHT["scale"])

    info = {
        **SOCKET_WEAPON_RIGHT,
        "resolved_bone": bone_name,
        "blender_location_m": list(empty.location),
    }
    stage("socket", socket=info)
    REPORT["socket"] = info
    return info


def copy_clips_from_hero_athlete(target_arm) -> list[str]:
    """Import HeroAthlete GLB in a temp scene layer, copy matching bone fcurves."""
    if not CLIP_GLB.is_file():
        warn(f"clip GLB missing: {CLIP_GLB}")
        return []

    # Snapshot existing object names so we can delete the donor after copy.
    before = set(bpy.data.objects.keys())
    before_actions = set(bpy.data.actions.keys())

    try:
        bpy.ops.import_scene.gltf(filepath=str(CLIP_GLB))
    except Exception as exc:
        warn(f"gltf import failed: {exc}")
        return []

    donor_arm = None
    for o in bpy.data.objects:
        if o.name in before:
            continue
        if o.type == "ARMATURE":
            donor_arm = o
            break
    if donor_arm is None:
        warn("no donor armature in HeroAthlete")
        return []

    target_bones = {b.name for b in target_arm.data.bones}
    target_bases = {bone_basename(n): n for n in target_bones}
    created = []

    for src_name, dst_name in CLIP_MAP.items():
        src_action = bpy.data.actions.get(src_name)
        if src_action is None:
            # glTF may rename
            matches = [a for a in bpy.data.actions if a.name == src_name or src_name in a.name]
            src_action = matches[0] if matches else None
        if src_action is None:
            warn(f"clip missing: {src_name}")
            continue

        dst, dst_bag, dst_slot = new_object_action(dst_name)

        copied = 0
        skipped = 0
        for fc in action_fcurves(src_action):
            data_path = fc.data_path
            # pose.bones["mixamorig:Hips"].rotation_quaternion
            if 'pose.bones["' not in data_path:
                continue
            bone = data_path.split('pose.bones["', 1)[1].split('"]', 1)[0]
            if bone not in target_bones:
                base = bone_basename(bone)
                if base not in target_bases:
                    skipped += 1
                    continue
                bone = target_bases[base]
            suffix = data_path.split('"]', 1)[1]
            data_path = f'pose.bones["{bone}"]{suffix}'

            try:
                new_fc = dst_bag.fcurves.new(data_path=data_path, index=fc.array_index)
            except RuntimeError:
                skipped += 1
                continue
            new_fc.keyframe_points.add(len(fc.keyframe_points))
            for i, kp in enumerate(fc.keyframe_points):
                nkp = new_fc.keyframe_points[i]
                nkp.co = kp.co.copy()
                nkp.interpolation = kp.interpolation
                nkp.handle_left = kp.handle_left.copy()
                nkp.handle_right = kp.handle_right.copy()
            copied += 1

        created.append(dst_name)
        stage("clip_copy", source=src_name, dest=dst_name, fcurves=copied, skipped_missing_bones=skipped)

    # Push actions onto target as NLA strips so FBX export embeds them.
    if not target_arm.animation_data:
        target_arm.animation_data_create()
    track = target_arm.animation_data.nla_tracks.new()
    track.name = "PhotonClips"
    frame = 1
    for aname in created:
        act = bpy.data.actions.get(aname)
        if not act:
            continue
        # Bind layered action slot to this armature.
        slot = action_get_first_suitable_slot(act, "OBJECT")
        if slot is not None:
            target_arm.animation_data.action = act
            try:
                target_arm.animation_data.action_slot = slot
            except Exception:
                pass
        frames = []
        for fc in action_fcurves(act):
            for kp in fc.keyframe_points:
                frames.append(kp.co.x)
        if not frames:
            continue
        start = int(min(frames))
        end = int(max(frames))
        length = max(1, end - start)
        strip = track.strips.new(aname, frame, act)
        strip.action_frame_start = start
        strip.action_frame_end = end
        if slot is not None:
            try:
                strip.action_slot = slot
            except Exception:
                pass
        frame += length + 2

    # Delete donor objects (keep copied actions).
    for o in list(bpy.data.objects):
        if o.name not in before and o != target_arm:
            bpy.data.objects.remove(o, do_unlink=True)
    # Remove donor-only actions we don't need
    keep = set(created) | before_actions
    for a in list(bpy.data.actions):
        if a.name not in keep and a.name not in CLIP_MAP:
            # keep originals referenced? remove unused donor names
            if a.name in CLIP_MAP or a.name in ("Breathing Idle", "Walking", "Running", "Fast Run"):
                if a.name not in created:
                    try:
                        bpy.data.actions.remove(a)
                    except Exception:
                        pass

    return created


def export_fbx(path: Path, objects: list, bake_anim: bool) -> None:
    ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        if o is None:
            continue
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        object_types={"ARMATURE", "MESH", "EMPTY"},
        add_leaf_bones=False,
        bake_anim=bake_anim,
        bake_anim_use_nla_strips=True,
        bake_anim_use_all_actions=True,
        bake_anim_force_startend_keying=True,
        armature_nodetype="NULL",
        mesh_smooth_type="FACE",
        use_tspace=True,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
    )
    stage("export", path=str(path), bytes=path.stat().st_size if path.is_file() else 0)


def is_arm_bone(name: str) -> bool:
    base = bone_basename(name)
    return any(tok in base for tok in ARM_BONE_TOKENS)


def extract_fp_arms(arm, mesh) -> bpy.types.Object:
    """Duplicate mesh, delete non-arm vertices by vertex-group weight."""
    ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.duplicate()
    arms_mesh = bpy.context.view_layer.objects.active
    arms_mesh.name = "PhotonFPArms"

    arm_groups = set()
    for vg in arms_mesh.vertex_groups:
        if is_arm_bone(vg.name):
            arm_groups.add(vg.index)

    if not arm_groups:
        err("no arm vertex groups found for FP extract")
        return arms_mesh

    # Select verts whose dominant weight is NOT an arm bone.
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")

    import bmesh
    bm = bmesh.new()
    bm.from_mesh(arms_mesh.data)
    bm.verts.ensure_lookup_table()
    deform = bm.verts.layers.deform.active
    delete = []
    for v in bm.verts:
        if deform is None:
            delete.append(v)
            continue
        weights = v[deform]
        if not weights:
            delete.append(v)
            continue
        # keep if any arm group has meaningful weight
        keep = any(weights.get(gi, 0.0) > 0.15 for gi in arm_groups)
        if not keep:
            delete.append(v)
    bmesh.ops.delete(bm, geom=delete, context="VERTS")
    bm.to_mesh(arms_mesh.data)
    bm.free()
    arms_mesh.data.update()

    # Ensure armature modifier targets the shared armature.
    for mod in arms_mesh.modifiers:
        if mod.type == "ARMATURE":
            mod.object = arm

    stage(
        "fp_arms_extract",
        verts=len(arms_mesh.data.vertices),
        arm_groups=len(arm_groups),
    )
    return arms_mesh


def weight_stats(mesh) -> dict:
    total = len(mesh.data.vertices)
    weighted = 0
    for v in mesh.data.vertices:
        if any(g.weight > 1e-5 for g in v.groups):
            weighted += 1
    return {"verts": total, "weighted": weighted, "pct": (100.0 * weighted / total) if total else 0.0}


def finger_limitation(arm) -> dict:
    names = [b.name for b in arm.data.bones]
    bases = [bone_basename(n) for n in names]
    has = {
        "index": any("HandIndex" in b for b in bases),
        "thumb": any("HandThumb" in b for b in bases),
        "middle": any("HandMiddle" in b for b in bases),
        "ring": any("HandRing" in b for b in bases),
        "pinky": any("HandPinky" in b for b in bases),
    }
    return {"bone_count": len(names), "chains": has}


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    clear_scene()

    arm, meshes = import_hero()
    mesh = max(meshes, key=lambda m: len(m.data.vertices))
    mesh.name = "PhotonHero"

    REPORT["skinning"] = weight_stats(mesh)
    REPORT["rig"] = finger_limitation(arm)

    scale_to_height(arm, [mesh])
    apply_grip_pose(arm)
    add_socket(arm)

    clips = copy_clips_from_hero_athlete(arm)
    REPORT["clips"] = clips

    # Do NOT export the socket empty — FBX turns bone-parented empties into fake bones/tracks
    # that break UE anim import ("Unable to retrieve bone index for track: SOCKET_weapon_right").
    # Socket is authored in Unreal from SOCKET_weapon_right.json instead.
    sock = bpy.data.objects.get(SOCKET_WEAPON_RIGHT["name"])
    if sock is not None:
        sock.hide_set(True)
        sock.hide_render = True

    hero_fbx = OUT_DIR / "PhotonHero_SK.fbx"
    export_fbx(hero_fbx, [arm, mesh], bake_anim=True)
    REPORT["exports"]["hero_sk"] = str(hero_fbx)

    # FP arms: extract from a duplicate — work on a copy of the scene state by duplicating mesh only
    arms_mesh = extract_fp_arms(arm, mesh)
    # Hide full body for arms-only export selection
    mesh.hide_set(True)
    fp_fbx = OUT_DIR / "PhotonFPArms_SK.fbx"
    export_fbx(fp_fbx, [arm, arms_mesh], bake_anim=False)
    REPORT["exports"]["fp_arms_sk"] = str(fp_fbx)
    mesh.hide_set(False)

    # Also write a rest-pose static right/left arm for the existing UStaticMeshComponent path
    # (skinned FP skeletal is primary; static is fallback / preview).
    report_path = OUT_DIR / "photon_hero_nofinger_report.json"
    report_path.write_text(json.dumps(REPORT, indent=2), encoding="utf-8")
    log(f"report -> {report_path}")

    # Socket doc sidecar
    sock_doc = OUT_DIR / "SOCKET_weapon_right.json"
    sock_doc.write_text(json.dumps(REPORT.get("socket", {}), indent=2), encoding="utf-8")

    if REPORT["errors"]:
        log(f"FAILED with {len(REPORT['errors'])} errors")
        return 1
    log("OK")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        import traceback
        traceback.print_exc()
        REPORT["errors"].append(traceback.format_exc())
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUT_DIR / "photon_hero_nofinger_report.json").write_text(
            json.dumps(REPORT, indent=2), encoding="utf-8"
        )
        raise SystemExit(1)
