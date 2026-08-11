"""Lightweight binary FBX inspector (no Blender/assimp required)."""
import struct
import zlib
import sys

path = sys.argv[1] if len(sys.argv) > 1 else (
    r"c:\Users\Home\Downloads\tripo_convert_2259b18c-7904-4bb7-bcaf-3ab3fbe3736a.fbx"
)
data = open(path, "rb").read()
print("size_mb", round(len(data) / 1024 / 1024, 2))
print("header", data[:21])
ver = struct.unpack_from("<I", data, 23)[0]
print("fbx_version", ver)


def parse_props(buf, offset, num_props, prop_list_len):
    end = offset + prop_list_len
    props = []
    for _ in range(num_props):
        if offset >= end:
            break
        t = chr(buf[offset])
        offset += 1
        if t == "Y":
            v = struct.unpack_from("<h", buf, offset)[0]
            offset += 2
            props.append(v)
        elif t == "C":
            props.append(buf[offset])
            offset += 1
        elif t == "I":
            v = struct.unpack_from("<i", buf, offset)[0]
            offset += 4
            props.append(v)
        elif t == "L":
            v = struct.unpack_from("<q", buf, offset)[0]
            offset += 8
            props.append(v)
        elif t == "F":
            v = struct.unpack_from("<f", buf, offset)[0]
            offset += 4
            props.append(v)
        elif t == "D":
            v = struct.unpack_from("<d", buf, offset)[0]
            offset += 8
            props.append(v)
        elif t in ("S", "R"):
            n = struct.unpack_from("<I", buf, offset)[0]
            offset += 4
            raw = buf[offset : offset + n]
            offset += n
            props.append(raw.decode("utf-8", "ignore") if t == "S" else ("bytes", n))
        elif t in ("i", "l", "f", "d", "b"):
            length, encoding, comp_len = struct.unpack_from("<III", buf, offset)
            offset += 12
            raw = buf[offset : offset + comp_len]
            offset += comp_len
            if encoding == 1:
                raw = zlib.decompress(raw)
            props.append(("array", t, length, raw))
        else:
            props.append(("bad", t))
            break
    return props


def read_tree(buf, offset, version):
    if version >= 7500:
        end_offset, num_props, prop_list_len = struct.unpack_from("<QQQ", buf, offset)
        hoff = 24
    else:
        end_offset, num_props, prop_list_len = struct.unpack_from("<III", buf, offset)
        hoff = 12
    if end_offset == 0:
        return None, offset + hoff
    o = offset + hoff
    name_len = buf[o]
    o += 1
    name = buf[o : o + name_len].decode("ascii", "ignore")
    o += name_len
    props = parse_props(buf, o, num_props, prop_list_len)
    o = o + prop_list_len
    children = []
    while o < end_offset:
        child, o = read_tree(buf, o, version)
        if child is None:
            break
        children.append(child)
    return {"name": name, "props": props, "children": children}, end_offset


root = []
off = 27
while off < len(data):
    node, off = read_tree(data, off, ver)
    if node is None:
        break
    root.append(node)

print("top_nodes", [n["name"] for n in root])


def find(nodes, pred, out=None):
    if out is None:
        out = []
    for n in nodes:
        if pred(n):
            out.append(n)
        find(n["children"], pred, out)
    return out


geoms = find(root, lambda n: n["name"] == "Geometry")
models = find(root, lambda n: n["name"] == "Model")
mats = find(root, lambda n: n["name"] == "Material")
print("geometry_nodes", len(geoms))
print("model_nodes", len(models))
print("material_nodes", len(mats))

for m in models:
    strs = [p for p in m["props"] if isinstance(p, str)]
    if strs:
        print("Model", strs)

for m in mats:
    strs = [p for p in m["props"] if isinstance(p, str)]
    if strs:
        print("Material", strs)

files = []
for n in find(root, lambda n: n["name"] in ("RelativeFilename", "FileName", "Filename")):
    for p in n["props"]:
        if isinstance(p, str) and p.strip():
            files.append(p)
print("embedded_or_ref_files", list(dict.fromkeys(files))[:40])


def bbox_from_vertices(raw):
    vals = struct.unpack("<%dd" % (len(raw) // 8), raw)
    xs, ys, zs = vals[0::3], vals[1::3], vals[2::3]
    return (
        (min(xs), min(ys), min(zs)),
        (max(xs), max(ys), max(zs)),
        len(xs),
    )


def count_tris(raw_indices):
    idx = struct.unpack("<%di" % (len(raw_indices) // 4), raw_indices)
    polys = []
    cur = []
    for v in idx:
        if v < 0:
            cur.append(~v)  # bitwise not recovers index
            polys.append(cur)
            cur = []
        else:
            cur.append(v)
    tris = 0
    for p in polys:
        if len(p) >= 3:
            tris += len(p) - 2
    return len(polys), tris


for g in geoms:
    strs = [p for p in g["props"] if isinstance(p, str)]
    print("--- Geometry", strs)
    verts = pvi = uvs = None
    for c in g["children"]:
        if c["name"] == "Vertices":
            for p in c["props"]:
                if isinstance(p, tuple) and p[0] == "array":
                    mn, mx, n = bbox_from_vertices(p[3])
                    verts = n
                    print("  verts", n)
                    print("  bbox_min", tuple(round(x, 4) for x in mn))
                    print("  bbox_max", tuple(round(x, 4) for x in mx))
                    dx, dy, dz = mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]
                    print("  size", (round(dx, 4), round(dy, 4), round(dz, 4)))
                    # height heuristic: largest axis often Y or Z depending on exporter
                    print("  max_extent", round(max(dx, dy, dz), 4))
        if c["name"] == "PolygonVertexIndex":
            for p in c["props"]:
                if isinstance(p, tuple) and p[0] == "array":
                    polys, tris = count_tris(p[3])
                    pvi = (polys, tris)
                    print("  polygons", polys, "triangles", tris)
        if c["name"] == "LayerElementUV":
            for u in c["children"]:
                if u["name"] == "UV":
                    for p in u["props"]:
                        if isinstance(p, tuple) and p[0] == "array":
                            uvs = p[2] // 2
                            print("  uv_coords", uvs)
    if verts and pvi:
        print("  density_tris_per_vert", round(pvi[1] / max(verts, 1), 2))
