"""
PROJECT PHOTON — GLB to FBX, for Mixamo upload
==============================================

    blender --background --factory-startup --python photon_glb_to_fbx.py -- \
        --in <model.glb> --out <model.fbx>

Driven by `npm run to-fbx`. Exists for one reason: **Mixamo's character uploader does not
accept GLB.** It takes FBX, OBJ or ZIP, and Tripo exports GLB, so there is a format gap
between the two halves of the asset pipeline and it needs bridging automatically rather
than by hand each time.

## Why --factory-startup

The conversion must not inherit the current .blend, add-on state or scene. `--factory-startup`
gives an empty file with default settings, so the output depends only on the input.

## What it deliberately does not do

No decimation, no retopology, no material work, no rigging. Tripo's remesh has already
produced a mesh inside budget, and Mixamo is about to add the skeleton; anything else this
script touched would be work thrown away or, worse, silently altered geometry that the
budget numbers were measured against.

It does check the two things that make Mixamo's auto-rigger fail, because finding out here
costs seconds and finding out after an upload costs a round trip.
"""

import bpy
import os
import sys


def fail(message):
    print(f"\n  CONVERT FAILED: {message}\n")
    sys.exit(1)


def script_args():
    argv = sys.argv
    if "--" not in argv:
        return {}
    rest = argv[argv.index("--") + 1:]
    out = {}
    key = None
    for token in rest:
        if token.startswith("--"):
            key = token[2:]
            out[key] = True
        elif key:
            out[key] = token
            key = None
    return out


def main():
    args = script_args()
    src = args.get("in")
    dst = args.get("out")
    if not src or not dst:
        fail("need --in <model.glb> and --out <model.fbx>")
    if not os.path.isfile(src):
        fail(f"no such file: {src}")

    print("\n" + "=" * 70)
    print("  PHOTON — GLB to FBX (for Mixamo upload)")
    print("=" * 70)
    print(f"  in        {src}")

    # Empty the factory scene: the default cube would upload alongside the character.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        fail("the GLB contains no mesh")

    total_faces = sum(len(m.data.polygons) for m in meshes)
    for mesh in meshes:
        print(f"  mesh      {mesh.name[:44]:<46} {len(mesh.data.polygons):>9,} faces")

    # --- The two things that make Mixamo's auto-rigger refuse -------------
    #
    # Both are cheap to check and expensive to discover after an upload.

    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if armatures:
        # Mixamo auto-rigs an unrigged mesh. Handing it something already skinned is a
        # different workflow and the result is rarely what anyone wanted.
        print(f"  WARNING: {len(armatures)} armature(s) present. Mixamo expects an unrigged mesh;")
        print("           it will try to rig a character that already has a skeleton.")

    # Proportions, as a proxy for pose. A T-pose or A-pose is wider than it is deep and
    # taller than it is wide. A curled or seated figure fails auto-rigging, and the
    # bounding box is enough to catch the obvious cases.
    lo = [min(v.co[i] for m in meshes for v in m.data.vertices) for i in range(3)]
    hi = [max(v.co[i] for m in meshes for v in m.data.vertices) for i in range(3)]
    # Blender is Z-up, so height is index 2. Reading it as index 1 — glTF's up axis, which the
    # importer has already converted away — made an upright 0.98 m figure look like a 0.25 m one and
    # fired the "not upright" warning on a perfectly good model. A check that cries wolf gets ignored.
    width, depth, height = (hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    print(f"  bounds    W {width:.3f}  D {depth:.3f}  H {height:.3f} m  (Blender Z-up)")
    if height < max(width, depth):
        print("  WARNING: the model is wider or deeper than it is tall. Mixamo's auto-rigger")
        print("           expects an upright A-pose or T-pose and will likely refuse it.")

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.fbx(
        filepath=os.path.abspath(dst),
        use_selection=True,
        # Embedded, so the upload is a single file rather than an FBX plus a texture folder
        # Mixamo would never see.
        path_mode="COPY",
        embed_textures=True,
        # Mixamo reads centimetres. Blender's FBX exporter defaults to a 1.0 scale with
        # "FBX Units Scale", which is what Mixamo's importer expects.
        global_scale=1.0,
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_NONE",
        axis_forward="-Z",
        axis_up="Y",
        object_types={"MESH"},
        use_mesh_modifiers=True,
        mesh_smooth_type="FACE",
        bake_anim=False,
    )

    size = os.path.getsize(dst)
    print("")
    print(f"  wrote     {dst}  ({size / 1048576:.1f} MB, {total_faces:,} faces)")
    print("")
    print("  Upload this to mixamo.com > Upload Character, then auto-rig it and")
    print("  download FBX Binary / With Skin / 30 fps.")
    print("=" * 70 + "\n")


main()
