"""Author the Photon mesh kit: real geometry instead of engine primitives.

The arena kept reading as a greybox because every actor in it was /Engine/BasicShapes/Cube. No amount
of material or lighting work fixes that, because the silhouette is the thing that says "Unreal
primitive". Geometry Script is available in this build (under the GeometryScript_* library names
rather than the GeometryScriptLibrary_* ones), so the modules below are authored properly: massed
from several volumes, boolean-cut to give recessed detail, and bevelled so every edge catches a
highlight.

Each module is saved to /Game/Photon/Meshes and then placed by build_photon_arena.py. Collision is
generated per asset, because static meshes created from a DynamicMesh have none by default and cover
the player can walk through is a gameplay regression, not a visual one.

Run:
  UnrealEditor-Cmd.exe PhotonUE.uproject -run=pythonscript -script=Tools/photon_mesh_kit.py
"""
import math

import unreal

PKG = "/Game/Photon/Meshes"

report = []


def say(t):
    report.append(str(t))


# --- Geometry Script shims -----------------------------------------------------------------------
PRIM = unreal.GeometryScript_Primitives
MODEL = unreal.GeometryScript_MeshModeling
BOOL = unreal.GeometryScript_MeshBooleans
XFORM = unreal.GeometryScript_MeshTransforms
NORMALS = unreal.GeometryScript_Normals
NEWASSET = unreal.GeometryScript_NewAssetUtils

_tri_fn = next((getattr(unreal.GeometryScript_MeshQueries, n)
                for n in dir(unreal.GeometryScript_MeshQueries) if "num_triangles" in n), None)

# The origin enum is spelled differently across engine versions; resolve it rather than assume.
_ORIGIN = unreal.GeometryScriptPrimitiveOriginMode
ORIGIN_BASE = getattr(_ORIGIN, "BASE")
ORIGIN_CENTRE = next(getattr(_ORIGIN, n) for n in ("CENTERED", "CENTER", "CENTRE")
                     if hasattr(_ORIGIN, n))


def tris(mesh):
    try:
        return _tri_fn(mesh) if _tri_fn else -1
    except Exception:
        return -1


def opts():
    o = unreal.GeometryScriptPrimitiveOptions()
    # Per-face polygroups are what the bevel operation walks to find edges. Without this the whole
    # primitive is one group, there are no group edges, and the bevel silently does nothing.
    o.set_editor_property("polygroup_mode", unreal.GeometryScriptPrimitivePolygroupMode.PER_FACE)
    return o


def xf(x=0.0, y=0.0, z=0.0, yaw=0.0, pitch=0.0, roll=0.0, scale=1.0):
    return unreal.Transform(
        unreal.Vector(x, y, z),
        unreal.Rotator(roll=roll, pitch=pitch, yaw=yaw),
        unreal.Vector(scale, scale, scale))


def new_mesh():
    return unreal.DynamicMesh()


def box(mesh, cx, cy, cz, sx, sy, sz, yaw=0.0, pitch=0.0, roll=0.0):
    """Axis-aligned-ish box specified by centre and full size."""
    return PRIM.append_box(mesh, opts(), xf(cx, cy, cz, yaw, pitch, roll), sx, sy, sz,
                           origin=ORIGIN_CENTRE)


def cyl(mesh, cx, cy, z_base, radius, height, steps=32):
    return PRIM.append_cylinder(mesh, opts(), xf(cx, cy, z_base), radius, height,
                                radial_steps=steps, height_steps=1, capped=True,
                                origin=ORIGIN_BASE)


def cone(mesh, cx, cy, z_base, base_radius, top_radius, height, steps=24,
         yaw=0.0, pitch=0.0, roll=0.0):
    return PRIM.append_cone(mesh, opts(), xf(cx, cy, z_base, yaw, pitch, roll),
                            base_radius, top_radius, height, radial_steps=steps, height_steps=1,
                            capped=True, origin=ORIGIN_BASE)


def sphere(mesh, cx, cy, cz, radius, steps=20):
    return PRIM.append_sphere_lat_long(mesh, opts(), xf(cx, cy, cz), radius,
                                       steps_phi=steps, steps_theta=steps,
                                       origin=ORIGIN_CENTRE)


def subtract(mesh, tool):
    o = unreal.GeometryScriptMeshBooleanOptions()
    return BOOL.apply_mesh_boolean(mesh, unreal.Transform(), tool, unreal.Transform(),
                                   unreal.GeometryScriptBooleanOperation.SUBTRACT, o)


def unite(mesh, tool):
    o = unreal.GeometryScriptMeshBooleanOptions()
    return BOOL.apply_mesh_boolean(mesh, unreal.Transform(), tool, unreal.Transform(),
                                   unreal.GeometryScriptBooleanOperation.UNION, o)


def bevel(mesh, distance):
    o = unreal.GeometryScriptMeshBevelOptions()
    o.set_editor_property("bevel_distance", distance)
    try:
        return MODEL.apply_mesh_polygroup_bevel(mesh, o)
    except Exception as exc:
        say("    bevel failed: %s" % exc)
        return mesh


def finalise(mesh, name, collision=True):
    """Normals, asset, collision, save."""
    try:
        NORMALS.recompute_normals(mesh, unreal.GeometryScriptCalculateNormalsOptions())
    except Exception as exc:
        say("    normals failed: %s" % exc)

    path = "%s/%s" % (PKG, name)
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        unreal.EditorAssetLibrary.delete_asset(path)

    o = unreal.GeometryScriptCreateNewStaticMeshAssetOptions()
    try:
        o.set_editor_property("enable_recompute_normals", False)
        o.set_editor_property("enable_recompute_tangents", True)
    except Exception:
        pass

    result = NEWASSET.create_new_static_mesh_asset_from_mesh(mesh, path, o)
    sm = result[0] if isinstance(result, tuple) else result
    if sm is None:
        say("  %-28s FAILED to create asset" % name)
        return None

    if collision:
        made = "none"
        try:
            co = unreal.GeometryScriptCollisionFromMeshOptions()
            co.set_editor_property("method",
                                   unreal.GeometryScriptCollisionGenerationMethod.CONVEX_HULLS)
            unreal.GeometryScript_Collision.set_static_mesh_collision_from_mesh(mesh, sm, co)
            made = "convex"
        except Exception:
            try:
                bs = sm.get_editor_property("body_setup")
                bs.set_editor_property("collision_trace_flag",
                                       unreal.CollisionTraceFlag.CTF_USE_COMPLEX_AS_SIMPLE)
                made = "complex_as_simple"
            except Exception as exc2:
                say("    collision failed: %s" % exc2)
        say("  %-28s tris=%-6d collision=%s" % (name, tris(mesh), made))
    else:
        say("  %-28s tris=%-6d collision=off" % (name, tris(mesh)))

    unreal.EditorAssetLibrary.save_asset(path)
    return sm


# ==================================================================================================
# COVER ARCHETYPES
# ==================================================================================================

def cover_low():
    """Cover A — competition barrier. A sports divider, not a crate: kick plate, recessed faces,
    overhanging rail, and end posts that stand proud like stanchions."""
    m = new_mesh()
    m = box(m, 0, 0, 10, 292, 108, 20)                 # plinth
    m = box(m, 0, 0, 28, 276, 92, 18)                  # kick plate, set back
    m = box(m, 0, 0, 68, 250, 70, 72)                  # body, narrower than the rail
    m = box(m, 0, 0, 112, 286, 96, 16)                 # capping rail, overhangs the body
    for sx in (-1, 1):
        m = box(m, sx * 142, 0, 64, 28, 100, 108)      # end stanchions
        m = box(m, sx * 142, 0, 126, 36, 108, 14)      # stanchion caps
    for sy in (-1, 1):
        cut = box(new_mesh(), 0, sy * 38, 70, 210, 22, 36)
        m = subtract(m, cut)
    return bevel(m, 3.5)


def cover_angled():
    """Cover B — blast shield. A framed leaning panel on a substantial plinth."""
    m = new_mesh()
    m = box(m, 0, 0, 18, 246, 110, 36)                      # plinth
    m = box(m, 0, 28, 108, 214, 36, 180, roll=-14.0)        # leaning panel
    for sx in (-1, 1):
        m = box(m, sx * 110, 16, 96, 26, 52, 176, roll=-14.0)
    cut = box(new_mesh(), 0, 28, 118, 156, 48, 100, roll=-14.0)
    m = subtract(m, cut)
    m = box(m, 0, 26, 118, 156, 16, 100, roll=-14.0)        # recessed inner panel
    m = box(m, 0, 18, 198, 220, 48, 14, roll=-14.0)         # top rail
    return bevel(m, 3.0)


def cover_pod():
    """Cover C — pitchside equipment cabinet. Stacked masses, side handles, a collar on top."""
    m = new_mesh()
    m = box(m, 0, 0, 18, 176, 176, 36)        # base
    m = box(m, 0, 0, 86, 136, 136, 104)       # cabinet
    m = box(m, 0, 0, 146, 168, 168, 18)       # overhanging lid
    m = cyl(m, 0, 0, 154, 48, 36, steps=12)   # collar, where the energy cap sits
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        m = box(m, sx * 82, sy * 82, 86, 16 if sx else 110, 110 if sx else 16, 70)
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cut = box(new_mesh(), sx * 64, sy * 64, 92, 24 if sx else 80, 80 if sx else 24, 48)
        m = subtract(m, cut)
    return bevel(m, 4.0)


def cover_pylon():
    """Cover D — venue totem. Stepped base, fluted shaft, a ring under the cap for the energy band."""
    m = new_mesh()
    m = box(m, 0, 0, 16, 140, 140, 32)        # foot
    m = box(m, 0, 0, 42, 108, 108, 22)        # step
    m = box(m, 0, 0, 150, 72, 72, 216)        # shaft
    m = box(m, 0, 0, 262, 96, 96, 14)         # energy ring seat
    m = box(m, 0, 0, 278, 112, 112, 22)       # cap
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cut = box(new_mesh(), sx * 36, sy * 36, 150, 16 if sx else 32, 32 if sx else 16, 180)
        m = subtract(m, cut)
    return bevel(m, 3.0)


def cover_bench():
    """Cover E — lane divider. A long low run with a backboard, so it reads as furniture not a crate."""
    m = new_mesh()
    m = box(m, 0, 0, 10, 480, 118, 20)        # plinth
    m = box(m, 0, 0, 48, 448, 88, 58)         # seat / body
    m = box(m, 0, -28, 92, 448, 22, 54)       # backboard, offset to one long edge
    m = box(m, 0, 0, 82, 468, 104, 12)        # capping rail
    for i in (-1, 0, 1):
        m = box(m, i * 160, 0, 46, 20, 124, 68)
    for sx in (-1, 1):
        m = box(m, sx * 236, 0, 50, 22, 118, 80)
    return bevel(m, 3.0)


# ==================================================================================================
# ARCHITECTURE
# ==================================================================================================

def wall_bay():
    """A 500-wide perimeter module: recessed centre, structural ribs, upper band."""
    m = new_mesh()
    m = box(m, 0, 0, 350, 500, 70, 700)                 # slab
    cut = box(new_mesh(), 0, -30, 350, 380, 40, 480)    # recess the inner face
    m = subtract(m, cut)
    m = box(m, 0, -12, 350, 340, 14, 440)               # back panel inside the recess
    for sx in (-1, 1):
        m = box(m, sx * 232, -18, 350, 44, 108, 700)    # vertical ribs, proud of the wall
    m = box(m, 0, -22, 648, 500, 118, 56)               # upper structural band
    m = box(m, 0, -18, 34, 500, 110, 68)                # kick plinth
    return bevel(m, 3.0)


def wall_bay_angled():
    """A canted variant so the perimeter is not four identical straight runs."""
    m = new_mesh()
    m = box(m, 0, 0, 350, 500, 70, 700)
    cut = box(new_mesh(), 0, -46, 420, 420, 70, 380, roll=0.0, pitch=12.0)
    m = subtract(m, cut)
    for sx in (-1, 1):
        m = box(m, sx * 232, -18, 350, 44, 108, 700)
    m = box(m, 0, -22, 648, 500, 118, 56)
    m = box(m, 0, -18, 34, 500, 110, 68)
    return bevel(m, 3.0)


def corner_pylon():
    """Chamfered corner column. The large bevel is the point: it kills the cube read instantly."""
    m = new_mesh()
    m = box(m, 0, 0, 380, 300, 300, 760)
    m = box(m, 0, 0, 40, 380, 380, 80)
    m = box(m, 0, 0, 742, 360, 360, 36)
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cut = box(new_mesh(), sx * 150, sy * 150, 400, 30 if sx else 90, 90 if sx else 30, 560)
        m = subtract(m, cut)
    return bevel(m, 26.0)


def ceiling_bay():
    """An open-bottomed coffer. A rect light sits inside it, so the ceiling lights from a recess."""
    m = new_mesh()
    m = box(m, 0, 0, 55, 940, 940, 110)
    cut = box(new_mesh(), 0, 0, 40, 780, 780, 110)
    m = subtract(m, cut)
    return bevel(m, 5.0)


def truss():
    """I-profile ceiling member, 4200 long."""
    m = new_mesh()
    m = box(m, 0, 0, 0, 4200, 120, 150)
    for sy in (-1, 1):
        cut = box(new_mesh(), 0, sy * 60, 0, 4200, 60, 74)
    # Two separate cuts, one per side, so the web survives in the middle.
    for sy in (-1, 1):
        cut = box(new_mesh(), 0, sy * 62, 0, 4260, 66, 76)
        m = subtract(m, cut)
    return bevel(m, 2.5)


def centre_dais():
    """Hexagonal competition platform: two shallow steps, low enough to fight over."""
    m = new_mesh()
    m = cyl(m, 0, 0, 0, 640, 14, steps=6)
    m = cyl(m, 0, 0, 12, 540, 16, steps=6)
    return bevel(m, 4.0)


def centre_ring():
    """Thin hex inlay that sits in the dais and carries the energy material."""
    m = cyl(new_mesh(), 0, 0, 0, 505, 8, steps=6)
    cut = cyl(new_mesh(), 0, 0, -10, 465, 40, steps=6)
    return subtract(m, cut)


def centre_rig():
    """The overhead anchor: a suspended hexagonal lighting rig above the dais."""
    m = cyl(new_mesh(), 0, 0, 0, 880, 90, steps=6)
    cut = cyl(new_mesh(), 0, 0, -20, 700, 140, steps=6)
    m = subtract(m, cut)
    m = cyl(m, 0, 0, 84, 840, 26, steps=6)          # top flange
    for i in range(6):
        import math
        a = math.radians(i * 60.0)
        m = box(m, math.cos(a) * 790, math.sin(a) * 790, 150, 60, 60, 210)   # hangers
    return bevel(m, 5.0)


def core_lantern():
    """Shell of the Photon Core: the arena's landmark, hung over the dais at 6 m.

    Every earlier centrepiece attempt put mass on the floor, and the floor is the one place a
    competitive arena cannot spare it — the dais is 12.8 m across and four teams have to fight over
    it. This carries the vertical read entirely above head height instead, so it costs the court
    nothing and is still the first thing in frame from all four spawns.

    Four stacked rings widening upward, so it reads as a machine rather than a lampshade, with a
    nose cone underneath that points at the centre spot.
    """
    m = new_mesh()
    steps = [(0.0, 110.0), (108.0, 172.0), (216.0, 240.0), (324.0, 312.0)]
    for z, r in steps:
        m = cyl(m, 0, 0, z, r, 52, steps=12)
        m = subtract(m, cyl(new_mesh(), 0, 0, z - 12, r - 40, 76, steps=12))
    # Ribs bridging the rings, each leaning out to follow the taper.
    for i in range(6):
        a = math.radians(i * 60.0)
        for (z0, r0), (z1, r1) in zip(steps, steps[1:]):
            mid_r, mid_z = (r0 + r1) * 0.5, (z0 + z1) * 0.5 + 26
            lean = math.degrees(math.atan2(r1 - r0, z1 - z0))
            m = box(m, math.cos(a) * mid_r, math.sin(a) * mid_r, mid_z, 40, 40, 132,
                    yaw=i * 60.0, pitch=0.0, roll=lean if abs(math.sin(a)) < 0.5 else 0.0)
    m = cyl(m, 0, 0, 376, 348, 44, steps=12)                 # top flange, meets the rig above
    m = cone(m, 0, 0, -96, 0.0, 118.0, 96, steps=12)         # nose, aimed at the centre spot
    return bevel(m, 4.0)


def core_glow():
    """The emissive element inside the Core shell, sized to show through the gaps between rings."""
    m = cone(new_mesh(), 0, 0, -30, 54.0, 268.0, 400, steps=16)
    m = sphere(m, 0, 0, -56, 58, steps=16)
    return m


def deck_slab():
    """Elevated viewing deck. Ribbed underside so it reads as engineered from below."""
    m = new_mesh()
    m = box(m, 0, 0, 0, 1200, 800, 46)
    for i in range(-2, 3):
        m = box(m, i * 260, 0, -44, 60, 800, 46)      # underside ribs
    m = box(m, 0, 0, 30, 1160, 760, 16)               # walking surface, inset
    return bevel(m, 3.0)


def deck_ramp():
    """Walkable mezzanine ramp. Origin at the foot, +X up the run, walking surface on top.

    Authored already pitched, so the builder places it at the foot with yaw only — no actor pitch,
    which is what made the previous three-box ramp photograph as a fallen slab. Rise 278, run 380,
    width 340: those numbers are the deck's inner edge minus the dais clearance, and they keep the
    slope at 36 degrees, under the pawn's 44.4 walkable limit.
    """
    run, rise, width = 380.0, 278.0, 340.0
    pitch = math.degrees(math.atan2(rise, run))
    length = math.hypot(run, rise)
    m = new_mesh()
    m = box(m, run * 0.5, 0, rise * 0.5, length, width, 32, pitch=pitch)
    for sy in (-1, 1):
        m = box(m, run * 0.5, sy * (width * 0.5 - 14), rise * 0.5 + 48,
                length, 28, 88, pitch=pitch)
        m = box(m, run * 0.5, sy * (width * 0.5 - 14), rise * 0.5 + 94,
                length, 34, 12, pitch=pitch)           # rail cap, energy strip sits on this
    for i in range(4):
        t = (i + 1) / 5.0
        m = box(m, run * t, 0, rise * t - 24, 30, width - 40, 36, pitch=pitch)
    m = box(m, 10, 0, 22, 20, width + 8, 44)           # kick plate at the foot
    m = box(m, run - 8, 0, rise + 16, 24, width, 20, pitch=pitch)  # landing nosing
    return bevel(m, 3.0)


def scoreboard():
    """League board. 20 m wide, recessed face, side ears. Type sits in the recess."""
    m = new_mesh()
    m = box(m, 0, 0, 0, 2000, 36, 360)                 # body
    cut = box(new_mesh(), 0, -12, 8, 1760, 28, 260)
    m = subtract(m, cut)
    m = box(m, 0, 6, 8, 1780, 16, 280)                 # back panel, the face type sits in front of
    for sx in (-1, 1):
        m = box(m, sx * 1020, 0, 0, 56, 48, 380)
        m = box(m, sx * 1020, 0, 200, 64, 56, 28)      # ear caps
    m = box(m, 0, 0, 196, 2040, 44, 24)                # top lintel
    m = box(m, 0, 0, -196, 2040, 44, 24)               # bottom lintel
    return bevel(m, 4.0)


def railing():
    """400-wide railing segment: posts, top rail, lower bar."""
    m = new_mesh()
    for sx in (-1, 1):
        m = box(m, sx * 190, 0, 55, 22, 22, 110)
    m = box(m, 0, 0, 116, 400, 34, 18)                # top rail
    m = box(m, 0, 0, 46, 400, 14, 10)                 # lower bar
    return bevel(m, 2.5)


def pedestal():
    """Target pedestal: tapered column on a chamfered base."""
    m = new_mesh()
    m = box(m, 0, 0, 12, 130, 130, 24)
    m = cone(m, 0, 0, 22, 52, 38, 120, steps=12)
    m = cyl(m, 0, 0, 140, 46, 16, steps=12)
    return bevel(m, 3.0)


def spawn_gate():
    """A framed archway over each team spawn so the zones read architecturally, not just by colour."""
    m = new_mesh()
    for sx in (-1, 1):
        m = box(m, sx * 250, 0, 170, 90, 130, 340)
        m = box(m, sx * 250, 0, 18, 130, 170, 36)
    m = box(m, 0, 0, 372, 620, 120, 64)               # lintel
    cut = box(new_mesh(), 0, 0, 372, 420, 140, 30)
    m = subtract(m, cut)
    return bevel(m, 4.0)


# ==================================================================================================
# SPECTATOR BOWL — adapted from the Apex venue (src/maps/arena02_apex.ts)
#
# Apex's central insight is that the building is not the play space. Its bounds stay at 60 x 60 while
# the bowl occupies a ring entirely outside them, so the seating can be as deep as it likes without
# costing a metre of court or shortening a single sight line. Everything below is authored to live in
# that ring, above the containment wall, where it is scenery the player reads and never touches.
# ==================================================================================================

def seat_bank():
    """A raked seating bank, 7 rows over a 10 m run. Local +Y is outward and up, away from the field.

    One mesh rather than 7 riser actors plus 7 nosings: the bank is the single most repeated element
    in the venue and placing it as 14 boxes per run would have put 450 actors in the bowl on its own.
    The seat blocks matter more than they look — a smooth rake reads as a concrete ramp at any
    distance, and it is the row of interrupted verticals that says "seating".
    """
    rows, pitch, rise = 7, 105.0, 64.0
    m = new_mesh()
    for r in range(rows):
        y, z = r * pitch, r * rise
        m = box(m, 0, y + pitch * 0.5, z + rise * 0.5, 1000, pitch, rise)
        m = box(m, 0, y + 18, z + rise + 8, 1000, 30, 18)                 # tread nosing
        for i in (-1, 0, 1):
            m = box(m, i * 322, y + pitch - 28, z + rise + 36, 252, 32, 56)
    # Central aisle: cut after the rows so the steps survive in the flanking blocks.
    aisle = box(new_mesh(), 0, rows * pitch * 0.5, rows * rise * 0.5 + 60,
                96, rows * pitch + 60, rows * rise + 200)
    m = subtract(m, aisle)
    m = box(m, 0, rows * pitch + 34, rows * rise * 0.5, 1000, 68, rows * rise + 80)   # back wall
    return bevel(m, 2.5)


def suite_box():
    """A VIP suite / press box. The glazing is placed separately so it can carry the warm material."""
    m = new_mesh()
    m = box(m, 0, 0, 0, 900, 520, 36)                 # floor
    m = box(m, 0, 0, 320, 900, 520, 36)               # roof
    m = box(m, 0, 0, 344, 960, 570, 26)               # cornice, proud of the roof
    for sx in (-1, 1):
        m = box(m, sx * 436, 0, 160, 34, 520, 288)    # end mullions
    m = box(m, 0, 0, 160, 240, 30, 288)               # centre mullion
    m = box(m, 0, 248, 160, 900, 34, 288)             # back wall
    return bevel(m, 3.0)


def atrium_column():
    """A 22.8 m fluted column. Eight of these ring the centre and carry the arena's vertical read.

    Apex rings its atrium with columns that run the full height of the building, and that single
    move is most of the difference between a room with a high ceiling and a venue. The flutes stop
    short of the base and capital so the column has three distinct zones instead of one extrusion.
    """
    h = 2280.0
    m = new_mesh()
    m = box(m, 0, 0, h * 0.5, 150, 150, h)
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cut = box(new_mesh(), sx * 75, sy * 75, h * 0.5,
                  34 if sx else 58, 58 if sx else 34, h - 520)
        m = subtract(m, cut)
    m = box(m, 0, 0, 62, 250, 250, 124)               # base plinth
    m = box(m, 0, 0, 156, 202, 202, 64)               # base transition
    m = box(m, 0, 0, h - 176, 196, 196, 72)           # capital transition
    m = box(m, 0, 0, h - 88, 238, 238, 104)           # capital
    return bevel(m, 5.0)


def reactor_drum():
    """A pressure vessel for the Fusion Reactor landmark. Placed several times at different scales."""
    m = new_mesh()
    m = cyl(m, 0, 0, 0, 300, 400, steps=20)
    m = cyl(m, 0, 0, -16, 336, 32, steps=20)          # bottom flange
    m = cyl(m, 0, 0, 384, 336, 32, steps=20)          # top flange
    for i in range(8):
        a = math.radians(i * 45.0)
        m = box(m, math.cos(a) * 296, math.sin(a) * 296, 200, 46, 46, 320, yaw=i * 45.0)
    return bevel(m, 3.0)


def broadcast_pod():
    """The commentary box that cantilevers off the Broadcast Tower toward the centre of the court."""
    m = new_mesh()
    m = box(m, 0, 0, 0, 620, 400, 34)                 # floor
    m = box(m, 0, 0, 268, 620, 400, 38)               # roof
    for sx in (-1, 1):
        m = box(m, sx * 300, 0, 134, 36, 400, 234)    # side mullions
    m = box(m, 0, 186, 134, 620, 36, 234)             # back
    for sx in (-1, 1):
        m = box(m, sx * 170, 90, -110, 44, 320, 200, pitch=24.0)   # cantilever props
    return bevel(m, 3.0)


def walk_arch():
    """One bay of the Champion's Walk colonnade. Tiles at 340 so adjacent bays share a pier.

    Apex's west wall is the only place in the venue that is warm, and the only place built from
    voids rather than solids. Both are deliberate: it is the one elevation a player can name.
    """
    m = new_mesh()
    for sx in (-1, 1):
        m = box(m, sx * 170, 0, 250, 112, 150, 500)   # piers
    m = box(m, 0, 0, 532, 340, 150, 64)               # arch head, three courses
    m = box(m, 0, 0, 588, 252, 150, 48)
    m = box(m, 0, 0, 632, 164, 150, 40)
    m = box(m, 0, 62, 250, 232, 32, 500)              # recessed back panel
    m = box(m, 0, 0, 14, 360, 190, 28)                # threshold
    return bevel(m, 3.0)


# ==================================================================================================
# FIRST-PERSON ARMS
# ==================================================================================================

def arm(mirror=False):
    """A first-person forearm and gloved hand, authored along +Z with the elbow at the origin.

    Proportioned from a real arm rather than styled: 30 cm forearm tapering 5.4 -> 3.9 cm at the
    wrist, a 19 cm hand. The sleeve/cuff/glove split is what makes it read as competition gear
    instead of a limb, and the finger block gives the silhouette something to end on.
    """
    s = -1.0 if mirror else 1.0
    m = new_mesh()

    m = sphere(m, 0, 0, 2, 6.4)                            # elbow cap
    m = cone(m, 0, 0, 0, 6.2, 4.4, 27, steps=18)           # sleeve, tapering to the wrist
    m = cyl(m, 0, 0, 8, 6.0, 3.2, steps=18)                # sleeve seam ring
    m = cyl(m, 0, 0, 25.5, 4.9, 4.5, steps=18)             # wrist cuff
    m = box(m, 0, s * 4.6, 17, 2.4, 2.0, 15)               # forearm strap detail

    # Hand. Modelled as a closed grip rather than four separate fingers: individual digits at this
    # size read as a splayed claw, whereas a single curled mass with grooves cut into it reads as a
    # fist holding something, which is the only thing this hand ever does.
    m = box(m, 0, 0, 36.0, 8.0, 5.0, 16.0, roll=s * 5.0)             # palm
    m = box(m, 2.6, 0, 45.0, 8.8, 6.2, 8.0, pitch=22.0)              # curled finger mass
    m = box(m, 5.2, 0, 41.4, 6.6, 5.8, 5.0, pitch=54.0)              # fingertips, tucked under
    for gz in (43.0, 45.6, 48.2):
        groove = box(new_mesh(), 4.0, 0, gz, 12.0, 0.7, 2.2, pitch=22.0)
        m = subtract(m, groove)
    m = box(m, 1.6, s * -4.2, 38.5, 4.6, 2.8, 8.0, pitch=18.0, roll=s * 30.0)   # thumb

    return bevel(m, 1.1)


# ==================================================================================================
# BUILD
# ==================================================================================================

MODULES = [
    ("SM_PhotonCoverLow", cover_low, True),
    ("SM_PhotonCoverAngled", cover_angled, True),
    ("SM_PhotonCoverPod", cover_pod, True),
    ("SM_PhotonCoverPylon", cover_pylon, True),
    ("SM_PhotonCoverBench", cover_bench, True),
    ("SM_PhotonWallBay", wall_bay, True),
    ("SM_PhotonWallBayAngled", wall_bay_angled, True),
    ("SM_PhotonCornerPylon", corner_pylon, True),
    ("SM_PhotonCeilingBay", ceiling_bay, False),
    ("SM_PhotonTruss", truss, False),
    ("SM_PhotonCentreDais", centre_dais, True),
    ("SM_PhotonCentreRing", centre_ring, False),
    ("SM_PhotonCentreRig", centre_rig, False),
    # The Core hangs at 6 m and is never touched, so no collision.
    ("SM_PhotonCoreLantern", core_lantern, False),
    ("SM_PhotonCoreGlow", core_glow, False),
    ("SM_PhotonDeckSlab", deck_slab, True),
    ("SM_PhotonDeckRamp", deck_ramp, True),
    ("SM_PhotonScoreboard", scoreboard, False),
    ("SM_PhotonRailing", railing, True),
    ("SM_PhotonPedestal", pedestal, True),
    ("SM_PhotonSpawnGate", spawn_gate, True),
    # Spectator bowl. None of it is collidable: it all lives outside the play space, and convex
    # hulls around a seven-row rake are both expensive and pointless.
    ("SM_PhotonSeatBank", seat_bank, False),
    ("SM_PhotonSuiteBox", suite_box, False),
    ("SM_PhotonReactorDrum", reactor_drum, False),
    ("SM_PhotonBroadcastPod", broadcast_pod, False),
    ("SM_PhotonWalkArch", walk_arch, False),
    # The columns stand in the court, so these do need collision.
    ("SM_PhotonAtriumColumn", atrium_column, True),
    ("SM_PhotonArmRight", lambda: arm(False), False),
    ("SM_PhotonArmLeft", lambda: arm(True), False),
]

say("=== Photon mesh kit ===")
ok = 0
for name, fn, collide in MODULES:
    try:
        mesh = fn()
        if finalise(mesh, name, collide):
            ok += 1
    except Exception as exc:
        say("  %-28s EXCEPTION %s: %s" % (name, type(exc).__name__, exc))
say("built %d/%d" % (ok, len(MODULES)))
for line in report:
    print("PHOTONKIT %s" % line)

with open(unreal.Paths.project_saved_dir() + "Logs/photon_mesh_kit.txt", "w") as f:
    f.write("\n".join(report))
