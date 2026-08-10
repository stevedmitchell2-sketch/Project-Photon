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
    """Cover A — low competition barrier. Waist high, wide, mounted on a plinth."""
    m = new_mesh()
    m = box(m, 0, 0, 8, 280, 96, 16)          # plinth
    m = box(m, 0, 0, 60, 258, 76, 88)         # body
    m = box(m, 0, 0, 106, 268, 88, 12)        # capping rail
    for sx in (-1, 1):
        m = box(m, sx * 131, 0, 62, 22, 92, 96)   # end posts, proud of the body
    # Recessed channel down both long faces: this is the detail that stops it reading as a slab.
    for sy in (-1, 1):
        cut = box(new_mesh(), 0, sy * 40, 66, 220, 26, 20)
        m = subtract(m, cut)
    return bevel(m, 3.5)


def cover_angled():
    """Cover B — angled divider. A leaning panel that breaks sightlines diagonally."""
    m = new_mesh()
    m = box(m, 0, 0, 15, 230, 96, 30)                       # base wedge
    m = box(m, 0, 24, 110, 206, 30, 186, roll=-14.0)        # leaning panel
    for sx in (-1, 1):
        m = box(m, sx * 104, 12, 96, 22, 46, 168, roll=-14.0)   # edge frames
    cut = box(new_mesh(), 0, 24, 120, 150, 44, 96, roll=-14.0)
    m = subtract(m, cut)
    m = box(m, 0, 24, 120, 150, 18, 96, roll=-14.0)         # recessed inner panel, set back
    return bevel(m, 3.0)


def cover_pod():
    """Cover C — technical pod. Chunky arena equipment: stacked masses and side fins."""
    m = new_mesh()
    m = box(m, 0, 0, 20, 168, 168, 40)        # base
    m = box(m, 0, 0, 88, 140, 140, 100)       # main mass
    m = box(m, 0, 0, 148, 172, 172, 22)       # overhanging cap
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        m = box(m, sx * 78, sy * 78, 86, 14 if sx else 120, 120 if sx else 14, 76)  # fins
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cut = box(new_mesh(), sx * 66, sy * 66, 96, 26 if sx else 84, 84 if sx else 26, 44)
        m = subtract(m, cut)
    return bevel(m, 4.0)


def cover_pylon():
    """Cover D — vertical panel. Tall, narrow, fluted; reads at range and gives head cover."""
    m = new_mesh()
    m = box(m, 0, 0, 14, 124, 124, 28)        # foot
    m = box(m, 0, 0, 140, 78, 78, 240)        # column
    m = box(m, 0, 0, 268, 108, 108, 20)       # cap
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        cut = box(new_mesh(), sx * 38, sy * 38, 150, 14 if sx else 34, 34 if sx else 14, 190)
        m = subtract(m, cut)
    return bevel(m, 3.0)


def cover_bench():
    """Cover E — long low run. Fills lanes without adding another silhouette to parse."""
    m = new_mesh()
    m = box(m, 0, 0, 10, 460, 110, 20)
    m = box(m, 0, 0, 46, 430, 84, 56)
    m = box(m, 0, 0, 80, 450, 100, 14)
    for i in (-1, 0, 1):
        m = box(m, i * 150, 0, 44, 18, 116, 62)   # transverse ribs
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


def deck_slab():
    """Elevated viewing deck. Ribbed underside so it reads as engineered from below."""
    m = new_mesh()
    m = box(m, 0, 0, 0, 1200, 800, 46)
    for i in range(-2, 3):
        m = box(m, i * 260, 0, -44, 60, 800, 46)      # underside ribs
    m = box(m, 0, 0, 30, 1160, 760, 16)               # walking surface, inset
    return bevel(m, 3.0)


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
    ("SM_PhotonDeckSlab", deck_slab, True),
    ("SM_PhotonRailing", railing, True),
    ("SM_PhotonPedestal", pedestal, True),
    ("SM_PhotonSpawnGate", spawn_gate, True),
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

with open(unreal.Paths.project_saved_dir() + "Logs/photon_mesh_kit.txt", "w") as f:
    f.write("\n".join(report))
