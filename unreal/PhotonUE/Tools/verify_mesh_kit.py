"""Check the authored kit actually contains geometry, at the intended size, with usable collision.

"built 19/19" only proves the asset call returned. Bevels and booleans fail quietly, and a mesh that
came back empty or a convex hull that seals an archway would both survive that check.
"""
import unreal

out = []
names = [
    "SM_PhotonCoverLow", "SM_PhotonCoverAngled", "SM_PhotonCoverPod", "SM_PhotonCoverPylon",
    "SM_PhotonCoverBench", "SM_PhotonWallBay", "SM_PhotonWallBayAngled", "SM_PhotonCornerPylon",
    "SM_PhotonCeilingBay", "SM_PhotonTruss", "SM_PhotonCentreDais", "SM_PhotonCentreRing",
    "SM_PhotonCentreRig", "SM_PhotonDeckSlab", "SM_PhotonRailing", "SM_PhotonPedestal",
    "SM_PhotonSpawnGate", "SM_PhotonArmRight", "SM_PhotonArmLeft",
]

out.append("%-24s %7s %7s  %-28s %s" % ("asset", "tris", "verts", "size xyz", "collision"))
for n in names:
    sm = unreal.EditorAssetLibrary.load_asset("/Game/Photon/Meshes/" + n)
    if not sm:
        out.append("%-24s MISSING" % n)
        continue
    tris = sm.get_num_triangles(0)
    verts = sm.get_num_vertices(0)
    b = sm.get_bounding_box()
    size = b.max - b.min
    hulls = "?"
    try:
        bs = sm.get_editor_property("body_setup")
        agg = bs.get_editor_property("agg_geom")
        hulls = "convex=%d box=%d flag=%s" % (
            len(agg.get_editor_property("convex_elems")),
            len(agg.get_editor_property("box_elems")),
            str(bs.get_editor_property("collision_trace_flag")).split(".")[-1])
    except Exception as exc:
        hulls = "err %s" % exc
    out.append("%-24s %7d %7d  %6.0f %6.0f %6.0f       %s"
               % (n, tris, verts, size.x, size.y, size.z, hulls))

with open(unreal.Paths.project_saved_dir() + "Logs/photon_mesh_verify.txt", "w") as f:
    f.write("\n".join(out))
