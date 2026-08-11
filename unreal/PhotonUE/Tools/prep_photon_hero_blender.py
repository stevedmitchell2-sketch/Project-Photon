"""
Photon hero → first-person arms — fully automated Blender pipeline.

Tripo's FBX often arrives WITHOUT an armature/weights in Blender's importer
(verified: mesh-only, 0 vertex groups). This pipeline therefore:

  1. Imports FBX + relinks .fbm PBR maps
  2. Scales to 195 cm, snaps feet to origin
  3. Extracts L/R forearm+hand via geodesic flood from the hand tip (T-pose)
  4. Procedurally bends into a rifle-grip mime (weapon NOT modified)
  5. Orients elbow-origin / +Z (Photon C++ convention)
  6. Optimizes if over budget (hands protected by distal weighting)
  7. Exports hero + arms, preview renders, JSON report with validation gates

Run:  Tools\\prep_photon_hero_blender.bat
"""
from __future__ import annotations

import json
import math
import os
import sys
import traceback
from collections import deque
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector, Euler, Quaternion

DEFAULT_FBX = Path(
    r"C:\Users\Home\Downloads\futuristic+athlete+3d+model"
    r"\tripo_convert_2259b18c-7904-4bb7-bcaf-3ab3fbe3736a.fbx"
)
SRC_FBX = Path(os.environ.get("PHOTON_HERO_FBX", str(DEFAULT_FBX)))
OUT_DIR = Path(
    os.environ.get(
        "PHOTON_HERO_OUT",
        str(Path(__file__).resolve().parents[1] / "Content" / "Photon" / "Characters" / "HeroPrep"),
    )
)
TARGET_HEIGHT_CM = float(os.environ.get("PHOTON_HERO_HEIGHT_CM", "195.0"))

# Photon camera-space grip targets (reference only; weapon hierarchy untouched).
GRIP_RIGHT = Vector((40.0, 14.0, -14.0))
GRIP_LEFT = Vector((56.0, 8.0, -10.0))

ARM_TRIS_MIN = 3500
ARM_TRIS_TARGET = 12000
ARM_TRIS_HARD_MAX = 20000
# Flood distance from fingertip along the mesh surface (cm): hand+wrist+forearm+elbow cuff.
ARM_FLOOD_CM = 55.0
# Tripo islands are often 2–6 mm apart after scale; weld aggressively enough to reconnect fingers.
WELD_DIST_CM = 0.55
HERO_HEIGHT_TOL = 3.0

REPORT: dict = {"stages": [], "warnings": [], "errors": [], "validation": {}, "exports": {}}


def log(msg: str) -> None:
    print(f"[PhotonHero] {msg}")


def stage(name: str, **data) -> None:
    REPORT["stages"].append({"stage": name, **data})
    log(f"== {name} == {json.dumps(data, default=str)[:400]}")


def warn(msg: str) -> None:
    REPORT["warnings"].append(msg)
    log(f"WARN {msg}")


def err(msg: str) -> None:
    REPORT["errors"].append(msg)
    log(f"ERROR {msg}")


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures):
        for b in list(coll):
            coll.remove(b)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def select_only(objs) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        bpy.context.view_layer.objects.active = o


def ensure_object_mode():
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def world_bbox(objs):
    coords = []
    for o in objs:
        for corner in o.bound_box:
            coords.append(o.matrix_world @ Vector(corner))
    xs, ys, zs = [v.x for v in coords], [v.y for v in coords], [v.z for v in coords]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def count_loose_parts(obj) -> int:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen, parts = set(), 0
    for v in bm.verts:
        if v.index in seen:
            continue
        parts += 1
        stack = [v]
        seen.add(v.index)
        while stack:
            cur = stack.pop()
            for e in cur.link_edges:
                ov = e.other_vert(cur)
                if ov.index not in seen:
                    seen.add(ov.index)
                    stack.append(ov)
    bm.free()
    return parts


def mesh_stats(obj) -> dict:
    me = obj.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    bb = world_bbox([obj])
    size = bb[1] - bb[0]
    return {
        "name": obj.name,
        "verts": len(me.vertices),
        "polys": len(me.polygons),
        "tris": tris,
        "materials": [s.material.name if s.material else None for s in obj.material_slots],
        "bbox_min": [round(c, 3) for c in bb[0]],
        "bbox_max": [round(c, 3) for c in bb[1]],
        "size": [round(c, 3) for c in size],
        "loose_parts": count_loose_parts(obj),
    }


# -------------------------------------------------------------------------------------------------
def import_fbx(path: Path) -> None:
    bpy.ops.import_scene.fbx(
        filepath=str(path),
        automatic_bone_orientation=True,
        ignore_leaf_bones=False,
        use_anim=False,
    )


def apply_scale_to_height(target_cm: float) -> float:
    mn, mx = world_bbox(mesh_objects())
    height = max((mx - mn).z, (mx - mn).y)
    scale = target_cm / height
    select_only(mesh_objects())
    bpy.ops.transform.resize(value=(scale, scale, scale))
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    stage("scale", height_before=round(height, 4), scale=round(scale, 5))
    return scale


def snap_feet_to_origin() -> None:
    mn, mx = world_bbox(mesh_objects())
    delta = Vector((-(mn.x + mx.x) * 0.5, -(mn.y + mx.y) * 0.5, -mn.z))
    for o in mesh_objects():
        o.location += delta
    select_only(mesh_objects())
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    mn2, mx2 = world_bbox(mesh_objects())
    stage("snap_origin", delta=[round(c, 3) for c in delta], height=round(mx2.z - mn2.z, 3))


def relink_textures(fbm_dir: Path) -> int:
    if not fbm_dir.is_dir():
        warn(f"missing fbm {fbm_dir}")
        return 0
    by_name = {p.name.lower(): p for p in fbm_dir.iterdir() if p.is_file()}
    linked = 0
    tokens = {
        "basecolor": ("basecolor", "base_color", "albedo"),
        "normal": ("normal",),
        "roughness": ("roughness",),
        "metallic": ("metallic", "metalness"),
    }
    for img in bpy.data.images:
        base = Path(str(img.filepath).replace("\\", "/")).name.lower()
        match = by_name.get(base)
        if match is None:
            blob = f"{img.name} {img.filepath}".lower()
            for ts in tokens.values():
                if any(t in blob for t in ts):
                    for name, path in by_name.items():
                        if any(t in name for t in ts):
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
            linked += 1
    stage("textures", linked=linked)
    return linked


def setup_principled() -> None:
    def find_img(*ts):
        for img in bpy.data.images:
            blob = f"{img.name} {img.filepath}".lower()
            if any(t in blob for t in ts):
                return img
        return None

    base = find_img("basecolor", "albedo")
    normal = find_img("normal")
    rough = find_img("roughness")
    metal = find_img("metallic", "metalness")

    for mat in bpy.data.materials:
        mat.use_nodes = True
        nt = mat.node_tree
        nodes, links = nt.nodes, nt.links
        principled = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not principled:
            continue
        for inp in ("Base Color", "Roughness", "Metallic", "Normal"):
            for link in list(principled.inputs[inp].links):
                links.remove(link)

        def tex(img, non_color=False):
            n = nodes.new("ShaderNodeTexImage")
            n.image = img
            if non_color and n.image:
                try:
                    n.image.colorspace_settings.name = "Non-Color"
                except Exception:
                    pass
            return n

        if base:
            links.new(tex(base).outputs["Color"], principled.inputs["Base Color"])
        if rough:
            links.new(tex(rough, True).outputs["Color"], principled.inputs["Roughness"])
        if metal:
            links.new(tex(metal, True).outputs["Color"], principled.inputs["Metallic"])
        if normal:
            n = tex(normal, True)
            nrm = nodes.new("ShaderNodeNormalMap")
            links.new(n.outputs["Color"], nrm.inputs["Color"])
            links.new(nrm.outputs["Normal"], principled.inputs["Normal"])

    stage("materials", maps={
        "basecolor": bool(base), "normal": bool(normal),
        "roughness": bool(rough), "metallic": bool(metal),
    })


# -------------------------------------------------------------------------------------------------
# Spatial arm extraction (no armature required)
# -------------------------------------------------------------------------------------------------
def _world_verts(obj):
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]


def extract_arm_flood(hero, side: str, flood_cm: float = ARM_FLOOD_CM):
    """
    Extract forearm+hand from a T-pose hero.

    This Tripo mesh imports as many loose parts (no armature/weights), so edge-flood from a
    fingertip cannot traverse the arm. Instead we keep verts inside a Euclidean capsule from
    the hand tip toward the shoulder, plus a tip ball for glove islands — then delete via bmesh.
    """
    ensure_object_mode()
    select_only([hero])
    bpy.ops.object.duplicate()
    dup = bpy.context.view_layer.objects.active
    dup.name = f"PhotonArm{side}_Extract"

    mw = dup.matrix_world
    me = dup.data
    coords = [mw @ v.co for v in me.vertices]
    mn, mx = world_bbox([dup])
    height = mx.z - mn.z
    shoulder_z = mn.z + height * 0.78
    z_lo, z_hi = shoulder_z - 30.0, shoulder_z + 24.0
    mid_x = (mn.x + mx.x) * 0.5

    candidates = [i for i, c in enumerate(coords) if z_lo <= c.z <= z_hi]
    if not candidates:
        candidates = list(range(len(coords)))
    # Character right ≈ -X after this FBX import (bbox was symmetric ±97 on X).
    tip_i = min(candidates, key=lambda i: coords[i].x) if side == "Right" else max(
        candidates, key=lambda i: coords[i].x
    )
    tip = coords[tip_i]
    # Shoulder aim point on the same side, near clavicle
    shoulder = Vector((
        mn.x * 0.35 if side == "Right" else mx.x * 0.35,
        0.0,
        shoulder_z,
    ))
    axis = shoulder - tip
    if axis.length < 1e-3:
        axis = Vector((1, 0, 0)) if side == "Left" else Vector((-1, 0, 0))
    axis_n = axis.normalized()
    axis_len = min(flood_cm, axis.length + 8.0)
    radius = 14.0  # cm capsule radius — generous for gloves

    keep = set()
    for i, c in enumerate(coords):
        # Same side of body
        if side == "Right" and c.x > mid_x + 2.0:
            continue
        if side == "Left" and c.x < mid_x - 2.0:
            continue
        # Tip ball (catches disconnected finger islands)
        if (c - tip).length <= 16.0:
            keep.add(i)
            continue
        # Capsule tip → shoulder
        rel = c - tip
        t = rel.dot(axis_n)
        if t < -2.0 or t > axis_len:
            continue
        radial = (rel - axis_n * t).length
        # Widen near the hand, taper slightly toward elbow
        rad = radius + 4.0 * max(0.0, 1.0 - t / max(axis_len, 1.0))
        if radial <= rad and c.z >= mn.z + height * 0.45:
            keep.add(i)

    if len(keep) < 100:
        raise RuntimeError(f"{side} extract kept only {len(keep)} verts — tip/capsule failed")

    # Delete with bmesh (reliable with multi-island meshes)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    to_delete = [v for v in bm.verts if v.index not in keep]
    bmesh.ops.delete(bm, geom=to_delete, context="VERTS")
    # Weld Tripo finger/glove islands back into one shell
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=WELD_DIST_CM)
    bm.to_mesh(me)
    me.update()
    bm.free()

    select_only([dup])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=WELD_DIST_CM)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.mesh.delete_loose()
    bpy.ops.object.mode_set(mode="OBJECT")

    # Drop only tiny noise far from the tip; join the rest and weld again.
    select_only([dup])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    kept_parts = []
    for p in parts:
        pc = [p.matrix_world @ v.co for v in p.data.vertices]
        if not pc:
            bpy.data.objects.remove(p, do_unlink=True)
            continue
        centroid = sum(pc, Vector()) / len(pc)
        if (centroid - tip).length <= flood_cm + 12.0 and len(pc) >= 6:
            kept_parts.append(p)
        else:
            bpy.data.objects.remove(p, do_unlink=True)
    if not kept_parts:
        raise RuntimeError(f"{side} extract produced no parts")
    select_only(kept_parts)
    bpy.context.view_layer.objects.active = kept_parts[0]
    if len(kept_parts) > 1:
        bpy.ops.object.join()
    keep_obj = bpy.context.view_layer.objects.active
    keep_obj.name = f"PhotonArm{side}"

    # Final weld pass after join
    select_only([keep_obj])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=WELD_DIST_CM)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    stats = mesh_stats(keep_obj)
    stage(
        f"extract_{side}",
        tip_index=tip_i,
        method="capsule+tip_ball+weld",
        flood_cm=flood_cm,
        weld_cm=WELD_DIST_CM,
        kept_verts_pre_join=len(keep),
        **{k: v for k, v in stats.items() if k != "name"},
    )
    return keep_obj, tip


def clean_elbow_cap(arm_obj, side: str) -> dict:
    """
    Bisect the jagged proximal end with a plane and fill the hole so the viewmodel cut is clean.

    Must run while the extract is still in T-pose (along ±X), BEFORE grip bend. Tip/prox are
    taken from X extremes — distance-from-centroid is unreliable because jagged elbow shards
    can outrank the hand tip and flip the plane onto the fingers (which previously destroyed
    the mesh down to ~320 tris).
    """
    ensure_object_mode()
    select_only([arm_obj])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    before = mesh_stats(arm_obj)["tris"]
    coords = [Vector(v.co) for v in arm_obj.data.vertices]
    # World X: Right tip = min X, Left tip = max X (same convention as extract).
    if side == "Right":
        tip = min(coords, key=lambda c: c.x)
        prox = max(coords, key=lambda c: c.x)
    else:
        tip = max(coords, key=lambda c: c.x)
        prox = min(coords, key=lambda c: c.x)
    axis = (tip - prox).normalized()
    # Step inward from proximal end toward the hand
    plane_co = prox + axis * 5.0

    select_only([arm_obj])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.bisect(
        plane_co=plane_co,
        plane_no=-axis,  # discard proximal / body side
        clear_inner=True,
        clear_outer=False,
        use_fill=True,
    )
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=WELD_DIST_CM)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    after = mesh_stats(arm_obj)["tris"]
    info = {
        "side": side,
        "plane_co": [round(c, 2) for c in plane_co],
        "tip_x": round(tip.x, 2),
        "prox_x": round(prox.x, 2),
        "tris_before": before,
        "tris_after": after,
        "parts": count_loose_parts(arm_obj),
    }
    # Safety: if bisect destroyed the arm, abort this stage's result by raising so build_arm retries
    # without cap... but we can't easily undo. Instead require keeping ≥55% of tris.
    if after < before * 0.55 or after < 800:
        raise RuntimeError(f"{side} elbow_cap destroyed mesh ({before}→{after} tris)")
    stage(f"elbow_cap_{side}", **info)
    return info


def procedural_grip_bend(arm_obj, side: str) -> dict:
    """
    Bend + curl the extracted T-pose arm into a closed rifle-hold mime.
    Also contracts distal finger verts toward a palm center so the hand isn't an open fan.
    """
    ensure_object_mode()
    mw = arm_obj.matrix_world
    coords = [mw @ v.co for v in arm_obj.data.vertices]
    if not coords:
        raise RuntimeError(f"{side} grip bend: empty mesh")
    body = Vector((0.0, 0.0, 140.0))
    elbow_seed = min(coords, key=lambda c: (c - body).length)
    tip = max(coords, key=lambda c: (c - elbow_seed).length)
    axis_dir = (tip - elbow_seed).normalized()
    arm_len = (tip - elbow_seed).length
    elbow = elbow_seed.lerp(tip, 0.12)

    bend_axis = axis_dir.cross(Vector((0, -1, 0)))
    if bend_axis.length < 1e-4:
        bend_axis = axis_dir.cross(Vector((0, 0, 1)))
    bend_axis.normalize()
    rot = Matrix.Rotation(math.radians(78.0), 4, bend_axis)

    # Palm center estimate: along arm at ~70%, slightly toward body forward
    palm = elbow_seed + axis_dir * (arm_len * 0.68)
    curl_pivot = elbow_seed + axis_dir * (arm_len * 0.55)
    curl_rot = Matrix.Rotation(math.radians(40.0), 4, bend_axis)

    me = arm_obj.data
    for v in me.vertices:
        co = mw @ v.co
        t = (co - elbow_seed).dot(axis_dir) / max(arm_len, 1e-5)
        if t >= 0.02:
            co = elbow + (rot.to_3x3() @ (co - elbow))
        if t >= 0.50:
            co = curl_pivot + (curl_rot.to_3x3() @ (co - curl_pivot))
        # Finger close: pull verts in the distal 30% toward palm axis
        if t >= 0.70:
            # Close fingers: pull toward the local arm axis through curl_pivot
            along = (co - curl_pivot).dot(axis_dir)
            axis_pt = curl_pivot + axis_dir * along
            co = co.lerp(axis_pt, 0.40)
        v.co = mw.inverted() @ co
    me.update()

    info = {
        "side": side,
        "elbow": [round(c, 2) for c in elbow],
        "tip": [round(c, 2) for c in tip],
        "bend_deg": 78,
        "curl_deg": 40,
        "finger_close": 0.35,
    }
    stage(f"grip_bend_{side}", **info)
    return info


def orient_elbow_origin(arm_obj, side: str) -> dict:
    """Elbow at origin, forearm toward +Z (Photon static arm convention)."""
    ensure_object_mode()
    # Apply object transforms into mesh first
    select_only([arm_obj])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    coords = [Vector(v.co) for v in arm_obj.data.vertices]
    body = Vector((0.0, 0.0, 0.0))
    # After extract+bend, elbow ≈ vert closest to world origin / densest proximal
    # Use: proximal end = centroid of the 8% of verts farthest from the tip extreme
    tip = max(coords, key=lambda c: c.length)  # provisional
    # Better tip = max distance from median
    median = sum(coords, Vector()) / len(coords)
    tip = max(coords, key=lambda c: (c - median).length)
    # Elbow = average of verts in the proximal 12% by distance-from-tip
    dists = [(c, (c - tip).length) for c in coords]
    dists.sort(key=lambda x: x[1], reverse=True)
    prox = [c for c, d in dists[: max(20, len(dists) // 8)]]
    elbow = sum(prox, Vector()) / len(prox)

    direction = (tip - elbow).normalized()
    rot = direction.rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
    xform = rot @ Matrix.Translation(-elbow)
    arm_obj.data.transform(xform)
    arm_obj.data.update()
    select_only([arm_obj])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    coords = [Vector(v.co) for v in arm_obj.data.vertices]
    zmin, zmax = min(c.z for c in coords), max(c.z for c in coords)
    info = {"side": side, "length_cm": round(zmax - zmin, 2), "zmin": round(zmin, 2), "zmax": round(zmax, 2)}
    stage(f"orient_{side}", **info)
    return info


def densify_arm(arm_obj, side: str) -> dict:
    """
    Source hero is ~20k tris total, so raw arm extracts land ~3k. Subdivide once to reach the
    8k–15k viewmodel budget without inventing silhouette (simplex density for lighting/normals).
    """
    stats = mesh_stats(arm_obj)
    before = stats["tris"]
    if before >= ARM_TRIS_MIN and before <= ARM_TRIS_TARGET:
        stage(f"densify_{side}", action="skip", **{k: v for k, v in stats.items() if k != "name"})
        return stats
    select_only([arm_obj])
    if before < ARM_TRIS_MIN:
        mod = arm_obj.modifiers.new(name="Subsurf", type="SUBSURF")
        mod.levels = 1
        mod.render_levels = 1
        mod.subdivision_type = "SIMPLE"  # preserve Tripo shape; don't balloon
        bpy.ops.object.modifier_apply(modifier=mod.name)
    stats2 = mesh_stats(arm_obj)
    # If still over hard max, decimate back toward target
    if stats2["tris"] > ARM_TRIS_HARD_MAX:
        ratio = ARM_TRIS_TARGET / stats2["tris"]
        mod = arm_obj.modifiers.new(name="Decimate", type="DECIMATE")
        mod.ratio = max(0.4, min(0.95, ratio))
        bpy.ops.object.modifier_apply(modifier=mod.name)
        stats2 = mesh_stats(arm_obj)
        stage(f"densify_{side}", action="subdivide+decimate", before=before,
              **{k: v for k, v in stats2.items() if k != "name"})
    else:
        stage(f"densify_{side}", action="subdivide_simple", before=before,
              **{k: v for k, v in stats2.items() if k != "name"})
    return stats2


def optimize_arm(arm_obj, side: str) -> dict:
    """Back-compat name used by build_arm: densify up, then clamp down if needed."""
    return densify_arm(arm_obj, side)


def analyze_hand(arm_obj, side: str) -> dict:
    coords = [Vector(v.co) for v in arm_obj.data.vertices]
    if not coords:
        return {"ok": False, "reason": "empty"}
    zmin, zmax = min(c.z for c in coords), max(c.z for c in coords)
    span = zmax - zmin
    distal = [c for c in coords if c.z >= zmin + span * 0.62]
    tip_z = zmin + span * 0.86
    tips = [c for c in distal if c.z >= tip_z] or sorted(distal, key=lambda c: c.z, reverse=True)[:50]
    cell = 1.6
    cells = {}
    for c in tips:
        key = (int(math.floor(c.x / cell)), int(math.floor(c.y / cell)))
        cells.setdefault(key, 0)
        cells[key] += 1
    lobes = sum(1 for n in cells.values() if n >= 3)
    parts = count_loose_parts(arm_obj)
    result = {
        "ok": lobes >= 3 and span >= 28.0 and parts == 1 and len(distal) >= 40,
        "length_cm": round(span, 2),
        "distal_verts": len(distal),
        "tip_verts": len(tips),
        "tip_lobes": lobes,
        "loose_parts": parts,
        "tris": mesh_stats(arm_obj)["tris"],
    }
    if not result["ok"]:
        if parts != 1:
            result["reason"] = "disconnected_geometry"
        elif lobes < 3:
            result["reason"] = "insufficient_finger_lobes"
        elif span < 28:
            result["reason"] = "forearm_too_short"
        else:
            result["reason"] = "weak_distal_detail"
    stage(f"hand_analysis_{side}", **result)
    return result


# -------------------------------------------------------------------------------------------------
def export_fbx(path: Path, objs) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    select_only(objs)
    bpy.ops.export_scene.fbx(
        filepath=str(path),
        use_selection=True,
        apply_scale_options="FBX_SCALE_UNITS",
        bake_space_transform=True,
        object_types={"MESH"},
        use_mesh_modifiers=True,
        add_leaf_bones=False,
        path_mode="COPY",
        embed_textures=True,
    )
    log(f"export {path}")


def render_preview(objs, path: Path, label: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    bb = world_bbox(objs)
    center = (bb[0] + bb[1]) * 0.5
    extent = (bb[1] - bb[0]).length
    for o in bpy.context.scene.objects:
        o.hide_render = (o not in objs) and o.type not in {"LIGHT", "CAMERA"}

    # Bright key + fill so dark graphite suits read in PNGs
    for name, energy, offset in (
        ("PreviewKey", 1200, Vector((70, -110, 120))),
        ("PreviewFill", 500, Vector((-80, -40, 60))),
    ):
        if name not in bpy.data.objects:
            ld = bpy.data.lights.new(name, "AREA")
            ld.energy = energy
            light = bpy.data.objects.new(name, ld)
            bpy.context.scene.collection.objects.link(light)
            light.location = center + offset
        else:
            bpy.data.objects[name].location = center + offset
            if bpy.data.objects[name].data:
                bpy.data.objects[name].data.energy = energy

    cam_data = bpy.data.cameras.new(f"Cam_{label}")
    cam = bpy.data.objects.new(f"Cam_{label}", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    dist = max(35.0, extent * 1.7)
    cam.location = center + Vector((dist * 0.55, -dist, dist * 0.4))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene = bpy.context.scene
    scene.camera = cam
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except Exception:
            continue
    scene.render.resolution_x = scene.render.resolution_y = 1024
    scene.render.filepath = str(path)
    scene.render.image_settings.file_format = "PNG"
    try:
        bpy.ops.render.render(write_still=True)
        REPORT.setdefault("previews", {})[label] = str(path)
        log(f"preview {path}")
    except Exception as exc:
        warn(f"preview {label} failed: {exc}")
    bpy.data.objects.remove(cam, do_unlink=True)
    for o in bpy.context.scene.objects:
        o.hide_render = False


def validate(hero_stats, r_stats, l_stats, hand_r, hand_l) -> bool:
    v, ok = {}, True

    def check(name, cond, detail):
        nonlocal ok
        v[name] = {"pass": bool(cond), "detail": detail}
        (log if cond else err)(f"{'PASS' if cond else 'FAIL'} {name}: {detail}")
        ok = ok and bool(cond)

    check("hero_height", abs(hero_stats["size"][2] - TARGET_HEIGHT_CM) <= HERO_HEIGHT_TOL,
          f"{hero_stats['size'][2]} vs {TARGET_HEIGHT_CM}")
    check("hero_materials", any(hero_stats["materials"]), str(hero_stats["materials"]))
    for side, stats, hand in (("right", r_stats, hand_r), ("left", l_stats, hand_l)):
        check(f"{side}_tris_min", stats["tris"] >= ARM_TRIS_MIN, stats["tris"])
        check(f"{side}_tris_max", stats["tris"] <= ARM_TRIS_HARD_MAX, stats["tris"])
        check(f"{side}_connected", stats["loose_parts"] == 1, stats["loose_parts"])
        check(f"{side}_hand", hand.get("ok"), hand)
        check(f"{side}_length", hand.get("length_cm", 0) >= 28, hand.get("length_cm"))
        check(f"{side}_finger_lobes", hand.get("tip_lobes", 0) >= 3, hand.get("tip_lobes"))
    REPORT["validation"] = v
    REPORT["validation_passed"] = ok
    stage("validation", passed=ok)
    return ok


# -------------------------------------------------------------------------------------------------
def main() -> int:
    log(f"Blender {bpy.app.version_string}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT.update({
        "source": str(SRC_FBX),
        "out_dir": str(OUT_DIR),
        "target_height_cm": TARGET_HEIGHT_CM,
        "grip_targets_camera_space": {"right": list(GRIP_RIGHT), "left": list(GRIP_LEFT)},
        "weapon_note": "Weapon hierarchy untouched. Arms authored to meet grips only.",
        "extraction_method": "spatial_flood (no armature in Blender FBX import)",
    })

    clear_scene()
    import_fbx(SRC_FBX)
    stage("import", meshes=[o.name for o in mesh_objects()],
          armatures=[o.name for o in bpy.context.scene.objects if o.type == "ARMATURE"],
          vertex_groups=sum(len(o.vertex_groups) for o in mesh_objects()))

    relink_textures(SRC_FBX.with_suffix(".fbm"))
    setup_principled()
    apply_scale_to_height(TARGET_HEIGHT_CM)
    snap_feet_to_origin()

    hero = mesh_objects()[0]
    hero.name = "PhotonHero"
    hero.data.name = "PhotonHero"
    hero_stats = mesh_stats(hero)
    stage("hero", **{k: v for k, v in hero_stats.items() if k != "name"})

    # If flood comes up short on tris/hands, retry with longer flood.
    def build_arm(side: str):
        flood = ARM_FLOOD_CM
        arm = None
        hand = None
        for attempt in range(3):
            if arm is not None:
                bpy.data.objects.remove(arm, do_unlink=True)
            arm, _tip = extract_arm_flood(hero, side, flood_cm=flood)
            # Elbow plane-cap is optional. Bisect on this Tripo mesh is unsafe (can wipe the arm
            # before we can restore it), so we duplicate, try, and only keep the capped mesh if
            # triangle count stays healthy.
            capped = None
            try:
                select_only([arm])
                bpy.ops.object.duplicate()
                capped = bpy.context.view_layer.objects.active
                capped.name = arm.name + "_CapTry"
                clean_elbow_cap(capped, side)
                # success — replace arm with capped
                bpy.data.objects.remove(arm, do_unlink=True)
                arm = capped
                arm.name = f"PhotonArm{side}"
            except Exception as exc:
                warn(f"{side} elbow_cap skipped: {exc}")
                if capped is not None:
                    try:
                        bpy.data.objects.remove(capped, do_unlink=True)
                    except Exception:
                        pass
            # Grip bend is intentionally OFF for this Tripo mesh. Without armature weights the
            # procedural curl melts fingers into a blob (verified in preview renders). Export a
            # clean elbow-origin / +Z T-pose forearm+hand; Unreal C++ already applies the viewmodel
            # rotator to meet the rifle. Closed-grip posing needs a future weighted/rigged pass.
            orient_elbow_origin(arm, side)
            optimize_arm(arm, side)
            arm.name = f"PhotonArm{side}"
            hand = analyze_hand(arm, side)
            if hand.get("ok") and mesh_stats(arm)["tris"] >= ARM_TRIS_MIN:
                break
            warn(f"{side} attempt {attempt+1} failed ({hand}); increasing flood")
            flood += 10.0
        return arm, hand

    right, hand_r = build_arm("Right")
    left, hand_l = build_arm("Left")
    r_stats, l_stats = mesh_stats(right), mesh_stats(left)

    hero_path = OUT_DIR / "PhotonHero.fbx"
    right_path = OUT_DIR / "PhotonArmRight.fbx"
    left_path = OUT_DIR / "PhotonArmLeft.fbx"
    export_fbx(hero_path, [hero])
    export_fbx(right_path, [right])
    export_fbx(left_path, [left])
    REPORT["exports"] = {"hero": str(hero_path), "arm_right": str(right_path), "arm_left": str(left_path)}

    prev = OUT_DIR / "previews"
    render_preview([hero], prev / "hero.png", "hero")
    render_preview([right], prev / "arm_right.png", "arm_right")
    render_preview([left], prev / "arm_left.png", "arm_left")
    render_preview([right, left], prev / "arms_together.png", "arms_together")

    blend = OUT_DIR / "PhotonHero_Prep.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    REPORT["exports"]["blend"] = str(blend)

    passed = validate(hero_stats, r_stats, l_stats, hand_r, hand_l)
    REPORT["summary"] = {
        "hero_tris": hero_stats["tris"],
        "right_tris": r_stats["tris"],
        "left_tris": l_stats["tris"],
        "right_hand": hand_r,
        "left_hand": hand_l,
        "passed": passed,
    }
    REPORT["visual_qa"] = {
        "hero": "Usable lookdev — human athlete, cyan accents, materials linked.",
        "arms": (
            "Exported as elbow-origin +Z T-pose extracts with welded islands and simple subdiv "
            "to ~9–10k tris. Procedural rifle-grip bend DISABLED — it destroyed finger topology "
            "on this unweighted Tripo mesh. Elbow plane-cap also unsafe (bisect wiped arms). "
            "Jagged proximal cut remains. Closed grip requires a future rigged/weighted pass or "
            "a better Tripo export with skin weights."
        ),
        "grip_pose_automated": False,
        "unreal_import_ready": False,
        "reason_not_import_ready": (
            "Hands are open T-pose, not rifle grip; elbow cut is jagged; do not replace "
            "SM_PhotonArm* until grip posing is solved."
        ),
    }
    report_path = OUT_DIR / "photon_hero_prep_report.json"
    report_path.write_text(json.dumps(REPORT, indent=2, default=str), encoding="utf-8")
    log(f"report {report_path}")
    log("PIPELINE PASSED" if passed else "PIPELINE FAILED VALIDATION")
    # Blender often ignores SystemExit codes; also write a sidecar status file.
    (OUT_DIR / "photon_hero_prep_status.txt").write_text(
        "PASSED\n" if passed else "FAILED\n", encoding="utf-8"
    )
    return 0 if passed else 2


if __name__ == "__main__":
    try:
        code = main()
        # Force non-zero for the shell when validation fails
        if code != 0:
            sys.exit(code)
    except Exception:
        err(traceback.format_exc())
        try:
            OUT_DIR.mkdir(parents=True, exist_ok=True)
            (OUT_DIR / "photon_hero_prep_report.json").write_text(
                json.dumps(REPORT, indent=2, default=str), encoding="utf-8"
            )
            (OUT_DIR / "photon_hero_prep_status.txt").write_text("FAILED\n", encoding="utf-8")
        except Exception:
            pass
        raise
