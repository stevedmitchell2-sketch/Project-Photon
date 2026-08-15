"""Create M_PhotonHero with UsedWithSkeletalMesh set BEFORE first compile.

Also force-recompile existing Photon materials so skeletal permutations exist.
"""
import unreal

CONTENT = "/Game/Photon/Materials"
mel = unreal.MaterialEditingLibrary
PATH = CONTENT + "/M_PhotonHero"


def ensure_dir():
    if not unreal.EditorAssetLibrary.does_directory_exist(CONTENT):
        unreal.EditorAssetLibrary.make_directory(CONTENT)


def force_skel(mat):
    mat.set_editor_property("used_with_skeletal_mesh", True)
    mat.set_editor_property("used_with_morph_targets", True)
    mel.recompile_material(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)


ensure_dir()

if unreal.EditorAssetLibrary.does_asset_exist(PATH):
    mat = unreal.EditorAssetLibrary.load_asset(PATH)
    force_skel(mat)
    unreal.log("PHOTONHEROMAT refreshed M_PhotonHero")
else:
    mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        "M_PhotonHero", CONTENT, unreal.Material, unreal.MaterialFactoryNew())
    # Flag BEFORE connecting/compiling so the skeletal permutation is built.
    mat.set_editor_property("used_with_skeletal_mesh", True)
    mat.set_editor_property("used_with_morph_targets", True)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_DEFAULT_LIT)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)

    tint = mel.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, -420, 0)
    tint.set_editor_property("parameter_name", "TintColor")
    tint.set_editor_property("default_value", unreal.LinearColor(0.35, 0.55, 0.85, 1.0))
    rough = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -420, 200)
    rough.set_editor_property("parameter_name", "Roughness")
    rough.set_editor_property("default_value", 0.55)
    metal = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -420, 300)
    metal.set_editor_property("parameter_name", "Metallic")
    metal.set_editor_property("default_value", 0.15)
    emis = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -420, 400)
    emis.set_editor_property("parameter_name", "EmissiveStrength")
    emis.set_editor_property("default_value", 1.5)

    mel.connect_material_property(tint, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(metal, "", unreal.MaterialProperty.MP_METALLIC)
    glow = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -160, 400)
    mel.connect_material_expressions(tint, "", glow, "A")
    mel.connect_material_expressions(emis, "", glow, "B")
    mel.connect_material_property(glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)

    mel.recompile_material(mat)
    mel.layout_material_expressions(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    unreal.log("PHOTONHEROMAT created M_PhotonHero")

# Recompile siblings so skeletal flag is not a stale property without shaders.
for name in ["M_PhotonMetal", "M_PhotonCover", "M_PhotonGlow", "M_PhotonSurface"]:
    p = "%s/%s" % (CONTENT, name)
    m = unreal.EditorAssetLibrary.load_asset(p)
    if m and isinstance(m, unreal.Material):
        force_skel(m)
        unreal.log("PHOTONHEROMAT recompiled %s" % name)

unreal.log("PHOTONHEROMAT done")
