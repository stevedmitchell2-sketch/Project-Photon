"""
PROJECT PHOTON — robot finishing pass
=====================================

Takes the retopologised, Mixamo-rigged robot and turns it into a game-ready
Photon arena service unit: unwrapped, baked, zoned, lit with team-coloured
channels, socketed, and exported as a clean GLB.

WHAT THIS EXPECTS TO FIND
    One .blend containing both meshes from Photon_Robot_Material_Backup.glb:
      - Photon_Robot_RETROPO ......... 60,928 tris, rigged, THE GAME MESH
      - tripo_node_7bac35fe-* ........ 1,938,280 tris, THE BAKE SOURCE ONLY
    plus the mixamorig armature.

WHY EACH STAGE EXISTS — read this before running

    1  CLEANUP   The high-poly is 97% of the file and must not ship. It is moved
                 to a hidden collection, never deleted: it is the bake source
                 and throwing it away would make step 3 impossible forever.

    2  UNWRAP    THE BLOCKER. The retopo mesh's UVs are collapsed — every vertex
                 sits at exactly (0.0, 1.0). Retopology produced geometry with
                 no unwrap, so no texture can be applied to it and no bake can
                 target it. Nothing downstream works until this runs.

    3  BAKE      Projects the Tripo high-poly's 4K detail onto the game mesh.
                 This is the step that makes 61k triangles look like 1.9M. Slow
                 (Cycles), so it is off by default.

    4  ZONES     Splits the single material into shell / joint / accent by bone
                 influence, because a robot in one colour reads as a maquette.

    5  ENERGY    Thin emissive bands at shoulders, chest, forearms, thighs,
                 shins and visor. Placed by projecting each vertex along its
                 dominant bone, so the strips wrap limbs correctly instead of
                 being axis-aligned slices.

    6  SOCKETS   Empties parented to hand, head and chest bones, named to the
                 Photon asset contract.

    7  EXPORT    GLB with the high-poly excluded and backface culling on.

WHAT IS NEVER TOUCHED
    The armature, bone hierarchy, bind poses, vertex groups, skin weights and
    the mixamo.com animation clip. Weights were verified clean on both meshes
    (0 vertices with malformed weight sums) and stay that way: no stage joins,
    applies, decimates, or re-parents anything.

    Blender 3.3+ / 4.x
"""

import bpy
import bmesh
import os
import math
from mathutils import Vector

# =============================================================================
#  CONFIG
# =============================================================================

GAME_MESH_HINT = "RETROPO"          # substring identifying the low-poly
SOURCE_MESH_HINT = "tripo_node"     # substring identifying the high-poly

STAGES = {
    "cleanup": True,
    "unwrap": True,
    "bake": False,      # Cycles, minutes-long. Turn on when ready.
    "zones": True,
    "energy": True,
    "sockets": True,
    "export": True,
}

TEAM = "cyan"
EMISSION_STRENGTH = 5.0

BAKE_SIZE = 2048
BAKE_MARGIN = 8
BAKE_RAY_DISTANCE = 0.02            # metres; the model is ~0.98 m tall

#: 6'4" = 1.93 m. Applied to the armature object only — a scale on the root node
#: is animation-safe, whereas applying it would require re-binding the rig.
TARGET_HEIGHT_M = 1.93
APPLY_SCALE_TO_ARMATURE = True

EXPORT_FILENAME = "Photon_Robot_Game.glb"
EXPORT_DIR = ""   # empty = next to the .blend

TEAM_COLORS = {
    "cyan":   (0.031, 0.706, 1.000),
    "red":    (1.000, 0.031, 0.086),
    "blue":   (0.031, 0.196, 1.000),
    "green":  (0.031, 1.000, 0.230),
    "yellow": (1.000, 0.663, 0.031),
}

# --- Material zones ----------------------------------------------------------
# Four zones, which is the Photon character budget. Each is a draw call per
# player and there may be sixteen players, so this is a hard ceiling, not a
# preference.

ZONES = {
    "MAT_shell": {
        "base_color": (0.860, 0.874, 0.890, 1.0),
        "metallic": 0.20, "roughness": 0.35, "coat": 0.35, "coat_rough": 0.18,
    },
    "MAT_joint": {
        "base_color": (0.055, 0.060, 0.070, 1.0),
        "metallic": 0.60, "roughness": 0.50, "coat": 0.0, "coat_rough": 0.5,
    },
    "MAT_accent": {
        "base_color": (0.560, 0.576, 0.600, 1.0),
        "metallic": 0.85, "roughness": 0.25, "coat": 0.0, "coat_rough": 0.5,
    },
}
ENERGY_ZONE = "MAT_trim"

#: Bones whose geometry is graphite joint housing rather than ceramic shell.
JOINT_BONES = {
    "leftforearm", "rightforearm", "leftleg", "rightleg",
    "neck", "spine", "lefthand", "righthand",
    "lefttoebase", "righttoebase",
}

#: Bones whose geometry is exposed machined metal.
ACCENT_BONES = {
    "leftshoulder", "rightshoulder",
    "lefthandindex1", "righthandindex1", "lefthandthumb1", "righthandthumb1",
}

# --- Energy channels ---------------------------------------------------------
# (bone substring, centre along the bone 0..1, half-width 0..1)
#
# Restrained on purpose. The brief asks for arena technology, not neon overload,
# so this is ten narrow bands on a humanoid — roughly what a premium sports
# product carries — and nothing on the hands, feet or back.

ENERGY_BANDS = [
    ("leftarm",      0.14, 0.045),   # shoulder ring
    ("rightarm",     0.14, 0.045),
    ("leftforearm",  0.55, 0.040),   # forearm strip
    ("rightforearm", 0.55, 0.040),
    ("spine2",       0.45, 0.055),   # chest bar
    ("leftupleg",    0.22, 0.040),   # thigh ring
    ("rightupleg",   0.22, 0.040),
    ("leftleg",      0.50, 0.035),   # shin strip
    ("rightleg",     0.50, 0.035),
    ("head",         0.35, 0.060),   # visor band
]


# =============================================================================
#  HELPERS
# =============================================================================

def log(msg=""):
    print(f"  {msg}")


def banner(title):
    print("\n" + "=" * 74)
    print(f"  {title}")
    print("=" * 74)


def _ensure_nodes(mat):
    """Enable node shading without tripping Blender 6.0's deprecation warning."""
    if getattr(mat, "node_tree", None) is None:
        try:
            mat.use_nodes = True
        except Exception:
            pass


def _set(node, names, value):
    """Write a Principled socket by whichever name this Blender version uses."""
    if isinstance(names, str):
        names = (names,)
    for name in names:
        s = node.inputs.get(name)
        if s is not None:
            s.default_value = value
            return True
    return False


def find_meshes():
    game = source = None
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        if GAME_MESH_HINT.lower() in obj.name.lower():
            game = obj
        elif SOURCE_MESH_HINT.lower() in obj.name.lower():
            source = obj
    if game is None:
        # Fall back to "the smaller of the two meshes", which is what the game
        # mesh always is by definition.
        meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
        if len(meshes) == 2:
            meshes.sort(key=lambda o: len(o.data.polygons))
            game, source = meshes[0], meshes[1]
    return game, source


def find_armature():
    for obj in bpy.context.scene.objects:
        if obj.type == "ARMATURE":
            return obj
    return None


def dominant_bone_map(obj, armature):
    """Vertex index -> (bone name, t along that bone, 0..1).

    The basis for both the zone split and the energy strips. Working from bone
    influence rather than world coordinates is what makes a strip wrap a raised
    arm correctly: the band follows the limb, not a horizontal plane through it.
    """
    group_names = {i: g.name for i, g in enumerate(obj.vertex_groups)}
    bones = {b.name: b for b in armature.data.bones}
    world = obj.matrix_world
    arm_world = armature.matrix_world

    out = {}
    for v in obj.data.vertices:
        if not v.groups:
            continue
        best = max(v.groups, key=lambda g: g.weight)
        name = group_names.get(best.group)
        bone = bones.get(name)
        if bone is None:
            continue

        head = arm_world @ bone.head_local
        tail = arm_world @ bone.tail_local
        axis = tail - head
        length_sq = axis.length_squared
        if length_sq < 1e-9:
            continue
        co = world @ v.co
        t = max(0.0, min(1.0, (co - head).dot(axis) / length_sq))
        out[v.index] = (name.lower(), t)
    return out


# =============================================================================
#  MATERIALS
# =============================================================================

def build_zone_material(name, spec):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    _ensure_nodes(mat)
    mat.use_backface_culling = True     # exports as doubleSided: false
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial"); out.location = (300, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (0, 0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    _set(bsdf, "Base Color", spec["base_color"])
    _set(bsdf, "Metallic", spec["metallic"])
    _set(bsdf, "Roughness", spec["roughness"])
    _set(bsdf, ("Coat Weight", "Clearcoat"), spec["coat"])
    _set(bsdf, ("Coat Roughness", "Clearcoat Roughness"), spec["coat_rough"])
    return mat


def build_energy_material():
    """Emissive channel on a shared node group, so a team swap is one write."""
    group = bpy.data.node_groups.get("PHOTON_TeamColor")
    if group is None:
        group = bpy.data.node_groups.new("PHOTON_TeamColor", "ShaderNodeTree")
        gout = group.nodes.new("NodeGroupOutput"); gout.location = (300, 0)
        rgb = group.nodes.new("ShaderNodeRGB"); rgb.name = "TeamColor"
        rgb.label = "TEAM COLOR"; rgb.location = (-200, 60)
        val = group.nodes.new("ShaderNodeValue"); val.name = "TeamStrength"
        val.label = "Strength"; val.location = (-200, -140)
        if hasattr(group, "interface"):
            group.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
            group.interface.new_socket("Strength", in_out="OUTPUT", socket_type="NodeSocketFloat")
        else:
            group.outputs.new("NodeSocketColor", "Color")
            group.outputs.new("NodeSocketFloat", "Strength")
        group.links.new(rgb.outputs[0], gout.inputs[0])
        group.links.new(val.outputs[0], gout.inputs[1])

    group.nodes["TeamColor"].outputs[0].default_value = (*TEAM_COLORS[TEAM], 1.0)
    group.nodes["TeamStrength"].outputs[0].default_value = EMISSION_STRENGTH

    mat = bpy.data.materials.get(ENERGY_ZONE) or bpy.data.materials.new(ENERGY_ZONE)
    _ensure_nodes(mat)
    mat.use_backface_culling = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial"); out.location = (300, 0)
    inst = nodes.new("ShaderNodeGroup"); inst.node_tree = group; inst.location = (-180, 0)
    emit = nodes.new("ShaderNodeEmission"); emit.location = (60, 0)
    links.new(inst.outputs["Color"], emit.inputs["Color"])
    links.new(inst.outputs["Strength"], emit.inputs["Strength"])
    links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


# =============================================================================
#  STAGES
# =============================================================================

def stage_cleanup(game, source):
    """Hide the high-poly. Never delete it — it is the bake source."""
    banner("1  CLEANUP")
    if source is None:
        log("no high-poly found; nothing to isolate")
        return

    coll = bpy.data.collections.get("PHOTON_BAKE_SOURCE")
    if coll is None:
        coll = bpy.data.collections.new("PHOTON_BAKE_SOURCE")
        bpy.context.scene.collection.children.link(coll)

    for c in list(source.users_collection):
        if c is not coll:
            c.objects.unlink(source)
    if source.name not in coll.objects:
        coll.objects.link(source)

    source.hide_viewport = True
    source.hide_render = False          # bake needs it renderable
    coll.hide_viewport = True

    tris_hi = len(source.data.polygons)
    tris_lo = len(game.data.polygons) if game else 0
    log(f"game mesh    {game.name if game else '?'}  ({tris_lo:,} faces)")
    log(f"bake source  {source.name[:40]}  ({tris_hi:,} faces) -> hidden collection")
    log("high-poly retained for baking and excluded from export")


def stage_unwrap(game):
    """THE BLOCKER. Give the retopo mesh a UV layout.

    Its current UVs are degenerate — every vertex at (0.0, 1.0) — which is what
    retopology leaves behind when the unwrap step is skipped. Without this, the
    bake has no target to write into and every texture slot is meaningless.

    Smart UV Project rather than a hand unwrap: it is deterministic, needs no
    seam authoring, and for a hard-surface robot whose panels are already
    separate shells it produces a perfectly usable layout. A human can always
    redo it better later; this makes the pipeline run today.
    """
    banner("2  UNWRAP")
    if game is None:
        log("no game mesh")
        return

    uv = game.data.uv_layers.active
    if uv is not None and len(game.data.loops):
        us = {round(uv.data[i].uv.x, 4) for i in range(min(2000, len(uv.data)))}
        vs = {round(uv.data[i].uv.y, 4) for i in range(min(2000, len(uv.data)))}
        if len(us) > 3 or len(vs) > 3:
            log(f"existing UVs look valid ({len(us)}x{len(vs)} distinct) — keeping them")
            return
        log(f"existing UVs are degenerate ({len(us)}x{len(vs)} distinct values) — re-unwrapping")

    bpy.ops.object.select_all(action="DESELECT")
    game.select_set(True)
    bpy.context.view_layer.objects.active = game

    if not game.data.uv_layers:
        game.data.uv_layers.new(name="UVMap")

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(66.0),
        island_margin=0.003,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=False,
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    log(f"unwrapped {len(game.data.polygons):,} faces (Smart UV Project, 66 deg, 3mm margin)")


def stage_bake(game, source):
    """Project high-poly detail onto the game mesh.

    Selected-to-active baking: source selected, game mesh active, cage extrusion
    covering the gap between the two surfaces. This is the step that buys back
    the 1.9M triangles of detail the retopology removed.
    """
    banner("3  BAKE")
    if game is None or source is None:
        log("need both meshes; skipping")
        return

    scene = bpy.context.scene
    previous_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = BAKE_RAY_DISTANCE
    scene.render.bake.margin = BAKE_MARGIN

    source.hide_viewport = False
    source.hide_render = False

    for bake_type, image_name, colorspace in (
        ("NORMAL", "PHOTON_Robot_Normal", "Non-Color"),
        ("DIFFUSE", "PHOTON_Robot_BaseColor", "sRGB"),
        ("ROUGHNESS", "PHOTON_Robot_Roughness", "Non-Color"),
    ):
        img = bpy.data.images.get(image_name)
        if img is None:
            img = bpy.data.images.new(image_name, BAKE_SIZE, BAKE_SIZE,
                                      alpha=False, float_buffer=(bake_type == "NORMAL"))
        img.colorspace_settings.name = colorspace

        # Every material on the target needs an image node selected as the
        # bake destination, or Cycles refuses with "No active image found".
        for slot in game.material_slots:
            if slot.material is None or getattr(slot.material, "node_tree", None) is None:
                continue
            nodes = slot.material.node_tree.nodes
            node = nodes.get(f"BAKE_{bake_type}") or nodes.new("ShaderNodeTexImage")
            node.name = f"BAKE_{bake_type}"
            node.image = img
            node.location = (-600, -400)
            for n in nodes:
                n.select = False
            node.select = True
            nodes.active = node

        bpy.ops.object.select_all(action="DESELECT")
        source.select_set(True)
        game.select_set(True)
        bpy.context.view_layer.objects.active = game

        log(f"baking {bake_type} at {BAKE_SIZE}px ...")
        if bake_type == "DIFFUSE":
            scene.render.bake.use_pass_direct = False
            scene.render.bake.use_pass_indirect = False
            scene.render.bake.use_pass_color = True
        try:
            bpy.ops.object.bake(type=bake_type)
            log(f"  {image_name} done")
        except RuntimeError as e:
            log(f"  FAILED: {e}")

    source.hide_viewport = True
    scene.render.engine = previous_engine
    log("bake complete — save the images with Image > Save As, then wire them")
    log("into the shell material's Base Color / Normal / Roughness inputs")


def stage_zones(game, armature):
    """Split the single material into shell / joint / accent by bone influence."""
    banner("4  MATERIAL ZONES")
    if game is None or armature is None:
        log("need mesh and armature; skipping")
        return

    mats = {name: build_zone_material(name, spec) for name, spec in ZONES.items()}
    mats[ENERGY_ZONE] = build_energy_material()

    game.data.materials.clear()
    order = ["MAT_shell", "MAT_joint", "MAT_accent", ENERGY_ZONE]
    for name in order:
        game.data.materials.append(mats[name])
    index_of = {name: i for i, name in enumerate(order)}

    dom = dominant_bone_map(game, armature)
    counts = {name: 0 for name in order}

    for poly in game.data.polygons:
        votes = {}
        for vi in poly.vertices:
            entry = dom.get(vi)
            if entry is None:
                continue
            bone = entry[0].replace("mixamorig:", "")
            votes[bone] = votes.get(bone, 0) + 1
        if not votes:
            poly.material_index = index_of["MAT_shell"]
            counts["MAT_shell"] += 1
            continue

        bone = max(votes, key=votes.get)
        if bone in JOINT_BONES:
            target = "MAT_joint"
        elif bone in ACCENT_BONES:
            target = "MAT_accent"
        else:
            target = "MAT_shell"
        poly.material_index = index_of[target]
        counts[target] += 1

    for name in order:
        log(f"{name:<14} {counts[name]:>7,} faces")


def stage_energy(game, armature):
    """Assign the emissive band faces."""
    banner("5  ENERGY CHANNELS")
    if game is None or armature is None:
        log("need mesh and armature; skipping")
        return

    slot = next((i for i, m in enumerate(game.data.materials)
                 if m and m.name == ENERGY_ZONE), None)
    if slot is None:
        log(f"{ENERGY_ZONE} not on the mesh — run the zones stage first")
        return

    dom = dominant_bone_map(game, armature)
    assigned = 0
    per_band = {}

    for poly in game.data.polygons:
        entries = [dom.get(vi) for vi in poly.vertices]
        if any(e is None for e in entries):
            continue
        for bone_hint, centre, half in ENERGY_BANDS:
            # Every vertex of the face must sit inside the band, so strips have
            # clean edges instead of a ragged fringe of partially-inside faces.
            if all(bone_hint in e[0] and abs(e[1] - centre) <= half for e in entries):
                poly.material_index = slot
                assigned += 1
                per_band[bone_hint] = per_band.get(bone_hint, 0) + 1
                break

    for hint, _c, _h in ENERGY_BANDS:
        log(f"{hint:<14} {per_band.get(hint, 0):>6,} faces")
    log(f"total {assigned:,} faces emissive "
        f"({assigned / max(len(game.data.polygons), 1) * 100:.1f}% of the model)")
    if assigned == 0:
        log("nothing matched — widen the half-widths in ENERGY_BANDS and re-run")


def stage_sockets(armature):
    """Attachment points named to the Photon asset contract."""
    banner("6  SOCKETS")
    if armature is None:
        log("no armature; skipping")
        return

    wanted = {
        "SOCKET_weapon_right": "RightHand",
        "SOCKET_weapon_left": "LeftHand",
        "SOCKET_helmet": "Head",
        "SOCKET_backpack": "Spine2",
    }
    bones = {b.name.replace("mixamorig:", "").lower(): b.name
             for b in armature.data.bones}

    for socket_name, bone_hint in wanted.items():
        bone_name = bones.get(bone_hint.lower())
        if bone_name is None:
            log(f"{socket_name:<22} no '{bone_hint}' bone — skipped")
            continue

        empty = bpy.data.objects.get(socket_name)
        if empty is None:
            empty = bpy.data.objects.new(socket_name, None)
            empty.empty_display_type = "ARROWS"
            empty.empty_display_size = 0.05
            bpy.context.scene.collection.objects.link(empty)

        empty.parent = armature
        empty.parent_type = "BONE"
        empty.parent_bone = bone_name
        empty.matrix_parent_inverse.identity()
        empty.location = (0.0, 0.0, 0.0)
        log(f"{socket_name:<22} -> {bone_name}")


def stage_scale(armature, game):
    """Scale to 6'4". Object scale only — applying it would need a re-bind."""
    banner("SCALE")
    if armature is None or game is None:
        log("skipping")
        return
    height = max(game.dimensions.z, game.dimensions.y)
    if height < 1e-6:
        log("cannot measure height")
        return
    factor = TARGET_HEIGHT_M / height
    log(f"current {height:.3f} m -> target {TARGET_HEIGHT_M:.2f} m  (x{factor:.4f})")
    if APPLY_SCALE_TO_ARMATURE:
        armature.scale = tuple(s * factor for s in armature.scale)
        log("scale set on the armature root — animation unaffected, rig not re-bound")
    else:
        log(f"not applied; set `scale: {factor:.4f}` in the Photon manifest instead")


def resolve_export_path():
    """Absolute output path. The glTF exporter does not resolve Blender's `//`."""
    folder = EXPORT_DIR or bpy.path.abspath("//")
    if not folder or not os.path.isdir(folder):
        folder = os.path.join(os.path.expanduser("~"), "Documents")
    return os.path.join(folder, EXPORT_FILENAME)


def stage_export(game, source):
    banner("7  EXPORT")
    if game is None:
        log("no game mesh")
        return

    if source is not None:
        source.hide_viewport = True
        source.hide_render = True

    bpy.ops.object.select_all(action="DESELECT")
    game.select_set(True)
    arm = find_armature()
    if arm:
        arm.select_set(True)
    for obj in bpy.context.scene.objects:
        if obj.name.startswith("SOCKET_"):
            obj.select_set(True)
    bpy.context.view_layer.objects.active = game

    export_path = resolve_export_path()
    try:
        bpy.ops.export_scene.gltf(
            filepath=export_path,
            export_format="GLB",
            use_selection=True,
            export_apply=False,          # never applies modifiers — rig stays intact
            export_skins=True,
            export_animations=True,
            export_yup=True,
            export_materials="EXPORT",
        )
        log(f"exported {export_path}")
        log("high-poly excluded; armature, weights and clip preserved")
    except Exception as e:
        log(f"export failed: {e}")


# =============================================================================

def main():
    banner("PROJECT PHOTON — robot finishing pass")

    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    game, source = find_meshes()
    armature = find_armature()

    log(f"game mesh   {game.name if game else 'NOT FOUND'}")
    log(f"bake source {source.name[:40] if source else 'not present'}")
    log(f"armature    {armature.name if armature else 'NOT FOUND'}")
    if game is None:
        log("\nCannot continue without the game mesh. Check GAME_MESH_HINT.")
        return

    if STAGES["cleanup"]:
        stage_cleanup(game, source)
    if STAGES["unwrap"]:
        stage_unwrap(game)
    if STAGES["bake"]:
        stage_bake(game, source)
    if STAGES["zones"]:
        stage_zones(game, armature)
    if STAGES["energy"]:
        stage_energy(game, armature)
    if STAGES["sockets"]:
        stage_sockets(armature)
    stage_scale(armature, game)
    if STAGES["export"]:
        stage_export(game, source)

    if bpy.data.is_saved:
        bpy.ops.wm.save_mainfile()
        log(f"\n  saved {bpy.data.filepath}")
    else:
        log("\n  file never saved — File > Save As once, then re-run to autosave")

    print("=" * 74 + "\n")


def photon_set_team(team):
    """Recolour every energy channel. One write, shared node group."""
    global TEAM
    if team not in TEAM_COLORS:
        raise ValueError(f"unknown team '{team}'")
    TEAM = team
    build_energy_material()
    print(f"[photon] team -> {team}")


if __name__ == "__main__":
    main()
