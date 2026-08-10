"""Make the greybox actually lit.

Evidence this is built on: projectile point lights DO illuminate the level. That proves geometry,
materials and the deferred lighting path all work, and narrows the fault to the sun and sky
contributing nothing.

Two causes, both addressed:
  * A SkyLight with nothing to capture captures black and contributes zero. The level has no sky at
    all, so a SkyAtmosphere is added to give it one.
  * The directional light was set to 4 lux, which is dusk. Raised and marked as the atmosphere sun.

Point lights are also placed as fill, because they are the one light type already proven to work here.
"""
import unreal

MAP = "/Game/Photon/Maps/L_PhotonGrey"
unreal.EditorLoadingAndSavingUtils.load_map(MAP)

actors = unreal.EditorLevelLibrary.get_all_level_actors()


def kill(cls):
    for a in list(actors):
        if isinstance(a, cls):
            unreal.EditorLevelLibrary.destroy_actor(a)


# Rebuild the lighting rig from scratch so repeated runs cannot stack duplicates.
kill(unreal.DirectionalLight)
kill(unreal.SkyLight)
kill(unreal.SkyAtmosphere)
kill(unreal.PointLight)

sun = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.DirectionalLight, unreal.Vector(0, 0, 1500),
    unreal.Rotator(roll=0.0, pitch=-48.0, yaw=35.0))
sun.set_actor_label("KeyLight")
sc = sun.light_component
sc.set_mobility(unreal.ComponentMobility.MOVABLE)
sc.set_intensity(10.0)          # lux; 4.0 was effectively dusk
sc.set_light_color(unreal.LinearColor(1.0, 0.965, 0.902, 1.0))
try:
    sc.set_editor_property("atmosphere_sun_light", True)
except Exception as exc:
    unreal.log_warning("PHOTONLIGHT atmosphere_sun_light unavailable: %s" % exc)

atmo = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.SkyAtmosphere, unreal.Vector(0, 0, 0), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
atmo.set_actor_label("SkyAtmosphere")

sky = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.SkyLight, unreal.Vector(0, 0, 800), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
sky.set_actor_label("SkyFill")
skc = sky.light_component
skc.set_mobility(unreal.ComponentMobility.MOVABLE)
skc.set_intensity(3.0)
try:
    skc.set_editor_property("real_time_capture", True)
except Exception as exc:
    unreal.log_warning("PHOTONLIGHT real_time_capture unavailable: %s" % exc)

# Practical fill. Point lights are the one type proven to light this level, so the greybox cannot end
# up black again even if the sky setup misbehaves on another machine.
for i, (x, y) in enumerate([(0, 0), (1200, 1200), (-1200, 1200), (1200, -1200), (-1200, -1200)]):
    pl = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.PointLight, unreal.Vector(x, y, 600), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
    pl.set_actor_label("Fill_%d" % i)
    plc = pl.light_component
    plc.set_mobility(unreal.ComponentMobility.MOVABLE)
    plc.set_intensity(40000.0)      # candelas
    plc.set_attenuation_radius(2200.0)
    plc.set_light_color(unreal.LinearColor(0.804, 0.882, 1.0, 1.0))

# The three targets were missing last run; load_class returning None is the suspected reason, so it is
# checked explicitly this time instead of failing silently.
tcls = unreal.load_class(None, "/Script/Photon.PhotonTarget")
unreal.log("PHOTONLIGHT target_class_loaded=%s" % (tcls is not None))
if tcls:
    for i, (x, y) in enumerate([(0, 600), (700, 1300), (-800, 1600)]):
        t = unreal.EditorLevelLibrary.spawn_actor_from_class(
            tcls, unreal.Vector(x, y, 140), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
        if t:
            t.set_actor_label("Target_%d" % i)

unreal.EditorLevelLibrary.save_current_level()

now = unreal.EditorLevelLibrary.get_all_level_actors()
counts = {}
for a in now:
    counts[type(a).__name__] = counts.get(type(a).__name__, 0) + 1
unreal.log("PHOTONLIGHT total_actors=%d" % len(now))
for k in sorted(counts):
    unreal.log("PHOTONLIGHT   %s = %d" % (k, counts[k]))
unreal.log("PHOTONLIGHT sun intensity=%.1f pitch=%.1f" % (sc.intensity, sun.get_actor_rotation().pitch))
