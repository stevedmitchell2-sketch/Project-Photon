"""
PROJECT PHOTON — new character setup, start to .blend
=====================================================

    blender --background --factory-startup --python photon_setup_character.py -- \
        --rigged <mixamo_tpose.fbx> --highpoly <tripo_hd.glb> --out <character.blend>

Takes a Mixamo-rigged character and its Tripo high-poly, and produces a finished
`.blend` ready for `npm run build-character`: UVs unwrapped, normal and AO baked from
the high-poly, four material zones assigned, energy bands placed, four sockets parented
to the right bones, and the armature scaled to Photon's target height.

Driven by `npm run setup-character`.

## This is a thin driver, not a new pipeline

Every stage already exists in `photon_robot_finish.py`, which did exactly this work for
the Service Unit. Reusing it rather than reimplementing matters more than usual here,
because its zone assignment works off **bone influence** — which vertices are dominated
by which bones — and Mixamo's bone names are identical across auto-rigged characters. The
robot's `JOINT_BONES` and `ACCENT_BONES` sets therefore apply to any Mixamo humanoid
without a line of change.

What this adds is only the part that was manual: getting the two meshes and the armature
into one clean file in the state those stages expect, and saving the result.

## Why the mesh hints are left alone

`find_meshes()` prefers name hints but falls back to "the smaller of the two meshes",
which is what a game mesh is by definition. Both of ours arrive named `tripo_node_*`, so
the hints cannot separate them and the fallback is the *correct* path — 12,101 faces
against 1.9M is not an ambiguous comparison. Renaming to force a hint match would be
fighting a mechanism that already works.

## Export is deliberately skipped

`stage_export` is turned off. Exporting is `build-character`'s job, and it is the half
with the validation attached — clip resolution, the rig fingerprint, pose checks. A second
export path here would be a second thing to keep correct, and the one without any gates.
"""

import bpy
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)


def fail(message):
    print(f"\n  SETUP FAILED: {message}\n")
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


def clear_scene():
    """Empty the factory file. The default cube would become a third mesh."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in list(bpy.data.meshes):
        if block.users == 0:
            bpy.data.meshes.remove(block)


def main():
    args = script_args()
    rigged = args.get("rigged")
    highpoly = args.get("highpoly")
    out_path = args.get("out")
    skip_bake = bool(args.get("no-bake"))

    if not rigged or not out_path:
        fail("need --rigged <fbx> and --out <file.blend>  [--highpoly <glb>] [--no-bake]")
    if not os.path.isfile(rigged):
        fail(f"no rigged FBX at {rigged}")
    if highpoly and not os.path.isfile(highpoly):
        fail(f"no high-poly at {highpoly}")

    import photon_robot_finish as finish

    finish.banner("PROJECT PHOTON — new character setup")
    finish.log(f"rigged    {rigged}")
    finish.log(f"highpoly  {highpoly or '(none — bake will be skipped)'}")
    finish.log(f"out       {out_path}")
    finish.log("")

    clear_scene()

    # --- Import the rigged character --------------------------------------
    bpy.ops.import_scene.fbx(filepath=os.path.abspath(rigged))
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not meshes:
        fail("the rigged FBX contains no mesh. Was it downloaded 'Without Skin'? "
             "Mixamo needs 'With Skin' for the character itself.")
    if not armatures:
        fail("the rigged FBX contains no armature — it is not rigged.")
    game = meshes[0]
    armature = armatures[0]

    # Rename the game mesh, and this is not cosmetic.
    #
    # A Mixamo-rigged Tripo character arrives called `tripo_node_<uuid>`, which matches
    # `SOURCE_HINTS` — the very list every script uses to recognise a *bake source*. Left alone:
    # `photon_bake.find_meshes` reports "game mesh NOT FOUND" because both meshes look like
    # sources, and `photon_build_character` excludes it from the export as high-poly, so the GLB
    # ships with a skeleton and no character.
    #
    # The stem of the output filename is the natural name and keeps the file self-describing.
    game.name = os.path.splitext(os.path.basename(out_path))[0] + "_GAME"
    game.data.name = game.name
    bound = any(m.type == "ARMATURE" for m in game.modifiers)
    if not bound or not len(game.vertex_groups):
        fail(f"{game.name} is not bound to the armature "
             f"(modifier={bound}, vertex groups={len(game.vertex_groups)}).")
    finish.log(f"game mesh   {game.name}  {len(game.data.polygons):,} faces, "
               f"{len(game.vertex_groups)} groups")
    finish.log(f"armature    {armature.name}  {len(armature.data.bones)} bones")

    # Drop the action the rigged FBX brings with it.
    #
    # Mixamo ships the T-pose download with an action called `mixamo.com`, and it is not one of the
    # twelve. Left in place it exports as a thirteenth clip, which fails the pipeline's exact clip
    # count — correctly, since a clip named `mixamo.com` carries no state information and would be
    # served to any state that failed to resolve. That fallback is precisely how a standing robot
    # ended up playing a run cycle.
    stray = list(bpy.data.actions)
    if armature.animation_data:
        armature.animation_data.action = None
    for action in stray:
        finish.log(f"  dropped   stray action {action.name!r} from the rigged FBX")
        action.use_fake_user = False
        bpy.data.actions.remove(action)

    # --- Import the high-poly as a bake source ----------------------------
    #
    # Named with a `_high` suffix so that every downstream exclusion rule recognises it:
    # photon_export.py and photon_build_character.py both match on SOURCE_HINTS, and a
    # 1.9M-face mesh leaking into a shipped GLB is silent — it loads and it renders.
    source = None
    if highpoly and not skip_bake:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(highpoly))
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        if not new:
            fail(f"no mesh found in {highpoly}")
        source = max(new, key=lambda o: len(o.data.polygons))
        source.name = "PHOTON_bake_source_high"
        finish.log(f"bake source {source.name}  {len(source.data.polygons):,} faces")
        # Anything else the glTF brought in — cameras, lights, empty parents — is not
        # wanted in a character file.
        for obj in new:
            if obj is not source:
                bpy.data.objects.remove(obj, do_unlink=True)

    # --- Run the finishing stages -----------------------------------------
    #
    # Export off: build-character owns exporting, and it is the path with the gates.
    finish.STAGES["export"] = False
    # `photon_robot_finish.stage_bake` is not used. Two reasons, both found by running it:
    #
    #  - it needs the high-poly *selectable*, and `stage_cleanup` has by then moved it into a
    #    hidden collection, so every pass failed with "No valid selected objects" — and the
    #    stage still printed "bake complete";
    #  - `photon_bake.py` is the script that actually baked the Service Unit, and it carries
    #    the hard-won details: normal and AO only (never base colour), a ray distance derived
    #    from model height, and occlusion wired through the glTF settings node group.
    finish.STAGES["bake"] = False

    # Order is load-bearing.
    #
    #   unwrap -> zones -> bake -> cleanup
    #
    # UVs must exist before anything bakes into them. Zones must exist before the bake, because
    # `wire_maps` attaches the normal and AO to the materials it finds — run the other way round
    # and `stage_zones` rebuilds those materials and discards the maps. Cleanup hides the
    # high-poly, so it has to come *after* the bake rather than before it.
    finish.stage_unwrap(game)
    finish.stage_zones(game, armature)
    finish.stage_energy(game, armature)

    baked = False
    if source is not None and not skip_bake:
        import photon_bake
        photon_bake.main()
        # Verify rather than trust. The failed run reported success, so the only honest signal
        # is whether the images exist and contain something other than their fill colour.
        for name in ("PHOTON_Robot_Normal", "PHOTON_Robot_AO"):
            img = bpy.data.images.get(name)
            if img is None:
                fail(f"bake reported success but produced no image called {name!r}")
            pixels = list(img.pixels[:4000])
            if not any(p not in (0.0, 1.0) for p in pixels):
                fail(f"{name} is empty — the bake did not transfer any detail")
        baked = True
    else:
        reason = "--no-bake" if skip_bake else "no high-poly supplied"
        finish.log(f"\n  BAKE SKIPPED ({reason}) — no normal or AO map on this character")

    finish.stage_cleanup(game, source)
    finish.stage_sockets(armature)
    finish.stage_scale(armature, game)

    # --- Save -------------------------------------------------------------
    #
    # save_as, never save: the input files are read-only and the output is a new file, so
    # running this twice cannot destroy the first result by surprise.
    out_abs = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=out_abs)

    sockets = [o for o in bpy.context.scene.objects if o.name.startswith("SOCKET_")]
    finish.log("")
    finish.log(f"  saved {out_abs}  ({os.path.getsize(out_abs) / 1048576:.0f} MB)")
    finish.log(f"  {len(armature.data.bones)} bones" + (" · baked" if baked else " · NOT BAKED") + f" · {len(sockets)} sockets · "
               f"{len(game.data.materials)} materials · {len(game.data.polygons):,} faces")
    finish.log("")
    finish.log("  next:")
    finish.log(f'    npm run build-character -- --blend "{out_abs}" --out <Name>_v01.glb')
    print("=" * 74 + "\n")


main()
