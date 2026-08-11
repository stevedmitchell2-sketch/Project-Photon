"""Reimport PhotonFPArms_SK.fbx onto the existing hero skeleton."""
import unreal

DEST = "/Game/Photon/Characters/Hero/FPArms"
FBX = unreal.Paths.project_content_dir() + "Photon/Characters/HeroPrep/PhotonFPArms_SK.fbx"
HERO_SKEL = "/Game/Photon/Characters/Hero/PhotonHero_SK_Skeleton"


def main():
    skeleton = None
    if unreal.EditorAssetLibrary.does_asset_exist(HERO_SKEL):
        skeleton = unreal.EditorAssetLibrary.load_asset(HERO_SKEL)
    else:
        # Discover skeleton from SK_PhotonHero
        hero = unreal.EditorAssetLibrary.load_asset("/Game/Photon/Characters/Hero/SK_PhotonHero")
        if hero:
            skeleton = hero.get_editor_property("skeleton")

    task = unreal.AssetImportTask()
    task.set_editor_property("filename", FBX)
    task.set_editor_property("destination_path", DEST)
    task.set_editor_property("destination_name", "SK_PhotonFPArms")
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)

    options = unreal.FbxImportUI()
    options.set_editor_property("import_mesh", True)
    options.set_editor_property("import_as_skeletal", True)
    options.set_editor_property("import_animations", False)
    options.set_editor_property("import_materials", True)
    options.set_editor_property("import_textures", True)
    options.set_editor_property("create_physics_asset", False)
    options.set_editor_property("mesh_type_to_import", unreal.FBXImportType.FBXIT_SKELETAL_MESH)
    if skeleton:
        options.set_editor_property("skeleton", skeleton)
    sk = options.get_editor_property("skeletal_mesh_import_data")
    try:
        sk.set_editor_property("convert_scene", True)
        sk.set_editor_property("force_front_x_axis", True)
        sk.set_editor_property("convert_scene_unit", True)
        sk.set_editor_property("use_t0_as_ref_pose", True)
        if skeleton:
            sk.set_editor_property("import_meshes_in_bone_hierarchy", True)
    except Exception as exc:
        unreal.log_warning(str(exc))

    task.set_editor_property("options", options)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = list(task.get_editor_property("imported_object_paths") or [])
    unreal.log(f"[PhotonFPArms] imported {paths}")

    # Force rename / skeleton assign
    arms = unreal.EditorAssetLibrary.load_asset(f"{DEST}/SK_PhotonFPArms")
    if arms is None and paths:
        for p in paths:
            a = unreal.EditorAssetLibrary.load_asset(p)
            if a and a.get_class().get_name() == "SkeletalMesh":
                arms = a
                break
    if arms and skeleton:
        try:
            arms.set_editor_property("skeleton", skeleton)
            unreal.EditorAssetLibrary.save_loaded_asset(arms)
            unreal.log(f"[PhotonFPArms] skeleton set to {skeleton.get_path_name()}")
        except Exception as exc:
            unreal.log_warning(f"skeleton assign failed: {exc}")
    unreal.log("[PhotonFPArms] OK")


if __name__ == "__main__":
    main()
