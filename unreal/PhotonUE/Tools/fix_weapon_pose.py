"""Fix the first-person weapon: scale, position, and material.

From the screen recording: the PH-6 renders but fills the right half of the frame, and it is pure
white. Two separate faults.

Scale. The mesh is 98 cm long and the hip transform placed it 29 cm from the camera at scale 1, so it
subtends an enormous angle. The reference build solved the same problem with a 0.62 uniform scale and
learned that this is a *scale* problem, not a position one — pushing a full-size weapon further away
shrinks it and moves it out of the corner at the same time, which is why it never worked there either.

Material. The FBX imported its own material but the data asset's mesh reference is what the weapon
draws, and nothing assigned a material to slot 0, so it falls back to WorldGridMaterial white.
"""
import unreal

HIP = unreal.Transform(
    location=unreal.Vector(42.0, 13.0, -11.0),
    rotation=unreal.Rotator(roll=2.0, pitch=-1.5, yaw=88.0),
    scale=unreal.Vector(0.55, 0.55, 0.55))
ADS = unreal.Transform(
    location=unreal.Vector(46.0, 0.0, -8.0),
    rotation=unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0),
    scale=unreal.Vector(0.55, 0.55, 0.55))

mesh = unreal.EditorAssetLibrary.load_asset("/Game/Photon/Weapons/PH6_PhotonRifle")
unreal.log("PHOTONPOSE mesh=%s" % (mesh is not None))
if mesh:
    mats = mesh.static_materials
    unreal.log("PHOTONPOSE mesh_material_slots=%d" % len(mats))
    for i, m in enumerate(mats):
        unreal.log("PHOTONPOSE   slot %d interface=%s" % (i, m.material_interface is not None))
    # Give slot 0 a real material if the import left it empty, or the weapon draws as grid-white.
    if mats and mats[0].material_interface is None:
        base = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/BasicShapeMaterial")
        if base:
            mats[0].material_interface = base
            mesh.static_materials = mats
            unreal.EditorAssetLibrary.save_loaded_asset(mesh)
            unreal.log("PHOTONPOSE assigned fallback material to slot 0")

for path in ["/Game/Photon/Weapons/DA_PH6_PhotonRifle", "/Game/Photon/Weapons/DA_PH9_Swift"]:
    d = unreal.EditorAssetLibrary.load_asset(path)
    if not d:
        unreal.log_error("PHOTONPOSE missing %s" % path)
        continue
    d.set_editor_property("hip_transform", HIP)
    d.set_editor_property("ads_transform", ADS)
    unreal.EditorAssetLibrary.save_loaded_asset(d)
    t = d.get_editor_property("hip_transform")
    unreal.log("PHOTONPOSE %s hip loc=%s scale=%s"
               % (path.split("/")[-1], t.translation, t.scale3d))
