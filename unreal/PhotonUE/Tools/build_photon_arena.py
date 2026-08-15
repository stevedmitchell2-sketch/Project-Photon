"""Authoritative Photon arena build — Visual Sprint 02.

Sprint 01 fixed the materials and the lighting, which left an arena that was correctly lit and
correctly shaded and still unmistakably a greybox. The reason was never the shading: every actor in
the level was /Engine/BasicShapes/Cube, and a cube reads as a cube at any exposure.

So this build places almost nothing from BasicShapes. The modules come from Tools/photon_mesh_kit.py,
which authors them with Geometry Script — massed from several volumes, boolean-cut for recessed
detail, and bevelled so edges catch a highlight. Run that script first; this one only places.

Structure of the arena, bottom to top:

  z    0 - 700   wall bays: recessed centre panel, structural ribs, kick plinth
  z  700 - 860   clerestory: a band set back 40 uu with an illuminated channel inside it
  z  860 - 900   soffit: a ledge projecting inward, capping the clerestory
  z  900 - 1000  upper wall, stepped back again
  z 1000          ceiling plane; coffers hang below it and the truss grid runs through it

That stepped section is what stops the perimeter reading as one flat wall, and it is why the arena
is 10 m tall rather than the 7 m it was: the tiers need somewhere to live.

Emissive is deliberately rationed. Sprint 01 put a strip on every available edge, which is the same
mistake as putting a cube everywhere — it stops meaning anything. Here it marks the court, the
clerestory, the centre, the team zones, and the inside of alternating wall recesses. Nothing else.
"""
import math

import unreal

MAP = "/Game/Photon/Maps/L_PhotonGrey"
KIT = "/Game/Photon/Meshes"
FOLDER = "PhotonArena"

CUBE = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")
CYL = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cylinder")

MAT = {
    "structure": unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonSurface"),
    "floor": unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonFloor"),
    "cover": unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonCover"),
    "metal": unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonMetal"),
    "energy": unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonGlow"),
}

# Roughness/metallic per role, mirroring PhotonVisuals::SetPhotonParameters. The runtime bootstrap
# re-applies these anyway; matching them here keeps the editor viewport honest.
ROLE_SHADING = {
    "structure": (0.70, 0.05),
    "floor": (0.78, 0.0),
    "cover": (0.52, 0.22),
    "metal": (0.30, 0.88),
    "energy": (0.50, 0.0),
}

# --- Palette (linear) — mirrors PhotonVisuals::Palette -------------------------------------------
STRUCTURE = unreal.LinearColor(0.045, 0.050, 0.062, 1.0)
STRUCTURE_LIGHT = unreal.LinearColor(0.085, 0.092, 0.110, 1.0)
# Floor faces the ceiling rig; keep it darker than cover so the court reads as a playing surface.
FLOOR_COL = unreal.LinearColor(0.014, 0.016, 0.022, 1.0)
COURT_COL = unreal.LinearColor(0.022, 0.026, 0.034, 1.0)
COURT_ALT = unreal.LinearColor(0.017, 0.020, 0.028, 1.0)
COVER_COL = unreal.LinearColor(0.118, 0.128, 0.152, 1.0)
METAL_COL = unreal.LinearColor(0.070, 0.076, 0.092, 1.0)
NEON = unreal.LinearColor(0.28, 0.78, 1.0, 1.0)
TEAM = {
    "Red": unreal.LinearColor(1.00, 0.18, 0.14, 1.0),
    "Green": unreal.LinearColor(0.16, 0.95, 0.42, 1.0),
    "Blue": unreal.LinearColor(0.20, 0.55, 1.00, 1.0),
    "Yellow": unreal.LinearColor(1.00, 0.80, 0.12, 1.0),
}

# --- Arena dimensions ----------------------------------------------------------------------------
HALF = 2000.0        # inner face of the perimeter wall
WALL_H = 700.0       # top of the wall-bay tier
CLEAR_H = 860.0      # top of the clerestory recess
CEIL = 1000.0        # ceiling plane
COURT = 1700.0       # half-extent of the marked competition court

# --- Lighting ------------------------------------------------------------------------------------
# Performance foundation (measured ~46→49 FPS at 1280x720 by culling decorative movables):
#   KEEP: Directional key, SkyLight, CeilingLight_*, CentreLight (sole rect shadow caster),
#         WallWash_* (cover readability), TeamLight_* (spawn identity).
#   OMIT: CyanGlow_* points, CeilingUp_* truss washes, WallGraze_* — emissive materials already
#         carry cyan/architectural read without paying movable-light cost.
COFFER_LM = 1800.0       # zone 2: ceiling key, recessed in the coffers
CENTRE_LM = 2200.0       # zone 3: competition floor, from the overhead rig
WALLWASH_LM = 5600.0     # zone 1: inward fill — enough for cover faces, under washout
TEAM_LM = 2000.0         # zone 5: team identity at the spawns
KEY_LIGHT_LUX = 0.32
SKY_LIGHT = 0.26
BLOOM = 0.18             # keep bloom low; camera also pins photon.Bloom

report = []
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def say(text):
    report.append(str(text))


def cool(r, g, b):
    """FColor is laid out B,G,R,A, so unreal.Color's positional arguments are (b, g, r, a).

    Every light in the first pass was written as Color(206, 226, 255) meaning cool white and
    was silently created as R=255 G=226 B=206 — warm amber. That is where the row of orange dots
    along the wall tops came from, and why an arena lit entirely by cyan-white fixtures rendered
    brown. Naming the channels is the fix.
    """
    return unreal.Color(r=r, g=g, b=b, a=255)


def dim(color, factor):
    """unreal.LinearColor has no scalar multiply in this Python API."""
    return unreal.LinearColor(color.r * factor, color.g * factor, color.b * factor, 1.0)


def spawn(cls, loc, yaw=0.0, pitch=0.0, roll=0.0):
    a = subsys.spawn_actor_from_class(
        cls, unreal.Vector(*loc), unreal.Rotator(roll=roll, pitch=pitch, yaw=yaw))
    if a:
        # Every actor this script owns is tagged by folder, which is what makes the rebuild
        # idempotent. The previous version matched on label prefixes and quietly duplicated four
        # spawn pylons on every run because one prefix was missing from the list.
        a.set_folder_path(FOLDER)
    return a


def surface(actor, role, color, emissive=0.0):
    smc = actor.static_mesh_component
    parent = MAT.get(role) or MAT["structure"]
    rough, metal = ROLE_SHADING.get(role, (0.6, 0.0))
    for slot in range(max(1, smc.get_num_materials())):
        smc.set_material(slot, parent)
        mid = smc.create_dynamic_material_instance(slot)
        if mid:
            mid.set_vector_parameter_value("TintColor", color)
            mid.set_scalar_parameter_value("EmissiveStrength", emissive)
            mid.set_scalar_parameter_value("Roughness", rough)
            mid.set_scalar_parameter_value("Metallic", metal)


def place(asset, loc, label, role="structure", color=None, emissive=0.0, yaw=0.0, pitch=0.0,
          roll=0.0, scale=1.0):
    """Place an authored kit module. Authored at real size, so scale stays 1 unless stated."""
    mesh = unreal.EditorAssetLibrary.load_asset("%s/%s" % (KIT, asset))
    if not mesh:
        say("MISSING KIT ASSET %s" % asset)
        return None
    a = spawn(unreal.StaticMeshActor, loc, yaw=yaw, pitch=pitch, roll=roll)
    a.set_actor_label(label)
    a.set_actor_scale3d(unreal.Vector(scale, scale, scale) if isinstance(scale, float)
                        else unreal.Vector(*scale))
    a.static_mesh_component.set_static_mesh(mesh)
    a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    surface(a, role, color if color else STRUCTURE, emissive)
    return a


def box(loc, scale, label, role="structure", color=None, emissive=0.0, yaw=0.0, mesh=None):
    """Engine cube. Reserved for slabs and thin strips, where there is no silhouette to get wrong."""
    a = spawn(unreal.StaticMeshActor, loc, yaw=yaw)
    a.set_actor_label(label)
    a.set_actor_scale3d(unreal.Vector(*scale))
    a.static_mesh_component.set_static_mesh(mesh or CUBE)
    a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    surface(a, role, color if color else STRUCTURE, emissive)
    return a


unreal.EditorLoadingAndSavingUtils.load_map(MAP)
say("loaded_map=%s" % MAP)

# --- 0. Clear the previously generated arena -----------------------------------------------------
LEGACY_PREFIXES = ("Floor", "Wall", "Cover", "LaneCover", "Platform", "Perch", "Arena", "Target_",
                   "Court", "Boundary", "Lane", "Panel", "Roof", "Ceiling", "Signage", "Pylon",
                   "Spawn", "Pedestal", "Step")
removed = 0
for a in subsys.get_all_level_actors():
    label = a.get_actor_label()
    in_folder = str(a.get_folder_path()) == FOLDER
    legacy_mesh = isinstance(a, unreal.StaticMeshActor) and label.startswith(LEGACY_PREFIXES)
    legacy_light = isinstance(a, (unreal.RectLight, unreal.SpotLight, unreal.PointLight))
    is_target = a.get_class().get_name() == "PhotonTarget"
    if in_folder or legacy_mesh or legacy_light or is_target:
        subsys.destroy_actor(a)
        removed += 1
say("removed_previous_actors=%d" % removed)

# --- 1. Floor and competition court --------------------------------------------------------------
box((0, 0, -50), (43, 43, 1.0), "Floor", "floor", FLOOR_COL)

# Panel variation: four quadrant panels at marginally different values, plus seams. Subtle enough
# that it reads as flooring rather than as a checkerboard, but it stops the court being one dead
# 34 m plane.
for i, (sx, sy) in enumerate([(1, 1), (-1, 1), (1, -1), (-1, -1)]):
    lit = (sx * sy) > 0
    box((sx * COURT / 2.0, sy * COURT / 2.0, 1), (COURT / 100.0, COURT / 100.0, 0.02),
        "CourtPanel%s_%d" % ("A" if lit else "B", i), "floor", COURT_COL if lit else COURT_ALT)
for i, off in enumerate([-1130, -570, 570, 1130]):
    box((off, 0, 2), (0.05, COURT * 2 / 100.0, 0.02), "CourtSeam_X%d" % i, "floor",
        dim(FLOOR_COL, 0.6))
    box((0, off, 2), (COURT * 2 / 100.0, 0.05, 0.02), "CourtSeam_Y%d" % i, "floor",
        dim(FLOOR_COL, 0.6))

# Competition markings: the court boundary and three lane lines. Restrained on purpose.
for i, (x, y, sx, sy) in enumerate([
    (0, COURT, COURT * 2 / 100.0, 0.10), (0, -COURT, COURT * 2 / 100.0, 0.10),
    (COURT, 0, 0.10, COURT * 2 / 100.0), (-COURT, 0, 0.10, COURT * 2 / 100.0),
]):
    box((x, y, 3), (sx, sy, 0.03), "BoundaryLine_%d" % i, "energy", NEON, 1.6)
for i, x in enumerate([-850, 850]):
    box((x, 0, 2.5), (0.05, COURT * 2 / 100.0, 0.02), "LaneLine_%d" % i, "energy", dim(NEON, 0.5), 0.9)

# Half-court seam + centre circle — sports-venue read without props.
box((0, 0, 3.2), (COURT * 2 / 100.0, 0.06, 0.025), "HalfCourt_Line", "energy", dim(NEON, 0.45), 0.85)
for i, ang in enumerate(range(0, 360, 20)):
    rad = math.radians(ang)
    cx, cy = math.cos(rad) * 320.0, math.sin(rad) * 320.0
    box((cx, cy, 3.0), (0.55, 0.08, 0.025), "CenterCircle_%d" % i, "energy", dim(NEON, 0.65), 1.4,
        yaw=ang)
# Lane index blocks (1–3 style markers) along each long boundary.
for i, x in enumerate([-1100, 0, 1100]):
    box((x, COURT - 40, 8), (1.2, 0.35, 0.12), "LaneMark_N_%d" % (i + 1), "energy", dim(NEON, 0.55), 1.1)
    box((x, -(COURT - 40), 8), (1.2, 0.35, 0.12), "LaneMark_S_%d" % (i + 1), "energy", dim(NEON, 0.55), 1.1)

# --- 2. Perimeter shell ---------------------------------------------------------------------------
# Sides as (label, sign, axis). Each wall is built inward-facing from the same module set.
SIDES = [("N", (0.0, 1.0), 0.0), ("S", (0.0, -1.0), 180.0),
         ("E", (1.0, 0.0), -90.0), ("W", (-1.0, 0.0), 90.0)]
BAY_OFFSETS = [-1750.0, -1250.0, -750.0, -250.0, 250.0, 750.0, 1250.0, 1750.0]
# Canted bays at two positions per side, so the perimeter is not eight identical modules in a row.
ANGLED_AT = {1, 6}
# Illuminated recess channels on alternating bays only.
LIT_BAYS = {0, 3, 4, 7}

for side, (nx, ny), yaw in SIDES:
    ax, ay = (abs(nx), abs(ny))

    def at(along, out, z):
        """Convert (position along the wall, distance outward from centre) to world x, y."""
        if ay:  # north or south wall: the run is along X
            return (along, ny * out, z)
        return (nx * out, along, z)

    # Solid backing wall. Hidden behind the bays, and the guarantee that nothing leaks out of the
    # arena regardless of how the modules tile.
    box(at(0.0, HALF + 55, CEIL / 2.0),
        (43 if ay else 1.1, 1.1 if ay else 43, CEIL / 100.0),
        "Wall_%s" % side, "structure", STRUCTURE)

    for i, along in enumerate(BAY_OFFSETS):
        asset = "SM_PhotonWallBayAngled" if i in ANGLED_AT else "SM_PhotonWallBay"
        place(asset, at(along, HALF + 35, 0.0), "WallBay_%s_%d" % (side, i),
              "structure", STRUCTURE, yaw=yaw)
        if i in LIT_BAYS:
            # Inside the recess. The bay's inner face is at HALF and the recess backs onto HALF+25,
            # so HALF+14 puts the channel in the pocket. The first pass put it at HALF-16, which is
            # in front of the wall, and it read as a 2.6 m cyan billboard stuck to the architecture.
            box(at(along, HALF + 14, 350.0),
                (0.16 if ay else 0.05, 0.05 if ay else 0.16, 3.4),
                "Energy_BayChannel_%s_%d" % (side, i), "energy", dim(NEON, 0.7), 2.4)

    # Clerestory: a band stepped back 40 uu with a continuous illuminated channel inside it.
    box(at(0.0, HALF + 70, (WALL_H + CLEAR_H) / 2.0),
        (43 if ay else 0.6, 0.6 if ay else 43, (CLEAR_H - WALL_H) / 100.0),
        "Clerestory_%s" % side, "structure", dim(STRUCTURE, 0.8))
    box(at(0.0, HALF + 36, 782.0),
        (40 if ay else 0.06, 0.06 if ay else 40, 0.32),
        "Energy_Clerestory_%s" % side, "energy", dim(NEON, 0.85), 2.4)
    # Soffit: the ledge that caps the clerestory and gives the wall a horizontal shadow line.
    box(at(0.0, HALF - 30, 880.0),
        (43 if ay else 1.5, 1.5 if ay else 43, 0.4),
        "Soffit_%s" % side, "structure", STRUCTURE_LIGHT)
    # Upper wall, stepped back again to the ceiling.
    box(at(0.0, HALF + 50, 950.0),
        (43 if ay else 1.0, 1.0 if ay else 43, 1.0),
        "UpperWall_%s" % side, "structure", dim(STRUCTURE, 0.9))

for i, (sx, sy) in enumerate([(1, 1), (-1, 1), (1, -1), (-1, -1)]):
    place("SM_PhotonCornerPylon", (sx * (HALF + 60), sy * (HALF + 60), 0),
          "CornerPylon_%d" % i, "structure", STRUCTURE_LIGHT, yaw=45.0)

# --- 3. Ceiling ------------------------------------------------------------------------------------
box((0, 0, CEIL + 30), (43, 43, 0.6), "Roof", "structure", dim(STRUCTURE, 0.85))

# Coffers: open-bottomed light boxes hanging just below the ceiling, each with a rect light inside.
for i, (x, y) in enumerate([(-950, -950), (950, -950), (-950, 950), (950, 950)]):
    place("SM_PhotonCeilingBay", (x, y, CEIL - 110), "CeilingBay_%d" % i,
          "structure", STRUCTURE_LIGHT)
    # The visible luminaire. Without it the ceiling is a black plane with an invisible light in it,
    # which is why looking up read as nothing at all.
    box((x, y, CEIL - 24), (7.6, 7.6, 0.06), "Energy_CofferPanel_%d" % i, "energy",
        unreal.LinearColor(0.72, 0.83, 1.0, 1.0), 2.2)
    light = spawn(unreal.RectLight, (x, y, CEIL - 26), pitch=-90.0)
    light.set_actor_label("CeilingLight_%d" % i)
    lc = light.rect_light_component
    lc.set_mobility(unreal.ComponentMobility.MOVABLE)
    lc.set_editor_property("intensity_units", unreal.LightUnits.LUMENS)
    lc.set_editor_property("intensity", COFFER_LM)
    lc.set_editor_property("source_width", 760.0)
    lc.set_editor_property("source_height", 760.0)
    lc.set_editor_property("attenuation_radius", 3200.0)
    lc.set_editor_property("light_color", cool(206, 226, 255))
    # Shadows: CentreLight is the only rect shadow caster (VSM + non-Nanite overflow risk).
    lc.set_editor_property("cast_shadows", False)

# Truss grid. Deliberately uneven spacing: an even grid reads as a texture, an uneven one reads as
# structure that had to span something.
for i, y in enumerate([-1650, 0, 1650]):
    place("SM_PhotonTruss", (0, y, 930), "Truss_X_%d" % i, "metal", METAL_COL)
for i, x in enumerate([-1650, 0, 1650]):
    place("SM_PhotonTruss", (x, 0, 930), "Truss_Y_%d" % i, "metal", METAL_COL, yaw=90.0)

# --- 4. Centre: the competition anchor ---------------------------------------------------------------
place("SM_PhotonCentreDais", (0, 0, 0), "CentreDais", "cover", dim(COVER_COL, 0.85))
place("SM_PhotonCentreRing", (0, 0, 27), "Energy_CentreRing", "energy", dim(NEON, 0.75), 2.6)
place("SM_PhotonCoverPylon", (0, 0, 28), "Beacon_Centre", "cover", COVER_COL, scale=0.95)
box((0, 0, 300), (0.98, 0.98, 0.10), "Energy_BeaconTop", "energy", NEON, 4.0)

# Overhead rig: the ceiling half of the same anchor, so the centre reads from any height.
place("SM_PhotonCentreRig", (0, 0, 745), "CentreRig", "metal", METAL_COL)
place("SM_PhotonCentreRing", (0, 0, 738), "Energy_RigRing", "energy", dim(NEON, 0.9), 3.4, scale=1.58)
rig_light = spawn(unreal.RectLight, (0, 0, 726), pitch=-90.0)
rig_light.set_actor_label("CentreLight")
rl = rig_light.rect_light_component
rl.set_mobility(unreal.ComponentMobility.MOVABLE)
rl.set_editor_property("intensity_units", unreal.LightUnits.LUMENS)
rl.set_editor_property("intensity", CENTRE_LM)
rl.set_editor_property("source_width", 1200.0)
rl.set_editor_property("source_height", 1200.0)
rl.set_editor_property("attenuation_radius", 2600.0)
rl.set_editor_property("light_color", cool(220, 232, 255))
rl.set_editor_property("cast_shadows", True)

# --- 5. Cover -----------------------------------------------------------------------------------------
# One quadrant, instantiated at four rotations. Four teams spawn on four sides, so the layout has to
# be rotationally fair; it also makes the arena look composed rather than scattered.
QUADRANT = [
    ("SM_PhotonCoverPod", 790, 340, 0.0, "Pod"),
    ("SM_PhotonCoverLow", 1180, 900, 28.0, "Low"),
    ("SM_PhotonCoverAngled", 430, 1180, -22.0, "Angled"),
    ("SM_PhotonCoverPylon", 1520, 330, 0.0, "Pylon"),
    ("SM_PhotonCoverBench", 940, 1520, 90.0, "Bench"),
]
for q in range(4):
    a = math.radians(q * 90.0)
    ca, sa = math.cos(a), math.sin(a)
    for asset, x, y, yaw, kind in QUADRANT:
        wx, wy = x * ca - y * sa, x * sa + y * ca
        label = "Cover_%s_%d" % (kind, q)
        place(asset, (wx, wy, 0), label, "cover", COVER_COL, yaw=yaw + q * 90.0)
        # Height cue on the low barriers only. Putting a lit lip on all five archetypes was what
        # made the last build look like a strip-light showroom.
        if kind == "Low":
            box((wx, wy, 114), (2.6, 0.9, 0.05), "Energy_CoverTrim_%d" % q, "energy",
                dim(NEON, 0.55), 1.5, yaw=yaw + q * 90.0)
        if kind == "Pylon":
            box((wx, wy, 280), (1.0, 1.0, 0.08), "Energy_PylonCap_%d" % q, "energy",
                dim(NEON, 0.6), 2.0, yaw=yaw + q * 90.0)

# --- 6. Verticality ------------------------------------------------------------------------------------
# Playable deck, reached by steps from the west.
DECK = (1250.0, -1150.0, 300.0)
place("SM_PhotonDeckSlab", DECK, "DeckSlab", "cover", dim(COVER_COL, 0.9))
for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
    box((DECK[0] + sx * 520, DECK[1] + sy * 320, DECK[2] / 2.0), (0.7, 0.7, DECK[2] / 100.0),
        "DeckColumn_%d%d" % (sx, sy), "metal", METAL_COL)
for i in range(3):
    place("SM_PhotonRailing", (DECK[0] - 400 + i * 400, DECK[1] + 400, DECK[2] + 38),
          "Railing_N_%d" % i, "metal", METAL_COL)
    place("SM_PhotonRailing", (DECK[0] - 400 + i * 400, DECK[1] - 400, DECK[2] + 38),
          "Railing_S_%d" % i, "metal", METAL_COL)
for i, h in enumerate([100, 200, 300]):
    box((DECK[0] - 700 - i * 130, DECK[1], h / 2.0), (1.3, 5.0, h / 100.0),
        "DeckStep_%d" % i, "cover", dim(COVER_COL, 0.85))

# Broadcast gantry: not playable, purely to give the west side depth and a sense of a venue that
# has people in it who are not competing.
place("SM_PhotonDeckSlab", (-1820, 0, 640), "Gantry", "metal", METAL_COL, yaw=90.0,
      scale=(1.0, 2.6, 1.0))
for i in range(5):
    place("SM_PhotonRailing", (-1420, -800 + i * 400, 678), "Railing_Gantry_%d" % i,
          "metal", METAL_COL, yaw=90.0)

# --- 7. Team spawn zones ---------------------------------------------------------------------------------
SPAWNS = [("Red", 0.0, -1700.0, 90.0), ("Blue", 0.0, 1700.0, -90.0),
          ("Green", -1700.0, 0.0, 0.0), ("Yellow", 1700.0, 0.0, 180.0)]
for team, x, y, facing in SPAWNS:
    colour = TEAM[team]
    # Outward direction, so the gate sits behind the pad rather than on top of the player.
    ox, oy = (0.0, -1.0) if y < 0 else (0.0, 1.0) if y > 0 else ((-1.0, 0.0) if x < 0 else (1.0, 0.0))
    gate_yaw = 0.0 if oy else 90.0

    # Team-zone floor wash — larger than the pad so spawn identity reads from mid-court.
    box((x - ox * 80, y - oy * 80, 1.5), (9.5, 9.5, 0.02), "TeamZone_%s" % team, "floor",
        dim(colour, 0.055), 0.0)
    box((x, y, 2), (6, 6, 0.03), "SpawnPad_%s" % team, "cover", dim(colour, 0.16), 0.0)
    for j, (dx, dy, sx, sy) in enumerate([(0, 300, 6, 0.08), (0, -300, 6, 0.08),
                                          (300, 0, 0.08, 6), (-300, 0, 0.08, 6)]):
        box((x + dx, y + dy, 4), (sx, sy, 0.04), "SpawnStrip_%s_%d" % (team, j), "energy",
            colour, 3.4)

    place("SM_PhotonSpawnGate", (x + ox * 250, y + oy * 250, 0), "SpawnGate_%s" % team,
          "structure", STRUCTURE_LIGHT, yaw=gate_yaw)
    box((x + ox * 250, y + oy * 250, 356), (4.0 if oy else 0.3, 0.3 if oy else 4.0, 0.14),
        "SpawnStrip_%s_Lintel" % team, "energy", colour, 4.0)

    spot = spawn(unreal.SpotLight, (x + ox * 120, y + oy * 120, 620), pitch=-70.0,
                 yaw=math.degrees(math.atan2(-oy, -ox)))
    spot.set_actor_label("TeamLight_%s" % team)
    sc = spot.spot_light_component
    sc.set_mobility(unreal.ComponentMobility.MOVABLE)
    sc.set_editor_property("intensity_units", unreal.LightUnits.LUMENS)
    sc.set_editor_property("intensity", TEAM_LM)
    sc.set_editor_property("attenuation_radius", 1400.0)
    sc.set_editor_property("outer_cone_angle", 46.0)
    sc.set_editor_property("inner_cone_angle", 18.0)
    sc.set_editor_property("light_color", cool(
        int(min(colour.r, 1.0) * 255), int(min(colour.g, 1.0) * 255), int(min(colour.b, 1.0) * 255)))
    sc.set_editor_property("cast_shadows", False)

# --- 8. Architectural fill and infrastructure glow ----------------------------------------------------------
def rect_light(label, loc, yaw, pitch, lumens, width, height, radius, colour, shadows=False):
    a = spawn(unreal.RectLight, loc, yaw=yaw, pitch=pitch)
    a.set_actor_label(label)
    c = a.rect_light_component
    c.set_mobility(unreal.ComponentMobility.MOVABLE)
    c.set_editor_property("intensity_units", unreal.LightUnits.LUMENS)
    c.set_editor_property("intensity", lumens)
    c.set_editor_property("source_width", width)
    c.set_editor_property("source_height", height)
    c.set_editor_property("attenuation_radius", radius)
    c.set_editor_property("light_color", colour)
    c.set_editor_property("cast_shadows", shadows)
    return a


# A rect light emits along its actor's +X, so the yaw here is the direction the light faces, not the
# wall it belongs to. Getting this backwards on the first pass aimed every wash out of the arena.
FACING = {"N": -90.0, "S": 90.0, "E": 180.0, "W": 0.0}
for side, (nx, ny), _yaw in SIDES:
    inward = FACING[side]
    at_wall = lambda out, z: ((0.0, ny * out, z) if ny else (nx * out, 0.0, z))

    # Zone 1: inward fill. Kept — primary cover/face lighting. Graze and CeilingUp omitted for FPS.
    rect_light("WallWash_%s" % side, at_wall(HALF - 140, 470.0), inward, -14.0,
               WALLWASH_LM, 3000.0, 520.0, 2600.0, cool(150, 180, 220))

# Zone 4 cyan spill lights omitted: Energy_* emissive meshes already provide the cyan read.
say("decorative_lights_omitted=CyanGlow,CeilingUp,WallGraze")

# --- 9. Targets ------------------------------------------------------------------------------------------------
target_cls = unreal.load_class(None, "/Script/Photon.PhotonTarget")
for i, (x, y) in enumerate([(620, 980), (-980, 620), (-620, -980), (980, -620), (0, 1420)]):
    place("SM_PhotonPedestal", (x, y, 0), "Pedestal_%d" % i, "structure", STRUCTURE_LIGHT)
    if target_cls:
        t = spawn(target_cls, (x, y, 210))
        t.set_actor_label("ArenaTarget_%d" % i)

# --- 10. Signage / scoreboard surfaces ----------------------------------------------------------------
# Two installed screens in wall recesses + a metal frame so they read as venue displays.
for i, (x, y, yaw) in enumerate([(0, HALF - 8, 0), (0, -(HALF - 8), 180)]):
    box((x, y + 18, 400) if i == 0 else (x, y - 18, 400), (11.6, 0.22, 3.1),
        "ScoreboardFrame_%d" % i, "metal", METAL_COL, yaw=yaw)
    box((x, y + 14, 400) if i == 0 else (x, y - 14, 400), (11.0, 0.18, 2.8),
        "SignageBody_%d" % i, "structure", STRUCTURE_LIGHT, yaw=yaw)
    box((x, y + 8, 400) if i == 0 else (x, y - 8, 400), (10.2, 0.08, 2.2),
        "ScoreboardFace_%d" % i, "energy", dim(NEON, 0.18), 0.7, yaw=yaw)

# --- 11. Lighting environment -----------------------------------------------------------------------------------------
for a in subsys.get_all_level_actors():
    if isinstance(a, unreal.DirectionalLight):
        a.light_component.set_mobility(unreal.ComponentMobility.MOVABLE)
        a.light_component.set_intensity(KEY_LIGHT_LUX)
        say("dirlight tuned intensity=%.2f" % KEY_LIGHT_LUX)
    elif isinstance(a, unreal.SkyLight):
        a.light_component.set_mobility(unreal.ComponentMobility.MOVABLE)
        a.light_component.set_intensity(SKY_LIGHT)
        say("skylight tuned intensity=%.2f" % SKY_LIGHT)
    elif isinstance(a, unreal.PlayerStart):
        a.set_actor_location_and_rotation(
            unreal.Vector(0, -1700, 120), unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0),
            False, False)
        say("playerstart at red spawn, facing centre")

existing = {a.get_actor_label() for a in subsys.get_all_level_actors()}

if "PhotonPostProcess" not in existing:
    ppv = subsys.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 300))
    ppv.set_actor_label("PhotonPostProcess")
else:
    ppv = next(a for a in subsys.get_all_level_actors() if a.get_actor_label() == "PhotonPostProcess")
ppv.set_editor_property("unbound", True)
s = ppv.get_editor_property("settings")
# Exposure is deliberately NOT set here. Pinning it on this volume was measured across a ten stop
# sweep and changed nothing at all, so it lives on the player camera instead
# (PhotonVisuals::ApplyArenaPostProcess, photon.Exposure).
s.set_editor_property("override_bloom_intensity", True)
s.set_editor_property("bloom_intensity", BLOOM)
s.set_editor_property("override_vignette_intensity", True)
s.set_editor_property("vignette_intensity", 0.30)
ppv.set_editor_property("settings", s)
say("postprocess bloom=%.2f (exposure is owned by the camera)" % BLOOM)

if "PhotonFog" not in existing:
    fog = subsys.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0))
    fog.set_actor_label("PhotonFog")
    fc = fog.component
    fc.set_editor_property("fog_density", 0.010)
    fc.set_editor_property("fog_height_falloff", 0.45)
    fc.set_editor_property("fog_inscattering_luminance", unreal.LinearColor(0.015, 0.040, 0.075, 1.0))
    say("fog added")

unreal.EditorLevelLibrary.save_current_level()

actors = subsys.get_all_level_actors()
kit_actors = [a for a in actors if isinstance(a, unreal.StaticMeshActor)
              and a.static_mesh_component.static_mesh
              and "Photon/Meshes" in a.static_mesh_component.static_mesh.get_path_name()]
say("final_actor_count=%d" % len(actors))
say("static_meshes=%d" % len([a for a in actors if isinstance(a, unreal.StaticMeshActor)]))
say("authored_kit_actors=%d" % len(kit_actors))
say("rect_lights=%d" % len([a for a in actors if isinstance(a, unreal.RectLight)]))
say("spot_lights=%d" % len([a for a in actors if isinstance(a, unreal.SpotLight)]))
say("point_lights=%d" % len([a for a in actors if isinstance(a, unreal.PointLight)]))
say("dir_lights=%d" % len([a for a in actors if isinstance(a, unreal.DirectionalLight)]))
shadow_casters = 0
for a in actors:
    lc = None
    if isinstance(a, unreal.RectLight):
        lc = a.rect_light_component
    elif isinstance(a, unreal.SpotLight):
        lc = a.spot_light_component
    elif isinstance(a, unreal.PointLight):
        lc = a.point_light_component
    elif isinstance(a, unreal.DirectionalLight):
        lc = a.light_component
    if lc and lc.get_editor_property("cast_shadows"):
        shadow_casters += 1
say("shadow_casters=%d" % shadow_casters)
say("targets=%d" % len([a for a in actors if a.get_class().get_name() == "PhotonTarget"]))

with open(unreal.Paths.project_saved_dir() + "Logs/photon_arena_build.txt", "w") as f:
    f.write("\n".join(report))
