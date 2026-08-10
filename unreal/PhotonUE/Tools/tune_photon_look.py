"""Tune Photon arena exposure, bloom, light and emissive levels without rebuilding geometry.

Driven by environment variables so a sweep can be run from the shell:

  PHOTON_EXPOSURE   pinned auto-exposure brightness (min == max, so adaptation is off)
  PHOTON_BIAS       exposure compensation in stops
  PHOTON_BLOOM      bloom intensity
  PHOTON_LUMENS     per-ceiling-light lumens
  PHOTON_BAND       emissive strength on the ceiling light bands
  PHOTON_STRIP      emissive strength on wall/court energy strips
"""
import os
import unreal

MAP = "/Game/Photon/Maps/L_PhotonGrey"


def num(name, default):
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return float(default)


EXPOSURE = num("PHOTON_EXPOSURE", 1.0)
BIAS = num("PHOTON_BIAS", 0.0)
BLOOM = num("PHOTON_BLOOM", 0.25)
LUMENS = num("PHOTON_LUMENS", 60000.0)
BAND = num("PHOTON_BAND", 2.0)
STRIP = num("PHOTON_STRIP", 3.0)

unreal.EditorLoadingAndSavingUtils.load_map(MAP)
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)

lights = 0
bands = 0
strips = 0

for a in subsys.get_all_level_actors():
    label = a.get_actor_label()

    if isinstance(a, unreal.RectLight) and label.startswith("CeilingLight"):
        a.rect_light_component.set_editor_property("intensity", LUMENS)
        lights += 1
        continue

    if isinstance(a, unreal.PostProcessVolume) and label == "PhotonPostProcess":
        s = a.get_editor_property("settings")
        s.set_editor_property("override_auto_exposure_min_brightness", True)
        s.set_editor_property("auto_exposure_min_brightness", EXPOSURE)
        s.set_editor_property("override_auto_exposure_max_brightness", True)
        s.set_editor_property("auto_exposure_max_brightness", EXPOSURE)
        s.set_editor_property("override_auto_exposure_bias", True)
        s.set_editor_property("auto_exposure_bias", BIAS)
        s.set_editor_property("override_bloom_intensity", True)
        s.set_editor_property("bloom_intensity", BLOOM)
        a.set_editor_property("settings", s)
        continue

    if not isinstance(a, unreal.StaticMeshActor):
        continue

    smc = a.static_mesh_component
    mid = smc.get_material(0)
    if not isinstance(mid, unreal.MaterialInstanceDynamic):
        mid = smc.create_dynamic_material_instance(0)
    if not mid:
        continue

    if label.startswith("CeilingBand"):
        mid.set_scalar_parameter_value("EmissiveStrength", BAND)
        bands += 1
    elif label.startswith("ArenaEnergyStrip"):
        mid.set_scalar_parameter_value("EmissiveStrength", STRIP)
        strips += 1

unreal.EditorLevelLibrary.save_current_level()

with open(unreal.Paths.project_saved_dir() + "Logs/photon_tune.txt", "w") as f:
    f.write("exposure=%.3f bias=%.2f bloom=%.2f lumens=%.0f band=%.2f strip=%.2f "
            "lights=%d bands=%d strips=%d" % (EXPOSURE, BIAS, BLOOM, LUMENS, BAND, STRIP,
                                              lights, bands, strips))
