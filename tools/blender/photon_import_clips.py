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
2. Put them in one folder. The filename becomes the clip name, so leave the names
   alone — a `Robot@` prefix or a ` (1)` duplicate suffix is handled for you, but
   anything else you type in has to match Mixamo's own spelling exactly.
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
#:
#: On Windows this MUST be a raw string or use forward slashes. A plain
#: "C:\Users\..." fails to parse before Blender ever runs the script, because
#: Python reads the \U of \Users as the start of a unicode escape:
#:
#:     CLIP_DIR = r"C:\Users\You\Documents\ProjectPhoton\Clips"    # correct
#:     CLIP_DIR = "C:/Users/You/Documents/ProjectPhoton/Clips"     # also correct
#:     CLIP_DIR = "C:\Users\You\Documents\ProjectPhoton\Clips"     # SyntaxError
CLIP_DIR = ""

#: Re-import a clip that is already in the file, replacing it. Leave False for a
#: normal run: re-running then skips what is already there instead of creating
#: `Fast Run.001` alongside `Fast Run`. Set True after re-downloading a clip.
REPLACE_EXISTING = False

#: Substring identifying the armature to receive the clips. The robot's armature
#: is the only one in the file, so this is a safety net rather than a selector.
TARGET_ARMATURE_HINT = ""

#: Clips the pack expects, for the coverage report at the end. Mixamo's names,
#: verbatim — these are what the engine matches on.
EXPECTED = (
    "Breathing Idle", "Walking", "Running", "Fast Run",
    "Crouching Idle", "Running Slide",
    "Jumping Up", "Falling Idle", "Hard Landing",
    "Left Turn", "Button Pushing", "Falling Back Death",
)


def clip_frames(action):
    """Length in frames, or None if this Blender does not report a range."""
    span = getattr(action, "frame_range", None)
    return int(span[1] - span[0]) if span else None


def already_stashed(target, name):
    """True when `target` already carries an NLA track for this clip."""
    anim = getattr(target, "animation_data", None)
    if not anim:
        return False
    return any(track.name == name for track in anim.nla_tracks)


def drop_clip(target, name):
    """Remove a clip's NLA track and its action, so a re-import is clean."""
    anim = getattr(target, "animation_data", None)
    if anim:
        for track in list(anim.nla_tracks):
            if track.name == name:
                anim.nla_tracks.remove(track)
    action = bpy.data.actions.get(name)
    if action:
        action.use_fake_user = False
        bpy.data.actions.remove(action)


def action_channel_count(action):
    """Number of animated channels, across Blender's old and new action APIs.

    Blender 4.4 restructured actions into layers, strips and channelbags — "slotted
    actions" — and `Action.fcurves`, the accessor every pre-4.4 script used, is gone
    in 5.x. Reaching for it raises `AttributeError: 'Action' object has no attribute
    'fcurves'`.

    This is only used for the report, so an API this does not recognise returns None
    and prints a dash rather than stopping an import that otherwise worked.
    """
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        return len(legacy)

    total = 0
    for layer in getattr(action, "layers", []):
        for strip in getattr(layer, "strips", []):
            # channelbags is the 4.4+ container; older betas exposed `channels`.
            bags = getattr(strip, "channelbags", None)
            if bags is None:
                bags = getattr(strip, "channels", [])
            for bag in bags:
                total += len(getattr(bag, "fcurves", []))
    return total or None


def clip_name_from_file(path):
    """Derive the clip name from a downloaded filename.

    Mixamo is not consistent about what it writes. Downloading against an uploaded
    character prefixes the character name — `Robot@Fast Run.fbx` — and downloading
    the same clip twice gives `Fast Run (1).fbx`. Both produce a name the engine
    will not match, and the failure is the silent kind: the clip loads fine and the
    state it was meant for resolves to something else.

    So: everything before an `@` goes, and a trailing browser duplicate marker goes.
    Nothing else is touched, because the remaining text has to stay character-exact.
    """
    name = os.path.splitext(os.path.basename(path))[0]
    if "@" in name:
        name = name.split("@")[-1]
    # " (1)", " (2)" — Chrome's duplicate-download suffix.
    if name.endswith(")") and " (" in name:
        head, _, tail = name.rpartition(" (")
        if tail[:-1].isdigit():
            name = head
    return name.strip()


def resolve_clip_dir():
    """Return the folder to scan, or None."""
    folder = CLIP_DIR or os.path.join(bpy.path.abspath("//"), "clips")
    return folder if os.path.isdir(folder) else None


def deforming_armatures():
    """Armatures that actually deform a mesh, via an Armature modifier.

    This is the only definition that matters. A clip stashed on an armature that
    deforms nothing exports as a perfectly valid glTF animation targeting a skeleton
    no mesh is bound to — it loads, it validates, and the character never moves.
    """
    found = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for mod in obj.modifiers:
            if mod.type == "ARMATURE" and mod.object and mod.object not in found:
                found.append(mod.object)
    return found


def find_target_armature():
    """The armature that deforms the robot mesh.

    ## Why this is not simply "the first armature"

    It was, and that shipped eleven clips onto the wrong skeleton.

    The first run of this script crashed on `Action.fcurves` *before* reaching the
    cleanup that deletes the armature each FBX import brings in. So the .blend was
    left with two 49-bone skeletons: `Photon Robot Armature`, which deforms the
    mesh, and a stray `Armature`, which deforms nothing. `armatures[0]` picked the
    stray, every clip was stashed on it, and the export was flawless — 98 joints,
    2 skins, 12 named clips, valid weights, every file-level check green. The robot
    simply would not have animated.

    So: prefer an armature with a mesh actually bound to it, and refuse to guess
    when the answer is ambiguous. A loud stop costs a minute; the silent version
    cost a full download, import and export cycle.
    """
    deforming = deforming_armatures()
    if TARGET_ARMATURE_HINT:
        hinted = [o for o in deforming or bpy.data.objects
                  if o.type == "ARMATURE" and TARGET_ARMATURE_HINT.lower() in o.name.lower()]
        return hinted[0] if hinted else None

    if len(deforming) == 1:
        return deforming[0]
    if len(deforming) > 1:
        print(f"  STOP: {len(deforming)} armatures deform a mesh: "
              f"{', '.join(o.name for o in deforming)}")
        print("        set TARGET_ARMATURE_HINT to the right one.")
        return None

    # Nothing is bound. Fall back, but say so — this is how the wrong pick happened.
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not armatures:
        return None
    if len(armatures) > 1:
        print(f"  STOP: {len(armatures)} armatures in the file and none deform a mesh:")
        for o in armatures:
            print(f"          {o.name}")
        print("        Delete the strays, or set TARGET_ARMATURE_HINT. Refusing to guess —")
        print("        a clip stashed on the wrong skeleton exports clean and never plays.")
        return None
    print(f"  note: '{armatures[0].name}' deforms no mesh; using it anyway as it is the only one.")
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
    name = clip_name_from_file(path)

    # Re-runs have to be safe, because the first run of this script crashed partway
    # through and anyone would simply run it again. Without this, a second import
    # creates a fresh action, finds `Fast Run` taken, settles for `Fast Run.001`, and
    # stashes that as a thirteenth track — a clip name that resolves to nothing.
    existing = bpy.data.actions.get(name)
    stashed = already_stashed(target, name)
    if existing and not REPLACE_EXISTING:
        if not stashed:
            # The action is in the file but not on *this* armature — which is exactly the
            # state left behind when the clips were stashed on the wrong skeleton. Re-stash
            # rather than re-import: an action's fcurves address bones by name, so it is
            # already correct, and re-importing would find the name taken and create
            # `Fast Run.001` instead.
            stash(target, existing)
            note = "re-stashed onto " + target.name
        else:
            note = "already present"
        return {"file": os.path.basename(path), "clip": name, "ok": True, "skipped": True,
                "frames": clip_frames(existing), "channels": action_channel_count(existing),
                "note": note}
    if REPLACE_EXISTING:
        drop_clip(target, name)

    before_actions = set(bpy.data.actions)
    before_objects = set(bpy.data.objects)

    # Defaults deliberately: see the docstring. `ignore_leaf_bones` off keeps the
    # toe-end and finger-tip bones the target rig also has, so channel names line up.
    bpy.ops.import_scene.fbx(filepath=path)

    new_actions = [a for a in bpy.data.actions if a not in before_actions]
    new_objects = [o for o in bpy.data.objects if o not in before_objects]

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
        result["frames"] = clip_frames(action)
        result["channels"] = action_channel_count(action)

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
    track.strips.new(action.name, int((getattr(action, "frame_range", None) or (0, 0))[0]), action)
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
        frames = r.get("frames")
        channels = r.get("channels")
        cells = f"{(frames if frames is not None else '-'):>7} {(channels if channels is not None else '-'):>9}"
        if r["ok"]:
            state = r.get("note") or "stashed" if r.get("skipped") else "stashed"
            print(f"  {r['clip']:<24} {cells}  {state}")
        else:
            print(f"  {r['clip']:<24} {cells}  SKIPPED: {r['note']}")

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
