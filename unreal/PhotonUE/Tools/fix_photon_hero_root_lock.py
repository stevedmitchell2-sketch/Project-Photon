"""Force-lock Mixamo hero anim roots so the skinned body stays on the capsule."""
import unreal

CLIPS = [
    "/Game/Photon/Characters/Hero/A_PhotonHero_Idle",
    "/Game/Photon/Characters/Hero/A_PhotonHero_Walk",
    "/Game/Photon/Characters/Hero/A_PhotonHero_Run",
    "/Game/Photon/Characters/Hero/A_PhotonHero_Sprint",
    "/Game/Photon/Characters/Hero/PhotonHero_SKA_PhotonHero_Idle",
    "/Game/Photon/Characters/Hero/PhotonHero_SKA_PhotonHero_Walk",
    "/Game/Photon/Characters/Hero/PhotonHero_SKA_PhotonHero_Run",
    "/Game/Photon/Characters/Hero/PhotonHero_SKA_PhotonHero_Sprint",
]

fixed = 0
for path in CLIPS:
    clip = unreal.EditorAssetLibrary.load_asset(path)
    if not clip:
        continue
    clip.set_editor_property("enable_root_motion", False)
    clip.set_editor_property("force_root_lock", True)
    try:
        clip.set_editor_property("root_motion_root_lock", unreal.RootMotionRootLock.REF_POSE)
    except Exception:
        pass
    unreal.EditorAssetLibrary.save_loaded_asset(clip)
    unreal.log("PHOTONROOTLOCK %s" % clip.get_name())
    fixed += 1

unreal.log("PHOTONROOTLOCK done fixed=%d" % fixed)
