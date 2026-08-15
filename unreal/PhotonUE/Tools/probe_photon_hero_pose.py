"""Probe SK_PhotonHero + idle clip skeleton match and ref-pose bone spans."""
import unreal

HERO = "/Game/Photon/Characters/Hero/SK_PhotonHero"
IDLE = "/Game/Photon/Characters/Hero/A_PhotonHero_Idle"
IDLE2 = "/Game/Photon/Characters/Hero/PhotonHero_SKArmature_A_PhotonHero_Idle"


def skeleton_path(asset):
    if not asset:
        return None
    try:
        sk = asset.get_editor_property("skeleton")
        return sk.get_path_name() if sk else None
    except Exception as exc:
        return "err:%s" % exc


def main():
    hero = unreal.EditorAssetLibrary.load_asset(HERO)
    idle = unreal.EditorAssetLibrary.load_asset(IDLE)
    idle2 = unreal.EditorAssetLibrary.load_asset(IDLE2)
    unreal.log("PHOTONPOSE hero=%s skel=%s" % (hero, skeleton_path(hero)))
    unreal.log("PHOTONPOSE idle=%s skel=%s" % (idle, skeleton_path(idle)))
    unreal.log("PHOTONPOSE idle2=%s skel=%s" % (idle2, skeleton_path(idle2)))

    if hero:
        try:
            bones = list(unreal.EditorSkeletalMeshLibrary.get_bone_list(hero))
        except Exception:
            bones = []
        unreal.log("PHOTONPOSE bones=%d sample=%s" % (len(bones), bones[:12]))
        # Bound box of mesh
        try:
            bounds = hero.get_bounds()
            unreal.log("PHOTONPOSE mesh_bounds origin=%s box=%s" % (bounds.origin, bounds.box_extent))
        except Exception as exc:
            unreal.log("PHOTONPOSE bounds_err %s" % exc)

    for clip, label in ((idle, "idle"), (idle2, "idle2")):
        if not clip:
            continue
        try:
            unreal.log(
                "PHOTONPOSE %s root_motion=%s force_lock=%s len=%.2f"
                % (
                    label,
                    clip.get_editor_property("enable_root_motion"),
                    clip.get_editor_property("force_root_lock"),
                    float(clip.get_editor_property("sequence_length")),
                )
            )
        except Exception as exc:
            unreal.log("PHOTONPOSE %s props_err %s" % (label, exc))

    # Skeleton match
    hs = skeleton_path(hero)
    for clip, label in ((idle, "idle"), (idle2, "idle2")):
        cs = skeleton_path(clip)
        unreal.log("PHOTONPOSE match_%s=%s" % (label, hs == cs if hs and cs else None))


if __name__ == "__main__":
    main()
