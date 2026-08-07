"""
PROJECT PHOTON — high-to-low detail bake
========================================

Projects the Tripo high-poly's surface detail onto the 61k game mesh: panel
seams, machined edges, fasteners, vents, crevice shading. This is the step that
makes a low-poly robot read as a manufactured product.

WHAT IT BAKES, AND WHAT IT DELIBERATELY DOES NOT

    NORMAL   yes — the whole point. Derived from *geometry*, so it transfers
             every seam and bevel modelled in the 1.9M-triangle source.

    AO       yes — also geometry-derived. Multiplied into base colour, this is
             what puts shadow in the panel gaps and stops the white ceramic
             reading as a flat blob.

    BASE     NO. This is the one worth explaining, because baking it is the
    COLOUR   obvious instinct and it would actively undo the art direction.

             The brief asks for white ceramic composite. The Tripo source is
             dark blue-grey metal. Baking its base colour down would overwrite
             the four material zones with the exact look the material pass was
             written to replace.

             The high-poly's materials in the .blend have also already been
             replaced by the flat zone colours, so a base-colour bake would
             sample flat white anyway. Both reasons point the same way: skip it.

    So: keep the authored zone colours, and take only the geometric truth the
    high-poly holds that the low-poly cannot.

THE FAILURE THIS SCRIPT EXISTS TO PREVENT

    Selected-to-active baking silently produces black or garbage when the two
    meshes are not in the same place at the same size. The game mesh has since
    been scaled (via the armature) to 2.285 m while the high-poly may still sit
    at 0.979 m. If so, no ray from the low-poly ever reaches the high-poly and
    the bake completes "successfully" with an empty result.

    This checks that first and refuses to run rather than wasting an hour.

Run from Blender's Scripting workspace. Non-destructive: adds images and image
nodes, touches no geometry, no armature, no weights.
"""

import bpy
import os
from mathutils import Vector

# =============================================================================
#  CONFIG
# =============================================================================

BAKE_SIZE = 2048
BAKE_MARGIN = 8
AO_SAMPLES = 64
NORMAL_SAMPLES = 8          # normal bakes need almost no samples; it is not noisy

#: Fraction of model height used as ray distance. 0.5% of 2.29 m is ~11 mm,
#: which comfortably spans the gap between the two surfaces without shooting
#: through thin panels into the geometry behind them.
RAY_FRACTION = 0.005

BAKE_NORMAL = True
BAKE_AO = True
WIRE_INTO_MATERIALS = True

SOURCE_HINTS = ("tripo_node", "_high", "highpoly", "high_poly", "_src", "_source")


def log(m=""):
    print(f"  {m}")


def find_meshes():
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    source = [m for m in meshes if any(h in m.name.lower() for h in SOURCE_HINTS)]
    game = [m for m in meshes if m not in source]
    return (game[0] if game else None), (source[0] if source else None)


def world_height(obj):
    """Height in world space, so object and armature scale are both included.

    Uses the object's eight bounding-box corners rather than sampling vertices.
    The first version strided through `obj.data.vertices` with a slice step,
    which raises `TypeError: bpy_prop_collection[slice]: slice steps not
    supported` — Blender's collections accept `[a:b]` but never `[a:b:step]`.

    The bounding box is also strictly better here: exact instead of sampled, and
    eight matrix multiplications instead of five hundred.
    """
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    if not corners:
        return 0.0
    return max(c.z for c in corners) - min(c.z for c in corners)


def make_image(name, is_data):
    img = bpy.data.images.get(name)
    if img is None:
        img = bpy.data.images.new(name, BAKE_SIZE, BAKE_SIZE,
                                  alpha=False, float_buffer=is_data)
    img.colorspace_settings.name = "Non-Color" if is_data else "sRGB"
    return img


def set_bake_target(obj, image, tag):
    """Every material on the target needs the destination image node selected.

    Cycles bakes into whichever Image Texture node is active per material, and
    refuses with "No active image found" if any material lacks one. The game
    mesh has four zone materials, so all four need the node.
    """
    for slot in obj.material_slots:
        mat = slot.material
        if mat is None or getattr(mat, "node_tree", None) is None:
            continue
        nodes = mat.node_tree.nodes
        node = nodes.get(tag)
        if node is None:
            node = nodes.new("ShaderNodeTexImage")
            node.name = tag
            node.label = tag
            node.location = (-900, -500 if tag == "BAKE_NORMAL" else -800)
        node.image = image
        for n in nodes:
            n.select = False
        node.select = True
        nodes.active = node


def bake_pass(game, source, bake_type, image, tag, samples, extrusion):
    scene = bpy.context.scene
    scene.cycles.samples = samples
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = extrusion
    scene.render.bake.max_ray_distance = extrusion * 2.0
    scene.render.bake.margin = BAKE_MARGIN
    if hasattr(scene.render.bake, "margin_type"):
        scene.render.bake.margin_type = "ADJACENT_FACES"

    set_bake_target(game, image, tag)

    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    game.select_set(True)
    bpy.context.view_layer.objects.active = game

    log(f"baking {bake_type} at {BAKE_SIZE}px, {samples} samples, ray {extrusion*1000:.1f} mm ...")
    try:
        if bake_type == "NORMAL":
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT",
                                use_clear=True, margin=BAKE_MARGIN)
        else:
            bpy.ops.object.bake(type=bake_type, use_clear=True, margin=BAKE_MARGIN)
    except RuntimeError as e:
        log(f"  FAILED: {e}")
        return False

    # Save beside the .blend so the maps survive a file reload.
    folder = bpy.path.abspath("//") or os.path.expanduser("~")
    path = os.path.join(folder, f"{image.name}.png")
    image.filepath_raw = path
    image.file_format = "PNG"
    try:
        image.save()
        log(f"  saved {path}")
    except Exception as e:
        log(f"  baked but not saved ({e}) — use Image > Save As")
    return True


def wire_maps(game, normal_img, ao_img):
    """Connect the baked maps into each zone material.

    Normal goes through a Normal Map node into the Principled normal input. AO
    multiplies base colour rather than replacing it, so the authored zone colour
    survives and only gains shadow where the high-poly had crevices.
    """
    for slot in game.material_slots:
        mat = slot.material
        if mat is None or getattr(mat, "node_tree", None) is None:
            continue
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue

        if normal_img is not None:
            tex = nodes.get("BAKE_NORMAL")
            nmap = nodes.get("PHOTON_NormalMap") or nodes.new("ShaderNodeNormalMap")
            nmap.name = "PHOTON_NormalMap"
            nmap.location = (-500, -500)
            if tex:
                links.new(tex.outputs["Color"], nmap.inputs["Color"])
                links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

        # AO is deliberately NOT multiplied into Base Color.
        #
        # The first version did exactly that, and it destroyed the art direction on
        # export: routing a Mix node into Base Color moves the zone colour into the
        # Mix input, and glTF — whose model is baseColorFactor x baseColorTexture —
        # cannot represent it. The exporter took AO as baseColorTexture, set the
        # factor to white, and every zone came out the same grey. It also applied AO
        # twice, once in albedo and once as occlusion.
        #
        # AO's correct home is glTF's occlusionTexture, wired by photon_export.py.
        # Base Color stays an unlinked value carrying the zone colour.
        if ao_img is not None:
            log(f"  {mat.name}: AO left for occlusionTexture, not mixed into albedo")

        log(f"  wired {mat.name}")


def main():
    print("\n" + "=" * 72)
    print("  PHOTON — high-to-low bake")
    print("=" * 72)

    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    game, source = find_meshes()
    log(f"game mesh   {game.name if game else 'NOT FOUND'}")
    log(f"high-poly   {source.name[:44] if source else 'NOT FOUND'}")

    if game is None:
        log("\n  ABORT: no game mesh.")
        return
    if source is None:
        log("\n  ABORT: no high-poly in this .blend. Re-import the Tripo source")
        log("  (Photon Robot Tripo High.obj) before baking — there is nothing")
        log("  to project detail from.")
        return

    # --- Unhide. A hidden object cannot be baked from. ----------------------
    for coll in source.users_collection:
        coll.hide_viewport = False
        if coll.name in bpy.context.view_layer.layer_collection.children:
            bpy.context.view_layer.layer_collection.children[coll.name].exclude = False
    source.hide_viewport = False
    source.hide_render = False
    source.hide_set(False)

    # --- THE CHECK THAT MATTERS --------------------------------------------
    h_game = world_height(game)
    h_src = world_height(source)
    log("")
    log(f"game mesh height  {h_game:.3f} m")
    log(f"high-poly height  {h_src:.3f} m")
    if h_src < 1e-6:
        log("\n  ABORT: cannot measure the high-poly.")
        return
    ratio = h_game / h_src
    if abs(ratio - 1.0) > 0.02:
        log("")
        log(f"  ABORT: the two meshes differ in scale by {ratio:.3f}x.")
        log("  Selected-to-active baking projects rays between the surfaces, so a")
        log("  scale mismatch produces a black or garbage map while reporting")
        log("  success. Fix before baking:")
        log("")
        log(f"    - set the high-poly's scale to match ({ratio:.4f}x its current), or")
        log("    - parent the high-poly to the same armature so it inherits the scale, or")
        log("    - undo the armature scale, bake at native size, and rescale after")
        log("      (recommended — Photon can apply the height correction at import")
        log("       via the manifest's `scale` field instead)")
        return
    log(f"scale match       {ratio:.4f}x  OK")

    extrusion = max(0.001, h_game * RAY_FRACTION)

    scene = bpy.context.scene
    previous = scene.render.engine
    scene.render.engine = "CYCLES"

    normal_img = ao_img = None
    if BAKE_NORMAL:
        normal_img = make_image("PHOTON_Robot_Normal", True)
        if not bake_pass(game, source, "NORMAL", normal_img, "BAKE_NORMAL",
                         NORMAL_SAMPLES, extrusion):
            normal_img = None
    if BAKE_AO:
        ao_img = make_image("PHOTON_Robot_AO", True)
        if not bake_pass(game, source, "AO", ao_img, "BAKE_AO",
                         AO_SAMPLES, extrusion):
            ao_img = None

    scene.render.engine = previous

    if WIRE_INTO_MATERIALS and (normal_img or ao_img):
        log("")
        log("wiring maps into the zone materials:")
        wire_maps(game, normal_img, ao_img)

    source.hide_viewport = True
    source.hide_render = True

    log("")
    log("Done. Check the result in Material Preview before exporting.")
    log("Then re-export with tools/blender/photon_export.py")
    if bpy.data.is_saved:
        bpy.ops.wm.save_mainfile()
        log(f"saved {bpy.data.filepath}")
    print("=" * 72 + "\n")


if __name__ == "__main__":
    main()
