"""T10 Arena Foundation — upgrade L_PhotonGrey from greybox to recognizable Photon arena.

Architecture first: perimeter shell, competition floor, deliberate cover, elevated perch,
team spawn pads, energy strips, target pedestals. Idempotent via actor labels.

Photon visual language: premium sports facility, clean architecture, controlled neon,
team identity — not military warehouse or junkyard sci-fi.
"""
import unreal

MAP = "/Game/Photon/Maps/L_PhotonGrey"
CUBE = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")
CYL = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cylinder")

# Team colours (linear) — subtle spawn identity, not neon overload.
TEAM = {
    "Red": unreal.LinearColor(0.95, 0.22, 0.18, 1.0),
    "Green": unreal.LinearColor(0.18, 0.88, 0.42, 1.0),
    "Blue": unreal.LinearColor(0.22, 0.55, 1.0, 1.0),
    "Yellow": unreal.LinearColor(0.98, 0.82, 0.18, 1.0),
}
NEON = unreal.LinearColor(0.35, 0.82, 1.0, 1.0)
FLOOR = unreal.LinearColor(0.08, 0.09, 0.12, 1.0)
WALL = unreal.LinearColor(0.14, 0.15, 0.18, 1.0)
COVER = unreal.LinearColor(0.18, 0.20, 0.24, 1.0)

MATS = {
    "structure": "/Game/Photon/Materials/M_PhotonSolid",
    "floor": "/Game/Photon/Materials/M_PhotonSolid",
    "cover": "/Game/Photon/Materials/M_PhotonSolid",
    "energy": "/Game/Photon/Materials/M_PhotonEnergy",
    "target": "/Game/Photon/Materials/M_PhotonEnergy",
}


def apply_mat(actor, role, color=None, emissive=0.0):
    sm = actor.static_mesh_component
    parent_path = MATS.get(role, MATS["structure"])
    parent = unreal.EditorAssetLibrary.load_asset(parent_path)
    if parent:
        sm.set_material(0, parent)
        mid = sm.create_dynamic_material_instance(0)
        if mid:
            em = emissive if emissive > 0.0 else (2.0 if role in ("energy", "target") else 0.15)
            if color:
                s = 1.0 + em
                c = unreal.LinearColor(color.r * s, color.g * s, color.b * s, 1.0)
                mid.set_vector_parameter_value("TintColor", c)
            mid.set_scalar_parameter_value("EmissiveStrength", em)
        return
    if color:
        tint(actor, color, emissive)


def existing_labels():
    return {a.get_actor_label() for a in unreal.EditorLevelLibrary.get_all_level_actors()}


def tint(actor, color, emissive_scale=0.0):
    sm = actor.static_mesh_component
    base = unreal.EditorAssetLibrary.load_asset("/Game/Photon/Materials/M_PhotonSolid")
    if not base:
        base = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/BasicShapeMaterial")
    if base:
        sm.set_material(0, base)
    mid = sm.create_dynamic_material_instance(0)
    if not mid:
        return
    s = 1.0 + emissive_scale
    c = unreal.LinearColor(color.r * s, color.g * s, color.b * s, 1.0)
    mid.set_vector_parameter_value("TintColor", c)
    mid.set_scalar_parameter_value("EmissiveStrength", emissive_scale)


def box(loc, scale, label, labels, role="structure", color=None, emissive=0.0):
    if label in labels:
        unreal.log("PHOTONARENA skip %s" % label)
        return None
    a = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(*loc), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
    a.set_actor_label(label)
    a.set_actor_scale3d(unreal.Vector(*scale))
    a.static_mesh_component.set_static_mesh(CUBE)
    a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    apply_mat(a, role, color, emissive)
    labels.add(label)
    return a


def pedestal(loc, label, labels):
    if label in labels:
        return None
    a = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(*loc), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
    a.set_actor_label(label)
    a.set_actor_scale3d(unreal.Vector(0.9, 0.9, 0.25))
    a.static_mesh_component.set_static_mesh(CYL)
    a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    apply_mat(a, "target")
    labels.add(label)
    return a


unreal.EditorLoadingAndSavingUtils.load_map(MAP)
labels = existing_labels()

# --- 1. Arena perimeter shell (architectural rim above existing walls) -------------------------
for i, (x, y, sx, sy, h) in enumerate([
    (0, 2050, 42, 1.2, 3.5), (0, -2050, 42, 1.2, 3.5),
    (2050, 0, 1.2, 42, 3.5), (-2050, 0, 1.2, 42, 3.5),
]):
    box((x, y, h * 50), (sx, sy, h), "ArenaShell_%d" % i, labels, "structure")

for i, (x, y) in enumerate([(2050, 2050), (-2050, 2050), (2050, -2050), (-2050, -2050)]):
    box((x, y, 220), (1.8, 1.8, 4.4), "ArenaShellCorner_%d" % i, labels, "structure")

# --- 2. Competition floor (designed surface over greybox) ------------------------------------
box((0, 0, -48), (38, 38, 0.08), "ArenaCompetitionFloor", labels, "floor")
box((0, 0, -46), (12, 12, 0.04), "ArenaCenterMark", labels, "energy")

# --- 3. Deliberate cover system ---------------------------------------------------------------
cover_specs = [
    # low barriers
    (600, 200, 0.45, "ArenaCover_Low_0"), (-700, 350, 0.45, "ArenaCover_Low_1"),
    (900, -500, 0.45, "ArenaCover_Low_2"), (-400, -900, 0.45, "ArenaCover_Low_3"),
    # waist-high
    (300, 900, 1.0, "ArenaCover_Mid_0"), (-500, 1100, 1.0, "ArenaCover_Mid_1"),
    (1100, 700, 1.0, "ArenaCover_Mid_2"), (-1200, 200, 1.0, "ArenaCover_Mid_3"),
    # tall / angled lane blockers
    (0, 1400, 1.6, "ArenaCover_High_Center"), (1500, 0, 1.4, "ArenaCover_High_E"),
    (-1500, 0, 1.4, "ArenaCover_High_W"),
]
for x, y, h, name in cover_specs:
    box((x, y, h * 50 - 50), (2.2, 1.4, h), name, labels, "cover")

# central structure
box((0, 400, 60), (5, 5, 1.2), "ArenaCover_Central", labels, "cover")

# --- 4. Elevated perch (designed platform + ramp + cover) ------------------------------------
box((1300, -1200, 160), (5, 5, 0.35), "ArenaElevated_Deck", labels, "structure")
box((1050, -1200, 80), (2.5, 5, 0.25), "ArenaElevated_Ramp", labels, "structure")
box((1300, -1200, 280), (1.2, 1.2, 1.6), "ArenaElevated_Cover", labels, "cover")

# --- 5. Team spawn zones -----------------------------------------------------------------------
spawns = [
    ("Red", 0, -1700, 90), ("Blue", 0, 1700, -90),
    ("Green", -1700, 0, 0), ("Yellow", 1700, 0, 180),
]
for team, x, y, yaw in spawns:
    box((x, y, -45), (6, 6, 0.06), "ArenaSpawn_%s" % team, labels, "structure", TEAM[team], 0.2)
    strip_label = "ArenaSpawnStrip_%s" % team
    if strip_label not in labels:
        s = unreal.EditorLevelLibrary.spawn_actor_from_class(
            unreal.StaticMeshActor, unreal.Vector(x, y, 30),
            unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(yaw)))
        s.set_actor_label(strip_label)
        s.set_actor_scale3d(unreal.Vector(6.5, 0.15, 0.08))
        s.static_mesh_component.set_static_mesh(CUBE)
        s.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
        apply_mat(s, "energy", TEAM[team], 0.55)
        labels.add(strip_label)

# --- 6. Energy / lighting strips (controlled neon, not everywhere) ---------------------------
for i, (x, y, yaw) in enumerate([
    (0, 1980, 0), (0, -1980, 0), (1980, 0, 90), (-1980, 0, 90),
]):
    label = "ArenaEnergyStrip_%d" % i
    if label in labels:
        continue
    s = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(x, y, 120),
        unreal.Rotator(roll=0.0, pitch=0.0, yaw=float(yaw)))
    s.set_actor_label(label)
    s.set_actor_scale3d(unreal.Vector(14, 0.12, 0.12))
    s.static_mesh_component.set_static_mesh(CUBE)
    s.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    apply_mat(s, "energy", NEON, 0.8)
    labels.add(label)

# --- 7. Target pedestals (intentional competition pylons) ------------------------------------
tcls = unreal.load_class(None, "/Script/Photon.PhotonTarget")
target_positions = [(0, 600), (700, 1300), (-800, 1600), (400, 2000), (-900, 400)]
for i, (x, y) in enumerate(target_positions):
    pedestal((x, y, 90), "ArenaTargetPedestal_%d" % i, labels)
    if tcls:
        label = "ArenaTarget_%d" % i
        if label not in labels:
            t = unreal.EditorLevelLibrary.spawn_actor_from_class(
                tcls, unreal.Vector(x, y, 140), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
            if t:
                t.set_actor_label(label)
                labels.add(label)

unreal.EditorLevelLibrary.save_current_level()

# --- Retint legacy greybox geometry still in the map -------------------------------------------
for a in unreal.EditorLevelLibrary.get_all_level_actors():
    if not isinstance(a, unreal.StaticMeshActor):
        continue
    label = a.get_actor_label()
    if label == "Floor":
        apply_mat(a, "floor")
    elif label.startswith("Wall"):
        apply_mat(a, "structure")
    elif label.startswith("Cover") or label.startswith("LaneCover"):
        apply_mat(a, "cover")
    elif label.startswith("Platform") or label.startswith("Perch"):
        apply_mat(a, "structure")

unreal.EditorLevelLibrary.save_current_level()
actors = unreal.EditorLevelLibrary.get_all_level_actors()
arena = len([a for a in actors if "Arena" in a.get_actor_label()])
unreal.log("PHOTONARENA foundation complete total=%d arena_labeled=%d" % (len(actors), arena))
