"""Enable UsedWithSkeletalMesh on Photon surface materials so SK_PhotonHero can render them.

Without this flag UE logs:
  Material with missing usage flag was applied to skeletal mesh .../SK_PhotonHero
and the Mixamo body often draws invisible / black, so the chase cam looks empty.
"""
import unreal

PATHS = [
    "/Game/Photon/Materials/M_PhotonMetal",
    "/Game/Photon/Materials/M_PhotonCover",
    "/Game/Photon/Materials/M_PhotonGlow",
    "/Game/Photon/Materials/M_PhotonSurface",
    "/Game/Photon/Materials/M_PhotonFloor",
    "/Game/Photon/Materials/M_PhotonSolid",
    "/Game/Photon/Materials/M_PhotonEnergy",
]

mel = unreal.MaterialEditingLibrary
fixed = 0
for path in PATHS:
    mat = unreal.EditorAssetLibrary.load_asset(path)
    if not mat:
        unreal.log_warning("PHOTONMATSKEL missing %s" % path)
        continue
    # MaterialInstanceConstant parents still need the base Material flagged.
    base = mat
    if isinstance(mat, unreal.MaterialInstance):
        parent = mat.get_editor_property("parent")
        while parent and isinstance(parent, unreal.MaterialInstance):
            parent = parent.get_editor_property("parent")
        if parent:
            base = parent
    if not isinstance(base, unreal.Material):
        unreal.log_warning("PHOTONMATSKEL not a Material: %s" % path)
        continue
    already = bool(base.get_editor_property("used_with_skeletal_mesh"))
    if not already:
        base.set_editor_property("used_with_skeletal_mesh", True)
        mel.recompile_material(base)
        unreal.EditorAssetLibrary.save_loaded_asset(base)
        unreal.log("PHOTONMATSKEL enabled skeletal on %s" % base.get_name())
        fixed += 1
    else:
        unreal.log("PHOTONMATSKEL already set %s" % base.get_name())
    if mat != base:
        unreal.EditorAssetLibrary.save_loaded_asset(mat)

unreal.log("PHOTONMATSKEL done fixed=%d" % fixed)
