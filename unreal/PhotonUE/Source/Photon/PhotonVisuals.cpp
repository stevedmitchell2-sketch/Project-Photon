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
		case EPhotonSurface::Metal:
			// Smooth and fully metallic. In an arena this dark, structural steel can only be told
			// apart from graphite by how it catches the ceiling rig, not by its albedo.
			MID->SetScalarParameterValue(TEXT("Roughness"), 0.34f);
			MID->SetScalarParameterValue(TEXT("Metallic"), 0.85f);
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
	case EPhotonSurface::Metal:
		return ResolvePhotonMaterial(Role, {
			TEXT("/Game/Photon/Materials/M_PhotonMetal.M_PhotonMetal"),
			TEXT("/Game/Photon/Materials/M_PhotonCover.M_PhotonCover") });
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

// Kept in step with Tools/build_photon_arena.py. The floor is authored much darker than it looks
// like it should be: it is the only large surface facing the ceiling rig head on, so it collects
// several times the light any vertical surface does, and at the previous 0.030 it still rendered as
// the brightest thing in frame with cover reading darker than the ground beneath it.
FLinearColor PhotonVisuals::Palette::Structure() { return FLinearColor(0.062f, 0.067f, 0.082f); }
FLinearColor PhotonVisuals::Palette::Floor()     { return FLinearColor(0.022f, 0.025f, 0.033f); }
FLinearColor PhotonVisuals::Palette::Cover()     { return FLinearColor(0.145f, 0.156f, 0.184f); }
FLinearColor PhotonVisuals::Palette::Metal()     { return FLinearColor(0.085f, 0.092f, 0.108f); }
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
	// Lighting channel 1 only. The arena's lights are all on channel 0, so the viewmodel is lit
	// exclusively by the camera-mounted key and fill and can be exposed independently of the room.
	Component->SetLightingChannels(false, true, false);
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
	const FLinearColor Steel = Palette::Metal();

	// Matched in order, first hit wins, on a substring of the actor's name and label. Order is
	// load-bearing wherever one token contains another: SpawnGate before Spawn, CentreRing before
	// Centre, CourtSeam before Court. The build script (Tools/build_photon_arena.py) authors the
	// labels this table expects, and the two have to be edited together.
	const FArenaRule Rules[] = {
		// --- Energy. Listed first because these labels also carry structural tokens. -------------
		{ TEXT("SpawnStrip_Red"), EPhotonSurface::Energy,    FLinearColor(0.95f, 0.22f, 0.18f), 3.6f },
		{ TEXT("SpawnStrip_Green"),EPhotonSurface::Energy,   FLinearColor(0.18f, 0.88f, 0.42f), 3.6f },
		{ TEXT("SpawnStrip_Blue"),EPhotonSurface::Energy,    FLinearColor(0.22f, 0.55f, 1.00f), 3.6f },
		{ TEXT("SpawnStrip_Yellow"),EPhotonSurface::Energy,  FLinearColor(0.98f, 0.82f, 0.18f), 3.6f },
		{ TEXT("Energy_Clerestory"),EPhotonSurface::Energy,  Neon * 0.85f,                      3.2f },
		{ TEXT("Energy_BayChannel"),EPhotonSurface::Energy,  Neon * 0.7f,                       2.4f },
		{ TEXT("Energy_CentreRing"),EPhotonSurface::Energy,  Neon * 0.75f,                      2.6f },
		{ TEXT("Energy_RigRing"), EPhotonSurface::Energy,    Neon * 0.9f,                       3.4f },
		{ TEXT("Energy_BeaconTop"),EPhotonSurface::Energy,   Neon,                              5.0f },
		{ TEXT("Energy_CoverTrim"),EPhotonSurface::Energy,   Neon * 0.55f,                      1.5f },
		{ TEXT("Energy_PylonCap"),EPhotonSurface::Energy,    Neon * 0.6f,                       2.0f },
		{ TEXT("Energy_CofferPanel"),EPhotonSurface::Energy, FLinearColor(0.72f, 0.83f, 1.0f),  2.2f },
		{ TEXT("Energy"),         EPhotonSurface::Energy,    Neon,                              3.0f },
		{ TEXT("EnergyStrip"),    EPhotonSurface::Energy,    Neon,                              6.0f },
		{ TEXT("CenterMark"),     EPhotonSurface::Energy,    Neon,                              3.0f },
		{ TEXT("LaneLine"),       EPhotonSurface::Energy,    Neon * 0.5f,                       0.9f },
		{ TEXT("BoundaryLine"),   EPhotonSurface::Energy,    Neon,                              1.6f },
		{ TEXT("Signage_"),       EPhotonSurface::Energy,    Neon * 0.22f,                      0.55f },

		// --- Structural metal: trusses, railings, the overhead rig, deck columns. ----------------
		{ TEXT("Truss"),          EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("Railing"),        EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("Gantry"),         EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("CentreRig"),      EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("DeckColumn"),     EPhotonSurface::Metal,     Steel,                             0.0f },

		// --- Cover volumes and the things the player stands on. ----------------------------------
		{ TEXT("SpawnPad_Red"),   EPhotonSurface::Cover,     FLinearColor(0.16f, 0.030f, 0.023f),0.0f },
		{ TEXT("SpawnPad_Green"), EPhotonSurface::Cover,     FLinearColor(0.026f, 0.152f, 0.067f),0.0f },
		{ TEXT("SpawnPad_Blue"),  EPhotonSurface::Cover,     FLinearColor(0.032f, 0.088f, 0.16f),0.0f },
		{ TEXT("SpawnPad_Yellow"),EPhotonSurface::Cover,     FLinearColor(0.16f, 0.128f, 0.019f),0.0f },
		{ TEXT("CentreDais"),     EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },
		{ TEXT("Beacon"),         EPhotonSurface::Cover,     Palette::Cover(),                  0.0f },
		{ TEXT("DeckSlab"),       EPhotonSurface::Cover,     Palette::Cover() * 0.9f,           0.0f },
		{ TEXT("DeckStep"),       EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },
		{ TEXT("ArenaSpawn_"),    EPhotonSurface::Cover,     Palette::Cover(),                  0.0f },
		{ TEXT("Cover"),          EPhotonSurface::Cover,     Palette::Cover(),                  0.0f },
		{ TEXT("Elevated"),       EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },
		{ TEXT("Platform"),       EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },
		{ TEXT("Perch"),          EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },

		// --- Architecture. -----------------------------------------------------------------------
		{ TEXT("Pedestal"),       EPhotonSurface::Structure, Palette::Structure() * 1.6f,       0.0f },
		{ TEXT("SpawnGate"),      EPhotonSurface::Structure, Palette::Structure() * 1.7f,       0.0f },
		{ TEXT("CornerPylon"),    EPhotonSurface::Structure, Palette::Structure() * 1.7f,       0.0f },
		{ TEXT("CeilingBay"),     EPhotonSurface::Structure, Palette::Structure() * 1.7f,       0.0f },
		{ TEXT("Soffit"),         EPhotonSurface::Structure, Palette::Structure() * 1.7f,       0.0f },
		{ TEXT("Clerestory"),     EPhotonSurface::Structure, Palette::Structure() * 0.8f,       0.0f },
		{ TEXT("UpperWall"),      EPhotonSurface::Structure, Palette::Structure() * 0.9f,       0.0f },
		{ TEXT("SignageBody"),    EPhotonSurface::Structure, Palette::Structure() * 1.2f,       0.0f },
		{ TEXT("WallBay"),        EPhotonSurface::Structure, Palette::Structure(),              0.0f },
		{ TEXT("Roof"),           EPhotonSurface::Structure, Palette::Structure() * 0.85f,      0.0f },
		// No bare "Panel" rule. It sits above the floor block, so it swallowed CourtPanelA/B and
		// retinted the four court quadrants — the biggest surfaces in the arena — as pale structure.
		{ TEXT("Shell"),          EPhotonSurface::Structure, Palette::Structure(),              0.0f },
		{ TEXT("Wall"),           EPhotonSurface::Structure, Palette::Structure(),              0.0f },

		// --- Floor. CourtSeam and CourtPanel before the bare Floor rule. -------------------------
		{ TEXT("CourtSeam"),      EPhotonSurface::Floor,     Palette::Floor() * 0.6f,           0.0f },
		{ TEXT("CourtPanelA"),    EPhotonSurface::Floor,     FLinearColor(0.030f, 0.034f, 0.044f),0.0f },
		{ TEXT("CourtPanelB"),    EPhotonSurface::Floor,     FLinearColor(0.024f, 0.027f, 0.036f),0.0f },
		{ TEXT("Court"),          EPhotonSurface::Floor,     FLinearColor(0.030f, 0.034f, 0.044f),0.0f },
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
