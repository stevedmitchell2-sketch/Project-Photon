"""
PROJECT PHOTON — headless character build
=========================================

Runs the whole Blender half of the character pipeline with no GUI:

    blender --background <file.blend> --python photon_build_character.py -- \
        --clips <dir> --out <file.glb>

Driven by `scripts/buildCharacter.ts` (`npm run build-character`), which supplies the
arguments and runs the validation afterwards. Nothing here validates the *result* —
that is the driver's job, using tools that read the GLB rather than the .blend.

## What it does, and what it refuses to do

Three stages, in order, each aborting the build rather than continuing on a doubt:

1. **Prune** armatures that deform no mesh. This is the failure that produced a GLB with
   98 joints in 2 skins and eleven clips stashed on a skeleton no mesh was bound to —
   valid glTF that loads, validates and never moves.
2. **Import** every FBX in the clips folder onto the deforming armature, naming each
   action after its file. Reuses `photon_import_clips` rather than duplicating it.
3. **Export** the game mesh, armature and sockets, excluding bake sources.

It does not retopologise, unwrap, bake, assign materials or place sockets. Those are
one-time authoring passes that already happened; re-running them would overwrite work.
This script is the *repeatable* part of the pipeline and nothing else.

## Never writes to the .blend

`bpy.ops.wm.save_mainfile` is not called, deliberately. The pruning and importing happen
in memory and are discarded when Blender exits. The brief was explicit that the
production asset must not be modified, and a build that mutates its own input cannot be
run twice with the same result.
"""

import bpy
import os
import sys

# The importer lives beside this file. Blender does not put the script's directory on
# sys.path, so a plain `import photon_import_clips` fails with ModuleNotFoundError.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

#: Meshes whose name contains any of these are bake sources, not game assets. Kept in
#: step with photon_export.py — `_hd` is here for Tripo's high-density output.
SOURCE_HINTS = ("tripo_node", "_high", "highpoly", "high_poly", "_src", "_source", "_hd")

#: Every clip the pack expects, so a missing one is an error rather than a surprise later.
EXPECTED_CLIPS = (
    "Breathing Idle", "Walking", "Running", "Fast Run",
    "Crouching Idle", "Running Slide",
    "Jumping Up", "Falling Idle", "Hard Landing",
    "Left Turn", "Button Pushing", "Falling Back Death",
)


def fail(message):
    """Abort the build with a non-zero exit code the driver can see.

    `sys.exit` inside a Blender `--python` script sets the process exit code, which is the
    only signal that crosses back to npm. Printing an error and returning normally would
    let the driver report success on a broken build.
    """
    print(f"\n  BUILD FAILED: {message}\n")
    sys.exit(1)


def script_args():
    """Arguments after the `--` separator, which Blender passes through untouched."""
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


def deforming_armatures():
    """Armatures with a mesh actually bound to them by an Armature modifier."""
    found = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for mod in obj.modifiers:
            if mod.type == "ARMATURE" and mod.object and mod.object not in found:
                found.append(mod.object)
    return found


def prune_stray_armatures():
    """Remove armatures that deform nothing, and report what went.

    A stray armature is not cosmetic. The glTF exporter writes a skin for it, the animation
    exporter writes channels targeting its bones, and three.js then renames the *real*
    bones to disambiguate the duplicates — which broke a name-based bone lookup elsewhere
    in this project. One object, four downstream symptoms.
    """
    keep = deforming_armatures()
    strays = [o for o in bpy.data.objects if o.type == "ARMATURE" and o not in keep]
    for obj in strays:
        print(f"  pruned    stray armature {obj.name!r} (deforms no mesh)")
        bpy.data.objects.remove(obj, do_unlink=True)
    return strays


def main():
    args = script_args()
    clips_dir = args.get("clips")
    out_path = args.get("out")
    if not clips_dir or not out_path:
        fail("need --clips <dir> and --out <file.glb>")
    if not os.path.isdir(clips_dir):
        fail(f"clips folder does not exist: {clips_dir}")

    print("\n" + "=" * 70)
    print("  PHOTON — headless character build")
    print("=" * 70)
    print(f"  blend     {bpy.data.filepath or '(none)'}")
    print(f"  clips     {clips_dir}")
    print(f"  out       {out_path}")
    print("")

    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    # --- 1. Prune ---------------------------------------------------------
    prune_stray_armatures()
    armatures = deforming_armatures()
    if not armatures:
        fail("no armature deforms a mesh. Exporting now would produce a GLB with no skin.")
    if len(armatures) > 1:
        fail("more than one armature deforms a mesh: "
             + ", ".join(o.name for o in armatures)
             + ". Refusing to guess which one the clips belong on.")
    target = armatures[0]
    print(f"  armature  {target.name!r}  {len(target.data.bones)} bones")

    # --- 2. Import --------------------------------------------------------
    import photon_import_clips as importer

    files = sorted(f for f in os.listdir(clips_dir) if f.lower().endswith(".fbx"))
    if not files:
        fail(f"no .fbx files in {clips_dir}")

    # Two files normalising onto one name is a silent winner-takes-all, so it is caught
    # before anything is imported rather than after.
    seen = {}
    for name in files:
        clip = importer.clip_name_from_file(name)
        seen.setdefault(clip, []).append(name)
    clashes = {k: v for k, v in seen.items() if len(v) > 1}
    if clashes:
        fail("two files claim the same clip name: "
             + "; ".join(f"{k} <- {', '.join(v)}" for k, v in clashes.items()))

    print(f"  importing {len(files)} clip(s)")
    for name in files:
        result = importer.import_clip(os.path.join(clips_dir, name), target)
        state = result.get("note") or ("stashed" if result["ok"] else "FAILED")
        print(f"    {result['clip']:<24} {state}")
        if not result["ok"]:
            fail(f"{name}: {result['note']}")

    missing = [c for c in EXPECTED_CLIPS if c not in bpy.data.actions]
    if missing:
        fail("clips missing from the pack: " + ", ".join(missing))

    # --- 3. Export --------------------------------------------------------
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    game = [m for m in meshes if not any(h in m.name.lower() for h in SOURCE_HINTS)]
    source = [m for m in meshes if m not in game]
    sockets = [o for o in bpy.context.scene.objects if o.name.startswith("SOCKET_")]

    if not game:
        fail("no game mesh: every mesh matched a bake-source hint.")
    for mesh in game:
        bound = any(mod.type == "ARMATURE" for mod in mesh.modifiers)
        if not bound or not len(mesh.vertex_groups):
            fail(f"{mesh.name} is not bound to the armature "
                 f"(modifier={bound}, vertex groups={len(mesh.vertex_groups)}). "
                 "The export would have no skin.")
        print(f"  mesh      {mesh.name:<40} {len(mesh.data.polygons):>9,} faces")
    for mesh in source:
        print(f"  excluded  {mesh.name[:40]:<40} {len(mesh.data.polygons):>9,} faces (bake source)")
        mesh.hide_set(True)
        mesh.hide_viewport = True
    for sock in sockets:
        print(f"  socket    {sock.name}")

    # Occlusion has to be wired through the glTF settings node group or it is dropped
    # silently: glTF cannot represent a Mix graph, and a baked AO fed into Base Color
    # exported as a baseColorTexture once, destroying all three zone colours.
    import photon_export as exporter
    exporter.wire_occlusion_for_gltf(game)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in game + [target] + sockets:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = target

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out_path),
        export_format="GLB",
        use_selection=True,
        use_visible=True,
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_materials="EXPORT",
        export_yup=True,
    )

    size = os.path.getsize(out_path)
    print("")
    print(f"  wrote     {out_path}  ({size / 1048576:.1f} MB)")
    print("  The .blend was not modified.")
    print("=" * 70 + "\n")


main()
