#include "PhotonVisuals.h"

#include "Camera/CameraComponent.h"
#include "Components/PrimitiveComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "PhotonCore.h"
#include "PhotonPlayer.h"
#include "PhotonWeapon.h"

static TAutoConsoleVariable<float> CVarPhotonExposure(
	TEXT("photon.Exposure"), 18.f,
	TEXT("Fixed arena exposure. Min and max adaptation are both pinned to this, which disables eye "
		 "adaptation. Higher is darker."),
	ECVF_Default);

static TAutoConsoleVariable<float> CVarPhotonExposureBias(
	TEXT("photon.ExposureBias"), 0.f, TEXT("Arena exposure compensation in stops."), ECVF_Default);

static TAutoConsoleVariable<float> CVarPhotonBloom(
	TEXT("photon.Bloom"), 0.35f, TEXT("Arena bloom intensity."), ECVF_Default);

namespace
{
	/**
	 * Resolve a Photon material, caching only genuine successes.
	 *
	 * The previous version cached whatever the first call returned. That first call happens while the
	 * class default objects are being constructed at module load, when /Game/ content is not yet
	 * loadable, so every role permanently cached the engine's white BasicShapeMaterial fallback — and
	 * BasicShapeMaterial has no TintColor parameter, so every later tint silently did nothing. The
	 * whole arena rendered flat white while the code reported that it had retinted 75 surfaces.
	 */
	UMaterialInterface* ResolvePhotonMaterial(EPhotonSurface Role, std::initializer_list<const TCHAR*> Paths)
	{
		static TMap<EPhotonSurface, TStrongObjectPtr<UMaterialInterface>> Cache;
		if (const TStrongObjectPtr<UMaterialInterface>* Found = Cache.Find(Role))
		{
			if (Found->IsValid())
			{
				return Found->Get();
			}
		}

		for (const TCHAR* Path : Paths)
		{
			if (UMaterialInterface* Mat = LoadObject<UMaterialInterface>(nullptr, Path))
			{
				Cache.Add(Role, TStrongObjectPtr<UMaterialInterface>(Mat));
				return Mat;
			}
		}

		// Deliberately not cached: retry on the next call, once content is available.
		return LoadObject<UMaterialInterface>(
			nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	}

	/** Every Photon material exposes the same parameter names so one tint path drives all of them. */
	void SetPhotonParameters(UMaterialInstanceDynamic* MID, EPhotonSurface Role,
		FLinearColor Color, float EmissiveScale)
	{
		if (!MID)
		{
			return;
		}
		MID->SetVectorParameterValue(TEXT("TintColor"), Color);
		MID->SetScalarParameterValue(TEXT("EmissiveStrength"), EmissiveScale);

		// Roughness is part of the surface identity, not a per-actor choice. The floor in particular
		// needs to stay rough: at 0.42 the ceiling rig produced a mirror-bright specular pool across
		// the middle of the court that read as a blown-out white patch.
		switch (Role)
		{
		case EPhotonSurface::Floor:
			MID->SetScalarParameterValue(TEXT("Roughness"), 0.68f);
			MID->SetScalarParameterValue(TEXT("Metallic"), 0.f);
			break;
		case EPhotonSurface::Cover:
			MID->SetScalarParameterValue(TEXT("Roughness"), 0.55f);
			MID->SetScalarParameterValue(TEXT("Metallic"), 0.18f);
			break;
		case EPhotonSurface::Structure:
			MID->SetScalarParameterValue(TEXT("Roughness"), 0.64f);
			MID->SetScalarParameterValue(TEXT("Metallic"), 0.f);
			break;
		case EPhotonSurface::Energy:
		default:
			break;
		}
	}
}

UMaterialInterface* PhotonVisuals::GetSurfaceMaterial(EPhotonSurface Role)
{
	switch (Role)
	{
	case EPhotonSurface::Floor:
		return ResolvePhotonMaterial(Role, {
			TEXT("/Game/Photon/Materials/M_PhotonFloor.M_PhotonFloor"),
			TEXT("/Game/Photon/Materials/M_PhotonSurface.M_PhotonSurface") });
	case EPhotonSurface::Cover:
		return ResolvePhotonMaterial(Role, {
			TEXT("/Game/Photon/Materials/M_PhotonCover.M_PhotonCover"),
			TEXT("/Game/Photon/Materials/M_PhotonSurface.M_PhotonSurface") });
	case EPhotonSurface::Energy:
		return ResolvePhotonMaterial(Role, {
			TEXT("/Game/Photon/Materials/M_PhotonGlow.M_PhotonGlow"),
			TEXT("/Game/Photon/Materials/M_PhotonEnergy.M_PhotonEnergy") });
	case EPhotonSurface::Structure:
	default:
		return ResolvePhotonMaterial(EPhotonSurface::Structure, {
			TEXT("/Game/Photon/Materials/M_PhotonSurface.M_PhotonSurface"),
			TEXT("/Game/Photon/Materials/M_PhotonSolid.M_PhotonSolid") });
	}
}

bool PhotonVisuals::IsPhotonMaterial(const UMaterialInterface* Material)
{
	return Material && Material->GetPathName().Contains(TEXT("/Game/Photon/Materials/"));
}

UMaterialInterface* PhotonVisuals::GetSolidMaterial()
{
	return GetSurfaceMaterial(EPhotonSurface::Structure);
}

UMaterialInterface* PhotonVisuals::GetEnergyMaterial()
{
	return GetSurfaceMaterial(EPhotonSurface::Energy);
}

FLinearColor PhotonVisuals::Palette::Structure() { return FLinearColor(0.055f, 0.060f, 0.075f); }
FLinearColor PhotonVisuals::Palette::Floor()     { return FLinearColor(0.030f, 0.034f, 0.045f); }
FLinearColor PhotonVisuals::Palette::Cover()     { return FLinearColor(0.115f, 0.125f, 0.150f); }
FLinearColor PhotonVisuals::Palette::Energy()    { return FLinearColor(0.35f, 0.82f, 1.0f); }

void PhotonVisuals::ApplyTint(UPrimitiveComponent* Component, FLinearColor Color, float EmissiveScale)
{
	if (!Component)
	{
		return;
	}
	if (Component->GetMaterial(0) == nullptr)
	{
		Component->SetMaterial(0, GetSolidMaterial());
	}
	SetPhotonParameters(Component->CreateAndSetMaterialInstanceDynamic(0),
		EPhotonSurface::Structure, Color, EmissiveScale);
}

void PhotonVisuals::ApplySurface(UPrimitiveComponent* Component, EPhotonSurface Role,
	FLinearColor Color, float EmissiveScale)
{
	UMaterialInterface* Parent = GetSurfaceMaterial(Role);
	if (!Component || !Parent)
	{
		return;
	}
	// Unconditional: the slot almost always already holds BasicShapeMaterial, and leaving it there is
	// exactly what made the whole arena render as flat white.
	const int32 SlotCount = FMath::Max(1, Component->GetNumMaterials());
	for (int32 Slot = 0; Slot < SlotCount; ++Slot)
	{
		Component->SetMaterial(Slot, Parent);
		SetPhotonParameters(Component->CreateAndSetMaterialInstanceDynamic(Slot), Role, Color, EmissiveScale);
	}
}

void PhotonVisuals::ApplyEnergyTint(UPrimitiveComponent* Component, FLinearColor Color, float EmissiveScale)
{
	ApplySurface(Component, EPhotonSurface::Energy, Color, EmissiveScale);
}

void PhotonVisuals::ConfigureFirstPersonViewModel(UPrimitiveComponent* Component)
{
	if (!Component)
	{
		return;
	}
	// World-space viewmodel on the possessed pawn. UE 5.8's FirstPerson primitive pass does not draw
	// these static meshes in standalone -game, so the ordinary path is used instead.
	Component->SetFirstPersonPrimitiveType(EFirstPersonPrimitiveType::None);
	Component->SetOnlyOwnerSee(false);
	Component->SetOwnerNoSee(false);
	Component->SetCastShadow(false);
	Component->SetVisibility(true, true);
	Component->SetHiddenInGame(false);
}

void PhotonVisuals::ConfigureFirstPersonCamera(UCameraComponent* Camera)
{
	if (!Camera)
	{
		return;
	}
	Camera->bEnableFirstPersonFieldOfView = true;
	Camera->bEnableFirstPersonScale = true;
	Camera->FirstPersonFieldOfView = Camera->FieldOfView;
	Camera->FirstPersonScale = 1.f;
	ApplyArenaPostProcess(Camera);
}

void PhotonVisuals::ApplyArenaPostProcess(UCameraComponent* Camera)
{
	if (!Camera)
	{
		return;
	}

	FPostProcessSettings& PP = Camera->PostProcessSettings;

	// Min == Max is the documented way to switch eye adaptation off, which is what keeps the arena
	// dark: with adaptation on, the renderer brightens the dark materials straight back to grey.
	const float Exposure = CVarPhotonExposure.GetValueOnAnyThread();
	PP.bOverride_AutoExposureMethod = true;
	PP.AutoExposureMethod = AEM_Histogram;
	PP.bOverride_AutoExposureMinBrightness = true;
	PP.AutoExposureMinBrightness = Exposure;
	PP.bOverride_AutoExposureMaxBrightness = true;
	PP.AutoExposureMaxBrightness = Exposure;
	PP.bOverride_AutoExposureBias = true;
	PP.AutoExposureBias = CVarPhotonExposureBias.GetValueOnAnyThread();

	PP.bOverride_BloomIntensity = true;
	PP.BloomIntensity = CVarPhotonBloom.GetValueOnAnyThread();

	PP.bOverride_VignetteIntensity = true;
	PP.VignetteIntensity = 0.3f;

	Camera->PostProcessBlendWeight = 1.f;
}

void PhotonVisuals::RefreshArenaPostProcess(UWorld* World)
{
	if (!World)
	{
		return;
	}
	int32 Cameras = 0;
	for (TActorIterator<APhotonCharacter> It(World); It; ++It)
	{
		if (APhotonCharacter* Character = *It)
		{
			ApplyArenaPostProcess(Character->Camera);
			++Cameras;
		}
	}
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONVERIFY post process cameras=%d exposure=%.3f bloom=%.2f"),
		Cameras, CVarPhotonExposure.GetValueOnAnyThread(), CVarPhotonBloom.GetValueOnAnyThread());
}

namespace
{
	/**
	 * Actor labels are editor-only and object names are what survive into a cooked build, so both are
	 * searched. The arena is authored by a Python script that sets labels, and the runtime pass has to
	 * find the same actors either way.
	 */
	FString ArenaIdentity(const AActor* Actor)
	{
		FString Identity = Actor->GetName();
#if WITH_EDITOR
		Identity += TEXT("|") + Actor->GetActorLabel();
#endif
		return Identity;
	}

	struct FArenaRule
	{
		const TCHAR* Token;
		EPhotonSurface Role;
		FLinearColor Color;
		float Emissive;
	};
}

void PhotonVisuals::BootstrapArenaVisuals(UWorld* World)
{
	if (!World || World->GetNetMode() == NM_DedicatedServer)
	{
		return;
	}

	const FLinearColor Neon = Palette::Energy();
	const FArenaRule Rules[] = {
		// Energy first: these names also contain structural tokens such as "Spawn".
		{ TEXT("EnergyStrip"),    EPhotonSurface::Energy,    Neon,                              6.0f },
		{ TEXT("CenterMark"),     EPhotonSurface::Energy,    Neon,                              3.0f },
		{ TEXT("SpawnStrip_Red"), EPhotonSurface::Energy,    FLinearColor(0.95f, 0.22f, 0.18f), 5.0f },
		{ TEXT("SpawnStrip_Green"),EPhotonSurface::Energy,   FLinearColor(0.18f, 0.88f, 0.42f), 5.0f },
		{ TEXT("SpawnStrip_Blue"),EPhotonSurface::Energy,    FLinearColor(0.22f, 0.55f, 1.00f), 5.0f },
		{ TEXT("SpawnStrip_Yellow"),EPhotonSurface::Energy,  FLinearColor(0.98f, 0.82f, 0.18f), 5.0f },
		{ TEXT("LaneLine"),       EPhotonSurface::Energy,    Neon * 0.55f,                      2.2f },
		{ TEXT("BoundaryLine"),   EPhotonSurface::Energy,    Neon * 0.7f,                       2.6f },
		{ TEXT("Signage"),        EPhotonSurface::Energy,    Neon,                              4.0f },
		{ TEXT("Pedestal"),       EPhotonSurface::Structure, Palette::Structure() * 1.6f,       0.0f },
		{ TEXT("SpawnPad_Red"),   EPhotonSurface::Cover,     FLinearColor(0.20f, 0.045f, 0.04f),0.5f },
		{ TEXT("SpawnPad_Green"), EPhotonSurface::Cover,     FLinearColor(0.04f, 0.19f, 0.09f), 0.5f },
		{ TEXT("SpawnPad_Blue"),  EPhotonSurface::Cover,     FLinearColor(0.05f, 0.12f, 0.22f), 0.5f },
		{ TEXT("SpawnPad_Yellow"),EPhotonSurface::Cover,     FLinearColor(0.21f, 0.17f, 0.04f), 0.5f },
		{ TEXT("ArenaSpawn_"),    EPhotonSurface::Cover,     Palette::Cover(),                  0.0f },
		{ TEXT("Cover"),          EPhotonSurface::Cover,     Palette::Cover(),                  0.0f },
		{ TEXT("Elevated"),       EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },
		{ TEXT("Platform"),       EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },
		{ TEXT("Perch"),          EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },
		{ TEXT("Panel"),          EPhotonSurface::Structure, Palette::Structure() * 1.3f,       0.0f },
		{ TEXT("Shell"),          EPhotonSurface::Structure, Palette::Structure(),              0.0f },
		{ TEXT("Wall"),           EPhotonSurface::Structure, Palette::Structure(),              0.0f },
		{ TEXT("Floor"),          EPhotonSurface::Floor,     Palette::Floor(),                  0.0f },
	};

	int32 Retinted = 0;
	for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
	{
		AStaticMeshActor* Actor = *It;
		if (!Actor)
		{
			continue;
		}
		UStaticMeshComponent* Mesh = Actor->GetStaticMeshComponent();
		if (!Mesh)
		{
			continue;
		}
		const FString Identity = ArenaIdentity(Actor);
		for (const FArenaRule& Rule : Rules)
		{
			if (Identity.Contains(Rule.Token))
			{
				ApplySurface(Mesh, Rule.Role, Rule.Color, Rule.Emissive);
				++Retinted;
				break;
			}
		}
	}

	for (TActorIterator<APhotonTarget> It(World); It; ++It)
	{
		if (APhotonTarget* Target = *It; Target && Target->Mesh)
		{
			ApplyEnergyTint(Target->Mesh, PhotonTeamColor(Target->Team), 4.f);
			++Retinted;
		}
	}

	UE_LOG(LogTemp, Display,
		TEXT("[Photon] PHOTONVERIFY arena surfaces retinted=%d structure=%s floor=%s cover=%s energy=%s"),
		Retinted,
		*GetNameSafe(GetSurfaceMaterial(EPhotonSurface::Structure)),
		*GetNameSafe(GetSurfaceMaterial(EPhotonSurface::Floor)),
		*GetNameSafe(GetSurfaceMaterial(EPhotonSurface::Cover)),
		*GetNameSafe(GetSurfaceMaterial(EPhotonSurface::Energy)));
}
