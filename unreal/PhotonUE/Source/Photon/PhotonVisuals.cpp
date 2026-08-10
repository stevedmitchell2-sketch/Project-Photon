#include "PhotonVisuals.h"

#include "Components/PrimitiveComponent.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
	UMaterialInterface* LoadPhotonMaterial(const TCHAR* Primary, const TCHAR* Fallback)
	{
		if (UMaterialInterface* Mat = LoadObject<UMaterialInterface>(nullptr, Primary))
		{
			return Mat;
		}
		return LoadObject<UMaterialInterface>(nullptr, Fallback);
	}

	void EnsureMaterialSlot(UPrimitiveComponent* Component, UMaterialInterface* Parent)
	{
		if (!Component || !Parent)
		{
			return;
		}
		if (Component->GetMaterial(0) == nullptr)
		{
			Component->SetMaterial(0, Parent);
		}
	}

	UMaterialInstanceDynamic* EnsureDynamicTint(UPrimitiveComponent* Component, UMaterialInterface* Parent)
	{
		if (!Component || !Parent)
		{
			return nullptr;
		}
		EnsureMaterialSlot(Component, Parent);
		return Component->CreateAndSetMaterialInstanceDynamic(0);
	}
}

UMaterialInterface* PhotonVisuals::GetSolidMaterial()
{
	static UMaterialInterface* Cached = LoadPhotonMaterial(
		TEXT("/Game/Photon/Materials/M_PhotonSolid.M_PhotonSolid"),
		TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	return Cached;
}

UMaterialInterface* PhotonVisuals::GetEnergyMaterial()
{
	static UMaterialInterface* Cached = LoadPhotonMaterial(
		TEXT("/Game/Photon/Materials/M_PhotonEnergy.M_PhotonEnergy"),
		TEXT("/Game/Photon/Materials/M_PhotonSolid.M_PhotonSolid"));
	return Cached ? Cached : GetSolidMaterial();
}

void PhotonVisuals::ApplyTint(UPrimitiveComponent* Component, FLinearColor Color, float EmissiveScale)
{
	if (UMaterialInstanceDynamic* MID = EnsureDynamicTint(Component, GetSolidMaterial()))
	{
		const float Boost = 1.f + FMath::Max(0.f, EmissiveScale);
		const FLinearColor Boosted(Color.R * Boost, Color.G * Boost, Color.B * Boost, 1.f);
		MID->SetVectorParameterValue(TEXT("TintColor"), Boosted);
		MID->SetVectorParameterValue(TEXT("Color"), Boosted);
		MID->SetVectorParameterValue(TEXT("BaseColor"), Boosted);
		MID->SetScalarParameterValue(TEXT("EmissiveStrength"), EmissiveScale);
	}
}

void PhotonVisuals::ApplyEnergyTint(UPrimitiveComponent* Component, FLinearColor Color)
{
	if (UMaterialInstanceDynamic* MID = EnsureDynamicTint(Component, GetEnergyMaterial()))
	{
		MID->SetVectorParameterValue(TEXT("TintColor"), Color);
		MID->SetVectorParameterValue(TEXT("Color"), Color);
		MID->SetVectorParameterValue(TEXT("BaseColor"), Color);
		MID->SetScalarParameterValue(TEXT("EmissiveStrength"), 2.5f);
	}
}

void PhotonVisuals::ConfigureFirstPersonViewModel(UPrimitiveComponent* Component)
{
	if (!Component)
	{
		return;
	}
	Component->SetFirstPersonPrimitiveType(EFirstPersonPrimitiveType::FirstPerson);
	Component->SetOnlyOwnerSee(true);
	Component->SetCastShadow(false);
	Component->SetVisibility(true, true);
	Component->SetHiddenInGame(false);
}
