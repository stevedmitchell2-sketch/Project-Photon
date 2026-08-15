"""Measure the tour frames so "washed out" stops being an opinion.

Run outside the editor:  python Tools/photon_frame_stats.py

Reads every Photon_*.png in Saved/Screenshots/WindowsEditor and reports, per frame and overall:

  p01/p50/p99   luminance percentiles, 0-255. The gap between p01 and p99 is the arena's contrast.
  blown         fraction of pixels above 235. A premium venue has specular hits and light fixtures
                up there; it does not have a floor up there. Anything over ~4% is a blown pool.
  crushed       fraction below 12. Some is good, a lot means the bowl has gone to solid black.
  sat           mean HSV saturation. The palette is charcoal plus cyan plus two warm accents, so a
                reading near zero means the accents are not surviving exposure.
  hue split     share of pixels that are recognisably cyan / warm / neutral, which is the Photon
                identity check: neutral architecture, cyan energy, rationed amber.

The overlaid engine warning text is yellow-on-dark in the top 90 rows, so that band is excluded.
"""
import os
import sys

import numpy as np
from PIL import Image

SHOTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "Saved", "Screenshots", "WindowsEditor")
TOP_CROP = 90


def stats(path):
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)[TOP_CROP:] / 255.0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b

    hi = rgb.max(axis=-1)
    lo = rgb.min(axis=-1)
    sat = np.where(hi > 1e-4, (hi - lo) / np.maximum(hi, 1e-4), 0.0)

    lit = lum > 0.06                      # ignore the black roof void when judging colour
    cyan = lit & (sat > 0.18) & (b > r + 0.05) & (g > r + 0.02)
    warm = lit & (sat > 0.18) & (r > b + 0.06)
    coloured = cyan | warm

    p01, p50, p99 = np.percentile(lum, [1, 50, 99]) * 255.0
    return {
        "p01": p01, "p50": p50, "p99": p99,
        "blown": float((lum > 235 / 255.0).mean()),
        "crushed": float((lum < 12 / 255.0).mean()),
        "sat": float(sat[lit].mean()) if lit.any() else 0.0,
        "cyan": float(cyan.mean()), "warm": float(warm.mean()),
        "neutral": float((lit & ~coloured).mean()),
    }


def main():
    frames = sorted(f for f in os.listdir(SHOTS) if f.startswith("Photon_") and f.endswith(".png"))
    if not frames:
        print("no frames in %s" % SHOTS)
        return 1
    print("%-30s %5s %5s %5s %7s %8s %6s %6s %6s" %
          ("frame", "p01", "p50", "p99", "blown", "crushed", "sat", "cyan", "warm"))
    acc = []
    for name in frames:
        s = stats(os.path.join(SHOTS, name))
        acc.append(s)
        print("%-30s %5.0f %5.0f %5.0f %6.1f%% %7.1f%% %6.3f %5.1f%% %5.1f%%" %
              (name, s["p01"], s["p50"], s["p99"], s["blown"] * 100, s["crushed"] * 100,
               s["sat"], s["cyan"] * 100, s["warm"] * 100))
    mean = {k: sum(d[k] for d in acc) / len(acc) for k in acc[0]}
    print("-" * 84)
    print("%-30s %5.0f %5.0f %5.0f %6.1f%% %7.1f%% %6.3f %5.1f%% %5.1f%%" %
          ("MEAN", mean["p01"], mean["p50"], mean["p99"], mean["blown"] * 100,
           mean["crushed"] * 100, mean["sat"], mean["cyan"] * 100, mean["warm"] * 100))
    return 0


if __name__ == "__main__":
    sys.exit(main())
