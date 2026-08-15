"""Authoritative Photon arena build — Visual Sprint 03, "the bowl".

Sprint 02 replaced every engine primitive with authored kit modules, which fixed the silhouettes and
left an arena that was still, unmistakably, a room. A well-detailed room with a 10 m ceiling, but a
room: four walls, a lid, and nothing above the player except the underside of that lid.

This build takes its structure from the experimental Apex arena (src/maps/arena02_apex.ts), which was
authored to explore exactly this problem. Four of its ideas are load-bearing here:

  1. THE BUILDING IS NOT THE PLAY SPACE. Apex keeps its bounds at 60 x 60 and puts the whole
     spectator bowl in a ring outside them. The ring is free in every system that scales with arena
     area, and it can be as deep as it likes because nothing in it touches a sight line. Photon's
     play space is unchanged at 40 x 40 — every cover position, spawn, target and PlayerStart below
     is where Sprint 02 left it — and the venue is built in a 16 m ring beyond the containment wall.

  2. THE CEILING IS NOT THE ROOF. The wall tops out at 11 m, which is where gameplay stops. The roof
     is at 24.6 m, and between them are the bowl, the suites, the camera gantry and the truss grid.
     That gap is the single biggest visual difference between this build and the last one.

  3. OPPOSITE WALLS CAN BE DIFFERENT BUILDINGS. Four-fold symmetry guarantees balance and guarantees
     every wall looks the same, which is most of why a greybox reads as a greybox. Spawns stay
     four-fold — they have to be fair — but the elevation above each stand is unique: press suites
     north, general admission south, the Champion's Walk west, the Sky Deck east. You can say where
     you are without reading a compass.

  4. WARM IS RATIONED. Apex allows itself two warm surfaces in an otherwise charcoal-and-cyan
     venue: the suite glazing and the Walk's amber trim. Both survive here, and they are the reason
     the arena stops reading as monochrome.

The vertical section, bottom to top:

  z     0        competition floor
  z   460        elevated decks (two of them, on the diagonal)
  z     0 - 700  wall bays: recessed centre panel, structural ribs, kick plinth
  z   700 - 860  clerestory, set back 40 uu with an illuminated channel inside it
  z   880        soffit ledge
  z   900 - 1100 upper wall, stepped back again
  z  1100        parapet and the LED ribbon — top of the containment wall, top of gameplay
  z  1150 - 1534 lower bowl, seven raked rows
  z  1580 - 2300 the shelf: suites (N), upper bowl (S), Champion's Walk (W), Sky Deck (E)
  z  1980        camera gantry ring
  z  2280        lighting truss grid
  z  2460        roof

Run Tools/photon_mesh_kit.py first; this script only places.
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

# Roughness/metallic per role, mirroring PhotonVisuals::SetPhotonParameters.
ROLE_SHADING = {
    "structure": (0.70, 0.05),
    "floor": (0.78, 0.0),
    "cover": (0.52, 0.22),
    "metal": (0.30, 0.88),
    "energy": (0.50, 0.0),
}

# --- Palette (linear) — mirrors PhotonVisuals::Palette --------------------------------------------
# Roughly tripled from Sprint 02. Those values were picked while the arena was blowing out to white
# and they "fixed" it by making everything nearly black: a measured frame came back at a mean of
# 26/255 with no material separation left. Charcoal architecture is about 0.10 linear.
STRUCTURE = unreal.LinearColor(0.105, 0.112, 0.132, 1.0)
STRUCTURE_LIGHT = unreal.LinearColor(0.165, 0.176, 0.202, 1.0)
FLOOR_COL = unreal.LinearColor(0.040, 0.044, 0.056, 1.0)
COURT_COL = unreal.LinearColor(0.058, 0.064, 0.080, 1.0)
COURT_ALT = unreal.LinearColor(0.046, 0.051, 0.066, 1.0)
COVER_COL = unreal.LinearColor(0.178, 0.188, 0.214, 1.0)
METAL_COL = unreal.LinearColor(0.115, 0.124, 0.146, 1.0)
SEAT_COL = unreal.LinearColor(0.052, 0.060, 0.078, 1.0)
NEON = unreal.LinearColor(0.28, 0.78, 1.0, 1.0)
# The only two warm surfaces in the building.
AMBER = unreal.LinearColor(1.00, 0.62, 0.10, 1.0)
SUITE_GLASS = unreal.LinearColor(1.00, 0.66, 0.34, 1.0)
TEAM = {
    "Red": unreal.LinearColor(1.00, 0.18, 0.14, 1.0),
    "Green": unreal.LinearColor(0.16, 0.95, 0.42, 1.0),
    "Blue": unreal.LinearColor(0.20, 0.55, 1.00, 1.0),
    "Yellow": unreal.LinearColor(1.00, 0.80, 0.12, 1.0),
}

# --- Arena dimensions -----------------------------------------------------------------------------
HALF = 2000.0        # inner face of the containment wall. The play space. UNCHANGED.
COURT = 1700.0       # half-extent of the marked competition court. UNCHANGED.
BOWL = 3600.0        # building half-extent: a 16 m spectator ring outside the play space
MEZZ = 240.0         # elevated deck level, set by what its ramp can climb — see section 10
PLAY_TOP = 1100.0    # top of the containment wall — the top of gameplay
TIER_A = 1150.0      # lower bowl, front row
SHELF = 1580.0       # the upper shelf: a different building on every wall
BOOTH_Y = 1980.0     # camera gantry ring
TRUSS_Y = 2280.0
ROOF = 2460.0

COLUMN_R = 1650.0    # atrium colonnade radius
COLUMN_TOP = 2280.0  # authored height of SM_PhotonAtriumColumn

# --- Lighting -------------------------------------------------------------------------------------
# The rig moved from 9 m to 21 m when the roof went up, and illuminance falls with the square of
# distance, so the coffer lights are ~7x what they were. Everything else is where Sprint 02 measured
# it at 46-49 FPS: the movable count only grows by the four bow washes.
COFFER_LM = 13000.0      # ceiling key, from the truss
CENTRE_LM = 3400.0       # competition floor, from the suspended rig (sole rect shadow caster)
WALLWASH_LM = 5600.0     # inward fill — cover faces
BOWLWASH_LM = 3400.0     # the seating, which is otherwise a black mass above the wall
TEAM_LM = 900.0          # team identity at the spawns
KEY_LIGHT_LUX = 0.32
SKY_LIGHT = 0.26
BLOOM = 0.18

# Broadcast venues light with near-white sources and let the fixtures supply the colour. Photon was
# doing the opposite: every house light was 206/226/255, which put a blue cast on the architecture,
# the seating, the steel and the floor alike. Measured over the eleven tour frames, 81% of lit
# pixels came back reading as cyan — so the cyan energy strips, which are supposed to be the
# arena's signature, were the same hue as the concrete behind them. HOUSE is the neutral key the
# graphite palette is meant to be seen under; the tiny residual blue keeps it from going sodium.
HOUSE = (250, 250, 252)   # coffers, centre rig — the light you read gameplay by
FILL = (232, 238, 250)    # wall wash, still white but a touch cooler for depth
BOWL_TINT = (196, 212, 240)  # the seating rake, allowed to stay cool: it is scenery, not gameplay

report = []
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def say(text):
    report.append(str(text))


def cool(r, g, b):
    """FColor is laid out B,G,R,A, so unreal.Color's positional arguments are (b, g, r, a).

    Every light in the first pass was written as Color(206, 226, 255) meaning cool white and was
    silently created as R=255 G=226 B=206 — warm amber. Naming the channels is the fix.
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
        # idempotent. Matching on label prefixes quietly duplicated four spawn pylons per run.
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


def box(loc, scale, label, role="structure", color=None, emissive=0.0, yaw=0.0, pitch=0.0, mesh=None):
    """Engine cube. Reserved for slabs and thin strips, where there is no silhouette to get wrong."""
    a = spawn(unreal.StaticMeshActor, loc, yaw=yaw, pitch=pitch)
    a.set_actor_label(label)
    a.set_actor_scale3d(unreal.Vector(*scale))
    a.static_mesh_component.set_static_mesh(mesh or CUBE)
    a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    surface(a, role, color if color else STRUCTURE, emissive)
    return a


def on_circle(radius, degrees):
    t = math.radians(degrees)
    return math.cos(t) * radius, math.sin(t) * radius


def arc(radius, z, depth, height, label, role, colour, emissive=0.0, count=24,
        start=0.0, span=360.0, cx=0.0, cy=0.0):
    """Apex's "curves out of boxes": a ring of boxes, each yawed onto its own tangent.

    The convention the whole thing depends on is that a box yawed by `a` has its local X along
    (cos a, sin a). A brush sitting at angle `t` therefore needs yaw = t + 90 to put its long axis
    tangential and its depth radial. Get that backwards and you build a circle out of boxes that all
    face the same way, which reads as a pile of crates.

    Chord length carries Apex's 4% overlap so the seams do not open up as the radius grows.
    """
    step = span / count
    chord = 2.0 * radius * math.sin(math.radians(abs(step)) * 0.5) * 1.04 + 4.0
    for i in range(count):
        ang = start + step * (i + 0.5)
        x, y = on_circle(radius, ang)
        box((cx + x, cy + y, z), (chord / 100.0, depth / 100.0, height / 100.0),
            "%s_%d" % (label, i), role, colour, emissive, yaw=ang + 90.0)


def text_sign(loc, label, text, yaw, size, colour):
    """Real readable type. Nothing else in the kit can say the word PHOTON."""
    try:
        a = spawn(unreal.TextRenderActor, loc, yaw=yaw)
        a.set_actor_label(label)
        c = getattr(a, "text_render", None) or a.get_component_by_class(unreal.TextRenderComponent)
        try:
            c.set_text(text)
        except Exception:
            c.set_editor_property("text", text)
        c.set_world_size(size)
        c.set_text_render_color(colour)
        # The engine's own enum is misspelled ("Aligment") and its members carry the EHTA_/EVRTA_
        # prefixes, so the obvious `HorizTextAligment.CENTER` does not exist. The first attempt
        # tried exactly that inside a hasattr guard, which meant every sign silently kept the
        # default left/bottom alignment: "PHOTON LEAGUE" started at the middle of the scoreboard
        # and ran off its right edge. Candidates, and a report when none of them land.
        for enum_name, setter, members in (
                ("HorizTextAligment", "set_horizontal_alignment", ("EHTA_CENTER", "CENTER")),
                ("VerticalTextAligment", "set_vertical_alignment",
                 ("EVRTA_TEXT_CENTER", "TEXT_CENTER"))):
            enum = getattr(unreal, enum_name, None)
            member = next((m for m in members if enum is not None and hasattr(enum, m)), None)
            if member:
                getattr(c, setter)(getattr(enum, member))
            else:
                say("text_sign %s: no %s member among %s" % (label, enum_name, list(members)))
        return a
    except Exception as exc:
        say("text_sign %s failed: %s" % (label, exc))
        return None


unreal.EditorLoadingAndSavingUtils.load_map(MAP)
say("loaded_map=%s" % MAP)

# --- 0. Clear the previously generated arena ------------------------------------------------------
LEGACY_PREFIXES = ("Floor", "Wall", "FarWall", "Far", "Cover", "LaneCover", "Platform", "Perch",
                   "Arena", "Target_",
                   "Court", "Boundary", "Lane", "Panel", "Roof", "Ceiling", "Signage", "Pylon",
                   "Spawn", "Pedestal", "Step", "Seat", "Suite", "Tower", "Reactor", "Walk",
                   "SkyDeck", "Gantry", "Parapet", "Vomitory", "Atrium", "Outer", "Concourse",
                   "Truss", "Deck", "Railing", "Energy", "Clerestory", "Soffit", "Upper",
                   "Beacon", "Centre", "Core", "Scoreboard", "Broadcast", "TeamZone", "HalfCourt",
                   "SideLane")
removed = 0
for a in subsys.get_all_level_actors():
    label = a.get_actor_label()
    in_folder = str(a.get_folder_path()) == FOLDER
    legacy_mesh = isinstance(a, unreal.StaticMeshActor) and label.startswith(LEGACY_PREFIXES)
    legacy_light = isinstance(a, (unreal.RectLight, unreal.SpotLight, unreal.PointLight))
    legacy_text = isinstance(a, unreal.TextRenderActor)
    is_target = a.get_class().get_name() == "PhotonTarget"
    if in_folder or legacy_mesh or legacy_light or legacy_text or is_target:
        subsys.destroy_actor(a)
        removed += 1
say("removed_previous_actors=%d" % removed)
# Three "FarWall_*" slabs from the very first greybox survived every rebuild up to this one, because
# the prefix list never mentioned them, and one of them stood in the middle of the court. Anything
# this script does not own is now named in the report rather than left to be discovered in a
# screenshot.
strays = sorted(a.get_actor_label() for a in subsys.get_all_level_actors()
                if isinstance(a, unreal.StaticMeshActor))
if strays:
    say("pre_build_survivors=%d %s" % (len(strays), ", ".join(strays[:20])))

# --- 1. Floor, competition court, concourse -------------------------------------------------------
box((0, 0, -50), (43, 43, 1.0), "Floor", "floor", FLOOR_COL)
# The bowl ring stands on its own slab. Without it the seating floats over a void, which is visible
# through every vomitory.
box((0, 0, -62), (BOWL * 2 / 100.0, BOWL * 2 / 100.0, 1.0), "ConcourseFloor", "floor",
    dim(FLOOR_COL, 0.7))

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

box((0, 0, 3.2), (COURT * 2 / 100.0, 0.06, 0.025), "HalfCourt_Line", "energy", dim(NEON, 0.45), 0.85)
for i, ang in enumerate(range(0, 360, 20)):
    cx, cy = on_circle(320.0, ang)
    box((cx, cy, 3.0), (0.55, 0.08, 0.025), "CenterCircle_%d" % i, "energy", dim(NEON, 0.65), 1.4,
        yaw=ang + 90.0)
for i, x in enumerate([-1100, 0, 1100]):
    box((x, COURT - 40, 8), (1.2, 0.35, 0.12), "LaneMark_N_%d" % (i + 1), "energy", dim(NEON, 0.55), 1.1)
    box((x, -(COURT - 40), 8), (1.2, 0.35, 0.12), "LaneMark_S_%d" % (i + 1), "energy", dim(NEON, 0.55), 1.1)

# --- 2. Containment wall --------------------------------------------------------------------------
SIDES = [("N", (0.0, 1.0), 0.0), ("S", (0.0, -1.0), 180.0),
         ("E", (1.0, 0.0), -90.0), ("W", (-1.0, 0.0), 90.0)]
BAY_OFFSETS = [-1750.0, -1250.0, -750.0, -250.0, 250.0, 750.0, 1250.0, 1750.0]
ANGLED_AT = {1, 6}
LIT_BAYS = {0, 3, 4, 7}


def wall_point(ny, nx, along, out, z):
    """(distance along the wall, distance outward from centre) -> world."""
    if ny:
        return (along, ny * out, z)
    return (nx * out, along, z)


for side, (nx, ny), yaw in SIDES:
    ay = abs(ny)

    def at(along, out, z, _nx=nx, _ny=ny):
        return wall_point(_ny, _nx, along, out, z)

    # Solid backing wall, now full height to the parapet. Hidden behind the bays, and the guarantee
    # that nothing leaks out of the arena regardless of how the modules tile.
    box(at(0.0, HALF + 55, PLAY_TOP / 2.0),
        (43 if ay else 1.1, 1.1 if ay else 43, PLAY_TOP / 100.0),
        "Wall_%s" % side, "structure", STRUCTURE)

    for i, along in enumerate(BAY_OFFSETS):
        asset = "SM_PhotonWallBayAngled" if i in ANGLED_AT else "SM_PhotonWallBay"
        place(asset, at(along, HALF + 35, 0.0), "WallBay_%s_%d" % (side, i),
              "structure", STRUCTURE, yaw=yaw)
        if i in LIT_BAYS:
            box(at(along, HALF + 14, 350.0),
                (0.16 if ay else 0.05, 0.05 if ay else 0.16, 3.4),
                "Energy_BayChannel_%s_%d" % (side, i), "energy", dim(NEON, 0.7), 2.4)

    box(at(0.0, HALF + 70, 780.0), (43 if ay else 0.6, 0.6 if ay else 43, 1.6),
        "Clerestory_%s" % side, "structure", dim(STRUCTURE, 0.8))
    box(at(0.0, HALF + 36, 782.0), (40 if ay else 0.06, 0.06 if ay else 40, 0.32),
        "Energy_Clerestory_%s" % side, "energy", dim(NEON, 0.85), 2.4)
    box(at(0.0, HALF - 30, 880.0), (43 if ay else 1.5, 1.5 if ay else 43, 0.4),
        "Soffit_%s" % side, "structure", STRUCTURE_LIGHT)
    box(at(0.0, HALF + 50, 1000.0), (43 if ay else 1.0, 1.0 if ay else 43, 2.0),
        "UpperWall_%s" % side, "structure", dim(STRUCTURE, 0.9))

    # --- 3. Parapet and the LED ribbon ------------------------------------------------------------
    # Apex caps the wall with a lit parapet and hangs a continuous ribbon just under it. It is the
    # brightest continuous line in the building and it draws the boundary of play from anywhere.
    box(at(0.0, HALF + 20, PLAY_TOP + 34), (44 if ay else 1.7, 1.7 if ay else 44, 0.68),
        "Parapet_%s" % side, "structure", STRUCTURE_LIGHT)
    box(at(0.0, HALF - 22, PLAY_TOP - 88), (42 if ay else 0.18, 0.18 if ay else 42, 1.1),
        "Energy_Ribbon_%s" % side, "energy", dim(NEON, 0.9), 2.8)

for i, (sx, sy) in enumerate([(1, 1), (-1, 1), (1, -1), (-1, -1)]):
    place("SM_PhotonCornerPylon", (sx * (HALF + 60), sy * (HALF + 60), 0),
          "CornerPylon_%d" % i, "structure", STRUCTURE_LIGHT, yaw=45.0)
    # Extended to the parapet so the corners still terminate the wall now it is 11 m rather than 7.
    box((sx * (HALF + 60), sy * (HALF + 60), 930), (3.2, 3.2, 3.6),
        "CornerPylonUpper_%d" % i, "structure", dim(STRUCTURE, 1.2), yaw=45.0)

    # The bays run out to +/-2000 on both walls and stop, so each corner was left as an open 4 m
    # slot with the outside of a pylon visible through it and nothing else. The tour pose that aims
    # straight into one came back as a flat grey box with a single floor line in it — the exact
    # "wall, empty floor, wall" the rebuild is supposed to eliminate. A chamfer closes the slot and
    # turns the corner into a canted bay with its own vertical accent.
    cyaw = -45.0 if sx * sy > 0 else 45.0
    ix, iy = -sx * 0.7071, -sy * 0.7071          # inward normal at this corner
    ccx, ccy = sx * 1860.0, sy * 1860.0
    box((ccx, ccy, PLAY_TOP / 2.0), (4.5, 0.6, PLAY_TOP / 100.0), "WallCorner_%d" % i,
        "structure", STRUCTURE, yaw=cyaw)
    box((ccx + ix * 34, ccy + iy * 34, PLAY_TOP / 2.0), (2.6, 0.16, PLAY_TOP / 100.0 - 1.4),
        "WallCornerPanel_%d" % i, "structure", dim(STRUCTURE, 0.62), yaw=cyaw)
    box((ccx + ix * 44, ccy + iy * 44, 560.0), (0.3, 0.12, 8.8), "Energy_CornerStrip_%d" % i,
        "energy", dim(NEON, 0.7), 2.0, yaw=cyaw)
    box((ccx + ix * 30, ccy + iy * 30, PLAY_TOP - 46), (4.5, 0.42, 0.5),
        "CornerCap_%d" % i, "structure", STRUCTURE_LIGHT, yaw=cyaw)
    # Angled buttress fins, flat against the two walls that meet here.
    for j, (fx, fy, fyaw) in enumerate(((sx * 1660.0, sy * 1948.0, 0.0),
                                        (sx * 1948.0, sy * 1660.0, 90.0))):
        box((fx, fy, 300.0), (1.7, 0.7, 6.0), "CornerFin_%d_%d" % (i, j), "structure",
            dim(STRUCTURE, 1.25), yaw=fyaw)

# --- 4. The spectator bowl ------------------------------------------------------------------------
# Seven raked rows per bank, four banks per wall, with a 9 m gap at each wall midpoint for the
# landmark that stands there. This is the element that makes the building read as a venue, and it
# costs nothing in play space because all of it is outside the containment wall.
BANK_ALONG = [-2100.0, -950.0, 950.0, 2100.0]
VOM_ALONG = [-1520.0, 1520.0]

for side, (nx, ny), yaw in SIDES:
    ay = abs(ny)

    def at(along, out, z, _nx=nx, _ny=ny):
        return wall_point(_ny, _nx, along, out, z)

    for i, along in enumerate(BANK_ALONG):
        # The bank is authored with +Y running outward and up, which is the same convention the wall
        # bays use for their inward-facing recess, so the side's own yaw is already correct.
        place("SM_PhotonSeatBank", at(along, HALF + 90, TIER_A), "SeatBank_%s_%d" % (side, i),
              "structure", SEAT_COL, yaw=yaw)

    for i, along in enumerate(VOM_ALONG):
        box(at(along, HALF + 300, TIER_A + 190),
            (3.4 if ay else 8.0, 8.0 if ay else 3.4, 3.6),
            "Vomitory_%s_%d" % (side, i), "structure", dim(SEAT_COL, 0.35))
        box(at(along, HALF + 62, TIER_A + 176),
            (3.6 if ay else 0.14, 0.14 if ay else 3.6, 0.1),
            "Energy_VomLip_%s_%d" % (side, i), "energy", dim(NEON, 0.45), 1.1)

# --- 4b. The shelf: a different building above every stand ----------------------------------------
# Apex's two-fold thesis, applied to four walls. Spawns stay four-fold because they have to be fair;
# the elevation above each stand does not, and making them different is what lets a player say where
# they are without reading a compass.

# North — press suites. The glazing is one of the building's two warm surfaces.
for i, along in enumerate([-1860.0, -620.0, 620.0, 1860.0]):
    place("SM_PhotonSuiteBox", (along, HALF + 900, SHELF), "SuiteBox_N_%d" % i,
          "structure", dim(STRUCTURE, 1.5), yaw=0.0)
    box((along, HALF + 648, SHELF + 160), (8.8, 0.16, 2.7),
        "Energy_SuiteGlass_N_%d" % i, "energy", SUITE_GLASS, 1.5)
box((0, HALF + 940, SHELF - 40), (52, 6.2, 0.5), "SuiteDeck_N", "structure", dim(STRUCTURE, 1.2))

# South — general admission, a second raked tier.
for i, along in enumerate(BANK_ALONG):
    place("SM_PhotonSeatBank", (along, -(HALF + 900), SHELF + 60), "SeatBank_Upper_S_%d" % i,
          "structure", dim(SEAT_COL, 0.9), yaw=180.0)
box((0, -(HALF + 880), SHELF), (52, 5.0, 0.5), "SuiteDeck_S", "structure", dim(STRUCTURE, 1.2))

# West — the Champion's Walk. Seven arched bays and the only warm architecture in the venue.
box((-(HALF + 900), 0, SHELF - 40), (5.6, 52, 0.5), "WalkWall_Deck", "structure",
    unreal.LinearColor(0.088, 0.078, 0.064, 1.0))
for i in range(7):
    y = (i - 3) * 340.0
    place("SM_PhotonWalkArch", (-(HALF + 900), y, SHELF), "WalkArch_%d" % i,
          "structure", unreal.LinearColor(0.150, 0.132, 0.108, 1.0), yaw=90.0)
    box((-(HALF + 830), y, SHELF + 340), (0.14, 0.9, 3.0),
        "Energy_WalkNiche_%d" % i, "energy", AMBER, 1.8)
box((-(HALF + 1090), 0, SHELF + 340), (1.0, 52, 8.0), "WalkWall_Back", "structure",
    unreal.LinearColor(0.088, 0.078, 0.064, 1.0))
box((-(HALF + 900), 0, SHELF + 700), (6.4, 52, 0.5), "WalkWall_Roof", "structure",
    unreal.LinearColor(0.088, 0.078, 0.064, 1.0))
box((-(HALF + 640), 0, SHELF + 16), (0.3, 52, 0.16), "Energy_WalkSill", "energy", AMBER, 2.6)

# East — the Sky Deck, cantilevered out over the front of the stand.
box((HALF + 300, 0, SHELF + 200), (9.0, 46, 0.44), "SkyDeck_Slab", "metal", dim(METAL_COL, 1.15))
for i in range(5):
    y = (i - 2) * 1100.0
    box((HALF + 760, y, SHELF + 60), (5.4, 0.5, 0.46), "SkyDeck_Bracket_%d" % i, "metal",
        METAL_COL, pitch=20.0)
for i in range(11):
    place("SM_PhotonRailing", (HALF - 150, -2000.0 + i * 400.0, SHELF + 240),
          "SkyDeck_Railing_%d" % i, "metal", METAL_COL, yaw=90.0)
box((HALF + 980, 0, SHELF + 420), (0.3, 46, 4.6), "Energy_SkyShaft", "energy",
    unreal.LinearColor(0.66, 0.80, 1.0, 1.0), 2.4)

# --- 5. Outer skin and roof -----------------------------------------------------------------------
for i, (sx, sy) in enumerate([(0, 1), (0, -1), (1, 0), (-1, 0)]):
    box((sx * BOWL, sy * BOWL, ROOF / 2.0),
        (BOWL * 2 / 100.0 if sy else 1.2, 1.2 if sy else BOWL * 2 / 100.0, ROOF / 100.0),
        "OuterSkin_%d" % i, "structure", dim(STRUCTURE, 0.5))
box((0, 0, ROOF), (BOWL * 2 / 100.0, BOWL * 2 / 100.0, 0.7), "Roof", "structure",
    dim(STRUCTURE, 0.85))

# --- 6. The colonnade -----------------------------------------------------------------------------
# Apex rings its atrium with columns that run the full height of the building. That single move is
# most of the difference between a room with a high ceiling and a venue. At Photon's 40 m the ring
# sits out near the wall so the court stays clear: eight 22.8 m columns, on the 22.5 degree offsets
# so none of them lands on a cover piece.
for i in range(8):
    ang = 22.5 + i * 45.0
    cx, cy = on_circle(COLUMN_R, ang)
    place("SM_PhotonAtriumColumn", (cx, cy, 0), "AtriumColumn_%d" % i,
          "structure", dim(STRUCTURE, 1.35), yaw=ang)
    box((cx, cy, 640), (2.9, 2.9, 0.2), "AtriumColumnBracket_%d" % i, "metal", METAL_COL, yaw=ang)
    box((cx, cy, 700), (2.6, 2.6, 0.09), "Energy_ColumnBand_%d" % i, "energy", dim(NEON, 0.6), 1.6,
        yaw=ang)

# --- 7. Camera gantry, truss grid, house lighting --------------------------------------------------
arc(1900.0, BOOTH_Y, 220.0, 44.0, "GantryRing", "metal", METAL_COL, 0.0, count=24)
arc(1990.0, BOOTH_Y + 62.0, 26.0, 96.0, "Energy_GantryRail", "energy", dim(NEON, 0.55), 1.3, count=24)

TRUSS_SCALE = (BOWL * 2.0) / 4200.0
for i, y in enumerate([-2300, -800, 800, 2300]):
    place("SM_PhotonTruss", (0, y, TRUSS_Y), "Truss_X_%d" % i, "metal", METAL_COL,
          scale=(TRUSS_SCALE, 1.0, 1.0))
for i, x in enumerate([-1550, 0, 1550]):
    place("SM_PhotonTruss", (x, 0, TRUSS_Y), "Truss_Y_%d" % i, "metal", METAL_COL, yaw=90.0,
          scale=(TRUSS_SCALE, 1.0, 1.0))
for i, (x, y) in enumerate([(-2300, -1550), (2300, -1550), (-2300, 1550), (2300, 1550),
                            (-800, 0), (800, 0), (0, -2300), (0, 2300)]):
    box((x, y, TRUSS_Y + 90), (0.3, 0.3, 1.8), "TrussHanger_%d" % i, "metal", METAL_COL)

# A lit ceiling grid between the trusses. Looking up used to be 35% pure black — a 24.6 m roof that
# the player can only infer, and the single frame in the tour aimed at the vertical read had nothing
# in it. These strips are unlit emissive rather than lights, so the ceiling becomes a graphic
# without adding to the movable light count that the frame budget is measured on.
for i in range(7):
    o = (i - 3) * 1100.0
    box((0, o, TRUSS_Y + 128), (BOWL * 2 / 100.0, 0.24, 0.05), "Energy_CeilGrid_X_%d" % i,
        "energy", unreal.LinearColor(0.62, 0.76, 1.0, 1.0), 1.5)
    box((o, 0, TRUSS_Y + 128), (0.24, BOWL * 2 / 100.0, 0.05), "Energy_CeilGrid_Y_%d" % i,
        "energy", unreal.LinearColor(0.62, 0.76, 1.0, 1.0), 1.5)

# The grid alone still left the panels between its lines black, because four uplights cannot fill
# 130 m2 of ceiling at this distance and the measurement kept coming back with a fifth of the
# upward-looking frames crushed to zero. Filling the bays with dim self-lit panels is both cheaper
# than more lights and closer to how a real roof of this span is actually finished.
for iy in range(4):
    for ix in range(4):
        box(((ix - 1.5) * 1600.0, (iy - 1.5) * 1600.0, TRUSS_Y + 120),
            (13.0, 13.0, 0.04), "Energy_CeilPanel_%d_%d" % (ix, iy), "energy",
            unreal.LinearColor(0.20, 0.25, 0.34, 1.0), 0.85)

# Coffers hang from the truss with a rect light inside each. Moving the rig from 9 m to 21 m is why
# the lumens are seven times what Sprint 02 used: illuminance falls with the square of distance.
for i, (x, y) in enumerate([(-1000, -1000), (1000, -1000), (-1000, 1000), (1000, 1000)]):
    place("SM_PhotonCeilingBay", (x, y, TRUSS_Y - 210), "CeilingBay_%d" % i,
          "structure", STRUCTURE_LIGHT)
    box((x, y, TRUSS_Y - 124), (7.6, 7.6, 0.06), "Energy_CofferPanel_%d" % i, "energy",
        unreal.LinearColor(0.72, 0.83, 1.0, 1.0), 2.2)
    light = spawn(unreal.RectLight, (x, y, TRUSS_Y - 128), pitch=-90.0)
    light.set_actor_label("CeilingLight_%d" % i)
    lc = light.rect_light_component
    lc.set_mobility(unreal.ComponentMobility.MOVABLE)
    lc.set_editor_property("intensity_units", unreal.LightUnits.LUMENS)
    lc.set_editor_property("intensity", COFFER_LM)
    lc.set_editor_property("source_width", 900.0)
    lc.set_editor_property("source_height", 900.0)
    lc.set_editor_property("attenuation_radius", 5600.0)
    lc.set_editor_property("light_color", cool(*HOUSE))
    # CentreLight is the only rect shadow caster (VSM + non-Nanite overflow risk).
    lc.set_editor_property("cast_shadows", False)

# Unlit fixture pods across the rest of the truss so the ceiling has fixtures rather than four lamps.
for i, (x, y) in enumerate([(-2300, 0), (2300, 0), (0, -2300), (0, 2300),
                            (-1550, -800), (1550, -800), (-1550, 800), (1550, 800)]):
    box((x, y, TRUSS_Y - 96), (2.0, 2.0, 0.4), "Energy_TrussPod_%d" % i, "energy",
        unreal.LinearColor(0.72, 0.83, 1.0, 1.0), 2.2)

# --- 8. Centre: the competition anchor ------------------------------------------------------------
place("SM_PhotonCentreDais", (0, 0, 0), "CentreDais", "cover", dim(COVER_COL, 0.85))
place("SM_PhotonCentreRing", (0, 0, 27), "Energy_CentreRing", "energy", dim(NEON, 0.75), 2.6)
place("SM_PhotonCoverPylon", (0, 0, 28), "Beacon_Centre", "cover", COVER_COL, scale=0.95)
box((0, 0, 300), (0.98, 0.98, 0.10), "Energy_BeaconTop", "energy", NEON, 4.0)

# The overhead half of the anchor, now suspended at 10 m inside the colonnade rather than sitting
# just under a 10 m lid. Cables run on up to the truss so the eye follows it to the roof.
RIG_Z = 1020.0
place("SM_PhotonCentreRig", (0, 0, RIG_Z), "CentreRig", "metal", METAL_COL)
place("SM_PhotonCentreRing", (0, 0, RIG_Z - 7), "Energy_RigRing", "energy", dim(NEON, 0.9), 3.4,
      scale=1.58)
for i in range(6):
    cx, cy = on_circle(790.0, i * 60.0)
    box((cx, cy, (RIG_Z + 150 + TRUSS_Y) / 2.0), (0.18, 0.18, (TRUSS_Y - RIG_Z - 150) / 100.0),
        "TrussHanger_Rig_%d" % i, "metal", METAL_COL)

# The Photon Core. One landmark, hung between the dais and the rig, filling the 7 m of dead air
# that used to sit between a 2.9 m beacon and a ceiling fixture — which is why the centre of the
# arena read as an empty platform with a bollard on it. Its underside is at 5 m, so it is visible
# from all four spawns and reachable from none of them.
CORE_Z = 600.0
place("SM_PhotonCoreLantern", (0, 0, CORE_Z), "CoreLantern", "metal", dim(METAL_COL, 1.2))
place("SM_PhotonCoreGlow", (0, 0, CORE_Z), "Energy_CoreGlow", "energy", NEON, 4.2)
# A halo framing it, at the rig's underside. Reads from the far wall as a single bright circle.
arc(940.0, RIG_Z - 74.0, 28.0, 38.0, "Energy_CoreHalo", "energy", dim(NEON, 0.8), 2.4, count=16)
core_light = spawn(unreal.PointLight, (0, 0, CORE_Z + 150))
core_light.set_actor_label("CoreLight")
pl = core_light.point_light_component
pl.set_mobility(unreal.ComponentMobility.MOVABLE)
pl.set_editor_property("intensity_units", unreal.LightUnits.LUMENS)
pl.set_editor_property("intensity", 2600.0)
pl.set_editor_property("attenuation_radius", 1600.0)
pl.set_editor_property("light_color", cool(150, 216, 255))
pl.set_editor_property("cast_shadows", False)

rig_light = spawn(unreal.RectLight, (0, 0, RIG_Z - 20), pitch=-90.0)
rig_light.set_actor_label("CentreLight")
rl = rig_light.rect_light_component
rl.set_mobility(unreal.ComponentMobility.MOVABLE)
rl.set_editor_property("intensity_units", unreal.LightUnits.LUMENS)
rl.set_editor_property("intensity", CENTRE_LM)
rl.set_editor_property("source_width", 1400.0)
rl.set_editor_property("source_height", 1400.0)
rl.set_editor_property("attenuation_radius", 3000.0)
rl.set_editor_property("light_color", cool(*HOUSE))
rl.set_editor_property("cast_shadows", True)

# --- 9. Cover -------------------------------------------------------------------------------------
# One quadrant at four rotations. Four teams spawn on four sides, so the layout has to be
# rotationally fair. UNCHANGED from Sprint 02: this is the gameplay layer.
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
        place(asset, (wx, wy, 0), "Cover_%s_%d" % (kind, q), "cover", COVER_COL, yaw=yaw + q * 90.0)
        if kind == "Low":
            box((wx, wy, 114), (2.6, 0.9, 0.05), "Energy_CoverTrim_%d" % q, "energy",
                dim(NEON, 0.55), 1.5, yaw=yaw + q * 90.0)
        if kind == "Pylon":
            box((wx, wy, 280), (1.0, 1.0, 0.08), "Energy_PylonCap_%d" % q, "energy",
                dim(NEON, 0.6), 2.0, yaw=yaw + q * 90.0)

# --- 10. Verticality: two elevated decks on the diagonal -------------------------------------------
# Apex is two-fold, and its mezzanine is a pair of corner brackets rather than a ring. Two decks on
# opposite diagonals gives the same thing at Photon's scale: high ground that is worth taking,
# reachable, and not a decorative platform with no gameplay purpose. They sit between colonnade
# columns, on the 45 degree axis.
#
# Access is a pitched ramp, not a flight of blocks. The stair this replaces stacked five 92 uu steps
# against a 45 uu step height, so the deck it served could not actually be climbed, and its run was
# long enough that the bottom tread landed at radius 140 — inside the centre circle. Rendered from
# the south it read as a 12 m wall closing across the middle of the court, which is the object that
# filled two thirds of the first tour frame.
# The deck is a 1200x800 slab with its long axis radial. Two things fix where it can go: its outer
# corners have to stay inside the wall ribs at 1963, which caps the centre at radius 1687, and the
# colonnade columns sit 631 uu off the diagonal, which is what forces the long axis radial rather
# than tangential. That leaves 380 uu of court between the dais and the deck's inner edge for the
# ramp, and the ramp's pitch is then what sets the deck height rather than the other way round.
DECK_R = 1680.0         # deck centre on the 45 degree axis, inboard of the colonnade
DECK_TOP = MEZZ + 38.0  # SM_PhotonDeckSlab carries its walking surface 38 uu above its origin
RAMP_FOOT = 700.0       # radius the ramp starts at, 60 uu clear of the dais
RAMP_HALF_W = 170.0     # keeps 62 uu off the quadrant's technical pod
for name, base_ang in (("NE", 45.0), ("SW", 225.0)):
    cx, cy = on_circle(DECK_R, base_ang)
    ca, sa = math.cos(math.radians(base_ang)), math.sin(math.radians(base_ang))

    def to_world(lx, ly, lz, _cx=cx, _cy=cy, _ca=ca, _sa=sa):
        """Deck-local: +X radially outward toward the corner, +Y tangential."""
        return (_cx + lx * _ca - ly * _sa, _cy + lx * _sa + ly * _ca, lz)

    place("SM_PhotonDeckSlab", (cx, cy, MEZZ), "DeckSlab_%s" % name, "cover", dim(COVER_COL, 0.9),
          yaw=base_ang)
    for lx, ly in ((480, 280), (480, -280), (-480, 280), (-480, -280)):
        box(to_world(lx, ly, MEZZ / 2.0), (0.7, 0.7, MEZZ / 100.0),
            "DeckColumn_%s_%d_%d" % (name, lx, ly), "metal", METAL_COL, yaw=base_ang)
    # Railings on the flanks and the outer end. The inner end is where the ramp arrives.
    for i in range(3):
        for ly in (400, -400):
            place("SM_PhotonRailing", to_world(-400 + i * 400, ly, MEZZ + 38),
                  "Railing_%s_%d_%d" % (name, i, ly), "metal", METAL_COL, yaw=base_ang)
    for ly in (200, -200):
        place("SM_PhotonRailing", to_world(600, ly, MEZZ + 38), "Railing_%s_End_%d" % (name, ly),
              "metal", METAL_COL, yaw=base_ang + 90.0)

    # A box yawed by `a` and pitched by `p` sends its local +X along
    # (cos a cos p, sin a cos p, sin p), which is exactly "radially outward and up".
    run = (DECK_R - 600.0) - RAMP_FOOT
    pitch = math.degrees(math.atan2(DECK_TOP, run))
    length = math.hypot(run, DECK_TOP)
    mx, my = on_circle(RAMP_FOOT + run * 0.5, base_ang)
    box((mx, my, DECK_TOP * 0.5), (length / 100.0, RAMP_HALF_W * 2 / 100.0, 0.3),
        "DeckRamp_%s" % name, "cover", dim(COVER_COL, 0.6), yaw=base_ang, pitch=pitch)
    # Solid balustrades rather than a bare deck. A pitched slab on its own photographs as a fallen
    # panel — it needs two edges running up with it before it reads as a ramp.
    for sy in (-1.0, 1.0):
        ox, oy = -sy * RAMP_HALF_W * sa, sy * RAMP_HALF_W * ca
        box((mx + ox, my + oy, DECK_TOP * 0.5 + 52), (length / 100.0, 0.24, 0.86),
            "DeckRampWall_%s_%d" % (name, sy), "cover", dim(COVER_COL, 0.75),
            yaw=base_ang, pitch=pitch)
        box((mx + ox, my + oy, DECK_TOP * 0.5 + 96), (length / 100.0, 0.30, 0.06),
            "Energy_RampEdge_%s_%d" % (name, sy), "energy", dim(NEON, 0.5), 1.4,
            yaw=base_ang, pitch=pitch)
    box(to_world(0, 0, MEZZ + 66), (11.4, 0.14, 0.06), "Energy_DeckEdge_%s" % name, "energy",
        dim(NEON, 0.5), 1.4, yaw=base_ang)
say("deck top=%.0f ramp run=%.0f pitch=%.1f deg (walkable limit is 44.4)" % (
    DECK_TOP, (DECK_R - 600.0) - RAMP_FOOT,
    math.degrees(math.atan2(DECK_TOP, (DECK_R - 600.0) - RAMP_FOOT))))

# --- 11. Team spawn zones ---------------------------------------------------------------------------
SPAWNS = [("Red", 0.0, -1700.0, 90.0), ("Blue", 0.0, 1700.0, -90.0),
          ("Green", -1700.0, 0.0, 0.0), ("Yellow", 1700.0, 0.0, 180.0)]
for team, x, y, facing in SPAWNS:
    colour = TEAM[team]
    ox, oy = (0.0, -1.0) if y < 0 else (0.0, 1.0) if y > 0 else ((-1.0, 0.0) if x < 0 else (1.0, 0.0))
    gate_yaw = 0.0 if oy else 90.0

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
    sc.set_editor_property("attenuation_radius", 1100.0)
    sc.set_editor_property("outer_cone_angle", 34.0)
    sc.set_editor_property("inner_cone_angle", 12.0)
    # Half-strength tint, not the raw team colour. At full saturation and 2000 lm this was a green
    # floodlight that turned the whole west end of the floor into a glowing panel — "colour as
    # identity, not as a giant glowing wall" is the brief, and a pale tinted pool is what a real
    # venue's zone lighting looks like anyway.
    sc.set_editor_property("light_color", cool(
        *(int((min(c, 1.0) * 0.5 + 0.5) * 255) for c in (colour.r, colour.g, colour.b))))
    sc.set_editor_property("cast_shadows", False)

# --- 12. The four landmarks -------------------------------------------------------------------------
# Apex puts a different building at each wall midpoint so the player navigates by things they can
# see rather than by compass directions they have to memorise. Photon's spawns already own the wall
# midpoints at floor level, so these stand in the bowl beyond them and are read over the parapet.

# North — the Broadcast Tower. The tallest thing in the venue, and the only curved building.
TOWER = (0.0, HALF + 600.0)
# The drum is open toward the arena (270 degrees in this convention is -Y, which is where the court
# is from here), so the spiral inside it is visible over the parapet instead of being a silo.
arc(440.0, 760.0, 110.0, 1520.0, "TowerDrum_Lower", "structure", dim(STRUCTURE, 1.25), 0.0,
    count=16, start=310.0, span=280.0, cx=TOWER[0], cy=TOWER[1])
arc(400.0, 1900.0, 100.0, 700.0, "TowerDrum_Upper", "structure", dim(STRUCTURE, 1.25), 0.0,
    count=14, start=320.0, span=260.0, cx=TOWER[0], cy=TOWER[1])
for i, z in enumerate([1520.0, 2250.0]):
    box((TOWER[0], TOWER[1], z), (9.0, 9.0, 0.34), "TowerDeck_%d" % i, "structure",
        dim(STRUCTURE, 1.4), yaw=45.0)
for i in range(16):
    ang = 100.0 + i * 22.0
    sx, sy = on_circle(300.0, ang)
    box((TOWER[0] + sx, TOWER[1] + sy, 80.0 + i * 90.0), (2.0, 0.95, 0.16),
        "TowerStair_%d" % i, "metal", METAL_COL, yaw=ang + 90.0)
# The commentary pod cantilevers back over the arena, which is what sells the tower as broadcast
# infrastructure rather than a silo.
place("SM_PhotonBroadcastPod", (TOWER[0], HALF + 40.0, BOOTH_Y), "BroadcastPod", "structure",
      dim(STRUCTURE, 1.6), yaw=0.0)
box((TOWER[0], HALF - 150.0, BOOTH_Y + 134), (6.0, 0.16, 2.2), "Energy_SuiteGlass_Pod", "energy",
    SUITE_GLASS, 1.5)
box((TOWER[0], TOWER[1], (BOOTH_Y + TRUSS_Y + 200) / 2.0),
    (2.4, 2.4, (TRUSS_Y + 200 - BOOTH_Y) / 100.0), "TowerMast", "metal", dim(METAL_COL, 1.1))
arc(200.0, TRUSS_Y + 150.0, 40.0, 60.0, "Energy_MastRing", "energy", NEON, 3.2, count=12,
    cx=TOWER[0], cy=TOWER[1])

# South — the Fusion Reactor. Bulging stacked vessels with cyan coolant bands: the opposite of the
# tower's precision, which is exactly why the two ends of the arena are told apart instantly.
REACTOR = (0.0, -(HALF + 600.0))
for i, (r, z, h) in enumerate([(1.70, 0.0, 1.60), (2.20, 640.0, 1.10),
                               (1.90, 1080.0, 1.20), (1.25, 1560.0, 1.50)]):
    place("SM_PhotonReactorDrum", (REACTOR[0], REACTOR[1], z), "ReactorDrum_%d" % i,
          "metal", dim(METAL_COL, 1.05), scale=(r, r, h))
for i, (r, z) in enumerate([(560.0, 620.0), (700.0, 1060.0), (610.0, 1540.0)]):
    arc(r, z, 46.0, 90.0, "Energy_Coolant_%d" % i, "energy", dim(NEON, 0.8), 2.8, count=18,
        cx=REACTOR[0], cy=REACTOR[1])
for i, ang in enumerate([45.0, 135.0, 225.0, 315.0]):
    bx, by = on_circle(820.0, ang)
    box((REACTOR[0] + bx, REACTOR[1] + by, 720.0), (0.8, 0.8, 15.0),
        "ReactorBrace_%d" % i, "metal", METAL_COL, yaw=ang, pitch=14.0)

# --- 13. Targets ------------------------------------------------------------------------------------
target_cls = unreal.load_class(None, "/Script/Photon.PhotonTarget")
for i, (x, y) in enumerate([(620, 980), (-980, 620), (-620, -980), (980, -620), (0, 1420)]):
    place("SM_PhotonPedestal", (x, y, 0), "Pedestal_%d" % i, "structure", STRUCTURE_LIGHT)
    if target_cls:
        t = spawn(target_cls, (x, y, 210))
        t.set_actor_label("ArenaTarget_%d" % i)

# --- 14. Signage, scoreboards, branding --------------------------------------------------------------

# The wall's visible inner face is at HALF, and the bay ribs stand 37 uu proud of it, so the board
# has to be mounted in front of 1963 or it is a scoreboard installed inside a wall. The previous
# build offset it the wrong way and buried all three layers.
for i, (x, wall_y, yaw) in enumerate([(0.0, HALF, 0.0), (0.0, -HALF, 180.0)]):
    inward = -1.0 if wall_y > 0 else 1.0
    box((x, wall_y + inward * 45.0, 640), (11.6, 0.22, 3.1), "ScoreboardFrame_%d" % i, "metal",
        METAL_COL, yaw=yaw)
    box((x, wall_y + inward * 52.0, 640), (11.0, 0.18, 2.8), "SignageBody_%d" % i, "structure",
        STRUCTURE_LIGHT, yaw=yaw)
    box((x, wall_y + inward * 60.0, 640), (10.2, 0.08, 2.2), "ScoreboardFace_%d" % i, "energy",
        dim(NEON, 0.18), 0.7, yaw=yaw)

# Real type on the board. The previous build hedged on UTextRenderComponent's forward axis by
# spawning each sign twice, at yaw 90 and 270, on the same spot — hoping the wrong one would be
# swallowed by the panel behind. A text render is a flat double-sided quad with nothing between the
# two copies, so instead both drew and the tour caught "PHOTON LEAGUE" superimposed on its own
# mirror image. One actor per sign now.
#
# UTextRenderComponent lays its glyphs out in the local YZ plane advancing along -Y, so a reader has
# to be standing on the actor's local +X side: local +X points at the audience. TEXT_FACES is the
# one place to flip if a render comes back mirrored.
TEXT_FACES = 0.0


def wall_text(loc, label, text, size, colour):
    """Mount type flat on the north or south wall, reading from the court."""
    yaw = (270.0 if loc[1] > 0 else 90.0) + TEXT_FACES
    text_sign(loc, label, text, yaw, size, colour)


BRANDING = [
    ((0.0, HALF - 68.0, 686.0), "PHOTON LEAGUE", 104.0, cool(160, 230, 255)),
    ((0.0, HALF - 68.0, 572.0), "APEX  DIVISION  ONE", 50.0, cool(120, 180, 215)),
    ((0.0, -(HALF - 68.0), 686.0), "PHOTON LEAGUE", 104.0, cool(160, 230, 255)),
    ((0.0, -(HALF - 68.0), 572.0), "CHAMPIONSHIP  FINALS", 50.0, cool(120, 180, 215)),
]
for i, (loc, text, size, colour) in enumerate(BRANDING):
    wall_text(loc, "Signage_Text_%d" % i, text, size, colour)
# Lane numbering, on the upper wall above each lane rather than on the floor: floor type needs a
# pitched plane and reads as a smear from eye height anyway.
for i, (x, glyph) in enumerate([(-1100, "01"), (0, "02"), (1100, "03")]):
    wall_text((float(x), HALF - 62.0, 930.0), "Signage_Text_Lane_%d" % i, glyph, 76.0,
              cool(110, 175, 210))

# --- 15. Lighting environment -------------------------------------------------------------------------
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


# A rect light emits along its actor's +X, so this yaw is the direction the light faces, not the
# wall it belongs to. Getting it backwards on the first pass aimed every wash out of the arena.
FACING = {"N": -90.0, "S": 90.0, "E": 180.0, "W": 0.0}
for side, (nx, ny), _yaw in SIDES:
    inward = FACING[side]
    outward = inward + 180.0

    def at_wall(out, z, _nx=nx, _ny=ny):
        return (0.0, _ny * out, z) if _ny else (_nx * out, 0.0, z)

    rect_light("WallWash_%s" % side, at_wall(HALF - 140, 470.0), inward, -14.0,
               WALLWASH_LM, 3000.0, 520.0, 2600.0, cool(*FILL))
    # Without this the bowl is a black mass sitting on a lit wall, which is worse than no bowl. It
    # pitches slightly up because the back of the rake is 4 m above the parapet it sits on.
    rect_light("BowlWash_%s" % side, at_wall(HALF + 60, PLAY_TOP + 40.0), outward, 10.0,
               BOWLWASH_LM, 3800.0, 700.0, 2400.0, cool(*BOWL_TINT))

# The four wall washes sit at wall midpoints, so the corners were lit by nothing at all: the tour
# pose aimed into one measured a 25-76 luminance range across the entire frame. One wash per corner,
# on the diagonal, brings the canted bay and its buttress fins into the picture.
for i, (sx, sy) in enumerate([(1, 1), (-1, 1), (1, -1), (-1, -1)]):
    rect_light("CornerWash_%d" % i, (sx * 1810.0, sy * 1810.0, 540.0),
               math.degrees(math.atan2(-sy, -sx)), -8.0, 2600.0, 900.0, 620.0, 2000.0, cool(*FILL))

# Uplights on the truss. A 24.6 m roof that renders as pure black is a roof the player cannot see,
# and three of the eleven tour frames were more than a fifth crushed to nothing because of it.
# Bounced off the underside, these give the ceiling a form without lighting the court twice.
# They hang 5 m under the roof, not against it: the first placement sat at TRUSS_Y+150, which is
# 5 uu below a roof slab whose underside is at 2425, so each one lit a dinner plate.
for i, (x, y) in enumerate([(-1500, -1500), (1500, -1500), (-1500, 1500), (1500, 1500)]):
    rect_light("RoofWash_%d" % i, (x, y, TRUSS_Y - 380.0), 0.0, 90.0,
               7400.0, 1600.0, 1600.0, 2600.0, cool(*HOUSE))

say("lights: 4 coffer + 1 centre + 4 wallwash + 4 bowlwash + 4 corner + 4 roof + 4 team + 1 core")

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
s.set_editor_property("vignette_intensity", 0.22)
ppv.set_editor_property("settings", s)
say("postprocess bloom=%.2f (exposure is owned by the camera)" % BLOOM)

if "PhotonFog" not in existing:
    fog = subsys.spawn_actor_from_class(unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0))
    fog.set_actor_label("PhotonFog")
else:
    fog = next(a for a in subsys.get_all_level_actors() if a.get_actor_label() == "PhotonFog")
fc = fog.component
# Denser and taller than Sprint 02. Apex raises its own fog for exactly this reason: 25 m of
# vertical only reads as 25 m if the air between the floor and the truss is visible.
fc.set_editor_property("fog_density", 0.012)
fc.set_editor_property("fog_height_falloff", 0.20)
fc.set_editor_property("fog_inscattering_luminance", unreal.LinearColor(0.028, 0.036, 0.050, 1.0))
say("fog tuned for the vertical volume")

unreal.EditorLevelLibrary.save_current_level()

actors = subsys.get_all_level_actors()
kit_actors = [a for a in actors if isinstance(a, unreal.StaticMeshActor)
              and a.static_mesh_component.static_mesh
              and "Photon/Meshes" in a.static_mesh_component.static_mesh.get_path_name()]
say("final_actor_count=%d" % len(actors))
say("static_meshes=%d" % len([a for a in actors if isinstance(a, unreal.StaticMeshActor)]))
say("authored_kit_actors=%d" % len(kit_actors))
say("text_actors=%d" % len([a for a in actors if isinstance(a, unreal.TextRenderActor)]))
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
# Also to stdout. The report only ever went to a file, so photon_cycle.ps1's ARENA BUILD section
# printed nothing at all and a failed build looked exactly like a successful one.
for line in report:
    print("PHOTONBUILD %s" % line)
