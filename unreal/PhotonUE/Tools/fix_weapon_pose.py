"""Fix first-person weapon presentation: hip/ADS pose, muzzle offset, and recoil kick data.

CoD-style lower-right framing: forward-right-down offset, 0.34 uniform scale on the 98 cm GLB mesh,
minimal yaw so the rifle points downrange (+X in Unreal). PH-9 uses a tighter, slightly higher
compact SMG hold on the same mesh until a dedicated SMG asset exists.
"""
import unreal

# Shared mesh scale — 0.34 keeps a 98 cm rifle out of the crosshair without pushing it off-screen.
WEAPON_SCALE = unreal.Vector(0.34, 0.34, 0.34)

WEAPONS = {
    "DA_PH6_PhotonRifle": dict(
        hip_loc=unreal.Vector(44.0, 14.0, -12.0),
        hip_rot=unreal.Rotator(roll=0.0, pitch=-1.5, yaw=2.0),
        ads_loc=unreal.Vector(50.0, 3.0, -10.0),
        ads_rot=unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0),
        muzzle_offset=unreal.Vector(52.0, 0.0, 2.0),
        recoil_kick=unreal.Vector(-2.8, 0.35, 0.45),
        recoil_mesh_pitch_scale=3.5,
    ),
    "DA_PH9_Swift": dict(
        hip_loc=unreal.Vector(40.0, 16.0, -10.0),
        hip_rot=unreal.Rotator(roll=0.0, pitch=-0.8, yaw=3.0),
        ads_loc=unreal.Vector(46.0, 4.0, -8.0),
        ads_rot=unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0),
        muzzle_offset=unreal.Vector(48.0, 0.0, 1.5),
        recoil_kick=unreal.Vector(-2.0, 0.4, 0.35),
        recoil_mesh_pitch_scale=2.8,
    ),
}

mesh = unreal.EditorAssetLibrary.load_asset(
    "/Game/Photon/Weapons/GLB/HeroLaserRifle_v01/StaticMeshes/HeroLaserRifle_v01")
if not mesh:
    mesh = unreal.EditorAssetLibrary.load_asset("/Game/Photon/Weapons/PH6_PhotonRifle")
unreal.log("PHOTONPOSE mesh=%s" % (mesh is not None))

for asset_name, spec in WEAPONS.items():
    path = "/Game/Photon/Weapons/%s" % asset_name
    d = unreal.EditorAssetLibrary.load_asset(path)
    if not d:
        unreal.log_error("PHOTONPOSE missing %s" % path)
        continue

    hip = unreal.Transform(
        location=spec["hip_loc"],
        rotation=spec["hip_rot"],
        scale=WEAPON_SCALE)
    ads = unreal.Transform(
        location=spec["ads_loc"],
        rotation=spec["ads_rot"],
        scale=WEAPON_SCALE)

    d.set_editor_property("hip_transform", hip)
    d.set_editor_property("ads_transform", ads)
    d.set_editor_property("muzzle_offset", spec["muzzle_offset"])
    d.set_editor_property("recoil_kick_offset", spec["recoil_kick"])
    d.set_editor_property("recoil_mesh_pitch_scale", spec["recoil_mesh_pitch_scale"])
    if mesh:
        d.set_editor_property("mesh", mesh)

    unreal.EditorAssetLibrary.save_loaded_asset(d)
    t = d.get_editor_property("hip_transform")
    unreal.log(
        "PHOTONPOSE %s hip_loc=%s scale=%s muzzle=%s kick=%s"
        % (
            asset_name,
            t.translation,
            t.scale3d,
            d.get_editor_property("muzzle_offset"),
            d.get_editor_property("recoil_kick_offset"),
        ))
