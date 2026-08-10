"""Regenerate the greybox with correct rotations, and wire the PH-6 mesh into the weapon data.

Both problems observed in the first real visual test are addressed here:

  * Black screen. unreal.Rotator is (roll, pitch, yaw) in Python. Positional args written in C++
    FRotator order pitched the PlayerStart 90 degrees (player spawns looking straight up) and aimed
    the directional light at the sky. Every actor existed and was correctly counted, which is why the
    headless assertions passed while the level was unusable.
  * Invisible weapon. The bootstrap set the numeric fields on the weapon data assets but never
    assigned Mesh, so APhotonWeapon had nothing to draw. Asserted below rather than assumed.
"""
import unreal

MAP = "/Game/Photon/Maps/L_PhotonGrey"
CUBE = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")


def box(loc, scale, label):
    a = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(*loc), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
    a.set_actor_label(label)
    a.set_actor_scale3d(unreal.Vector(*scale))
    a.static_mesh_component.set_static_mesh(CUBE)
    return a


unreal.EditorLevelLibrary.new_level(MAP)

box((0, 0, -50), (40, 40, 1), "Floor")
for x, y, sx, sy in [(2000, 0, 1, 40), (-2000, 0, 1, 40), (0, 2000, 40, 1), (0, -2000, 40, 1)]:
    box((x, y, 200), (sx, sy, 5), "Wall")
# Cover at varied heights, plus targets at three engagement distances so range can be tested.
for i, (x, y, h) in enumerate([(500, 300, 1.2), (-600, -200, 1.2), (900, -800, 0.6),
                               (-1100, 700, 2.0), (0, 400, 1.2), (1400, 1200, 0.6)]):
    box((x, y, h * 50 - 50), (2, 2, h), "Cover_%d" % i)
box((-1500, -1500, 25), (6, 6, 1.5), "Platform")

# Movable, because the geometry is Static and no lighting has been built; Lumen needs no bake.
light = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.DirectionalLight, unreal.Vector(0, 0, 1200),
    unreal.Rotator(roll=0.0, pitch=-48.0, yaw=35.0))
light.set_actor_label("KeyLight")
light.light_component.set_mobility(unreal.ComponentMobility.MOVABLE)
light.light_component.set_intensity(4.0)

sky = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.SkyLight, unreal.Vector(0, 0, 700), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
sky.set_actor_label("SkyFill")
sky.light_component.set_mobility(unreal.ComponentMobility.MOVABLE)
sky.light_component.set_intensity(1.6)

start = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.PlayerStart, unreal.Vector(0, -1400, 150), unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0))
start.set_actor_label("PhotonSpawn")

# Three shootable pylons down the firing line.
for i, (x, y) in enumerate([(0, 600), (700, 1300), (-800, 1600)]):
    t = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.load_class(None, "/Script/Photon.PhotonTarget"),
        unreal.Vector(x, y, 140), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
    t.set_actor_label("Target_%d" % i)

unreal.EditorLevelLibrary.save_current_level()

actors = unreal.EditorLevelLibrary.get_all_level_actors()
ps = [a for a in actors if isinstance(a, unreal.PlayerStart)]
unreal.log("PHOTONFIX actors=%d playerstarts=%d" % (len(actors), len(ps)))
for a in ps:
    r = a.get_actor_rotation()
    unreal.log("PHOTONFIX playerstart rot roll=%.1f pitch=%.1f yaw=%.1f loc=%s"
               % (r.roll, r.pitch, r.yaw, a.get_actor_location()))
lr = light.get_actor_rotation()
unreal.log("PHOTONFIX keylight rot roll=%.1f pitch=%.1f yaw=%.1f intensity=%.1f"
           % (lr.roll, lr.pitch, lr.yaw, light.light_component.intensity))

# --- Weapon meshes -------------------------------------------------------------------------------
MESH = unreal.EditorAssetLibrary.load_asset("/Game/Photon/Weapons/PH6_PhotonRifle")
unreal.log("PHOTONFIX ph6_static_mesh_loaded=%s" % (MESH is not None))
for path in ["/Game/Photon/Weapons/DA_PH6_PhotonRifle", "/Game/Photon/Weapons/DA_PH9_Swift"]:
    d = unreal.EditorAssetLibrary.load_asset(path)
    if not d:
        unreal.log_error("PHOTONFIX missing %s" % path)
        continue
    before = d.get_editor_property("mesh")
    if MESH and not before:
        d.set_editor_property("mesh", MESH)
        unreal.EditorAssetLibrary.save_loaded_asset(d)
    after = d.get_editor_property("mesh")
    unreal.log("PHOTONFIX %s mesh_before=%s mesh_after=%s"
               % (path.split("/")[-1], before is not None, after is not None))
