"""Create PH-10 burst rifle data asset — third loadout slot, data-driven burst fire."""
import unreal

PATH = "/Game/Photon/Weapons/DA_PH10_Burst"
HIP = unreal.Transform(
    location=unreal.Vector(42.0, 15.0, -11.0),
    rotation=unreal.Rotator(roll=0.0, pitch=-1.0, yaw=2.0),
    scale=unreal.Vector(0.34, 0.34, 0.34))
ADS = unreal.Transform(
    location=unreal.Vector(48.0, 3.0, -9.0),
    rotation=unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0),
    scale=unreal.Vector(0.34, 0.34, 0.34))

mesh = unreal.EditorAssetLibrary.load_asset(
    "/Game/Photon/Weapons/GLB/HeroLaserRifle_v01/StaticMeshes/HeroLaserRifle_v01")

factory = unreal.DataAssetFactory()
factory.set_editor_property("data_asset_class", unreal.PhotonWeaponData)
asset = unreal.EditorAssetLibrary.load_asset(PATH)
if not asset:
    asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        "DA_PH10_Burst", "/Game/Photon/Weapons", unreal.PhotonWeaponData, factory)

if asset:
    asset.set_editor_property("weapon_id", "ph10_burst")
    asset.set_editor_property("display_name", unreal.Text("PH-10 Burst"))
    asset.set_editor_property("fire_mode", unreal.PhotonFireMode.BURST)
    asset.set_editor_property("burst_count", 3)
    asset.set_editor_property("fire_interval", 0.36)
    asset.set_editor_property("capacity", 12)
    asset.set_editor_property("projectile_speed", 20500.0)
    asset.set_editor_property("projectile_lifetime", 1.4)
    asset.set_editor_property("projectile_radius", 8.0)
    asset.set_editor_property("damage", 22.0)
    asset.set_editor_property("headshot_multiplier", 1.6)
    asset.set_editor_property("falloff_start", 2400.0)
    asset.set_editor_property("falloff_end", 4800.0)
    asset.set_editor_property("min_damage_scale", 0.55)
    asset.set_editor_property("spread_base", 0.45)
    asset.set_editor_property("spread_moving", 1.05)
    asset.set_editor_property("spread_air", 2.2)
    asset.set_editor_property("spread_ads", 0.12)
    asset.set_editor_property("spread_per_shot", 0.28)
    asset.set_editor_property("spread_max", 3.2)
    asset.set_editor_property("spread_recovery", 3.8)
    asset.set_editor_property("recoil_pitch", 0.65)
    asset.set_editor_property("recoil_yaw", 0.28)
    asset.set_editor_property("recoil_recovery_half_life", 0.1)
    asset.set_editor_property("hip_transform", HIP)
    asset.set_editor_property("ads_transform", ADS)
    asset.set_editor_property("muzzle_offset", unreal.Vector(50.0, 0.0, 2.0))
    asset.set_editor_property("recoil_kick_offset", unreal.Vector(-2.4, 0.3, 0.4))
    asset.set_editor_property("recoil_mesh_pitch_scale", 3.0)
    if mesh:
        asset.set_editor_property("mesh", mesh)
    unreal.EditorAssetLibrary.save_loaded_asset(asset)
    unreal.log("PHOTONBURST created id=%s burst=%d interval=%.2f dmg=%.0f"
               % (asset.get_editor_property("weapon_id"),
                  asset.get_editor_property("burst_count"),
                  asset.get_editor_property("fire_interval"),
                  asset.get_editor_property("damage")))
