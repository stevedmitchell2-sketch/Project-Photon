"""Expand L_PhotonGrey with additional lanes, cover, elevation, and target positions.

Idempotent: skips actors whose labels already exist so fix_lighting can run afterward without
duplicating geometry.
"""
import unreal

MAP = "/Game/Photon/Maps/L_PhotonGrey"
CUBE = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube")


def existing_labels():
    return {a.get_actor_label() for a in unreal.EditorLevelLibrary.get_all_level_actors()}


def box(loc, scale, label, labels):
    if label in labels:
        unreal.log("PHOTONARENA skip existing %s" % label)
        return None
    a = unreal.EditorLevelLibrary.spawn_actor_from_class(
        unreal.StaticMeshActor, unreal.Vector(*loc), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
    a.set_actor_label(label)
    a.set_actor_scale3d(unreal.Vector(*scale))
    a.static_mesh_component.set_static_mesh(CUBE)
    a.static_mesh_component.set_mobility(unreal.ComponentMobility.STATIC)
    labels.add(label)
    return a


unreal.EditorLoadingAndSavingUtils.load_map(MAP)
labels = existing_labels()

# --- Mid lane dividers (close/mid engagement) ---------------------------------------------------
for i, (x, y, h) in enumerate([
    (300, 800, 1.0), (-350, 950, 1.4), (650, 450, 0.8), (-750, 350, 1.0),
    (1100, 900, 1.6), (-1200, 1100, 0.7), (200, 1500, 1.2), (-400, 1700, 1.0),
]):
    box((x, y, h * 50 - 50), (2.5, 1.2, h), "LaneCover_%d" % i, labels)

# --- Far lane walls (partial, for sightlines) ---------------------------------------------------
for i, (x, y, sx, sy) in enumerate([
    (1600, 600, 1, 8), (-1600, 600, 1, 8), (0, 1800, 12, 1),
]):
    box((x, y, 120), (sx, sy, 2.4), "FarWall_%d" % i, labels)

# --- Elevated sniper perch --------------------------------------------------------------------
box((1300, -1200, 180), (4, 4, 0.4), "PerchDeck", labels)
box((1300, -1200, 320), (1.5, 1.5, 1.8), "PerchCover", labels)

# --- Side lanes for strafing ------------------------------------------------------------------
for i, x in enumerate([1800, -1800]):
    box((x, 0, -25), (1.5, 30, 0.2), "SideLane_%d" % i, labels)

# --- Additional targets at varied ranges ------------------------------------------------------
tcls = unreal.load_class(None, "/Script/Photon.PhotonTarget")
if tcls:
    for i, (x, y) in enumerate([
        (400, 2000), (-900, 400), (1500, 300), (-1500, -600), (0, -400),
    ]):
        label = "ArenaTarget_%d" % i
        if label in labels:
            continue
        t = unreal.EditorLevelLibrary.spawn_actor_from_class(
            tcls, unreal.Vector(x, y, 140), unreal.Rotator(roll=0.0, pitch=0.0, yaw=0.0))
        if t:
            t.set_actor_label(label)
            labels.add(label)

unreal.EditorLevelLibrary.save_current_level()
actors = unreal.EditorLevelLibrary.get_all_level_actors()
unreal.log("PHOTONARENA total_actors=%d static=%d"
           % (len(actors), len([a for a in actors if isinstance(a, unreal.StaticMeshActor)])))
