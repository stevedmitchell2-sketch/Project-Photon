"""Create the Photon surface material set.

The first material pass used a single UNLIT material for everything, which is why the arena could
only ever be flat: an unlit surface multiplied by a low emissive strength renders near-black, and a
high one renders blown out. Structural surfaces need real shading, so M_PhotonSurface is Default Lit
with parameters, and emission is reserved for M_PhotonEnergy.

Parameters (shared by every Photon material so one code path can tint any of them):
  TintColor        vector  base colour
  Roughness        scalar
  Metallic         scalar
  EmissiveStrength scalar  multiplier on TintColor into emissive
"""
import unreal

CONTENT = "/Game/Photon/Materials"
mel = unreal.MaterialEditingLibrary


def ensure_dir():
    if not unreal.EditorAssetLibrary.does_directory_exist(CONTENT):
        unreal.EditorAssetLibrary.make_directory(CONTENT)


def vector_param(mat, name, value, x, y):
    node = mel.create_material_expression(mat, unreal.MaterialExpressionVectorParameter, x, y)
    node.set_editor_property("parameter_name", name)
    node.set_editor_property("default_value", value)
    return node


def scalar_param(mat, name, value, x, y):
    node = mel.create_material_expression(mat, unreal.MaterialExpressionScalarParameter, x, y)
    node.set_editor_property("parameter_name", name)
    node.set_editor_property("default_value", value)
    return node


def build_surface(name, tint, roughness, metallic, emissive, unlit=False):
    """Create a Photon material. Returns None if it already exists (recompiling one crashes)."""
    path = "%s/%s" % (CONTENT, name)
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.log("PHOTONMAT exists %s" % name)
        return unreal.EditorAssetLibrary.load_asset(path)

    mat = unreal.AssetToolsHelpers.get_asset_tools().create_asset(
        name, CONTENT, unreal.Material, unreal.MaterialFactoryNew())
    if not mat:
        unreal.log_error("PHOTONMAT failed to create %s" % name)
        return None

    tint_node = vector_param(mat, "TintColor", tint, -420, 0)
    rough_node = scalar_param(mat, "Roughness", roughness, -420, 200)
    metal_node = scalar_param(mat, "Metallic", metallic, -420, 300)
    emis_node = scalar_param(mat, "EmissiveStrength", emissive, -420, 400)

    mel.connect_material_property(tint_node, "", unreal.MaterialProperty.MP_BASE_COLOR)

    glow = mel.create_material_expression(mat, unreal.MaterialExpressionMultiply, -160, 400)
    mel.connect_material_expressions(tint_node, "", glow, "A")
    mel.connect_material_expressions(emis_node, "", glow, "B")
    mel.connect_material_property(glow, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)

    if unlit:
        mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    else:
        mel.connect_material_property(rough_node, "", unreal.MaterialProperty.MP_ROUGHNESS)
        mel.connect_material_property(metal_node, "", unreal.MaterialProperty.MP_METALLIC)
        mat.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_DEFAULT_LIT)

    mat.set_editor_property("blend_mode", unreal.BlendMode.BLEND_OPAQUE)
    mel.recompile_material(mat)
    mel.layout_material_expressions(mat)
    unreal.EditorAssetLibrary.save_loaded_asset(mat)
    unreal.log("PHOTONMAT created %s unlit=%s" % (name, unlit))
    return mat


ensure_dir()

# Structural architecture: dark graphite ceramic, matte, no emission.
build_surface("M_PhotonSurface", unreal.LinearColor(0.055, 0.060, 0.075, 1.0), 0.62, 0.0, 0.0)

# Competition floor: slightly warmer/darker rubberised surface, a touch glossier for sheen.
build_surface("M_PhotonFloor", unreal.LinearColor(0.030, 0.034, 0.045, 1.0), 0.42, 0.0, 0.0)

# Cover: lighter graphite with a hint of metal so it separates from both floor and wall.
build_surface("M_PhotonCover", unreal.LinearColor(0.115, 0.125, 0.150, 1.0), 0.48, 0.25, 0.0)

# Structural metal: trusses, railings, the overhead rig. Genuinely metallic and much smoother than
# the architecture, so it separates from the graphite by specular response rather than by being a
# different shade of dark grey — which is the only kind of separation that survives a dim arena.
build_surface("M_PhotonMetal", unreal.LinearColor(0.085, 0.092, 0.108, 1.0), 0.34, 0.85, 0.0)

# Energy: unlit emissive. Base colour is irrelevant when unlit, emission carries it.
build_surface("M_PhotonGlow", unreal.LinearColor(0.35, 0.82, 1.0, 1.0), 0.5, 0.0, 6.0, unlit=True)

unreal.log("PHOTONMAT surface set complete")
