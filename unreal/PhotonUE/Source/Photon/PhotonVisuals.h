#pragma once

#include "CoreMinimal.h"
#include "PhotonCore.h"

class UCameraComponent;
class UMaterialInterface;
class UPrimitiveComponent;
class UWorld;

/** Surface roles in the Photon arena. Each maps to one parent material. */
enum class EPhotonSurface : uint8
{
	/** Perimeter, shells, pedestals — dark graphite architecture. */
	Structure,
	/** Competition floor — darkest value, slightly glossy. */
	Floor,
	/** Cover volumes — lifted value so they read instantly against the floor. */
	Cover,
	/** Trusses, railings, the overhead rig — separated from graphite by specular, not by shade. */
	Metal,
	/** Unlit emissive accents — strips, markings, bolts, targets. */
	Energy,
};

/** Shared runtime material + first-person viewmodel setup for Photon. */
namespace PhotonVisuals
{
	/** Parent material for a surface role. Never null in a cooked-content project. */
	PHOTON_API UMaterialInterface* GetSurfaceMaterial(EPhotonSurface Role);

	/**
	 * True when the material is a Photon material rather than an engine fallback.
	 *
	 * Falling back to BasicShapeMaterial is silent and looks like success — every tint call still
	 * runs, it just has no parameter to write to. This is what the self-test asserts on.
	 */
	PHOTON_API bool IsPhotonMaterial(const UMaterialInterface* Material);

	/** Opaque structural surface. Retained for callers and tests that predate surface roles. */
	PHOTON_API UMaterialInterface* GetSolidMaterial();

	/** Emissive energy surface — bolts, strips, targets. */
	PHOTON_API UMaterialInterface* GetEnergyMaterial();

	/**
	 * Tint without replacing authored art.
	 *
	 * Only assigns a Photon parent when the slot is empty, so imported meshes such as the PH-6 keep
	 * their own textures. Use ApplySurface for greybox and proxy geometry instead.
	 */
	PHOTON_API void ApplyTint(UPrimitiveComponent* Component, FLinearColor Color, float EmissiveScale = 0.f);

	/**
	 * Force a Photon parent material onto proxy geometry, then tint it.
	 *
	 * Engine BasicShapes ship with BasicShapeMaterial already in slot 0, which has no TintColor
	 * parameter. ApplyTint therefore left every greybox surface the same default white while
	 * reporting success — this is the entry point that actually re-materials those meshes.
	 */
	PHOTON_API void ApplySurface(UPrimitiveComponent* Component, EPhotonSurface Role,
		FLinearColor Color, float EmissiveScale = 0.f);

	/** UE 5.8 first-person viewmodel flags for camera-attached owner-only geometry. */
	PHOTON_API void ConfigureFirstPersonViewModel(UPrimitiveComponent* Component);

	/** Enable UE 5.8 first-person rendering on the player camera. */
	PHOTON_API void ConfigureFirstPersonCamera(UCameraComponent* Camera);

	/**
	 * Pin exposure and bloom on the player camera.
	 *
	 * Exposure lives on the camera rather than in a PostProcessVolume or an ini entry because neither
	 * of those worked: the ini keys r.AutoExposure.MinBrightness/MaxBrightness are not real console
	 * variables (the engine logs "deferred - dummy variable created" and ignores them), and the level's
	 * unbound volume had no measurable effect across a ten stop sweep. Camera post process always
	 * applies, so this is the one place the arena's exposure can be trusted.
	 *
	 * Values come from photon.Exposure / photon.ExposureBias / photon.Bloom so the look can be tuned
	 * without a rebuild.
	 */
	PHOTON_API void ApplyArenaPostProcess(UCameraComponent* Camera);

	/** Re-apply camera post process to every local player, after console variables have been parsed. */
	PHOTON_API void RefreshArenaPostProcess(UWorld* World);

	/** Re-apply arena materials at runtime so -game launches match the authored level. */
	PHOTON_API void BootstrapArenaVisuals(UWorld* World);

	/** Team-coloured energy material. */
	PHOTON_API void ApplyEnergyTint(UPrimitiveComponent* Component, FLinearColor Color,
		float EmissiveScale = 6.f);

	/** Canonical Photon arena palette, shared by the runtime bootstrap and the build script. */
	namespace Palette
	{
		PHOTON_API FLinearColor Structure();
		PHOTON_API FLinearColor Floor();
		PHOTON_API FLinearColor Cover();
		PHOTON_API FLinearColor Metal();
		PHOTON_API FLinearColor Energy();
	}
}
