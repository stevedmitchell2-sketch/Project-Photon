"""Authoritative Photon arena build — Visual Sprint 01.

Replaces the incremental greybox scripts. The layout is inherited from build_arena_foundation.py;
what changes is that the geometry is now correct and the surfaces are readable.

Three classes of bug are fixed here, all found by probing the saved level rather than by reading the
scripts that produced it:

  * Buried geometry. Cover was placed with `z = h * 50 - 50`, which puts a 45 uu low barrier entirely
    inside the 100 uu floor slab. Low cover, spawn pads, the competition floor and the centre mark
    were all invisible because they sat below the floor surface. Everything now sits ON z = 0.
  * Unreadable surfaces. Every actor was bound to one UNLIT material, so it could only ever be flat
    black or blown out. Structure, floor and cover now use separate lit materials with distinct
    values, and emission is reserved for energy.
  * Blown-out sky. The arena was open to a SkyAtmosphere, so auto-exposure metered for the sky and
    washed the interior white. The arena is now a roofed facility lit by its own ceiling rig.

The player start pitch is also corrected: it was 90 degrees, so the player spawned looking at the sky.
"""
import unreal

MAP = "/Game/Photon/Maps/L_PhotonGrey"

CUBE = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")
CYL = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cylinder")

MAT = {
    "structure": unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonSurface"),
    "floor": unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonFloor"),
    "cover": unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonCover"),
    "energy": unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonGlow"),
}

# --- Palette (linear) --------------------------------------------------------------------------
STRUCTURE = unreal.LinearColor(0.055, 0.060, 0.075, 1.0)
STRUCTURE_LIGHT = unreal.LinearColor(0.095, 0.102, 0.120, 1.0)
FLOOR_COL = unreal.LinearColor(0.030, 0.034, 0.045, 1.0)
COURT_COL = unreal.LinearColor(0.048, 0.055, 0.070, 1.0)
COVER_COL = unreal.LinearColor(0.115, 0.125, 0.150, 1.0)
NEON = unreal.LinearColor(0.35, 0.82, 1.0, 1.0)
TEAM = {
    "Red": unreal.LinearColor(1.00, 0.18, 0.14, 1.0),
    "Green": unreal.LinearColor(0.16, 0.95, 0.42, 1.0),
    "Blue": unreal.LinearColor(0.20, 0.55, 1.00, 1.0),
    "Yellow": unreal.LinearColor(1.00, 0.80, 0.12, 1.0),
}

# --- Arena dimensions --------------------------------------------------------------------------
HALF = 2000.0        # inner face of the perimeter wall
WALL_H = 700.0       # floor to ceiling
ROOF_T = 60.0
COURT = 1700.0       # half-extent of the marked competition court

# --- Lighting tunables -------------------------------------------------------------------------
# 60000 lm per light blew a 3% albedo floor to pure white. The arena reads as designed at 4200,
# paired with exposure pinned at photon.Exposure 18.
CEILING_LIGHT_LUMENS = 4200.0
# The arena is roofed, so the sun and sky are fill at most. They are kept low rather than removed
# because the perimeter still catches a little of both.
KEY_LIGHT_LUX = 0.6
SKY_LIGHT = 0.35
BLOOM = 0.35

report = []
subsys = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)


def say(text):
    report.append(text)


def dim(color, factor):
    """unreal.LinearColor has no scalar multiply in this Python API."""
    return unreal.LinearColor(color.r * factor, color.g * factor, color.b * factor, 1.0)


def spawn(cls, loc, yaw=0.0, pitch=0.0, roll=0.0):
    return subsys.spawn_actor_from_class(
        cls, unreal.Vector(*loc), unreal.Rotator(roll=roll, pitch=pitch, yaw=yaw))


def surface(actor, role, color, emissive=0.0):
    smc = actor.static_mesh_component
    parent = MAT.get(role) or MAT["structure"]
    smc.set_material(0, parent)
    mid = smc.create_dynamic_material_instance(0)
    if mid:
        mid.set_vector_parameter_value("TintColor", color)
        mid.set_scalar_parameter_value("EmissiveStrength", emissive)


def box(loc, scale, label, role="structure", color=None, emissive=0.0, yaw=0.0, mesh=None):
    a = spawn(unreal.StaticMeshActor, loc, yaw=yaw)
    a.set_actor_label(label)
    a.set_actor_scale3d(unreal.Vector(*scale))
    a.static_mesh_component.set_static_mesh(mesh or CUBE)
    a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    surface(a, role, color if color else STRUCTURE, emissive)
    return a


unreal.EditorLoadingAndSavingUtils.load_map(MAP)
say("loaded_map=%s" % MAP)

# --- 0. Clear previously generated arena geometry -----------------------------------------------
REBUILD_PREFIXES = ("Floor", "Wall", "Cover_", "LaneCover", "Platform", "Perch", "Arena", "Target_",
                    "Court", "Boundary", "Lane", "Panel", "Roof", "Ceiling", "Signage", "Pylon",
                    # "Spawn" rather than the individual SpawnPad/SpawnStrip names: SpawnPylon was
                    # missing from that list, so four pylons were duplicated on every rebuild.
                    "Spawn", "Pedestal", "Step")
removed = 0
for a in subsys.get_all_level_actors():
    label = a.get_actor_label()
    is_arena_mesh = isinstance(a, unreal.StaticMeshActor) and label.startswith(REBUILD_PREFIXES)
    is_arena_light = isinstance(a, unreal.RectLight) and label.startswith("Ceiling")
    is_target = a.get_class().get_name() == "PhotonTarget"
    if is_arena_mesh or is_arena_light or is_target:
        subsys.destroy_actor(a)
        removed += 1
say("removed_previous_actors=%d" % removed)

# --- 1. Floor and competition court --------------------------------------------------------------
box((0, 0, -50), (41, 41, 1.0), "Floor", "floor", FLOOR_COL)
box((0, 0, 1), (COURT * 2 / 100.0, COURT * 2 / 100.0, 0.02), "CourtSurface", "floor", COURT_COL)

# Boundary lines: a thin emissive frame around the court reads as a competition boundary.
for i, (x, y, sx, sy) in enumerate([
    (0, COURT, COURT * 2 / 100.0, 0.10), (0, -COURT, COURT * 2 / 100.0, 0.10),
    (COURT, 0, 0.10, COURT * 2 / 100.0), (-COURT, 0, 0.10, COURT * 2 / 100.0),
]):
    box((x, y, 3), (sx, sy, 0.03), "BoundaryLine_%d" % i, "energy", NEON, 2.2)

# Lane lines: restrained interior markings, not a grid.
for i, x in enumerate([-850, 0, 850]):
    box((x, 0, 2.5), (0.06, COURT * 2 / 100.0, 0.02), "LaneLine_%d" % i, "energy", dim(NEON, 0.5), 1.2)

# Centre circle, built from a flat cylinder so it reads as a designed centre mark.
centre = spawn(unreal.StaticMeshActor, (0, 0, 3))
centre.set_actor_label("CourtCentreMark")
centre.set_actor_scale3d(unreal.Vector(5.2, 5.2, 0.03))
centre.static_mesh_component.set_static_mesh(CYL)
centre.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
surface(centre, "energy", dim(NEON, 0.55), 1.6)

# --- 2. Perimeter shell ---------------------------------------------------------------------------
WALL_SCALE_Z = WALL_H / 100.0
for i, (x, y, sx, sy) in enumerate([
    (0, HALF + 50, 41, 1), (0, -(HALF + 50), 41, 1),
    (HALF + 50, 0, 1, 41), (-(HALF + 50), 0, 1, 41),
]):
    box((x, y, WALL_H / 2.0), (sx, sy, WALL_SCALE_Z), "Wall_%d" % i, "structure", STRUCTURE)

# Corner pylons give the enclosure defined architectural corners.
for i, (x, y) in enumerate([(HALF, HALF), (-HALF, HALF), (HALF, -HALF), (-HALF, -HALF)]):
    box((x, y, WALL_H / 2.0), (2.2, 2.2, WALL_SCALE_Z), "Pylon_%d" % i, "structure", STRUCTURE_LIGHT)

# Vertical architectural panels: regular rhythm around the shell, lifted in value.
panel_positions = []
for t in range(-3, 4):
    panel_positions.append((t * 500.0, HALF - 10, 0.0))
    panel_positions.append((t * 500.0, -(HALF - 10), 0.0))
    panel_positions.append((HALF - 10, t * 500.0, 90.0))
    panel_positions.append((-(HALF - 10), t * 500.0, 90.0))
for i, (x, y, yaw) in enumerate(panel_positions):
    box((x, y, 300), (1.8, 0.2, 5.4), "Panel_%d" % i, "structure", STRUCTURE_LIGHT, yaw=yaw)

# Horizontal energy bands: the single strongest cue that this is a lit sports venue.
for i, (x, y, sx, sy, yaw) in enumerate([
    (0, HALF - 6, 40, 0.14, 0), (0, -(HALF - 6), 40, 0.14, 0),
    (HALF - 6, 0, 0.14, 40, 0), (-(HALF - 6), 0, 0.14, 40, 0),
]):
    box((x, y, 250), (sx, sy, 0.16), "ArenaEnergyStrip_Low_%d" % i, "energy", NEON, 4.0, yaw=yaw)
    box((x, y, 610), (sx, sy, 0.16), "ArenaEnergyStrip_High_%d" % i, "energy", dim(NEON, 0.8), 3.0, yaw=yaw)

# --- 3. Roof and ceiling rig -----------------------------------------------------------------------
box((0, 0, WALL_H + ROOF_T / 2.0), (41, 41, ROOF_T / 100.0), "Roof", "structure", STRUCTURE)

for i, y in enumerate([-1200, -400, 400, 1200]):
    box((0, y, WALL_H - 14), (34, 1.1, 0.14), "CeilingBand_%d" % i, "energy", dim(NEON, 0.9), 5.0)

for i, (x, y) in enumerate([(-950, -950), (950, -950), (-950, 950), (950, 950)]):
    light = spawn(unreal.RectLight, (x, y, WALL_H - 40), pitch=-90.0)
    light.set_actor_label("CeilingLight_%d" % i)
    lc = light.rect_light_component
    lc.set_mobility(unreal.ComponentMobility.MOVABLE)
    lc.set_editor_property("intensity_units", unreal.LightUnits.LUMENS)
    lc.set_editor_property("intensity", CEILING_LIGHT_LUMENS)
    lc.set_editor_property("source_width", 900.0)
    lc.set_editor_property("source_height", 900.0)
    lc.set_editor_property("attenuation_radius", 3600.0)
    lc.set_editor_property("light_color", unreal.Color(198, 222, 255))
    lc.set_editor_property("cast_shadows", i == 0)

# --- 4. Cover, sitting on the floor ----------------------------------------------------------------
cover_specs = [
    (600, 200, 0.45, "Low_0"), (-700, 350, 0.45, "Low_1"),
    (900, -500, 0.45, "Low_2"), (-400, -900, 0.45, "Low_3"),
    (300, 900, 1.00, "Mid_0"), (-500, 1100, 1.00, "Mid_1"),
    (1100, 700, 1.00, "Mid_2"), (-1200, 200, 1.00, "Mid_3"),
    (0, 1400, 1.60, "High_Center"), (1500, 0, 1.40, "High_E"), (-1500, 0, 1.40, "High_W"),
]
for x, y, h, name in cover_specs:
    box((x, y, h * 50.0), (2.2, 1.4, h), "ArenaCover_%s" % name, "cover", COVER_COL)
    # A single emissive lip along the top edge makes cover height readable at a glance.
    box((x, y, h * 100.0 + 3), (2.24, 1.44, 0.06), "ArenaCoverTrim_%s" % name, "energy", dim(NEON, 0.6), 1.8)

box((0, 400, 120), (5, 5, 2.4), "ArenaCover_Central", "cover", COVER_COL)
box((0, 400, 245), (5.1, 5.1, 0.08), "ArenaCoverTrim_Central", "energy", dim(NEON, 0.7), 2.4)

# --- 5. Elevated deck with a stepped approach ------------------------------------------------------
box((1300, -1200, 160), (5, 5, 0.35), "ArenaElevated_Deck", "cover", COVER_COL)
box((1300, -1200, 180), (5.1, 5.1, 0.06), "ArenaElevated_DeckTrim", "energy", dim(NEON, 0.6), 2.0)
for i, (sx, height) in enumerate([(0, 45), (1, 90), (2, 135)]):
    box((1030 + sx * 90, -1200, height / 2.0), (0.9, 5, height / 100.0),
        "Step_%d" % i, "cover", COVER_COL)
box((1300, -1200, 300), (1.2, 1.2, 1.4), "ArenaCover_Deck", "cover", COVER_COL)

# --- 6. Team spawn zones ----------------------------------------------------------------------------
spawns = [("Red", 0, -1700, 90), ("Blue", 0, 1700, -90), ("Green", -1700, 0, 0), ("Yellow", 1700, 0, 180)]
for team, x, y, yaw in spawns:
    colour = TEAM[team]
    pad_colour = dim(colour, 0.20)
    box((x, y, 2), (6, 6, 0.03), "SpawnPad_%s" % team, "cover", pad_colour, 0.0)
    # Team identity comes from a bright edge, not from a glowing floor slab.
    for j, (ox, oy, sx, sy) in enumerate([(0, 300, 6, 0.1), (0, -300, 6, 0.1),
                                          (300, 0, 0.1, 6), (-300, 0, 0.1, 6)]):
        box((x + ox, y + oy, 4), (sx, sy, 0.04), "SpawnStrip_%s_%d" % (team, j), "energy", colour, 4.0)
    box((x, y, 200), (0.35, 0.35, 4.0), "SpawnPylon_%s" % team, "structure", STRUCTURE_LIGHT)
    box((x, y, 400), (0.42, 0.42, 0.12), "SpawnStrip_%s_Top" % team, "energy", colour, 5.0)

# --- 7. Target pedestals and targets -----------------------------------------------------------------
target_cls = unreal.load_class(None, "/Script/Photon.PhotonTarget")
target_positions = [(0, 600), (700, 1300), (-800, 1600), (400, 2000 - 300), (-900, 400)]
for i, (x, y) in enumerate(target_positions):
    ped = spawn(unreal.StaticMeshActor, (x, y, 45))
    ped.set_actor_label("Pedestal_%d" % i)
    ped.set_actor_scale3d(unreal.Vector(0.9, 0.9, 0.9))
    ped.static_mesh_component.set_static_mesh(CYL)
    ped.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    surface(ped, "structure", STRUCTURE_LIGHT)
    box((x, y, 93), (1.0, 1.0, 0.06), "Pedestal_%d_Trim" % i, "energy", dim(NEON, 0.7), 2.4)
    if target_cls:
        t = spawn(target_cls, (x, y, 180))
        t.set_actor_label("ArenaTarget_%d" % i)

# --- 8. Signage / scoreboard placeholders ------------------------------------------------------------
for i, (x, y, yaw) in enumerate([(0, HALF - 12, 0), (0, -(HALF - 12), 0)]):
    box((x, y, 470), (11, 0.2, 2.6), "SignageBody_%d" % i, "structure", STRUCTURE, yaw=yaw)
    box((x, y - 6 if i == 0 else y + 6, 470), (10.4, 0.1, 2.2), "Signage_%d" % i, "energy", dim(NEON, 0.35), 1.4,
        yaw=yaw)

# --- 9. Lighting environment ---------------------------------------------------------------------------
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
        # Was pitch=90: the player spawned looking straight up at the sky.
        a.set_actor_location_and_rotation(
            unreal.Vector(0, -1700, 120), unreal.Rotator(roll=0.0, pitch=0.0, yaw=90.0),
            False, False)
        say("playerstart corrected to pitch=0 yaw=90")

existing = {a.get_actor_label() for a in subsys.get_all_level_actors()}

if "PhotonPostProcess" not in existing:
    ppv = spawn(unreal.PostProcessVolume, (0, 0, 300))
    ppv.set_actor_label("PhotonPostProcess")
else:
    ppv = next(a for a in subsys.get_all_level_actors() if a.get_actor_label() == "PhotonPostProcess")
ppv.set_editor_property("unbound", True)
s = ppv.get_editor_property("settings")
# Exposure is deliberately NOT set here. Pinning it on this volume was measured across a ten stop
# sweep and changed nothing at all, so it lives on the player camera instead
# (PhotonVisuals::ApplyArenaPostProcess, photon.Exposure). Leaving dead exposure overrides in the
# level would just send the next person looking in the wrong place.
s.set_editor_property("override_bloom_intensity", True)
s.set_editor_property("bloom_intensity", BLOOM)
s.set_editor_property("override_vignette_intensity", True)
s.set_editor_property("vignette_intensity", 0.32)
ppv.set_editor_property("settings", s)
say("postprocess bloom=%.2f (exposure is owned by the camera)" % BLOOM)

if "PhotonFog" not in existing:
    fog = spawn(unreal.ExponentialHeightFog, (0, 0, 0))
    fog.set_actor_label("PhotonFog")
    fc = fog.component
    fc.set_editor_property("fog_density", 0.008)
    fc.set_editor_property("fog_height_falloff", 0.6)
    fc.set_editor_property("fog_inscattering_luminance", unreal.LinearColor(0.02, 0.05, 0.09, 1.0))
    say("fog added")

unreal.EditorLevelLibrary.save_current_level()

actors = subsys.get_all_level_actors()
say("final_actor_count=%d" % len(actors))
say("static_meshes=%d" % len([a for a in actors if isinstance(a, unreal.StaticMeshActor)]))
say("rect_lights=%d" % len([a for a in actors if isinstance(a, unreal.RectLight)]))
say("targets=%d" % len([a for a in actors if a.get_class().get_name() == "PhotonTarget"]))

with open(unreal.Paths.project_saved_dir() + "Logs/photon_arena_build.txt", "w") as f:
    f.write("\n".join(report))
