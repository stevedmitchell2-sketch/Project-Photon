"""
PROJECT PHOTON — restore the zone colours
=========================================

Repairs a specific bug introduced by `photon_bake.py`'s AO wiring. No re-bake
needed: the baked maps are correct, only the node graph is wrong.

WHAT WENT WRONG

    The bake script multiplied AO into Base Color through a Mix node, which is
    correct for a Blender render and wrong for glTF. It moved each zone's colour
    from the Principled `Base Color` socket into the Mix node's `A` input.

    glTF cannot represent a Mix graph. Its model is:

        baseColor = baseColorFactor x baseColorTexture

    So the exporter did the only thing it could: took the AO image as
    `baseColorTexture`, set `baseColorFactor` to white, and discarded the colour
    sitting in the Mix input. Every surface zone came out identical:

        MAT_shell    1.000, 1.000, 1.000   should be 0.860, 0.874, 0.890
        MAT_joint    1.000, 1.000, 1.000   should be 0.055, 0.060, 0.070
        MAT_accent   1.000, 1.000, 1.000   should be 0.560, 0.576, 0.600

    White ceramic, dark graphite and brushed titanium all became the same
    grey-white. AO was also applied twice — once in albedo, once as occlusion.

THE FIX

    AO belongs in `occlusionTexture`, and it is already there. So Base Color goes
    back to being a plain unlinked value carrying the zone colour, the Mix node
    is bypassed, and the normal and occlusion maps stay exactly as they are.

    Result on export:
        baseColorFactor  = the zone colour        (restored)
        baseColorTexture = none                   (AO no longer double-applied)
        normalTexture    = PHOTON_Robot_Normal    (unchanged)
        occlusionTexture = PHOTON_Robot_AO        (unchanged)

    Three.js reads occlusionTexture as `aoMap`, so the crevice shading survives
    into Photon without contaminating albedo.

Run from the Scripting workspace, then re-export with photon_export.py.
Non-destructive: touches material nodes only.
"""

import bpy

#: Authored zone colours, linear RGB. Must match ZONES in photon_robot_finish.py.
ZONE_COLORS = {
    "MAT_shell":  (0.860, 0.874, 0.890, 1.0),   # white ceramic composite
    "MAT_joint":  (0.055, 0.060, 0.070, 1.0),   # rubberised graphite
    "MAT_accent": (0.560, 0.576, 0.600, 1.0),   # brushed titanium
    # MAT_trim is emission-only and has no Base Color to restore.
}

#: Keep AO out of albedo but let it darken ambient. 1.0 is full strength; lower
#: it if the creases read too heavy once you see it in engine.
OCCLUSION_STRENGTH = 1.0


def main():
    print("\n" + "=" * 70)
    print("  PHOTON — restore zone colours")
    print("=" * 70)

    fixed = skipped = 0

    for mat in bpy.data.materials:
        if mat.name not in ZONE_COLORS:
            continue
        if getattr(mat, "node_tree", None) is None:
            continue

        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            print(f"  {mat.name:<14} no Principled BSDF — skipped")
            skipped += 1
            continue

        base = bsdf.inputs["Base Color"]

        # Cut whatever is feeding Base Color. The AO multiply is the expected
        # culprit, but anything linked here would be flattened by the exporter,
        # so removing all incoming links is the safe move.
        removed = 0
        for link in list(base.links):
            links.remove(link)
            removed += 1

        base.default_value = ZONE_COLORS[mat.name]

        # Leave the Mix node in place but disconnected. Deleting it would lose the
        # setup if anyone wants Blender-render AO back; disconnected it is inert
        # and the exporter ignores it entirely.
        mix = nodes.get("PHOTON_AOMix")
        if mix is not None:
            mix.label = "AO multiply (bypassed — AO ships as occlusionTexture)"

        colour = ZONE_COLORS[mat.name]
        print(f"  {mat.name:<14} base colour restored to "
              f"{colour[0]:.3f}, {colour[1]:.3f}, {colour[2]:.3f}"
              f"   ({removed} link{'s' if removed != 1 else ''} cut)")
        fixed += 1

    # The trim material should keep emission and nothing else. An occlusion map on
    # an emissive strip is harmless in glTF — occlusion only affects indirect
    # light — but it costs a texture reference for no benefit.
    trim = bpy.data.materials.get("MAT_trim")
    if trim is not None and getattr(trim, "node_tree", None) is not None:
        settings = trim.node_tree.nodes.get("PHOTON_gltf_settings")
        if settings is not None:
            trim.node_tree.nodes.remove(settings)
            print("  MAT_trim       occlusion removed (emissive needs none)")

    print("")
    print(f"  {fixed} material(s) repaired, {skipped} skipped")
    print("  AO stays in occlusionTexture; normal map untouched; no re-bake needed.")
    print("  Now re-export with photon_export.py")

    if bpy.data.is_saved:
        bpy.ops.wm.save_mainfile()
        print(f"  saved {bpy.data.filepath}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
