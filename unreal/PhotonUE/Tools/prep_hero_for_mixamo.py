"""
Export a Mixamo-uploadable FBX from the current Photon Tripo hero.

Mixamo wants (ideally):
  - single mesh
  - T-pose / A-pose humanoid
  - unrigged (or Mixamo will replace the rig)
  - FBX with textures

This strips any Tripo armature, keeps the mesh + textures, snaps feet, and writes:

  Content/Photon/Characters/HeroPrep/PhotonHero_ForMixamo.fbx

Run:
  blender --background --python Tools/prep_hero_for_mixamo.py
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import bpy
from mathutils import Vector

SRC = Path(
    os.environ.get(
        "PHOTON_HERO_FBX",
        r"c:\Users\Home\Downloads\futuristic+athlete+auto+rig+3d+model"
        r"\tripo_convert_f39ddff3-5bcd-4573-ae6f-f52d132834c1.fbx",
    )
)
OUT_DIR = Path(
    os.environ.get(
        "PHOTON_HERO_OUT",
        str(Path(__file__).resolve().parents[1] / "Content" / "Photon" / "Characters" / "HeroPrep"),
    )
)
OUT_FBX = OUT_DIR / "PhotonHero_ForMixamo.fbx"
TARGET_HEIGHT_CM = 195.0


def log(msg: str) -> None:
    print(f"[MixamoPrep] {msg}")


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def world_bbox(objs):
    coords = []
    for o in objs:
        for c in o.bound_box:
            coords.append(o.matrix_world @ Vector(c))
    xs, ys, zs = [v.x for v in coords], [v.y for v in coords], [v.z for v in coords]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def relink_textures(fbm: Path) -> int:
    if not fbm.is_dir():
        return 0
    by = {p.name.lower(): p for p in fbm.iterdir() if p.is_file()}
    n = 0
    for img in bpy.data.images:
        base = Path(str(img.filepath).replace("\\", "/")).name.lower()
        match = by.get(base)
        if match is None:
            blob = f"{img.name} {img.filepath}".lower()
            for key in ("basecolor", "normal", "roughness", "metallic"):
                if key in blob:
                    for name, path in by.items():
                        if key in name:
                            match = path
                            break
                if match:
                    break
        if match:
            img.filepath = img.filepath_raw = str(match)
            try:
                img.reload()
            except Exception:
                pass
            n += 1
    return n


def main() -> int:
    log(f"source {SRC}")
    if not SRC.is_file():
        raise FileNotFoundError(SRC)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    clear()
    bpy.ops.import_scene.fbx(
        filepath=str(SRC),
        automatic_bone_orientation=True,
        ignore_leaf_bones=False,
        use_anim=False,
    )
    relink_textures(SRC.with_suffix(".fbm"))

    # Apply armature at rest pose so the mesh keeps T-pose shape, then delete the rig.
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    for m in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        bpy.context.view_layer.objects.active = m
        for mod in list(m.modifiers):
            if mod.type == "ARMATURE":
                try:
                    # Rest pose: clear pose first on armature
                    if arms:
                        bpy.ops.object.select_all(action="DESELECT")
                        arms[0].select_set(True)
                        bpy.context.view_layer.objects.active = arms[0]
                        bpy.ops.object.mode_set(mode="POSE")
                        bpy.ops.pose.select_all(action="SELECT")
                        bpy.ops.pose.transforms_clear()
                        bpy.ops.object.mode_set(mode="OBJECT")
                    bpy.ops.object.select_all(action="DESELECT")
                    m.select_set(True)
                    bpy.context.view_layer.objects.active = m
                    bpy.ops.object.modifier_apply(modifier=mod.name)
                except Exception as exc:
                    log(f"apply armature skipped: {exc}")
        # Clear vertex groups — Mixamo re-skins from scratch
        m.vertex_groups.clear()

    for a in arms:
        bpy.data.objects.remove(a, do_unlink=True)

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise RuntimeError("no mesh after import")
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    hero = bpy.context.view_layer.objects.active
    hero.name = "PhotonHero_ForMixamo"

    # Scale to 195 cm and snap feet
    mn, mx = world_bbox([hero])
    height = max((mx - mn).z, (mx - mn).y)
    scale = TARGET_HEIGHT_CM / height
    hero.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mn, mx = world_bbox([hero])
    hero.location -= Vector(((mn.x + mx.x) * 0.5, (mn.y + mx.y) * 0.5, mn.z))
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mn, mx = world_bbox([hero])

    # Mixamo-facing sanity
    size = mx - mn
    wider_than_tall = size.x > size.z
    log(f"height={size.z:.2f} width={size.x:.2f} depth={size.y:.2f} wider_than_tall={wider_than_tall}")
    if wider_than_tall:
        log("WARN character is wider than tall — Mixamo may reject; T-pose arms may dominate width.")

    bpy.ops.object.select_all(action="DESELECT")
    hero.select_set(True)
    bpy.context.view_layer.objects.active = hero
    bpy.ops.export_scene.fbx(
        filepath=str(OUT_FBX),
        use_selection=True,
        apply_scale_options="FBX_SCALE_UNITS",
        bake_space_transform=True,
        object_types={"MESH"},
        use_mesh_modifiers=True,
        add_leaf_bones=False,
        path_mode="COPY",
        embed_textures=True,
        armature_nodetype="NULL",
    )
    report = {
        "source": str(SRC),
        "out": str(OUT_FBX),
        "height_cm": round(size.z, 2),
        "width_cm": round(size.x, 2),
        "tris": sum(len(p.vertices) - 2 for p in hero.data.polygons),
        "wider_than_tall": wider_than_tall,
        "mixamo_steps": [
            "Go to https://www.mixamo.com and sign in with Adobe",
            "Click Upload Character",
            f"Upload {OUT_FBX.name}",
            "Place markers (chin, wrists, elbows, knees, groin) if prompted",
            "Next → Auto-Rig",
            "Download → Format: FBX for Unreal (or FBX), Skin: With Skin, Pose: T-pose",
            "Send the downloaded FBX path back for Blender validation",
        ],
    }
    (OUT_DIR / "photon_hero_mixamo_prep.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    log(f"wrote {OUT_FBX}")
    log("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
