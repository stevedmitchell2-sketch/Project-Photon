"""Create the default Photon energy grenade data asset."""
import unreal

PATH = "/Game/Photon/Weapons/DA_PhotonGrenade"
factory = unreal.DataAssetFactory()
factory.set_editor_property("data_asset_class", unreal.PhotonGrenadeData)

existing = unreal.EditorAssetLibrary.load_asset(PATH)
if existing:
    asset = existing
    unreal.log("PHOTONGRENADE updating existing asset")
else:
    asset = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        "DA_PhotonGrenade", "/Game/Photon/Weapons", unreal.PhotonGrenadeData, factory)
    unreal.log("PHOTONGRENADE created=%s" % (asset is not None))

if asset:
    asset.set_editor_property("grenade_id", "photon_grenade")
    asset.set_editor_property("display_name", unreal.Text("Photon Energy Grenade"))
    asset.set_editor_property("throw_speed", 2200.0)
    asset.set_editor_property("throw_upward_boost", 620.0)
    asset.set_editor_property("fuse_time", 2.0)
    asset.set_editor_property("bounciness", 0.45)
    asset.set_editor_property("explosion_radius", 450.0)
    asset.set_editor_property("max_damage", 80.0)
    asset.set_editor_property("min_damage_scale", 0.2)
    unreal.EditorAssetLibrary.save_loaded_asset(asset)
    unreal.log("PHOTONGRENADE fuse=%.1f radius=%.0f damage=%.0f"
               % (asset.get_editor_property("fuse_time"),
                  asset.get_editor_property("explosion_radius"),
                  asset.get_editor_property("max_damage")))
