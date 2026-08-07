"""
PROJECT PHOTON — robot material pass
====================================

Turns a grey Mixamo-rigged humanoid robot into a finished-looking Photon League
maintenance unit: premium ceramic shell, graphite joints, titanium accents and
team-coloured energy channels.

Design brief: Apple industrial design, Tesla Optimus, Boston Dynamics Atlas,
TRON Legacy lighting, Detroit: Become Human. Clean, precise, intelligent,
friendly. Not military, not intimidating, no weapons.

WHAT IT TOUCHES
    Materials and material slots. That is all.

WHAT IT NEVER TOUCHES
    Armatures, bones, pose data, vertex groups, skin weights, modifiers,
    transforms, mesh data. Nothing here joins, applies, decimates or deletes.
    The Mixamo rig is untouched by construction, not by care.

Tested against the Blender 3.x and 4.x Principled BSDF. Socket names changed in
4.0 ("Emission" became "Emission Color", "Clearcoat" became "Coat Weight"), so
every socket write goes through a version-tolerant setter.

    Blender 3.3+ / 4.x
"""

import bpy
import re
from mathutils import Vector

# =============================================================================
#  CONFIG — edit these, then re-run
# =============================================================================

#: Team energy colour. One of TEAM_COLORS below.
TEAM = "cyan"

#: Emission strength for the energy channels. Brief asks for 3–8.
EMISSION_STRENGTH = 5.0

#: Print the classification and change nothing. Run this first.
DRY_RUN = False

#: Replace materials already on the object. False keeps existing slots and only
#: fills empty ones — useful for a second pass over a partly-authored model.
REPLACE_EXISTING = True

#: Save the .blend when finished.
SAVE_ON_FINISH = True

#: Force a specific object to a specific material, by exact object name.
#: Anything listed here skips both the name and geometry classifiers.
#:      OVERRIDES = {"Robot_Chest": "shell", "Eye_L": "energy"}
OVERRIDES: dict[str, str] = {}


TEAM_COLORS = {
    # Linear RGB. Chosen to match Photon's in-engine team palette rather than
    # picked by eye — these are the sRGB hex values from src/config/teams.ts
    # converted to linear, so a screenshot from Blender and a screenshot from
    # the game show the same colour.
    "cyan":   (0.031, 0.706, 1.000),   # #2DE0FF  house / neutral
    "red":    (1.000, 0.031, 0.086),   # #FF2D55
    "blue":   (0.031, 0.196, 1.000),   # #2D7BFF
    "green":  (0.031, 1.000, 0.230),   # #2DFF87
    "yellow": (1.000, 0.663, 0.031),   # #FFD42D
}


# =============================================================================
#  MATERIAL DEFINITIONS
# =============================================================================
#
# Values come straight from the brief. The two shell variants are the answer to
# "avoid flat grey surfaces": alternating panels between a bright ceramic and a
# very slightly darker, cooler one gives a large model visible panel breaks
# without any texture work, which is what reads as "assembled from parts"
# rather than "one moulded lump".

MATERIALS = {
    "shell": {
        "name": "PHOTON_Shell_Ceramic",
        "base_color": (0.860, 0.874, 0.890, 1.0),   # warm-neutral white, cool tint
        "metallic": 0.20,
        "roughness": 0.35,
        "coat": 0.35,                                # semi-gloss ceramic sheen
        "coat_roughness": 0.18,
        "noise_roughness": 0.06,                     # breaks up flat highlights
    },
    "shell_alt": {
        "name": "PHOTON_Shell_Ceramic_Alt",
        "base_color": (0.760, 0.782, 0.808, 1.0),   # a step darker and cooler
        "metallic": 0.22,
        "roughness": 0.40,
        "coat": 0.30,
        "coat_roughness": 0.20,
        "noise_roughness": 0.06,
    },
    "joint": {
        "name": "PHOTON_Joint_Graphite",
        "base_color": (0.055, 0.060, 0.070, 1.0),   # rubberised dark graphite
        "metallic": 0.60,
        "roughness": 0.50,
        "coat": 0.0,
        "coat_roughness": 0.5,
        "noise_roughness": 0.04,
    },
    "accent": {
        "name": "PHOTON_Accent_Titanium",
        "base_color": (0.560, 0.576, 0.600, 1.0),   # brushed aluminium/titanium
        "metallic": 0.85,
        "roughness": 0.25,
        "coat": 0.0,
        "coat_roughness": 0.5,
        "noise_roughness": 0.05,
    },
}

ENERGY_MATERIAL = "PHOTON_Energy_Team"
TEAM_NODE_GROUP = "PHOTON_TeamColor"


# =============================================================================
#  NAME CLASSIFICATION
# =============================================================================
#
# Checked in order: the first bucket with a keyword hit wins. Energy is first
# because "eye_lens_housing" should be energy, not accent, and "shoulder_led"
# should be energy, not joint.

KEYWORDS = [
    ("energy", (
        "led", "light", "lamp", "glow", "emis", "emit", "neon", "strip",
        "eye", "visor", "lens", "iris", "optic", "core", "reactor", "energy",
        "indicator", "status", "screen", "display", "vent_glow",
    )),
    ("joint", (
        "joint", "elbow", "knee", "neck", "hip", "wrist", "ankle", "shoulder",
        "pivot", "servo", "actuator", "hinge", "socket", "ball", "swivel",
        "knuckle", "spine", "waist", "torso_joint",
    )),
    ("accent", (
        "piston", "rod", "shaft", "hydraulic", "cable", "wire", "bolt",
        "screw", "vent", "grill", "grille", "frame", "brace",
        "strut", "clamp", "connector", "port", "trim", "detail", "mech",
    )),
    ("shell", (
        "shell", "panel", "plate", "armor", "armour", "casing", "cover",
        "body", "chest", "torso", "head", "helmet", "skull", "thigh",
        "shin", "calf", "forearm", "bicep", "upperarm", "foot", "hand",
        "pelvis", "back", "hull",
    )),
]

#: Tokens that describe the *file*, not the part. Stripped before matching.
#:
#: This list exists because of a real misclassification: `Photon_Robot_RETROPO_Mesh`
#: was assigned titanium, because "mesh" was an accent keyword (meant for wire and
#: grille mesh) and matched the `_Mesh` suffix that every exporter appends.
#: Structural suffixes carry no design intent and must never vote.
#:
#: "ring" was removed from the keyword lists outright for the same reason: it
#: matches Bearing, Steering and Spring, all of which are mechanical parts that
#: should never come out emissive.
STOPWORDS = {
    "mesh", "geo", "geometry", "object", "obj", "node", "group", "grp",
    "low", "high", "poly", "polygon", "retopo", "retopology",
    "final", "new", "old", "copy", "tmp", "temp", "backup", "bake", "baked",
    "photon", "robot", "tripo", "mixamo", "mixamorig", "rig", "rigged",
    "skin", "skinned", "default", "main", "base", "clean", "export",
}

#: Objects matching these are skipped entirely. A high-poly bake source is not
#: part of the shipped model and must not be given a game material.
SOURCE_HINTS = ("tripo_node", "_high", "highpoly", "high_poly",
                "_src", "_source", "bakesource", "bake_source")

#: A name is "generic" if it carries no information — Object.001, Mesh, Cube.
GENERIC_NAME = re.compile(
    r"^(object|mesh|cube|sphere|cylinder|plane|group|part|geo|node|item|"
    r"default|untitled|model|mixamo\w*)([._-]?\d+)?$",
    re.IGNORECASE,
)


# =============================================================================
#  HELPERS
# =============================================================================

def _ensure_nodes(mat):
    """Enable node shading without tripping Blender 6.0's deprecation warning.

    `Material.use_nodes` is on its way out because node trees became mandatory.
    Assigning it on Blender 5+ emits a DeprecationWarning; checking for the tree
    first means the assignment only runs on versions that still need it.
    """
    if getattr(mat, "node_tree", None) is None:
        try:
            mat.use_nodes = True
        except Exception:
            pass


def _set(node, names, value):
    """Write a Principled BSDF socket by whichever name this Blender uses.

    4.0 renamed several sockets. Passing a tuple of candidates and taking the
    first that exists means one script covers 3.x and 4.x without a version
    check, and silently skips a socket that genuinely is not there.
    """
    if isinstance(names, str):
        names = (names,)
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return True
    return False


def _team_color():
    if TEAM not in TEAM_COLORS:
        raise ValueError(
            f"TEAM is '{TEAM}'. Expected one of: {', '.join(TEAM_COLORS)}"
        )
    return TEAM_COLORS[TEAM]


def ensure_team_node_group():
    """A shared node group holding the team colour and emission strength.

    This is the whole team-swap mechanism, and it is worth understanding why it
    is a group rather than four materials: a node group's *internal* nodes are
    shared by every instance of it. Change the RGB node inside this group once
    and every energy material in the file changes with it — including on any
    extra energy materials added later.

    Four separate materials would mean four edits and a reassignment pass.
    """
    group = bpy.data.node_groups.get(TEAM_NODE_GROUP)
    if group is None:
        group = bpy.data.node_groups.new(TEAM_NODE_GROUP, "ShaderNodeTree")

        output = group.nodes.new("NodeGroupOutput")
        output.location = (300, 0)

        rgb = group.nodes.new("ShaderNodeRGB")
        rgb.name = "TeamColor"
        rgb.label = "TEAM COLOR — edit me"
        rgb.location = (-200, 60)

        strength = group.nodes.new("ShaderNodeValue")
        strength.name = "TeamStrength"
        strength.label = "Emission strength"
        strength.location = (-200, -140)

        # Socket creation moved to an interface API in 4.0.
        if hasattr(group, "interface"):
            group.interface.new_socket("Color", in_out="OUTPUT", socket_type="NodeSocketColor")
            group.interface.new_socket("Strength", in_out="OUTPUT", socket_type="NodeSocketFloat")
        else:
            group.outputs.new("NodeSocketColor", "Color")
            group.outputs.new("NodeSocketFloat", "Strength")

        group.links.new(rgb.outputs[0], output.inputs[0])
        group.links.new(strength.outputs[0], output.inputs[1])

    colour = _team_color()
    group.nodes["TeamColor"].outputs[0].default_value = (*colour, 1.0)
    group.nodes["TeamStrength"].outputs[0].default_value = EMISSION_STRENGTH
    return group


def build_surface_material(spec):
    """A Principled surface with a whisper of roughness noise.

    The noise is the difference between "grey plastic" and "a manufactured
    panel". It is deliberately tiny — a few per cent of variation at a large
    scale, so it reads as subtle unevenness in the finish under a moving
    highlight rather than as a visible texture.
    """
    mat = bpy.data.materials.get(spec["name"])
    if mat is None:
        mat = bpy.data.materials.new(spec["name"])
    _ensure_nodes(mat)

    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (420, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    _set(bsdf, "Base Color", spec["base_color"])
    _set(bsdf, "Metallic", spec["metallic"])
    _set(bsdf, "Roughness", spec["roughness"])
    _set(bsdf, ("Coat Weight", "Clearcoat"), spec["coat"])
    _set(bsdf, ("Coat Roughness", "Clearcoat Roughness"), spec["coat_roughness"])
    _set(bsdf, ("Specular IOR Level", "Specular"), 0.5)

    amount = spec.get("noise_roughness", 0.0)
    if amount > 0.0:
        tex_coord = nodes.new("ShaderNodeTexCoord")
        tex_coord.location = (-720, -220)

        noise = nodes.new("ShaderNodeTexNoise")
        noise.location = (-520, -220)
        noise.inputs["Scale"].default_value = 9.0
        noise.inputs["Detail"].default_value = 3.0
        if "Roughness" in noise.inputs:
            noise.inputs["Roughness"].default_value = 0.55

        # Map the 0..1 noise into a narrow band centred on the target roughness.
        ramp = nodes.new("ShaderNodeMapRange")
        ramp.location = (-300, -220)
        ramp.inputs["From Min"].default_value = 0.0
        ramp.inputs["From Max"].default_value = 1.0
        ramp.inputs["To Min"].default_value = max(0.0, spec["roughness"] - amount)
        ramp.inputs["To Max"].default_value = min(1.0, spec["roughness"] + amount)

        links.new(tex_coord.outputs["Object"], noise.inputs["Vector"])
        links.new(noise.outputs["Fac"], ramp.inputs["Value"])
        links.new(ramp.outputs["Result"], bsdf.inputs["Roughness"])

    return mat


def build_energy_material():
    """Emissive channel driven by the shared team group.

    Emission-only rather than an emissive Principled: these are light strips set
    into a shell, and giving them a diffuse response makes them read as painted
    plastic that happens to glow. A pure emission shader behind a dark base is
    what makes TRON-style channels look like they are lit from inside.
    """
    group = ensure_team_node_group()

    mat = bpy.data.materials.get(ENERGY_MATERIAL)
    if mat is None:
        mat = bpy.data.materials.new(ENERGY_MATERIAL)
    _ensure_nodes(mat)

    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()

    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (420, 0)

    instance = nodes.new("ShaderNodeGroup")
    instance.node_tree = group
    instance.location = (-180, 0)

    emission = nodes.new("ShaderNodeEmission")
    emission.location = (100, 0)

    links.new(instance.outputs["Color"], emission.inputs["Color"])
    links.new(instance.outputs["Strength"], emission.inputs["Strength"])
    links.new(emission.outputs["Emission"], out.inputs["Surface"])

    # Bloom in the viewport and in Eevee keys off this.
    if hasattr(mat, "blend_method"):
        mat.blend_method = "OPAQUE"
    return mat


# =============================================================================
#  CLASSIFICATION
# =============================================================================

def tokenise(name):
    """Split an object name into meaningful lower-case tokens.

    Splits on separators and camelCase, strips trailing digits, drops stopwords.
    `Photon_Robot_RETROPO_Mesh` reduces to {"retropo"} — no design intent left,
    so it falls through to the geometry classifier instead of matching a keyword
    by accident.
    """
    tokens = set()
    for part in re.split(r"[^A-Za-z0-9]+", name):
        for chunk in re.findall(r"[A-Z]+(?![a-z])|[A-Z][a-z]+|[a-z]+|\d+", part):
            token = re.sub(r"\d+$", "", chunk.lower())
            if len(token) >= 2 and token not in STOPWORDS:
                tokens.add(token)
    return tokens


def is_source_mesh(name):
    lowered = name.lower()
    return any(hint in lowered for hint in SOURCE_HINTS)


def classify_by_name(name):
    """Match keywords against whole tokens rather than raw substrings.

    Token matching is what stops `_Mesh` reading as "wire mesh". Keywords of six
    characters or more may still match inside a token, so `shoulderpad` finds
    "shoulder" — short keywords cannot, because that is where the false
    positives come from.
    """
    tokens = tokenise(name)
    if not tokens:
        return None
    for bucket, keys in KEYWORDS:
        for key in keys:
            if key in tokens:
                return bucket
            if len(key) >= 6 and any(key in token for token in tokens):
                return bucket
    return None


def looks_generic(name):
    stem = name.split(".")[0]
    return bool(GENERIC_NAME.match(stem)) or bool(GENERIC_NAME.match(name))


def classify_by_geometry(objects):
    """Fallback for Object.001-style names, using proportion and size.

    No name information, so this reasons about what the parts *are*:

      - the biggest volumes are shell panels — chest, thighs, head casing;
      - joints are chunky and roughly equilateral — the ball and cylinder
        housings at elbows, knees and hips;
      - accents are small and elongated — pistons, struts, cable runs;
      - energy channels are the smallest and flattest things on the model.

    Deliberately conservative about energy: at most a tenth of the objects, and
    only genuinely sliver-like ones. A robot with glowing bolts looks like a
    Christmas tree, and it is far easier to promote a part to energy by hand
    afterwards than to hunt down twenty that should not be.
    """
    metrics = []
    for obj in objects:
        d = obj.dimensions
        dims = sorted((abs(d.x), abs(d.y), abs(d.z)), reverse=True)
        longest = max(dims[0], 1e-6)
        shortest = max(dims[2], 1e-6)
        metrics.append({
            "obj": obj,
            "volume": max(dims[0] * dims[1] * dims[2], 1e-9),
            "elongation": longest / max(dims[1], 1e-6),
            "flatness": longest / shortest,
        })

    metrics.sort(key=lambda m: m["volume"])
    count = len(metrics)
    energy_budget = max(1, count // 10)

    result = {}
    for index, m in enumerate(metrics):
        percentile = index / max(count - 1, 1)
        obj = m["obj"]

        if percentile < 0.10 and m["flatness"] > 6.0 and energy_budget > 0:
            result[obj.name] = "energy"
            energy_budget -= 1
        elif percentile < 0.45 and m["elongation"] > 2.5:
            result[obj.name] = "accent"
        elif percentile < 0.55 and m["flatness"] < 2.5:
            result[obj.name] = "joint"
        elif percentile < 0.30:
            result[obj.name] = "accent"
        else:
            result[obj.name] = "shell"
    return result


def shell_variant(name, index):
    """Alternate the two ceramic tones so neighbouring panels differ.

    Keyed off a stable hash of the object name, not the loop index, so the
    pattern does not reshuffle when objects are added, renamed or reordered —
    re-running the script gives the same model back.
    """
    return "shell_alt" if (hash(name) + index) % 3 == 0 else "shell"


# =============================================================================
#  ASSIGNMENT
# =============================================================================

def assign(obj, bucket, materials, index):
    """Put one material on one object, without disturbing anything else.

    Multi-slot meshes are handled per slot: each slot is classified from the
    name of whatever material is already in it, so an imported model that
    already separates "Body" from "Lights" keeps that separation instead of
    being flattened to a single material.
    """
    mesh = obj.data
    slots = obj.material_slots

    if len(slots) > 1:
        for slot_index, slot in enumerate(slots):
            existing = slot.material.name if slot.material else ""
            slot_bucket = classify_by_name(existing) or bucket
            if slot_bucket == "shell":
                slot_bucket = shell_variant(obj.name + existing, slot_index)
            if slot.material is not None and not REPLACE_EXISTING:
                continue
            mesh.materials[slot_index] = materials[slot_bucket]
        return len(slots)

    resolved = shell_variant(obj.name, index) if bucket == "shell" else bucket
    material = materials[resolved]

    if len(slots) == 0:
        mesh.materials.append(material)
    elif REPLACE_EXISTING or slots[0].material is None:
        mesh.materials[0] = material
    return 1


def main():
    scene_meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    armatures = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]

    print("\n" + "=" * 72)
    print("  PROJECT PHOTON — robot material pass")
    print("=" * 72)
    print(f"  mesh objects   {len(scene_meshes)}")
    print(f"  armatures      {len(armatures)} (not touched)")
    print(f"  team           {TEAM}")
    print(f"  mode           {'DRY RUN — nothing will change' if DRY_RUN else 'apply'}")

    if not scene_meshes:
        print("\n  Nothing to do: no mesh objects in the scene.")
        return

    # --- Single-mesh models cannot be split by material without help ---------
    if len(scene_meshes) == 1 and len(scene_meshes[0].material_slots) <= 1:
        print("\n  NOTE: this model is one mesh with one material slot.")
        print("  Per-part materials are impossible without either:")
        print("    (a) separating the mesh by loose parts   — Edit Mode > P > By Loose Parts")
        print("    (b) assigning faces to extra slots by hand, or")
        print("    (c) re-exporting from the source with parts kept separate.")
        print("  Applying the ceramic shell to the whole model for now.\n")

    materials = {key: build_surface_material(spec) for key, spec in MATERIALS.items()}
    materials["energy"] = build_energy_material()

    # --- Classify ------------------------------------------------------------
    generic = [o for o in scene_meshes if looks_generic(o.name)]
    use_geometry = len(generic) > len(scene_meshes) / 2
    geometry_map = classify_by_geometry(scene_meshes) if use_geometry else {}

    if use_geometry:
        print(f"\n  {len(generic)}/{len(scene_meshes)} names are generic — "
              "using the geometry classifier.")
    else:
        print("\n  Names look descriptive — using the keyword classifier.")

    skipped = [o for o in scene_meshes if is_source_mesh(o.name)]
    if skipped:
        print(f"\n  Skipping {len(skipped)} bake-source mesh(es) — not part of the shipped model:")
        for o in skipped:
            print(f"    {o.name[:58]}  ({len(o.data.polygons):,} faces)")
        scene_meshes = [o for o in scene_meshes if not is_source_mesh(o.name)]
    if not scene_meshes:
        print("\n  Every mesh looks like a bake source. Check SOURCE_HINTS.")
        return

    plan = []
    for index, obj in enumerate(scene_meshes):
        if obj.name in OVERRIDES:
            bucket, source = OVERRIDES[obj.name], "override"
        else:
            bucket = classify_by_name(obj.name)
            source = "name"
            if bucket is None:
                bucket = geometry_map.get(obj.name)
                source = "geometry"
            if bucket is None:
                bucket, source = "shell", "default"
        plan.append((obj, bucket, source, index))

    # --- Report --------------------------------------------------------------
    print("\n  " + "-" * 68)
    print(f"  {'OBJECT':<34} {'MATERIAL':<22} {'VIA':<10}")
    print("  " + "-" * 68)
    tally = {}
    for obj, bucket, source, index in plan:
        shown = shell_variant(obj.name, index) if bucket == "shell" else bucket
        tally[shown] = tally.get(shown, 0) + 1
        print(f"  {obj.name[:33]:<34} {MATERIALS.get(shown, {}).get('name', ENERGY_MATERIAL)[:21]:<22} {source:<10}")
    print("  " + "-" * 68)
    print("  " + "   ".join(f"{k}:{v}" for k, v in sorted(tally.items())))

    if DRY_RUN:
        print("\n  DRY RUN — no changes made. Set DRY_RUN = False to apply.\n")
        return

    # --- Apply ---------------------------------------------------------------
    slots_written = 0
    for obj, bucket, _source, index in plan:
        slots_written += assign(obj, bucket, materials, index)

    print(f"\n  {slots_written} material slot(s) written across {len(plan)} object(s).")
    print("  Armature, vertex groups, weights and modifiers untouched.")

    # --- Viewport ------------------------------------------------------------
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.shading.type = "MATERIAL"

    # --- Save ----------------------------------------------------------------
    if SAVE_ON_FINISH:
        if bpy.data.is_saved:
            bpy.ops.wm.save_mainfile()
            print(f"  Saved: {bpy.data.filepath}")
        else:
            print("  NOT SAVED: this file has never been saved. Use File > Save As once,")
            print("  then re-run — or set SAVE_ON_FINISH = False to silence this.")

    print("=" * 72 + "\n")


# =============================================================================
#  TEAM SWAP
# =============================================================================

def photon_set_team(team):
    """Recolour every energy channel in the file.

    Run from the Python Console after the main pass:

        import photon_material_pass as p
        p.photon_set_team("red")

    Or paste the two lines below into the Scripting editor:

        exec(open(r"<path to this file>").read())
        photon_set_team("red")

    One RGB node inside the shared group feeds every energy material, so this is
    a single write no matter how many parts glow.
    """
    global TEAM
    if team not in TEAM_COLORS:
        raise ValueError(f"Unknown team '{team}'. Options: {', '.join(TEAM_COLORS)}")
    TEAM = team
    ensure_team_node_group()
    print(f"[photon] energy channels set to {team}")
    if bpy.data.is_saved:
        bpy.ops.wm.save_mainfile()


def photon_set_emission(strength):
    """Change glow intensity without touching colour. Brief's range is 3–8."""
    global EMISSION_STRENGTH
    EMISSION_STRENGTH = float(strength)
    ensure_team_node_group()
    print(f"[photon] emission strength set to {strength}")


if __name__ == "__main__":
    main()
