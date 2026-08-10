"""Report spawn orientation, lighting actors and Photon material wiring for the visual sprint.

Writes to Saved/Logs/photon_probe.txt: unreal.log Display output is swallowed when running as a
commandlet, so the report goes to a file rather than the engine log.
"""
import unreal

MAP = "/Game/Photon/Maps/L_PhotonGrey"
OUT = unreal.Paths.project_saved_dir() + "Logs/photon_probe.txt"

lines = []


def say(text):
    lines.append(text)


unreal.EditorLoadingAndSavingUtils.load_map(MAP)

subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
actors = subsys.get_all_level_actors()
say("total_actors=%d" % len(actors))

for a in actors:
    if isinstance(a, unreal.PlayerStart):
        r = a.get_actor_rotation()
        say("playerstart label=%s loc=%s roll=%.1f pitch=%.1f yaw=%.1f"
            % (a.get_actor_label(), a.get_actor_location(), r.roll, r.pitch, r.yaw))
    elif isinstance(a, unreal.DirectionalLight):
        r = a.get_actor_rotation()
        say("dirlight label=%s intensity=%.3f pitch=%.1f yaw=%.1f mobility=%s"
            % (a.get_actor_label(), a.light_component.intensity, r.pitch, r.yaw,
               a.light_component.mobility))
    elif isinstance(a, unreal.SkyLight):
        say("skylight label=%s intensity=%.3f" % (a.get_actor_label(), a.light_component.intensity))
    elif isinstance(a, unreal.PostProcessVolume):
        say("postprocess label=%s unbound=%s" % (a.get_actor_label(), a.unbound))
    elif isinstance(a, unreal.ExponentialHeightFog):
        say("fog label=%s" % a.get_actor_label())
    elif isinstance(a, unreal.SkyAtmosphere):
        say("skyatmosphere label=%s" % a.get_actor_label())

for name in ["M_PhotonSurface", "M_PhotonFloor", "M_PhotonCover", "M_PhotonGlow"]:
    path = "/Game/Photon/Materials/%s" % name
    mat = unreal.EditorAssetLibrary.load_asset(path)
    if not mat:
        say("material MISSING %s" % name)
        continue
    mel = unreal.MaterialEditingLibrary
    vectors = [str(p) for p in mel.get_vector_parameter_names(mat)]
    scalars = [str(p) for p in mel.get_scalar_parameter_names(mat)]
    say("material %s shading=%s vectors=%s scalars=%s"
        % (name, mat.get_editor_property("shading_model"), vectors, scalars))
    for p in mel.get_vector_parameter_names(mat):
        say("  %s.%s default=%s" % (name, p, mel.get_material_default_vector_parameter_value(mat, p)))
    for p in mel.get_scalar_parameter_names(mat):
        say("  %s.%s default=%s" % (name, p, mel.get_material_default_scalar_parameter_value(mat, p)))

sampled = 0
for a in actors:
    if not isinstance(a, unreal.StaticMeshActor) or sampled >= 10:
        continue
    smc = a.static_mesh_component
    m0 = smc.get_material(0)
    say("actor %s material0=%s" % (a.get_actor_label(), m0.get_name() if m0 else "None"))
    sampled += 1

with open(OUT, "w") as f:
    f.write("\n".join(lines))
