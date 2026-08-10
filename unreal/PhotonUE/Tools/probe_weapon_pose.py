"""Read current weapon presentation values from data assets — audit helper."""
import unreal

for path in [
    "/Game/Photon/Weapons/DA_PH6_PhotonRifle",
    "/Game/Photon/Weapons/DA_PH9_Swift",
]:
    d = unreal.EditorAssetLibrary.load_asset(path)
    if not d:
        unreal.log_error("PHOTONAUDIT missing %s" % path)
        continue
    hip = d.get_editor_property("hip_transform")
    ads = d.get_editor_property("ads_transform")
    mesh = d.get_editor_property("mesh")
    mesh_path = mesh.get_path_name() if mesh else "NONE"
    unreal.log(
        "PHOTONAUDIT %s mesh=%s hip_loc=%s hip_rot=(p=%.2f y=%.2f r=%.2f) hip_scale=%s ads_loc=%s recoil_pitch=%.3f"
        % (
            path.split("/")[-1],
            mesh_path,
            hip.translation,
            hip.rotation.pitch,
            hip.rotation.yaw,
            hip.rotation.roll,
            hip.scale3d,
            ads.translation,
            d.get_editor_property("recoil_pitch"),
        )
    )
