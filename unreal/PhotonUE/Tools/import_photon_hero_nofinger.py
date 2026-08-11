"""
Import Photon no-finger-bones hero FBX into /Game/Photon/Characters/Hero.

Creates:
  SK_PhotonHero / SK_PhotonFPArms
  Skeleton SKEL_PhotonHero (shared if possible)
  AnimSequences A_PhotonHero_*
  Adds SOCKET_weapon_right on the RightHand bone if the FBX empty did not become a socket.
  Writes Content/Photon/Characters/Hero/photon_hero_import_report.json

Run:
  UnrealEditor-Cmd.exe PhotonUE.uproject -run=pythonscript -script=Tools/import_photon_hero_nofinger.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import unreal

PROJECT_CONTENT = Path(unreal.Paths.project_content_dir())
PREP = PROJECT_CONTENT / "Photon" / "Characters" / "HeroPrep"
DEST = "/Game/Photon/Characters/Hero"
HERO_FBX = PREP / "PhotonHero_SK.fbx"
ARMS_FBX = PREP / "PhotonFPArms_SK.fbx"
SOCKET_DOC = PREP / "SOCKET_weapon_right.json"

REPORT = {
    "dest": DEST,
    "imports": [],
    "sockets": [],
    "anims": [],
    "errors": [],
    "warnings": [],
}


def log(msg: str) -> None:
    unreal.log(f"[PhotonHeroImport] {msg}")


def warn(msg: str) -> None:
    REPORT["warnings"].append(msg)
    unreal.log_warning(f"[PhotonHeroImport] {msg}")


def err(msg: str) -> None:
    REPORT["errors"].append(msg)
    unreal.log_error(f"[PhotonHeroImport] {msg}")


def ensure_dir(package_path: str) -> None:
    if not unreal.EditorAssetLibrary.does_directory_exist(package_path):
        unreal.EditorAssetLibrary.make_directory(package_path)


def import_fbx(fbx_path: Path, destination: str, skeletal: bool, import_animations: bool) -> list:
    if not fbx_path.is_file():
        err(f"missing FBX: {fbx_path}")
        return []

    ensure_dir(destination)
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", str(fbx_path))
    task.set_editor_property("destination_path", destination)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)

    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_textures", True)
    options.set_editor_property("import_materials", True)
    options.set_editor_property("import_as_skeletal", skeletal)
    options.set_editor_property("import_animations", import_animations)
    options.set_editor_property("create_physics_asset", skeletal)

    if skeletal:
        options.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_SKELETAL_MESH)
        sk = options.get_editor_property("skeletal_mesh_import_data")
        # Force front X / convert scene — UE default Mixamo path
        try:
            sk.set_editor_property("import_meshes_in_bone_hierarchy", True)
            sk.set_editor_property("use_t0_as_ref_pose", True)
            sk.set_editor_property("convert_scene", True)
            sk.set_editor_property("force_front_x_axis", True)
            sk.set_editor_property("convert_scene_unit", True)
        except Exception as exc:
            warn(f"skeletal import data tweak failed: {exc}")
        if import_animations:
            try:
                anim = options.get_editor_property("anim_sequence_import_data")
                anim.set_editor_property("import_bone_tracks", True)
            except Exception as exc:
                warn(f"anim import data tweak failed: {exc}")
    else:
        options.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)

    task.set_editor_property("options", options)
    try:
        unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    except Exception as exc:
        warn(f"import_asset_tasks raised (may be partial): {exc}")

    paths = list(task.get_editor_property("imported_object_paths") or [])
    REPORT["imports"].append({"fbx": str(fbx_path), "paths": paths})
    log(f"imported {fbx_path.name}: {paths}")
    return paths


def find_assets(path: str, class_name: str) -> list:
    assets = unreal.EditorAssetLibrary.list_assets(path, recursive=True, include_folder=False)
    out = []
    for a in assets:
        asset = unreal.EditorAssetLibrary.load_asset(a)
        if asset and asset.get_class().get_name() == class_name:
            out.append(asset)
    return out


def rename_if_needed(asset, desired_name: str, folder: str):
    if asset is None:
        return None
    current = asset.get_name()
    if current == desired_name:
        return asset
    dest = f"{folder}/{desired_name}"
    if unreal.EditorAssetLibrary.does_asset_exist(dest):
        unreal.EditorAssetLibrary.delete_asset(dest)
    ok = unreal.EditorAssetLibrary.rename_asset(asset.get_path_name(), dest)
    if ok:
        return unreal.EditorAssetLibrary.load_asset(dest)
    warn(f"rename failed {current} -> {desired_name}")
    return asset


def ensure_weapon_socket(skel_mesh) -> dict:
    """Create SOCKET_weapon_right on mixamorig:RightHand (or RightHand) if missing."""
    info = {
        "name": "SOCKET_weapon_right",
        "bone": None,
        "created": False,
        "existed": False,
        "location_cm": [8.0, 2.5, 0.0],
        "rotation_deg": [0.0, 90.0, 0.0],
        "scale": [1.0, 1.0, 1.0],
    }
    if SOCKET_DOC.is_file():
        try:
            doc = json.loads(SOCKET_DOC.read_text(encoding="utf-8"))
            info["location_cm"] = list(doc.get("location_cm", info["location_cm"]))
            info["rotation_deg"] = list(doc.get("rotation_deg_xyz", info["rotation_deg"]))
            info["scale"] = list(doc.get("scale", info["scale"]))
            info["source_doc_bone"] = doc.get("resolved_bone") or doc.get("bone")
        except Exception as exc:
            warn(f"socket doc read failed: {exc}")

    if skel_mesh is None:
        err("no skeletal mesh for socket")
        return info

    skeleton = skel_mesh.get_editor_property("skeleton")
    bone_name = info.get("source_doc_bone") or "mixamorig:RightHand"
    loc = info["location_cm"]
    rot = info["rotation_deg"]
    scl = info["scale"]
    rx, ry, rz = [float(v) for v in rot]
    rel_loc = unreal.Vector(float(loc[0]), float(loc[1]), float(loc[2]))
    rel_rot = unreal.Rotator(pitch=ry, yaw=rz, roll=rx)
    rel_scale = unreal.Vector(float(scl[0]), float(scl[1]), float(scl[2]))

    def _socket_names(obj) -> list:
        try:
            socks = list(obj.get_editor_property("sockets") or [])
            return [str(s.get_editor_property("socket_name")) for s in socks]
        except Exception:
            return []

    existing = _socket_names(skel_mesh) + (_socket_names(skeleton) if skeleton else [])
    if "SOCKET_weapon_right" in existing:
        info["existed"] = True
        info["bone"] = bone_name
        REPORT["sockets"].append(info)
        log("SOCKET_weapon_right already exists")
        return info

    socket = unreal.SkeletalMeshSocket()
    socket.set_editor_property("socket_name", "SOCKET_weapon_right")
    socket.set_editor_property("bone_name", bone_name)
    socket.set_editor_property("relative_location", rel_loc)
    socket.set_editor_property("relative_rotation", rel_rot)
    socket.set_editor_property("relative_scale", rel_scale)

    # Prefer Skeleton sockets (shared across meshes using the same skeleton).
    targets = []
    if skeleton is not None:
        targets.append(("skeleton", skeleton))
    targets.append(("mesh", skel_mesh))

    for label, obj in targets:
        try:
            sockets = list(obj.get_editor_property("sockets") or [])
            sockets.append(socket)
            obj.set_editor_property("sockets", sockets)
            unreal.EditorAssetLibrary.save_loaded_asset(obj)
            info["created"] = True
            info["bone"] = bone_name
            info["target"] = label
            log(f"created SOCKET_weapon_right on {label} bone {bone_name}")
            REPORT["sockets"].append(info)
            return info
        except Exception as exc:
            warn(f"socket create on {label} failed: {exc}")

    err("socket create failed on mesh and skeleton")
    REPORT["sockets"].append(info)
    return info


def write_report() -> None:
    out_dir = PROJECT_CONTENT / "Photon" / "Characters" / "Hero"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "photon_hero_import_report.json"
    path.write_text(json.dumps(REPORT, indent=2), encoding="utf-8")
    log(f"report -> {path}")


def main() -> None:
    ensure_dir(DEST)
    hero_paths = import_fbx(HERO_FBX, DEST, skeletal=True, import_animations=True)
    arms_paths = import_fbx(ARMS_FBX, f"{DEST}/FPArms", skeletal=True, import_animations=False)

    meshes = find_assets(DEST, "SkeletalMesh")
    # Prefer the full-body mesh (more verts / not under FPArms)
    hero_mesh = None
    arms_mesh = None
    for m in meshes:
        path = m.get_path_name()
        if "/FPArms/" in path:
            arms_mesh = m
        else:
            # pick largest-ish by name preference
            if hero_mesh is None or "PhotonHero" in m.get_name() or "PhotonHero_SK" in path:
                hero_mesh = m

    if hero_mesh:
        hero_mesh = rename_if_needed(hero_mesh, "SK_PhotonHero", DEST)
    else:
        err("SK_PhotonHero not found after import")

    if arms_mesh:
        arms_mesh = rename_if_needed(arms_mesh, "SK_PhotonFPArms", f"{DEST}/FPArms")
    else:
        # arms may have landed next to hero
        for m in meshes:
            if m != hero_mesh and "FPArms" in m.get_name() or "PhotonFPArms" in m.get_name():
                arms_mesh = rename_if_needed(m, "SK_PhotonFPArms", f"{DEST}/FPArms")
                break
        if arms_mesh is None:
            warn("SK_PhotonFPArms not found — FP will fall back to static proxy arms")

    if hero_mesh:
        ensure_weapon_socket(hero_mesh)
        # Mirror socket onto FP arms mesh if present (same bone names)
        if arms_mesh:
            ensure_weapon_socket(arms_mesh)

    anims = find_assets(DEST, "AnimSequence")
    for a in anims:
        REPORT["anims"].append(a.get_path_name())
        log(f"anim: {a.get_path_name()}")

    # Soft-touch: mark skeleton name if we can
    if hero_mesh:
        skel = hero_mesh.get_editor_property("skeleton")
        if skel:
            REPORT["skeleton"] = skel.get_path_name()
            REPORT["bone_count"] = None
            try:
                # ref skeleton bone num
                REPORT["ref_skeleton_bones"] = skel.get_editor_property("bone_tree") and len(
                    skel.get_editor_property("bone_tree")
                )
            except Exception:
                pass

    write_report()
    if REPORT["errors"]:
        raise RuntimeError(f"import finished with errors: {REPORT['errors']}")
    log("OK")


if __name__ == "__main__":
    main()
