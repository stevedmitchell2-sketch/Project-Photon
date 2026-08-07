"""
PROJECT PHOTON — safe GLB export
================================

Exports the game mesh + armature + animation, and nothing else.

Written because two consecutive hand-exports each lost half the asset: one had
the mesh with no skin, the next had 49 bones and no mesh. Both were the glTF
exporter's "Limit to > Selected Objects" doing exactly what it was told. This
picks the objects itself and verifies the result, so that cannot happen again.

Run from Blender's Scripting workspace. Nothing here is destructive.
"""

import bpy
import os

#: Output filename. The directory is resolved at runtime — see resolve_export_path.
EXPORT_FILENAME = "Photon_Robot_Game.glb"

#: Leave empty to write next to the .blend. Set an absolute path to override.
EXPORT_DIR = ""

#: Meshes whose name contains any of these are bake sources, not game assets.
SOURCE_HINTS = ("tripo_node", "_high", "highpoly", "high_poly", "_src", "_source")


def resolve_export_path():
    """Return an absolute output path.

    Blender's `//` prefix means "relative to the .blend", and most of the API
    resolves it. The glTF exporter in 5.2 does not: handed `//Photon_Robot_Game.glb`
    it derives the output directory as `//Photon_Robot_Game.glb/` and dies with
    `WinError 161: The specified path is invalid`, because it has treated the whole
    filename as a folder.

    So resolve it here instead of trusting the operator to. `bpy.path.abspath("//")`
    is the documented way, and it returns empty for an unsaved file — hence the
    fallback, which keeps the script usable before the first save.
    """
    folder = EXPORT_DIR or bpy.path.abspath("//")
    if not folder or not os.path.isdir(folder):
        folder = os.path.join(os.path.expanduser("~"), "Documents")
        print(f"  note: .blend has no location on disk; writing to {folder}")
    return os.path.join(folder, EXPORT_FILENAME)


def wire_occlusion_for_gltf(meshes):
    """Route the baked AO into glTF's occlusionTexture slot.

    Without this the AO is lost on export, silently. `photon_bake.py` wires AO as
    a MULTIPLY into base colour, which is correct for a Blender render — but glTF
    has no concept of an arbitrary node graph. The exporter recognises a fixed set
    of patterns and ignores everything else, so a MixRGB feeding Base Color is
    simply dropped and the GLB ships with the normal map only.

    The documented route is a node group named "glTF Material Output" with an
    `Occlusion` input. The group's internals are irrelevant — the exporter reads
    the *link* into that socket and writes it as `occlusionTexture`. Three.js maps
    that straight onto `aoMap`, so it survives all the way into Photon.
    """
    GROUP = "glTF Material Output"

    group = bpy.data.node_groups.get(GROUP)
    if group is None:
        group = bpy.data.node_groups.new(GROUP, "ShaderNodeTree")
        gin = group.nodes.new("NodeGroupInput")
        gin.location = (-200, 0)
        if hasattr(group, "interface"):
            group.interface.new_socket("Occlusion", in_out="INPUT",
                                       socket_type="NodeSocketFloat")
        else:
            group.inputs.new("NodeSocketFloat", "Occlusion")

    wired = 0
    for obj in meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or getattr(mat, "node_tree", None) is None:
                continue
            nodes, links = mat.node_tree.nodes, mat.node_tree.links
            ao_tex = nodes.get("BAKE_AO")
            if ao_tex is None or ao_tex.image is None:
                continue

            node = nodes.get("PHOTON_gltf_settings")
            if node is None:
                node = nodes.new("ShaderNodeGroup")
                node.name = "PHOTON_gltf_settings"
                node.location = (400, -400)
            node.node_tree = group

            socket = node.inputs.get("Occlusion")
            if socket is not None and not socket.is_linked:
                links.new(ao_tex.outputs["Color"], socket)
                wired += 1

    if wired:
        print(f"  occlusion routed to glTF for {wired} material(s)")
    return wired


def main():
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    sockets = [o for o in bpy.context.scene.objects if o.name.startswith("SOCKET_")]

    game = [m for m in meshes
            if not any(h in m.name.lower() for h in SOURCE_HINTS)]
    source = [m for m in meshes if m not in game]

    print("\n" + "=" * 68)
    print("  PHOTON EXPORT")
    print("=" * 68)
    for m in game:
        print(f"  mesh      {m.name[:44]:<46} {len(m.data.polygons):>7,} faces")
    for m in source:
        print(f"  excluded  {m.name[:44]:<46} {len(m.data.polygons):>7,} faces (bake source)")
    for a in armatures:
        print(f"  armature  {a.name[:44]:<46} {len(a.data.bones):>7} bones")
    for s in sockets:
        print(f"  socket    {s.name}")

    if not game:
        print("\n  ABORT: no game mesh found. Every mesh matched SOURCE_HINTS.")
        return
    if not armatures:
        print("\n  ABORT: no armature in the scene. Exporting now would lose the rig.")
        return

    # Verify the mesh is actually bound before exporting, rather than finding out
    # afterwards. A mesh with no armature modifier and no vertex groups produces
    # a GLB with skins: 0 even when an armature sits right beside it in the file.
    for m in game:
        has_modifier = any(mod.type == "ARMATURE" for mod in m.modifiers)
        has_groups = len(m.vertex_groups) > 0
        if not (has_modifier and has_groups):
            print(f"\n  WARNING: {m.name} is not bound to the armature")
            print(f"    armature modifier: {has_modifier}   vertex groups: {has_groups}")
            print("    The export will have no skin. Re-parent with Ctrl+P >")
            print("    Armature Deform, or restore the modifier, then re-run.")

    # Hide bake sources: the exporter skips hidden objects, which is a second
    # line of defence behind use_visible below.
    for m in source:
        m.hide_set(True)
        m.hide_viewport = True

    wire_occlusion_for_gltf(game)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in game + armatures + sockets:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armatures[0]

    export_path = resolve_export_path()
    print(f"  writing   {export_path}")

    bpy.ops.export_scene.gltf(
        filepath=export_path,
        export_format="GLB",
        # Belt and braces: the selection is correct *and* limited to visible, so
        # neither setting alone can drop half the asset.
        use_selection=True,
        use_visible=True,
        export_apply=False,      # never applies modifiers — the rig stays bound
        export_skins=True,       # JOINTS_0 / WEIGHTS_0
        export_animations=True,
        export_texcoords=True,
        export_normals=True,
        # A normal map without tangents makes three.js compute them at load, on a
        # 61k mesh, every time. Cheaper to ship them.
        export_tangents=True,
        export_materials="EXPORT",
        export_yup=True,
    )

    print(f"\n  exported {export_path}")
    print("  verify with:")
    print('    npm run asset-inspect -- "<path>" --kind character')
    print("  expect: 1 skin / 49 joints / 1 clip / >0 triangles / 4 materials")
    print("          plus normal + occlusion textures and a TANGENT attribute")
    print("=" * 68 + "\n")


if __name__ == "__main__":
    main()
