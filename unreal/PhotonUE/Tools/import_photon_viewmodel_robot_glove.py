"""Import robot-arm + glove static meshes for Photon FP viewmodel."""
import unreal

DEST = "/Game/Photon/Meshes/Viewmodel"
PREP = unreal.Paths.project_content_dir() + "Photon/Characters/ViewmodelPrep/"

FILES = {
    "SM_PhotonRobotArmRight": "SM_PhotonRobotArmRight.fbx",
    "SM_PhotonRobotArmLeft": "SM_PhotonRobotArmLeft.fbx",
    "SM_PhotonGloveRight": "SM_PhotonGloveRight.fbx",
    "SM_PhotonGloveLeft": "SM_PhotonGloveLeft.fbx",
}


def import_one(name: str, filename: str):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", PREP + filename)
    task.set_editor_property("destination_path", DEST)
    task.set_editor_property("destination_name", name)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)

    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_as_skeletal", False)
    options.set_editor_property("import_animations", False)
    options.set_editor_property("import_materials", True)
    options.set_editor_property("import_textures", True)
    options.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_STATIC_MESH)
    try:
        sm = options.get_editor_property("static_mesh_import_data")
        sm.set_editor_property("combine_meshes", True)
        sm.set_editor_property("convert_scene", True)
        sm.set_editor_property("force_front_x_axis", True)
        sm.set_editor_property("convert_scene_unit", True)
        sm.set_editor_property("auto_generate_collision", False)
    except Exception as exc:
        unreal.log_warning(str(exc))
    task.set_editor_property("options", options)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = list(task.get_editor_property("imported_object_paths") or [])
    unreal.log(f"[PhotonVMImport] {name}: {paths}")
    return paths


def main():
    if not unreal.EditorAssetLibrary.does_directory_exist(DEST):
        unreal.EditorAssetLibrary.make_directory(DEST)
    for name, filename in FILES.items():
        import_one(name, filename)
    unreal.log("[PhotonVMImport] OK")


if __name__ == "__main__":
    main()
