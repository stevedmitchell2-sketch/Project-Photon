"""Create reusable Photon solid/energy materials with TintColor + EmissiveStrength parameters."""
import unreal

CONTENT = "/Game/Photon/Materials"


def ensure_dir():
    if not unreal.EditorAssetLibrary.does_directory_exist(CONTENT):
        unreal.EditorAssetLibrary.make_directory(CONTENT)


def connect_emissive_unlit(mat, colour_expr, strength_expr):
    mel = unreal.MaterialEditingLibrary
    emissive = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, 120, 0)
    mel.connect_material_expressions(colour_expr, "", emissive, "A")
    mel.connect_material_expressions(strength_expr, "", emissive, "B")
    mel.connect_material_property(emissive, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    mel.connect_material_property(colour_expr, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)


def create_material(name, default_color, default_emissive):
    path = "%s/%s" % (CONTENT, name)
    mat = unreal.EditorAssetLibrary.load_asset(path)
    if mat:
        unreal.log("PHOTONMAT exists %s" % name)
        return mat
    factory = unreal.MaterialFactoryNew()
    mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        name, CONTENT, unreal.Material, factory)
    if not mat:
        unreal.log_error("PHOTONMAT failed to create %s" % name)
        return None

    mel = unreal.MaterialEditingLibrary

    tint = mel.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, -300, 0)
    tint.set_editor_property("parameter_name", "TintColor")
    tint.set_editor_property("default_value", default_color)

    strength = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, -300, 180)
    strength.set_editor_property("parameter_name", "EmissiveStrength")
    strength.set_editor_property("default_value", default_emissive)

    connect_emissive_unlit(mat, tint, strength)
    mel.recompile_material(mat)
    mel.layout_material_expressions(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    unreal.log("PHOTONMAT created %s" % name)
    return mat


ensure_dir()
create_material("M_PhotonSolid", unreal.LinearColor(0.18, 0.20, 0.24, 1.0), 0.15)
create_material("M_PhotonEnergy", unreal.LinearColor(0.35, 0.82, 1.0, 1.0), 2.5)
