"""Run build_photon_arena.py against a stub `unreal` module and audit the result offline.

Two things this catches without opening the editor:

  1. Python faults in the build script. The `dim` shadowing bug in the last pass only surfaced
     after a full editor launch, which is a slow way to find a NameError.
  2. Actor labels that no rule in PhotonVisuals::BootstrapArenaVisuals matches. An unmatched actor
     keeps whatever material it was placed with and never gets retinted at runtime, which is the
     exact failure that produced the white arena. The rule table and the build script have to agree,
     and nothing but this check enforces that.

The stub is deliberately shallow: it records what the script asks for and returns plausible objects.
It proves the script's logic and naming, not that Unreal does what the script expects.

Usage:  python Tools/audit_arena_labels.py
"""
import os
import re
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BUILD_SCRIPT = os.path.join(HERE, "build_photon_arena.py")
VISUALS_CPP = os.path.join(ROOT, "Source", "Photon", "PhotonVisuals.cpp")


# --- the stub engine ----------------------------------------------------------------------------

class Vector:
    def __init__(self, x=0.0, y=0.0, z=0.0):
        self.x, self.y, self.z = x, y, z


class Rotator:
    def __init__(self, roll=0.0, pitch=0.0, yaw=0.0):
        self.roll, self.pitch, self.yaw = roll, pitch, yaw


class LinearColor:
    def __init__(self, r=0.0, g=0.0, b=0.0, a=1.0):
        self.r, self.g, self.b, self.a = r, g, b, a


class Color:
    def __init__(self, r=0, g=0, b=0, a=255):
        self.r, self.g, self.b, self.a = r, g, b, a


class Asset:
    def __init__(self, path):
        self.path = path

    def get_path_name(self):
        return self.path


class PropertyBag:
    """Anything driven purely through set_editor_property/get_editor_property."""

    def __init__(self):
        self._props = {}

    def set_editor_property(self, name, value):
        self._props[name] = value

    def get_editor_property(self, name):
        return self._props.get(name)

    def __getattr__(self, name):
        return lambda *a, **k: None


class MeshComponent(PropertyBag):
    def __init__(self):
        super().__init__()
        self.static_mesh = None
        self.materials = {}

    def set_static_mesh(self, mesh):
        self.static_mesh = mesh

    def get_num_materials(self):
        return 1

    def set_material(self, slot, mat):
        self.materials[slot] = mat

    def create_dynamic_material_instance(self, slot):
        return PropertyBag()

    def set_mobility(self, mobility):
        pass


class Actor(PropertyBag):
    def __init__(self, world, location=None, rotation=None):
        super().__init__()
        self._world = world
        self.location = location
        self.rotation = rotation
        self.label = self.__class__.__name__
        self.folder = ""
        self.scale = None
        self.static_mesh_component = MeshComponent()
        for comp in ("rect_light_component", "spot_light_component", "point_light_component",
                     "light_component", "component"):
            setattr(self, comp, PropertyBag())

    def set_actor_label(self, label):
        self.label = label

    def get_actor_label(self):
        return self.label

    def set_folder_path(self, path):
        self.folder = path

    def get_folder_path(self):
        return self.folder

    def set_actor_scale3d(self, scale):
        self.scale = scale

    def set_actor_location_and_rotation(self, *a, **k):
        pass

    def get_class(self):
        return ClassHandle(type(self).__name__)


class ClassHandle:
    def __init__(self, name):
        self.name = name

    def get_name(self):
        return self.name


class StaticMeshActor(Actor):
    pass


class RectLight(Actor):
    pass


class SpotLight(Actor):
    pass


class PointLight(Actor):
    pass


class DirectionalLight(Actor):
    pass


class SkyLight(Actor):
    pass


class PlayerStart(Actor):
    pass


class PostProcessVolume(Actor):
    def get_editor_property(self, name):
        if name == "settings":
            return self._props.setdefault("settings", PropertyBag())
        return super().get_editor_property(name)


class ExponentialHeightFog(Actor):
    pass


class PhotonTarget(Actor):
    pass


class EditorActorSubsystem:
    def __init__(self):
        self.actors = []

    def spawn_actor_from_class(self, cls, location=None, rotation=None):
        actor = cls(self, location, rotation)
        self.actors.append(actor)
        return actor

    def get_all_level_actors(self):
        return list(self.actors)

    def destroy_actor(self, actor):
        if actor in self.actors:
            self.actors.remove(actor)


SUBSYSTEM = EditorActorSubsystem()
# The real level already contains these; several branches of the build script only run if they do.
for seeded in (DirectionalLight, SkyLight, PlayerStart):
    SUBSYSTEM.spawn_actor_from_class(seeded)


def build_stub_module(saved_dir):
    u = types.ModuleType("unreal")
    for cls in (Vector, Rotator, LinearColor, Color, StaticMeshActor, RectLight, SpotLight,
                PointLight, DirectionalLight, SkyLight, PlayerStart, PostProcessVolume,
                ExponentialHeightFog, EditorActorSubsystem):
        setattr(u, cls.__name__, cls)

    class Enum:
        def __getattr__(self, name):
            return name

    u.ComponentMobility = Enum()
    u.LightUnits = Enum()
    u.EditorAssetLibrary = types.SimpleNamespace(load_asset=lambda path: Asset(path))
    u.EditorLoadingAndSavingUtils = types.SimpleNamespace(load_map=lambda path: None)
    u.EditorLevelLibrary = types.SimpleNamespace(save_current_level=lambda: None)
    u.Paths = types.SimpleNamespace(project_saved_dir=lambda: saved_dir)
    u.get_editor_subsystem = lambda cls: SUBSYSTEM
    u.load_class = lambda outer, path: PhotonTarget
    return u


# --- the C++ rule table -------------------------------------------------------------------------

def parse_rules(path):
    """Pull the tokens out of the FArenaRule table, in declaration order."""
    src = open(path, encoding="utf-8").read()
    start = src.index("const FArenaRule Rules[] = {")
    end = src.index("\n\t};", start)
    return re.findall(r'\{\s*TEXT\("([^"]+)"\)', src[start:end])


def parse_palette(path):
    """Palette::Structure() and friends, as {name: (r, g, b)}."""
    src = open(path, encoding="utf-8").read()
    found = re.findall(
        r"Palette::(\w+)\(\)\s*\{\s*return FLinearColor\(([\d.]+)f,\s*([\d.]+)f,\s*([\d.]+)f\)",
        src)
    return {name: (float(r), float(g), float(b)) for name, r, g, b in found}


def check_palette(namespace, cpp_palette):
    """The build script and the runtime have to agree, or the viewport lies about every surface."""
    pairs = [("Structure", "STRUCTURE"), ("Floor", "FLOOR_COL"), ("Cover", "COVER_COL"),
             ("Metal", "METAL_COL"), ("Energy", "NEON")]
    bad = 0
    for cpp_name, py_name in pairs:
        cpp = cpp_palette.get(cpp_name)
        py = namespace.get(py_name)
        if cpp is None or py is None:
            print("  ?? %-10s missing (cpp=%s py=%s)" % (cpp_name, cpp is not None, py is not None))
            bad += 1
            continue
        got = (py.r, py.g, py.b)
        same = all(abs(a - b) < 1e-6 for a, b in zip(cpp, got))
        print("  %s %-10s cpp=%s py=%s" % ("OK" if same else "!!", cpp_name, cpp, got))
        bad += 0 if same else 1
    return bad


def classify(label, tokens):
    for token in tokens:
        if token in label:
            return token
    return None


# --- run ----------------------------------------------------------------------------------------

def main():
    # The build script writes its report under project_saved_dir; send that to a scratch directory
    # so an audit run leaves nothing behind in the repository.
    saved = tempfile.mkdtemp(prefix="photon_audit_") + os.sep
    os.makedirs(os.path.join(saved, "Logs"), exist_ok=True)
    sys.modules["unreal"] = build_stub_module(saved)

    source = open(BUILD_SCRIPT, encoding="utf-8").read()
    namespace = {"__name__": "__main__", "__file__": BUILD_SCRIPT}
    exec(compile(source, BUILD_SCRIPT, "exec"), namespace)

    print("=== build script report ===")
    for line in namespace.get("report", []):
        print("  " + line)

    print("\n=== palette parity: build script vs PhotonVisuals::Palette ===")
    palette_bad = check_palette(namespace, parse_palette(VISUALS_CPP))

    tokens = parse_rules(VISUALS_CPP)
    print("\n=== rule table: %d tokens ===" % len(tokens))

    meshes = [a for a in SUBSYSTEM.get_all_level_actors() if isinstance(a, StaticMeshActor)]
    unmatched, used = [], {}
    for actor in meshes:
        token = classify(actor.label, tokens)
        if token is None:
            unmatched.append(actor.label)
        else:
            used.setdefault(token, []).append(actor.label)

    print("static mesh actors placed: %d" % len(meshes))
    print("matched by a rule:         %d" % (len(meshes) - len(unmatched)))

    print("\n=== UNMATCHED (these keep their placed material, never retinted) ===")
    if unmatched:
        for label in sorted(set(unmatched)):
            print("  !! " + label)
    else:
        print("  none")

    # Shadowing: a label matching several tokens is fine when the winner is the specific one, and a
    # bug when a short generic token declared higher up steals it. "Panel" sat above the floor block
    # and captured CourtPanelA, retinting the court as structure. Flag any win by a token shorter
    # than another candidate, which is the shape that mistake always takes.
    print("\n=== SHADOWED (a later, more specific rule was outranked) ===")
    shadowed = []
    for actor in meshes:
        candidates = [t for t in tokens if t in actor.label]
        if len(candidates) > 1:
            winner = candidates[0]
            longer = [t for t in candidates[1:] if len(t) > len(winner)]
            if longer:
                shadowed.append((actor.label, winner, longer))
    if shadowed:
        for label, winner, longer in shadowed:
            print("  !! %-24s won by %-16s over %s" % (label, winner, ", ".join(longer)))
    else:
        print("  none")

    print("\n=== rules that never matched anything ===")
    dead = [t for t in tokens if t not in used]
    for token in dead:
        print("  -- " + token)

    print("\n=== rule -> actor count ===")
    for token in tokens:
        if token in used:
            print("  %-22s %3d   e.g. %s" % (token, len(used[token]), used[token][0]))

    return 1 if (unmatched or shadowed or palette_bad) else 0


if __name__ == "__main__":
    sys.exit(main())
