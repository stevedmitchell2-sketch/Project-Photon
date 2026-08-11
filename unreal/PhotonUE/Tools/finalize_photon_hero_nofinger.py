"""Normalize anim asset names after FBX import. Socket is created at runtime in C++."""
from __future__ import annotations

import json
from pathlib import Path

import unreal

DEST = "/Game/Photon/Characters/Hero"
REPORT = {"renames": [], "anims": [], "errors": []}


def log(msg: str) -> None:
    unreal.log(f"[PhotonHeroFinalize] {msg}")


def rename_anims() -> None:
    mapping = {
        "Idle": "A_PhotonHero_Idle",
        "Walk": "A_PhotonHero_Walk",
        "Run": "A_PhotonHero_Run",
        "Sprint": "A_PhotonHero_Sprint",
    }
    # Prefer shortest/canonical: rename SKA_ names first, skip Armature duplicates if canonical exists.
    assets = unreal.EditorAssetLibrary.list_assets(DEST, recursive=False, include_folder=False)
    for path in assets:
        asset = unreal.EditorAssetLibrary.load_asset(path)
        if not asset or asset.get_class().get_name() != "AnimSequence":
            continue
        name = asset.get_name()
        REPORT["anims"].append(path)
        for key, desired in mapping.items():
            if desired == name:
                break
            if key not in name:
                continue
            # Avoid matching "Run" inside "Sprint" — require suffix match preference
            if key == "Run" and "Sprint" in name:
                continue
            dest = f"{DEST}/{desired}"
            if unreal.EditorAssetLibrary.does_asset_exist(dest):
                log(f"canonical exists, leaving {name}")
                break
            if unreal.EditorAssetLibrary.rename_asset(path, dest):
                REPORT["renames"].append({"from": path, "to": dest})
                log(f"renamed {name} -> {desired}")
            break


def main() -> None:
    rename_anims()
    out = Path(unreal.Paths.project_content_dir()) / "Photon" / "Characters" / "Hero" / "photon_hero_finalize_report.json"
    out.write_text(json.dumps(REPORT, indent=2), encoding="utf-8")
    log(f"report -> {out}")
    log("OK")


if __name__ == "__main__":
    main()
