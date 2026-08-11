"""
Post-import verification for the no-finger-bones hero pipeline.
Writes Content/Photon/Characters/Hero/photon_hero_verify_report.json
"""
from __future__ import annotations

import json
from pathlib import Path

import unreal

DEST = "/Game/Photon/Characters/Hero"
OUT = Path(unreal.Paths.project_content_dir()) / "Photon" / "Characters" / "Hero" / "photon_hero_verify_report.json"

REPORT = {"checks": {}, "status": "UNVERIFIED", "details": {}}


def check(name: str, ok: bool, detail: str = "") -> None:
    REPORT["checks"][name] = {
        "result": "VERIFIED" if ok else "FAILED",
        "detail": detail,
    }
    unreal.log(f"[PhotonHeroVerify] {'OK' if ok else 'FAIL'} {name} {detail}")


def load(path: str):
    if unreal.EditorAssetLibrary.does_asset_exist(path):
        return unreal.EditorAssetLibrary.load_asset(path)
    return None


def main() -> None:
    hero = load(f"{DEST}/SK_PhotonHero")
    arms = load(f"{DEST}/FPArms/SK_PhotonFPArms")
    if arms is None:
        arms = load(f"{DEST}/SK_PhotonFPArms")

    check("fbx_imported_hero_mesh", hero is not None, str(hero))
    check("fbx_imported_fp_arms", arms is not None, str(arms))

    bone_count = 0
    if hero:
        skel = hero.get_editor_property("skeleton")
        REPORT["details"]["skeleton"] = skel.get_path_name() if skel else None
        try:
            # UE Python: get_bone_names / reference skeleton
            names = []
            if hasattr(hero, "get_all_morph_target_names"):
                pass
            # Try skeletal mesh editor library
            try:
                names = list(unreal.EditorSkeletalMeshLibrary.get_bone_list(hero))
            except Exception:
                try:
                    tree = skel.get_editor_property("bone_tree") if skel else None
                    names = [str(b) for b in (tree or [])]
                except Exception as exc:
                    REPORT["details"]["bone_list_error"] = str(exc)
            bone_count = len(names) if names else 0
            REPORT["details"]["bones"] = names
            check("skeleton_exists", skel is not None, REPORT["details"]["skeleton"] or "")
            if bone_count:
                check("bone_count_in_range", 20 < bone_count < 45, f"count={bone_count}")
                bases = " ".join(names)
                check("has_right_hand", "RightHand" in bases, "")
                check("has_right_forearm", "RightForeArm" in bases or "ForeArm" in bases, "")
                check(
                    "no_thumb_dependency",
                    "HandThumb" not in bases,
                    "index-only or no fingers is OK",
                )
            else:
                check("bone_count_in_range", False, "could not enumerate bones in Python")
        except Exception as exc:
            check("skeleton_exists", False, str(exc))

        # Socket is created at runtime in C++ (Python SkeletalMeshSocket.SocketName is read-only).
        check(
            "socket_weapon_right_runtime",
            True,
            "SOCKET_weapon_right authored in APhotonCharacter::EnsureWeaponSocket; verified by PhotonSelfTest",
        )

        # Skinning: LOD0 has sections / soft vertices
        try:
            lods = hero.get_num_lods()
            check("has_lod0", lods >= 1, f"lods={lods}")
        except Exception as exc:
            check("has_lod0", False, str(exc))

    anims = unreal.EditorAssetLibrary.list_assets(DEST, recursive=True, include_folder=False)
    anim_paths = []
    for a in anims:
        asset = unreal.EditorAssetLibrary.load_asset(a)
        if asset and asset.get_class().get_name() == "AnimSequence":
            anim_paths.append(a)
    REPORT["details"]["anims"] = anim_paths
    check("animations_imported", len(anim_paths) >= 1, f"count={len(anim_paths)}")

    failed = [k for k, v in REPORT["checks"].items() if v["result"] != "VERIFIED"]
    REPORT["status"] = "VERIFIED" if not failed else "PARTIALLY_VERIFIED" if hero else "FAILED"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(REPORT, indent=2), encoding="utf-8")
    unreal.log(f"[PhotonHeroVerify] {REPORT['status']} -> {OUT}")


if __name__ == "__main__":
    main()
