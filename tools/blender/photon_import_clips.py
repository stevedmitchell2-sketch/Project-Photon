"""
PROJECT PHOTON — batch clip import
==================================

Imports a folder of Mixamo FBX animation files onto the existing robot armature,
naming each clip after its file and stashing it so the glTF exporter can find it.

Additive only. It does not touch the mesh, the rig, the weights, the materials,
the sockets, or the export script — it puts actions into the .blend and stops.

## The problem this exists to solve

**Every Mixamo download contains an action called `mixamo.com`.** Not "usually" —
every single one, regardless of which animation you picked. Import twelve of them
by hand and Blender names them:

    Armature|mixamo.com|Layer0
    Armature|mixamo.com|Layer0.001
    Armature|mixamo.com|Layer0.002        ... and so on

The engine resolves animation states by clip *name*. Twelve identically-named
clips means eleven states resolve to whichever one the exporter happened to write
first, and — this is the part that makes it dangerous — nothing looks broken. The
character animates. It just plays a run cycle while standing still, exactly the
symptom the asset has today with one clip.

So the name has to come from somewhere other than the file's contents, and the
only place carrying it is the *filename*. Mixamo names the download after the
animation, so `Fast Run.fbx` becomes the action `Fast Run`, which is precisely
what the manifest's `clips` map is looking for.

## Usage

1. Download the twelve clips per docs/ANIMATION_CONTENT_PACK.md — FBX Binary,
   **Without Skin**, 30 fps, In Place ON where the option appears.
2. Put them in one folder. Do not rename them; the filename is the clip name.
3. Set CLIP_DIR below to that folder.
4. Open the robot .blend, Scripting workspace, run this.
5. Then run photon_export.py as normal.

Start with ONE file in the folder and check the pose before doing all twelve —
see the note on rest poses under `import_clip`.
"""

import bpy
import os

#: Folder holding the downloaded .fbx files. Leave empty to look for a "clips"
#: folder next to the .blend.
CLIP_DIR = ""

#: Substring identifying the armature to receive the clips. The robot's armature
#: is the only one in the file, so this is a safety net rather than a selector.
TARGET_ARMATURE_HINT = ""

#: Clips the pack expects, for the coverage report at the end. Mixamo's names,
#: verbatim — these are what the engine matches on.
EXPECTED = (
    "Breathing Idle", "Walking", "Running", "Fast Run",
    "Crouch Idle", "Running Slide",
    "Jumping Up", "Falling Idle", "Hard Landing",
    "Left Turn", "Button Pushing", "Falling Back Death",
)


def resolve_clip_dir():
    """Return the folder to scan, or None."""
    folder = CLIP_DIR or os.path.join(bpy.path.abspath("//"), "clips")
    return folder if os.path.isdir(folder) else None


def find_target_armature():
    """The armature the clips are for.

    Picked by object type rather than by name, because the name has changed twice
    across this asset's history and a hard-coded one would break silently.
    """
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if TARGET_ARMATURE_HINT:
        armatures = [o for o in armatures if TARGET_ARMATURE_HINT.lower() in o.name.lower()]
    if not armatures:
        return None
    if len(armatures) > 1:
        print(f"  note: {len(armatures)} armatures in the file; using '{armatures[0].name}'")
        print("        set TARGET_ARMATURE_HINT if that is the wrong one")
    return armatures[0]


def import_clip(path, target):
    """Import one FBX and move its action onto `target`, named after the file.

    ## Rest poses have to match

    An action stores bone rotations *relative to the armature's rest pose*. Two
    Mixamo skeletons with the same bone names but different rest orientations will
    happily accept each other's actions and produce a mangled pose — arms inside
    the chest, feet pointing backwards.

    Blender's FBX importer decides that orientation from its import settings, so
    the settings used here must match the ones used when the robot was first
    imported. Defaults are used below, which is what the character was brought in
    with. If the first clip looks wrong, that is the reason — and it is why this
    is worth testing on one file before running all twelve.
    """
    before_actions = set(bpy.data.actions)
    before_objects = set(bpy.data.objects)

    # Defaults deliberately: see the docstring. `ignore_leaf_bones` off keeps the
    # toe-end and finger-tip bones the target rig also has, so channel names line up.
    bpy.ops.import_scene.fbx(filepath=path)

    new_actions = [a for a in bpy.data.actions if a not in before_actions]
    new_objects = [o for o in bpy.data.objects if o not in before_objects]

    name = os.path.splitext(os.path.basename(path))[0]
    result = {"file": os.path.basename(path), "clip": name, "ok": False, "note": ""}

    if not new_actions:
        result["note"] = "no action in the file — was it exported With Skin and no animation?"
    elif len(new_actions) > 1:
        # Should not happen with a Mixamo download, but guessing which of several
        # actions is the animation would be the kind of silent wrong answer this
        # whole script exists to avoid.
        result["note"] = f"{len(new_actions)} actions in one file; skipped rather than guess"
    else:
        action = new_actions[0]
        action.name = name
        # Fake user, or Blender discards the action on the next file save as soon as
        # nothing has it assigned — which is exactly what stashing does.
        action.use_fake_user = True
        stash(target, action)
        result["ok"] = True
        result["frames"] = int(action.frame_range[1] - action.frame_range[0])
        result["channels"] = len(action.fcurves)

    # Remove what the import brought in besides the action: a duplicate armature
    # (and a mesh, if the download was not Without Skin). Leaving them behind would
    # put a second 49-bone skeleton in front of photon_export.py's object picker.
    for obj in new_objects:
        bpy.data.objects.remove(obj, do_unlink=True)

    return result


def stash(target, action):
    """Park an action on the armature as its own muted NLA track.

    The glTF exporter's default animation mode is "Actions", which exports actions
    that are active on an object or sitting on its NLA tracks. An action that is
    merely present in the .blend is not necessarily exported, so stashing is what
    makes twelve clips actually arrive in the GLB.

    Muted, because an unmuted track evaluates: twelve unmuted tracks would blend
    into each other and the viewport would show a pose that is none of the clips.
    Muting does not affect export.
    """
    if target.animation_data is None:
        target.animation_data_create()
    anim = target.animation_data
    for track in anim.nla_tracks:
        if track.name == action.name:
            return  # already stashed, from an earlier run
    track = anim.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, int(action.frame_range[0]), action)
    track.mute = True


def main():
    print("\n" + "=" * 68)
    print("  PHOTON — batch clip import")
    print("=" * 68)

    folder = resolve_clip_dir()
    if not folder:
        print(f"\n  no clip folder. Set CLIP_DIR, or make a 'clips' folder next to the .blend.")
        print("=" * 68 + "\n")
        return

    target = find_target_armature()
    if not target:
        print("\n  no armature in this file — is the robot .blend open?")
        print("=" * 68 + "\n")
        return

    files = sorted(f for f in os.listdir(folder) if f.lower().endswith(".fbx"))
    if not files:
        print(f"\n  no .fbx files in {folder}")
        print("=" * 68 + "\n")
        return

    print(f"  folder    {folder}")
    print(f"  armature  {target.name}  ({len(target.data.bones)} bones)")
    print(f"  found     {len(files)} file(s)\n")

    results = [import_clip(os.path.join(folder, f), target) for f in files]

    print(f"  {'CLIP':<24} {'FRAMES':>7} {'CHANNELS':>9}  RESULT")
    print("  " + "-" * 62)
    for r in results:
        if r["ok"]:
            print(f"  {r['clip']:<24} {r['frames']:>7} {r['channels']:>9}  stashed")
        else:
            print(f"  {r['clip']:<24} {'-':>7} {'-':>9}  SKIPPED: {r['note']}")

    imported = {r["clip"] for r in results if r["ok"]}
    missing = [c for c in EXPECTED if c not in imported]
    extra = sorted(imported - set(EXPECTED))

    print("  " + "-" * 62)
    print(f"  {len(imported)}/{len(EXPECTED)} of the content pack present.")
    if missing:
        print("\n  MISSING — these states will fall back to another clip:")
        for c in missing:
            print(f"    {c}")
    if extra:
        # Not an error, but worth surfacing: a filename one character off Mixamo's
        # own is indistinguishable from a deliberate extra, and the first resolves
        # to nothing.
        print("\n  NOT IN THE PACK — check for a typo in the filename:")
        for c in extra:
            print(f"    {c}")

    print("\n  next:")
    print("    1. scrub the timeline on one clip to confirm the pose is not mangled")
    print("    2. run photon_export.py")
    print("    3. npm run asset-inspect -- <glb> --kind character --expect-clips 12")
    print("=" * 68 + "\n")


main()
