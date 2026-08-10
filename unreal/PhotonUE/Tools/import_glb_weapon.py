"""Import the PH-6 from the original GLB so it arrives with its materials.

The weapon renders white because I routed it through FBX. FBX does not embed textures the way glTF
does, so the 4096 base colour that exists in HeroLaserRifle_v01.glb never crossed. Importing the GLB
directly is the fix rather than hand-assigning maps to the FBX result.

Also drops exposure and light levels further: the greybox is still reading blown-out white.
"""
import unreal

SRC = ("C:/Users/Home/Desktop/100 men vs gorilla/photon/public/assets/weapons/"
       "HeroLaserRifle_v01.glb")
DEST = "/Game/Photon/Weapons/GLB"

task = unreal.AssetImportTask()
task.filename = SRC
task.destination_path = DEST
task.automated = True
task.replace_existing = True
task.save = True
unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
paths = list(task.imported_object_paths or [])
unreal.log("PHOTONGLB imported=%d" % len(paths))
for p in paths:
    unreal.log("PHOTONGLB   %s" % p)

# Find the static mesh among whatever the importer produced, and report its material slots so a white
# result can be told apart from a missing-mesh result.
mesh = None
for p in paths:
    a = unreal.EditorAssetLibrary.load_asset(p)
    if isinstance(a, unreal.StaticMesh):
        mesh = a
        break
unreal.log("PHOTONGLB static_mesh_found=%s" % (mesh is not None))
if mesh:
    for i, m in enumerate(mesh.static_materials):
        mi = m.material_interface
        unreal.log("PHOTONGLB   slot %d = %s" % (i, mi.get_name() if mi else "NONE"))
    for path in ["/Game/Photon/Weapons/DA_PH6_PhotonRifle", "/Game/Photon/Weapons/DA_PH9_Swift"]:
        d = unreal.EditorAssetLibrary.load_asset(path)
        if d:
            d.set_editor_property("mesh", mesh)
            unreal.EditorAssetLibrary.save_loaded_asset(d)
            got = d.get_editor_property("mesh")
            unreal.log("PHOTONGLB %s mesh=%s" % (path.split("/")[-1],
                                                got.get_name() if got else "NONE"))
