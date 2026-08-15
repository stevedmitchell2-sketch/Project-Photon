"""Report what is actually standing in the play space, and how big it is.

Written because a tour frame came back with an unidentified wall filling two thirds of it and no
amount of reading the build script found the culprit. Listing bounds is faster than guessing.
"""
import unreal

MAP = "/Game/Photon/Maps/L_PhotonGrey"
PLAY_HALF = 2000.0
EYE = 190.0

unreal.EditorLoadingAndSavingUtils.load_map(MAP)
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

lines = []
occluders = []
for a in subsys.get_all_level_actors():
    if not isinstance(a, unreal.StaticMeshActor):
        continue
    origin, extent = a.get_actor_bounds(False)
    # Inside the play space, tall enough to block a standing player, and not the floor.
    if abs(origin.x) > PLAY_HALF or abs(origin.y) > PLAY_HALF:
        continue
    if origin.z - extent.z > EYE or origin.z + extent.z < 40.0:
        continue
    if extent.z < 40.0:
        continue
    occluders.append((extent.x * extent.y * extent.z, a.get_actor_label(), origin, extent))

occluders.sort(reverse=True, key=lambda t: t[0])
lines.append("=== volumes inside the play space that block eye height, largest first ===")
for _vol, label, o, e in occluders[:30]:
    lines.append("  %-28s at (%7.0f %7.0f %7.0f)  half-extent (%6.0f %6.0f %6.0f)"
                 % (label, o.x, o.y, o.z, e.x, e.y, e.z))

lines.append("")
lines.append("=== anything at all within 1100 uu of the centre dais ===")
for a in subsys.get_all_level_actors():
    if not isinstance(a, unreal.StaticMeshActor):
        continue
    o, e = a.get_actor_bounds(False)
    if o.x * o.x + o.y * o.y < 1100.0 * 1100.0 and o.z < 1200.0:
        lines.append("  %-28s at (%7.0f %7.0f %7.0f)  half-extent (%6.0f %6.0f %6.0f)"
                     % (a.get_actor_label(), o.x, o.y, o.z, e.x, e.y, e.z))

for line in lines:
    unreal.log("PHOTONPROBE %s" % line)
with open(unreal.Paths.project_saved_dir() + "Logs/photon_arena_probe.txt", "w") as f:
    f.write("\n".join(lines))
