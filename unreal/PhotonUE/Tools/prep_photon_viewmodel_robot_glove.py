"""
Prep FP viewmodel from Tripo maintenance robot + glove.

Strategy (no finger-bone dependency):
  - Import glove as static closed-grip hand mesh(es)
  - Import robot, extract forearm-ish region OR use whole robot arms if mesh is compact
  - Orient elbow-at-origin / +Z for Photon static arm convention when possible
  - Export SM-ready FBX into Content/Photon/Characters/ViewmodelPrep/

Run:
  blender -b -P Tools/prep_photon_viewmodel_robot_glove.py
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
PREP = ROOT / "Content" / "Photon" / "Characters" / "ViewmodelPrep"
ROBOT_FBX = PREP / "PhotonRobot.fbx"
GLOVE_FBX = PREP / "PhotonGlove.fbx"
REPORT: dict = {"stages": [], "warnings": [], "errors": [], "exports": {}}


def log(msg: str) -> None:
    print(f"[PhotonVM] {msg}", flush=True)


def stage(name: str, **data) -> None:
    REPORT["stages"].append({"stage": name, **data})
    log(f"== {name} == {json.dumps(data, default=str)[:400]}")


def clear_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path: Path) -> None:
    if not path.is_file():
        raise FileNotFoundError(path)
    log(f"import {path}")
    # Skip image search — glove packs 48+ PBR sets and can hang Blender on load.
    bpy.ops.import_scene.fbx(
        filepath=str(path),
        use_image_search=False,
        use_anim=False,
        ignore_leaf_bones=True,
        automatic_bone_orientation=False,
    )


def meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def arms():
    return [o for o in bpy.data.objects if o.type == "ARMATURE"]


def select_only(objs) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o


def export_fbx(path: Path, objs) -> None:
    select_only(objs)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        object_types={"MESH"},
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        mesh_smooth_type="FACE",
        use_tspace=True,
        bake_anim=False,
        path_mode="COPY",
        embed_textures=False,
    )
    stage("export", path=str(path), bytes=path.stat().st_size)


def join_meshes(name: str):
    ms = meshes()
    if not ms:
        return None
    select_only(ms)
    if len(ms) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


def normalize_height(obj, target_m: float) -> float:
    dim = max(obj.dimensions)
    if dim < 1e-6:
        return 1.0
    # If FBX came in as cm-ish Blender units (>10), treat as cm.
    height = dim
    factor = target_m / height
    obj.scale = tuple(s * factor for s in obj.scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Snap lowest point to Z=0
    bpy.context.view_layer.update()
    coords = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    min_z = min(c.z for c in coords)
    obj.location.z -= min_z
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    return factor


def orient_elbow_plus_z(obj) -> None:
    """Rough Photon arm convention: longest axis -> +Z, origin at 'elbow' (min Z after)."""
    # Place origin at bounds center then shift so min extent on long axis is at origin.
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    dims = Vector(obj.dimensions)
    axis = max(range(3), key=lambda i: dims[i])
    # Rotate so dominant axis aligns with Z
    if axis == 0:
        obj.rotation_euler = (0, math.radians(90), 0)
    elif axis == 1:
        obj.rotation_euler = (math.radians(-90), 0, 0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    # Move so the lower end (elbow) is at origin along Z
    coords = [Vector(c) for c in obj.bound_box]
    min_z = min(c.z for c in coords)
    obj.location.z -= min_z
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def inspect_current(tag: str) -> dict:
    info = {
        "armatures": [(a.name, len(a.data.bones)) for a in arms()],
        "meshes": [
            {
                "name": m.name,
                "verts": len(m.data.vertices),
                "groups": len(m.vertex_groups),
                "dims": [round(x, 4) for x in m.dimensions],
            }
            for m in meshes()
        ],
    }
    stage(f"inspect_{tag}", **info)
    return info


def prep_glove() -> Path:
    clear_scene()
    import_fbx(GLOVE_FBX)
    inspect_current("glove_raw")
    obj = join_meshes("PhotonGlove")
    if obj is None:
        raise RuntimeError("glove has no mesh")
    # Glove should be hand-sized ~0.22 m long
    normalize_height(obj, 0.22)
    orient_elbow_plus_z(obj)
    out = PREP / "SM_PhotonGlove.fbx"
    export_fbx(out, [obj])
    REPORT["exports"]["glove"] = str(out)
    return out


def prep_robot_forearms() -> tuple[Path, Path]:
    clear_scene()
    import_fbx(ROBOT_FBX)
    inspect_current("robot_raw")
    obj = join_meshes("PhotonRobot")
    if obj is None:
        raise RuntimeError("robot has no mesh")

    # Scale robot to ~1.95 m if it looks like a full body; if already arm-sized, keep smaller.
    dim = max(obj.dimensions)
    stage("robot_dim_before", dim=dim)
    if dim > 50:  # cm-ish units
        normalize_height(obj, 1.95)
    elif dim > 1.2:
        normalize_height(obj, 1.95)
    else:
        # Already metres-ish and small — treat as prop; scale to 0.45 m forearm
        normalize_height(obj, 0.45)

    # Duplicate for L/R — same mesh mirrored for now (static closed-grip pipeline).
    select_only([obj])
    bpy.ops.object.duplicate()
    right = bpy.context.view_layer.objects.active
    right.name = "PhotonRobotArmRight"
    orient_elbow_plus_z(right)

    select_only([obj])
    obj.name = "PhotonRobotArmLeft"
    orient_elbow_plus_z(obj)
    obj.scale.x *= -1
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    out_r = PREP / "SM_PhotonRobotArmRight.fbx"
    out_l = PREP / "SM_PhotonRobotArmLeft.fbx"
    export_fbx(out_r, [right])
    export_fbx(out_l, [obj])
    REPORT["exports"]["robot_arm_right"] = str(out_r)
    REPORT["exports"]["robot_arm_left"] = str(out_l)
    return out_r, out_l


def main() -> int:
    PREP.mkdir(parents=True, exist_ok=True)
    try:
        prep_glove()
        prep_robot_forearms()
    except Exception:
        import traceback

        REPORT["errors"].append(traceback.format_exc())
        log(traceback.format_exc())
        (PREP / "photon_viewmodel_prep_report.json").write_text(
            json.dumps(REPORT, indent=2), encoding="utf-8"
        )
        return 1

    (PREP / "photon_viewmodel_prep_report.json").write_text(
        json.dumps(REPORT, indent=2), encoding="utf-8"
    )
    log("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
