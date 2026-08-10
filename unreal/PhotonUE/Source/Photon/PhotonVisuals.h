#pragma once

#include "CoreMinimal.h"
#include "PhotonCore.h"

class UMaterialInterface;
class UPrimitiveComponent;

/** Shared runtime material + first-person viewmodel setup for Photon. */
namespace PhotonVisuals
{
	/** Opaque structural surface — arms, cover, walls. */
	PHOTON_API UMaterialInterface* GetSolidMaterial();

	/** Emissive energy surface — bolts, strips, targets. */
	PHOTON_API UMaterialInterface* GetEnergyMaterial();

	/** Apply TintColor (+ optional emissive boost) via a dynamic instance. */
	PHOTON_API void ApplyTint(UPrimitiveComponent* Component, FLinearColor Color, float EmissiveScale = 0.f);

	/** UE 5.8 first-person viewmodel flags for camera-attached owner-only geometry. */
	PHOTON_API void ConfigureFirstPersonViewModel(UPrimitiveComponent* Component);

	/** Team-coloured energy bolt material. */
	PHOTON_API void ApplyEnergyTint(UPrimitiveComponent* Component, FLinearColor Color);
}
