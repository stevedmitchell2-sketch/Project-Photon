import unreal

# unreal.Rotator is (roll, pitch, yaw) in Python -- NOT (pitch, yaw, roll) as in C++ FRotator's
# constructor. Positional args here produced a PlayerStart pitched 90 degrees (spawning the player
# looking straight up) and a directional light aimed at the sky, which rendered a completely black
# viewport. Every Rotator below is therefore keyword-only.

CUBE = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")
MAP = "/Game/Photon/Maps/L_PhotonGrey"

def box(loc, scale, label):
    a = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(*loc), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
    a.set_actor_label(label)
    a.set_actor_scale3d(unreal.Vector(*scale))
    a.static_mesh_component.set_static_mesh(CUBE)
    a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    return a

unreal.EditorLevelLibrary.new_level(MAP)

# Cube is 100 cm, so scale == metres. A 40 x 40 m floor gives room to test weapon range.
box((0, 0, -50), (40, 40, 1), "Floor")
for x, y, sx, sy in [(2000, 0, 1, 40), (-2000, 0, 1, 40), (0, 2000, 40, 1), (0, -2000, 40, 1)]:
    box((x, y, 200), (sx, sy, 5), "Wall")

# Cover at varied heights: chest-high to test crouching behind, plus a step up.
for i, (x, y, h) in enumerate([(500, 300, 1.2), (-600, -200, 1.2), (900, -800, 0.6),
                               (-1100, 700, 2.0), (0, 1100, 1.2), (1400, 1200, 0.6)]):
    box((x, y, h * 50 - 50), (2, 2, h), "Cover_%d" % i)
box((-1500, -1500, 25), (6, 6, 1.5), "Platform")

light = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.DirectionalLight, unreal.Vector(0, 0, 1200), unreal.Rotator(roll=0.0, pitch=-52.0, yaw=30.0))
light.set_actor_label("KeyLight")
light.light_component.set_mobility(unreal.ComponentMobility.MOVABLE)
light.light_component.set_intensity(3.2)
sky = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.SkyLight, unreal.Vector(0, 0, 600), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
sky.set_actor_label("SkyFill")
sky.light_component.set_mobility(unreal.ComponentMobility.MOVABLE)
sky.light_component.set_intensity(1.0)

start = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.PlayerStart, unreal.Vector(0, -1400, 150), unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0))
start.set_actor_label("PhotonSpawn")

unreal.EditorLevelLibrary.save_current_level()
actors = unreal.EditorLevelLibrary.get_all_level_actors()
unreal.log("PHOTONVERIFY greybox actors=%d map=%s" % (len(actors), MAP))
unreal.log("PHOTONVERIFY playerstart=%d" % len([a for a in actors if isinstance(a, unreal.PlayerStart)]))
