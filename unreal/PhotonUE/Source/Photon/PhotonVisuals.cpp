#include "PhotonVisuals.h"

#include "Camera/CameraComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/LightComponent.h"
#include "Components/PrimitiveComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/PointLight.h"
#include "Engine/RectLight.h"
#include "Engine/SpotLight.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "HAL/IConsoleManager.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "PhotonCore.h"
#include "PhotonPlayer.h"
#include "PhotonWeapon.h"

static TAutoConsoleVariable<float> CVarPhotonExposure(
	TEXT("photon.Exposure"), 12.f,
	TEXT("Fixed arena exposure. Min and max adaptation are both pinned to this, which disables eye "
		 "adaptation. Higher is darker."),
	ECVF_Default);

static TAutoConsoleVariable<float> CVarPhotonExposureBias(
	TEXT("photon.ExposureBias"), 0.35f, TEXT("Arena exposure compensation in stops."), ECVF_Default);

static TAutoConsoleVariable<float> CVarPhotonBloom(
	TEXT("photon.Bloom"), 0.18f, TEXT("Arena bloom intensity (kept low for FPS)."), ECVF_Default);

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
			MID->SetScalarParameterValue(TEXT("Roughness"), 0.78f);
			MID->SetScalarParameterValue(TEXT("Metallic"), 0.f);
			break;
		case EPhotonSurface::Cover:
			MID->SetScalarParameterValue(TEXT("Roughness"), 0.52f);
			MID->SetScalarParameterValue(TEXT("Metallic"), 0.22f);
			break;
		case EPhotonSurface::Metal:
			MID->SetScalarParameterValue(TEXT("Roughness"), 0.30f);
			MID->SetScalarParameterValue(TEXT("Metallic"), 0.88f);
			break;
		case EPhotonSurface::Structure:
			MID->SetScalarParameterValue(TEXT("Roughness"), 0.70f);
			MID->SetScalarParameterValue(TEXT("Metallic"), 0.05f);
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

// Kept in step with Tools/build_photon_arena.py. Floor is darkest (faces the ceiling rig), cover
// lifts clearly above it, structure sits between them as charcoal architecture.
//
// Hue, not value, was the thing wrong with the last set. Every architectural entry carried a blue
// bias of about 1.25:1 blue over red, every house light was authored at 206/226/255, and the result
// measured out at 81% of all lit pixels reading as cyan across the eleven tour frames. When the
// walls, the floor, the cover, the seating and the steel are all the same cyan as the energy
// strips, the energy strips are not an accent, they are the ambient colour of the room — which is
// exactly the "washed out, everything the same" read.
//
// So the architecture is now warm-neutral graphite: red very slightly ahead of blue, the way
// concrete and painted steel actually photograph under white light. Cyan is reserved for emissive
// energy and for the steel, which is allowed to stay cool because that is what makes it read as
// metal next to the ceramic. Amber stays rationed to the suites and the Champion's Walk.
//
// Values sit about a fifth below the first warm-neutral set. That one measured with a median of
// 75/255 and read as light concrete rather than the graphite the venue is meant to be built from;
// the ratios between the four surfaces were right, the whole ladder was just standing too high.
FLinearColor PhotonVisuals::Palette::Structure() { return FLinearColor(0.098f, 0.093f, 0.087f); }
FLinearColor PhotonVisuals::Palette::Floor()     { return FLinearColor(0.044f, 0.042f, 0.041f); }
FLinearColor PhotonVisuals::Palette::Cover()     { return FLinearColor(0.152f, 0.144f, 0.132f); }
FLinearColor PhotonVisuals::Palette::Metal()     { return FLinearColor(0.112f, 0.117f, 0.130f); }
FLinearColor PhotonVisuals::Palette::Energy()    { return FLinearColor(0.28f, 0.78f, 1.0f); }
FLinearColor PhotonVisuals::Palette::Seat()      { return FLinearColor(0.054f, 0.049f, 0.046f); }
FLinearColor PhotonVisuals::Palette::Amber()     { return FLinearColor(1.00f, 0.62f, 0.10f); }
FLinearColor PhotonVisuals::Palette::Suite()     { return FLinearColor(1.00f, 0.66f, 0.34f); }

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
	PP.VignetteIntensity = 0.22f;

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
	const FLinearColor Amber = Palette::Amber();
	const FLinearColor Suite = Palette::Suite();
	const FLinearColor Seat = Palette::Seat();

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
		{ TEXT("Energy_CeilGrid"),EPhotonSurface::Energy,    FLinearColor(0.62f, 0.76f, 1.0f),  1.5f },
		{ TEXT("Energy_CeilPanel"),EPhotonSurface::Energy,   FLinearColor(0.20f, 0.25f, 0.34f), 0.85f },

		// --- Bowl and landmark emissives. Warm is rationed to two of them on purpose. -------------
		{ TEXT("Energy_SuiteGlass"),EPhotonSurface::Energy,  Suite,                             1.5f },
		{ TEXT("Energy_WalkNiche"),EPhotonSurface::Energy,   Amber,                             1.8f },
		{ TEXT("Energy_WalkSill"),EPhotonSurface::Energy,    Amber,                             2.6f },
		{ TEXT("Energy_Ribbon"),  EPhotonSurface::Energy,    Neon * 0.9f,                       2.8f },
		{ TEXT("Energy_Coolant"), EPhotonSurface::Energy,    Neon * 0.8f,                       2.8f },
		{ TEXT("Energy_MastRing"),EPhotonSurface::Energy,    Neon,                              3.2f },
		{ TEXT("Energy_SkyShaft"),EPhotonSurface::Energy,    FLinearColor(0.66f, 0.80f, 1.0f),  2.4f },
		{ TEXT("Energy_TrussPod"),EPhotonSurface::Energy,    FLinearColor(0.72f, 0.83f, 1.0f),  2.2f },
		{ TEXT("Energy_GantryRail"),EPhotonSurface::Energy,  Neon * 0.55f,                      1.3f },
		{ TEXT("Energy_ColumnBand"),EPhotonSurface::Energy,  Neon * 0.6f,                       1.6f },
		{ TEXT("Energy_CornerStrip"),EPhotonSurface::Energy, Neon * 0.7f,                      2.0f },
		{ TEXT("Energy_VomLip"),  EPhotonSurface::Energy,    Neon * 0.45f,                      1.1f },
		{ TEXT("Energy_DeckEdge"),EPhotonSurface::Energy,    Neon * 0.5f,                       1.4f },
		{ TEXT("Energy_RampEdge"),EPhotonSurface::Energy,    Neon * 0.5f,                       1.4f },
		// The Core is the arena's one landmark, so it is also the arena's brightest emissive.
		{ TEXT("Energy_CoreGlow"),EPhotonSurface::Energy,    Neon,                              4.2f },
		{ TEXT("Energy_CoreHalo"),EPhotonSurface::Energy,    Neon * 0.8f,                       2.4f },

		{ TEXT("Energy"),         EPhotonSurface::Energy,    Neon,                              3.0f },
		{ TEXT("EnergyStrip"),    EPhotonSurface::Energy,    Neon,                              6.0f },
		{ TEXT("CenterMark"),     EPhotonSurface::Energy,    Neon,                              3.0f },
		{ TEXT("LaneLine"),       EPhotonSurface::Energy,    Neon * 0.5f,                       0.9f },
		{ TEXT("BoundaryLine"),   EPhotonSurface::Energy,    Neon,                              1.6f },
		{ TEXT("CenterCircle"),   EPhotonSurface::Energy,    Neon * 0.65f,                      1.4f },
		{ TEXT("HalfCourt"),      EPhotonSurface::Energy,    Neon * 0.45f,                      0.85f },
		{ TEXT("LaneMark_"),      EPhotonSurface::Energy,    Neon * 0.55f,                      1.1f },
		// A dead black rectangle is not a scoreboard. This is the brightest large surface in the
		// arena on purpose: it is the thing you look at from spawn.
		{ TEXT("ScoreboardFace"), EPhotonSurface::Energy,    Neon * 0.30f,                      1.5f },
		{ TEXT("Signage_"),       EPhotonSurface::Energy,    Neon * 0.22f,                      0.55f },

		// --- Structural metal: trusses, railings, the overhead rig, deck columns. ----------------
		{ TEXT("Truss"),          EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("Railing"),        EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("Gantry"),         EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("CentreRig"),      EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("CoreLantern"),    EPhotonSurface::Metal,     Steel * 1.2f,                      0.0f },
		{ TEXT("DeckColumn"),     EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("ScoreboardFrame"),EPhotonSurface::Metal,     Steel * 1.15f,                     0.0f },

		// --- Cover volumes and the things the player stands on. ----------------------------------
		{ TEXT("SpawnPad_Red"),   EPhotonSurface::Cover,     FLinearColor(0.16f, 0.030f, 0.023f),0.0f },
		{ TEXT("SpawnPad_Green"), EPhotonSurface::Cover,     FLinearColor(0.026f, 0.152f, 0.067f),0.0f },
		{ TEXT("SpawnPad_Blue"),  EPhotonSurface::Cover,     FLinearColor(0.032f, 0.088f, 0.16f),0.0f },
		{ TEXT("SpawnPad_Yellow"),EPhotonSurface::Cover,     FLinearColor(0.16f, 0.128f, 0.019f),0.0f },
		{ TEXT("TeamZone_Red"),   EPhotonSurface::Floor,     FLinearColor(0.055f, 0.012f, 0.010f),0.0f },
		{ TEXT("TeamZone_Green"), EPhotonSurface::Floor,     FLinearColor(0.010f, 0.052f, 0.024f),0.0f },
		{ TEXT("TeamZone_Blue"),  EPhotonSurface::Floor,     FLinearColor(0.012f, 0.030f, 0.060f),0.0f },
		{ TEXT("TeamZone_Yellow"),EPhotonSurface::Floor,     FLinearColor(0.055f, 0.044f, 0.008f),0.0f },
		// Half value, not 0.85. The dais sits directly under the only rect shadow caster in the
		// arena and was measuring as its brightest large surface — a white pool where the
		// centrepiece is supposed to be.
		{ TEXT("CentreDais"),     EPhotonSurface::Cover,     Palette::Cover() * 0.50f,          0.0f },
		{ TEXT("Beacon"),         EPhotonSurface::Cover,     Palette::Cover(),                  0.0f },
		{ TEXT("DeckSlab"),       EPhotonSurface::Cover,     Palette::Cover() * 0.9f,           0.0f },
		{ TEXT("DeckRampWall"),   EPhotonSurface::Cover,     Palette::Cover() * 0.75f,          0.0f },
		{ TEXT("DeckRamp"),       EPhotonSurface::Cover,     Palette::Cover() * 0.60f,          0.0f },
		{ TEXT("ArenaSpawn_"),    EPhotonSurface::Cover,     Palette::Cover(),                  0.0f },
		{ TEXT("Cover"),          EPhotonSurface::Cover,     Palette::Cover(),                  0.0f },
		{ TEXT("Elevated"),       EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },
		{ TEXT("Platform"),       EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },
		{ TEXT("Perch"),          EPhotonSurface::Cover,     Palette::Cover() * 0.85f,          0.0f },

		// --- Architecture. -----------------------------------------------------------------------
		// --- Spectator bowl and the four landmarks. Everything here lives outside the play space,
		// above the containment wall, and its whole job is to be a silhouette with depth. ---------
		{ TEXT("SeatBank"),       EPhotonSurface::Structure, Seat,                              0.0f },
		{ TEXT("Vomitory"),       EPhotonSurface::Structure, Seat * 0.35f,                      0.0f },
		{ TEXT("SuiteBox"),       EPhotonSurface::Structure, Palette::Structure() * 1.5f,       0.0f },
		{ TEXT("SuiteDeck"),      EPhotonSurface::Structure, Palette::Structure() * 1.2f,       0.0f },
		{ TEXT("TowerDeck"),      EPhotonSurface::Structure, Palette::Structure() * 1.4f,       0.0f },
		{ TEXT("TowerStair"),     EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("Parapet"),        EPhotonSurface::Structure, Palette::Structure() * 1.7f,       0.0f },
		{ TEXT("OuterSkin"),      EPhotonSurface::Structure, Palette::Structure() * 0.5f,       0.0f },
		{ TEXT("Concourse"),      EPhotonSurface::Floor,     Palette::Floor() * 0.7f,           0.0f },
		{ TEXT("AtriumColumn"),   EPhotonSurface::Structure, Palette::Structure() * 1.35f,      0.0f },
		{ TEXT("GantryRing"),     EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("TrussHanger"),    EPhotonSurface::Metal,     Steel,                             0.0f },
		{ TEXT("TowerDrum"),      EPhotonSurface::Structure, Palette::Structure() * 1.25f,      0.0f },
		{ TEXT("TowerMast"),      EPhotonSurface::Metal,     Steel * 1.1f,                      0.0f },
		{ TEXT("BroadcastPod"),   EPhotonSurface::Structure, Palette::Structure() * 1.6f,       0.0f },
		{ TEXT("Reactor"),        EPhotonSurface::Metal,     Steel * 1.05f,                     0.0f },
		// The Walk is warm even unlit: a neutral colonnade with amber trim reads as a neutral
		// colonnade, because the trim is 2% of its area.
		{ TEXT("WalkArch"),       EPhotonSurface::Structure, FLinearColor(0.150f, 0.132f, 0.108f),0.0f },
		{ TEXT("WalkWall"),       EPhotonSurface::Structure, FLinearColor(0.088f, 0.078f, 0.064f),0.0f },
		{ TEXT("SkyDeck"),        EPhotonSurface::Metal,     Steel * 1.15f,                     0.0f },

		{ TEXT("Pedestal"),       EPhotonSurface::Structure, Palette::Structure() * 1.6f,       0.0f },
		{ TEXT("SpawnGate"),      EPhotonSurface::Structure, Palette::Structure() * 1.7f,       0.0f },
		{ TEXT("CornerPylon"),    EPhotonSurface::Structure, Palette::Structure() * 1.7f,       0.0f },
		{ TEXT("CeilingBay"),     EPhotonSurface::Structure, Palette::Structure() * 1.7f,       0.0f },
		{ TEXT("Soffit"),         EPhotonSurface::Structure, Palette::Structure() * 1.7f,       0.0f },
		{ TEXT("WallCornerPanel"),EPhotonSurface::Structure, Palette::Structure() * 0.62f,      0.0f },
		{ TEXT("CornerCap"),      EPhotonSurface::Structure, Palette::Structure() * 1.7f,      0.0f },
		{ TEXT("CornerFin"),      EPhotonSurface::Structure, Palette::Structure() * 1.25f,     0.0f },
		{ TEXT("Clerestory"),     EPhotonSurface::Structure, Palette::Structure() * 0.8f,      0.0f },
		{ TEXT("UpperWall"),      EPhotonSurface::Structure, Palette::Structure() * 0.9f,       0.0f },
		{ TEXT("SignageBody"),    EPhotonSurface::Structure, Palette::Structure() * 1.2f,       0.0f },
		{ TEXT("WallBay"),        EPhotonSurface::Structure, Palette::Structure(),              0.0f },
		// Lifted above base structure, not below it. It is the one surface with nothing behind it to
		// give it contrast, and at 0.85 it disappeared into the void it is supposed to close off.
		{ TEXT("Roof"),           EPhotonSurface::Structure, Palette::Structure() * 1.30f,      0.0f },
		// No bare "Panel" rule. It sits above the floor block, so it swallowed CourtPanelA/B and
		// retinted the four court quadrants — the biggest surfaces in the arena — as pale structure.
		{ TEXT("Shell"),          EPhotonSurface::Structure, Palette::Structure(),              0.0f },
		{ TEXT("Wall"),           EPhotonSurface::Structure, Palette::Structure(),              0.0f },

		// --- Floor. CourtSeam and CourtPanel before the bare Floor rule. -------------------------
		// The court is the one large surface allowed to stay cool. With the architecture now
		// warm-neutral, that single hue shift is what draws the competition area out of the
		// building it sits in — a marked pitch rather than more of the same floor. The two panel
		// values are a deliberate 4:3 checker so the court has a grain at grazing angles.
		{ TEXT("CourtSeam"),      EPhotonSurface::Floor,     Palette::Floor() * 0.6f,           0.0f },
		{ TEXT("CourtPanelA"),    EPhotonSurface::Floor,     FLinearColor(0.032f, 0.039f, 0.050f),0.0f },
		{ TEXT("CourtPanelB"),    EPhotonSurface::Floor,     FLinearColor(0.023f, 0.029f, 0.039f),0.0f },
		{ TEXT("Court"),          EPhotonSurface::Floor,     FLinearColor(0.032f, 0.039f, 0.050f),0.0f },
		{ TEXT("Floor"),          EPhotonSurface::Floor,     Palette::Floor(),                  0.0f },
	};

	int32 Retinted = 0;
	int32 Unmatched = 0;
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
		bool bMatched = false;
		for (const FArenaRule& Rule : Rules)
		{
			if (Identity.Contains(Rule.Token))
			{
				ApplySurface(Mesh, Rule.Role, Rule.Color, Rule.Emissive);
				++Retinted;
				bMatched = true;
				break;
			}
		}
		if (!bMatched)
		{
			// Never leave BasicShapeMaterial white in the playable volume.
			ApplySurface(Mesh, EPhotonSurface::Structure, Palette::Structure(), 0.f);
			++Retinted;
			++Unmatched;
		}
	}

	for (TActorIterator<APhotonTarget> It(World); It; ++It)
	{
		if (APhotonTarget* Target = *It; Target && Target->Mesh)
		{
			ApplyEnergyTint(Target->Mesh, PhotonTeamColor(Target->Team), 5.f);
			++Retinted;
		}
	}

	UE_LOG(LogTemp, Display,
		TEXT("[Photon] PHOTONVERIFY arena surfaces retinted=%d unmatched_defaulted=%d "
			 "structure=%s floor=%s cover=%s energy=%s"),
		Retinted, Unmatched,
		*GetNameSafe(GetSurfaceMaterial(EPhotonSurface::Structure)),
		*GetNameSafe(GetSurfaceMaterial(EPhotonSurface::Floor)),
		*GetNameSafe(GetSurfaceMaterial(EPhotonSurface::Cover)),
		*GetNameSafe(GetSurfaceMaterial(EPhotonSurface::Energy)));
}

FString PhotonVisuals::BootstrapArenaPerformance(UWorld* World, bool bApplyFixes)
{
	if (!World || World->GetNetMode() == NM_DedicatedServer)
	{
		return TEXT("skipped");
	}

	// Light configuration is authored by Tools/build_photon_arena.py. This path only inventories
	// — it must not disable lights at BeginPlay (that was a temporary probe).
	(void)bApplyFixes;

	int32 RectLights = 0;
	int32 SpotLights = 0;
	int32 PointLights = 0;
	int32 DirLights = 0;
	int32 ShadowCasters = 0;
	int32 StaticMeshes = 0;
	int32 SkeletalMeshes = 0;
	int32 VisibleSkel = 0;

	auto CountLight = [&ShadowCasters](AActor* Actor, int32& Counter)
	{
		if (!Actor)
		{
			return;
		}
		++Counter;
		if (const ULightComponent* Light = Actor->FindComponentByClass<ULightComponent>())
		{
			if (Light->IsVisible() && Light->Intensity > 0.f && Light->CastShadows)
			{
				++ShadowCasters;
			}
		}
	};

	for (TActorIterator<ARectLight> It(World); It; ++It)
	{
		CountLight(*It, RectLights);
	}
	for (TActorIterator<ASpotLight> It(World); It; ++It)
	{
		CountLight(*It, SpotLights);
	}
	for (TActorIterator<APointLight> It(World); It; ++It)
	{
		CountLight(*It, PointLights);
	}
	for (TActorIterator<ADirectionalLight> It(World); It; ++It)
	{
		CountLight(*It, DirLights);
	}
	for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
	{
		++StaticMeshes;
	}
	for (TActorIterator<AActor> It(World); It; ++It)
	{
		TArray<USkeletalMeshComponent*> Skels;
		(*It)->GetComponents<USkeletalMeshComponent>(Skels);
		for (USkeletalMeshComponent* Skel : Skels)
		{
			++SkeletalMeshes;
			if (Skel && Skel->IsVisible() && !Skel->bHiddenInGame)
			{
				++VisibleSkel;
			}
		}
	}

	int32 VsmState = -1;
	if (IConsoleVariable* Vsm = IConsoleManager::Get().FindConsoleVariable(TEXT("r.Shadow.Virtual.Enable")))
	{
		VsmState = Vsm->GetInt();
	}
	int32 LumenState = -1;
	if (IConsoleVariable* Lumen = IConsoleManager::Get().FindConsoleVariable(
			TEXT("r.DynamicGlobalIlluminationMethod")))
	{
		LumenState = Lumen->GetInt();
	}

	const FString Summary = FString::Printf(
		TEXT("rect=%d spot=%d point=%d dir=%d shadow_casters=%d vsm=%d lumen_gi=%d "
			 "static_mesh_actors=%d skel_comps=%d skel_visible=%d"),
		RectLights, SpotLights, PointLights, DirLights, ShadowCasters, VsmState, LumenState,
		StaticMeshes, SkeletalMeshes, VisibleSkel);
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONPERF arena_lights %s"), *Summary);
	return Summary;
}

FString PhotonVisuals::ApplyRenderingABProbe(UWorld* World)
{
	if (!World || World->GetNetMode() == NM_DedicatedServer)
	{
		return TEXT("skipped");
	}

	const bool bDirOff = FParse::Param(FCommandLine::Get(), TEXT("PhotonABDirShadowOff"));
	const bool bLumenOff = FParse::Param(FCommandLine::Get(), TEXT("PhotonABLumenOff"));
	if (bDirOff && bLumenOff)
	{
		UE_LOG(LogTemp, Error,
			TEXT("[Photon] PHOTONAB refused: do not combine PhotonABDirShadowOff and PhotonABLumenOff"));
		return TEXT("refused_combined");
	}

	FString Mode = TEXT("baseline");
	if (bDirOff)
	{
		Mode = TEXT("dir_shadow_off");
		int32 Touched = 0;
		for (TActorIterator<ADirectionalLight> It(World); It; ++It)
		{
			if (ULightComponent* Light = (*It)->FindComponentByClass<ULightComponent>())
			{
				Light->SetCastShadows(false);
				++Touched;
			}
		}
		UE_LOG(LogTemp, Display,
			TEXT("[Photon] PHOTONAB dir_shadow_off applied to %d directional light(s)"), Touched);
	}
	else if (bLumenOff)
	{
		Mode = TEXT("lumen_off");
		if (IConsoleVariable* Gi = IConsoleManager::Get().FindConsoleVariable(
				TEXT("r.DynamicGlobalIlluminationMethod")))
		{
			Gi->Set(0, ECVF_SetByCode);
		}
		if (IConsoleVariable* Refl = IConsoleManager::Get().FindConsoleVariable(
				TEXT("r.ReflectionMethod")))
		{
			Refl->Set(0, ECVF_SetByCode);
		}
		UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONAB lumen_off: GI=0 Reflection=0"));
	}

	return Mode;
}

void PhotonVisuals::LogStaticMeshActorClassification(UWorld* World)
{
	if (!World)
	{
		return;
	}

	int32 Architecture = 0;
	int32 Gameplay = 0;
	int32 Decorative = 0;
	int32 TinyDetail = 0;
	int32 Energy = 0;
	int32 Other = 0;
	int32 Total = 0;

	auto Classify = [&](const FString& Name)
	{
		++Total;
		if (Name.Contains(TEXT("Cover")) || Name.Contains(TEXT("SpawnPad"))
			|| Name.Contains(TEXT("SpawnGate")) || Name.Contains(TEXT("CentreDais"))
			|| Name.Contains(TEXT("Deck")) || Name.Contains(TEXT("Step"))
			|| Name.Contains(TEXT("Beacon")) || Name.Contains(TEXT("Pedestal")))
		{
			++Gameplay;
		}
		else if (Name.Contains(TEXT("Floor")) || Name.Contains(TEXT("Court"))
			|| Name.Contains(TEXT("Wall")) || Name.Contains(TEXT("Roof"))
			|| Name.Contains(TEXT("Shell")) || Name.Contains(TEXT("Soffit"))
			|| Name.Contains(TEXT("Clerestory")) || Name.Contains(TEXT("CeilingBay"))
			|| Name.Contains(TEXT("CornerPylon")) || Name.Contains(TEXT("UpperWall"))
			|| Name.Contains(TEXT("WallBay")))
		{
			++Architecture;
		}
		else if (Name.Contains(TEXT("Energy")) || Name.Contains(TEXT("BoundaryLine"))
			|| Name.Contains(TEXT("LaneLine")) || Name.Contains(TEXT("SpawnStrip"))
			|| Name.Contains(TEXT("Signage")) || Name.Contains(TEXT("CenterMark"))
			|| Name.Contains(TEXT("CenterCircle")) || Name.Contains(TEXT("HalfCourt"))
			|| Name.Contains(TEXT("LaneMark")) || Name.Contains(TEXT("ScoreboardFace"))
			|| Name.Contains(TEXT("TeamZone")))
		{
			++Energy;
		}
		else if (Name.Contains(TEXT("Truss")) || Name.Contains(TEXT("Railing"))
			|| Name.Contains(TEXT("Gantry")) || Name.Contains(TEXT("CentreRig"))
			|| Name.Contains(TEXT("DeckColumn")) || Name.Contains(TEXT("ScoreboardFrame")))
		{
			++Decorative;
		}
		else if (Name.Contains(TEXT("Trim")) || Name.Contains(TEXT("Cap"))
			|| Name.Contains(TEXT("Seam")) || Name.Contains(TEXT("CofferPanel")))
		{
			++TinyDetail;
		}
		else
		{
			++Other;
		}
	};

	for (TActorIterator<AStaticMeshActor> It(World); It; ++It)
	{
		AStaticMeshActor* Actor = *It;
		if (!Actor)
		{
			continue;
		}
		FString Name = Actor->GetName();
#if WITH_EDITOR
		Name += TEXT("|") + Actor->GetActorLabel();
#endif
		Classify(Name);
	}

	UE_LOG(LogTemp, Display,
		TEXT("[Photon] PHOTONPERF mesh_class total=%d architecture=%d gameplay=%d "
			 "energy_accent=%d decorative=%d tiny_detail=%d other=%d"),
		Total, Architecture, Gameplay, Energy, Decorative, TinyDetail, Other);
}

void PhotonVisuals::ApplyHeroTeamPresentation(USkeletalMeshComponent* Body, EPhotonTeam InTeam)
{
	if (!Body)
	{
		return;
	}

	const EPhotonTeam TeamId = (InTeam == EPhotonTeam::None) ? EPhotonTeam::Blue : InTeam;
	const FLinearColor Accent = PhotonTeamColor(TeamId);

	// Dedicated hero material (UsedWithSkeletalMesh compiled in). Fall back to Cover / BasicShape.
	UMaterialInterface* HeroParent = LoadObject<UMaterialInterface>(nullptr,
		TEXT("/Game/Photon/Materials/M_PhotonHero.M_PhotonHero"));
	if (!HeroParent)
	{
		HeroParent = GetSurfaceMaterial(EPhotonSurface::Cover);
	}
	if (!HeroParent)
	{
		HeroParent = LoadObject<UMaterialInterface>(nullptr,
			TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	}

	const FLinearColor Shell = FLinearColor(
		FMath::Lerp(0.22f, Accent.R, 0.40f),
		FMath::Lerp(0.26f, Accent.G, 0.40f),
		FMath::Lerp(0.32f, Accent.B, 0.45f));

	const int32 SlotCount = FMath::Max(1, Body->GetNumMaterials());
	for (int32 Slot = 0; Slot < SlotCount; ++Slot)
	{
		if (HeroParent)
		{
			Body->SetMaterial(Slot, HeroParent);
		}
		if (UMaterialInstanceDynamic* Mid = Body->CreateAndSetMaterialInstanceDynamic(Slot))
		{
			// BasicShapeMaterial uses "Color"; Photon materials use TintColor — set both.
			Mid->SetVectorParameterValue(TEXT("Color"), Shell);
			Mid->SetVectorParameterValue(TEXT("TintColor"), Shell);
			// Low emissive so chase cam reads a figure, not a cyan light splat.
			Mid->SetScalarParameterValue(TEXT("EmissiveStrength"), 0.12f);
		}
	}

	Body->SetVisibility(true, true);
	Body->SetHiddenInGame(false);
	Body->SetOwnerNoSee(false);
	Body->SetOnlyOwnerSee(false);
	Body->SetLightingChannels(true, false, false);
	Body->SetCastShadow(true);
	Body->MarkRenderStateDirty();

	UE_LOG(LogTemp, Display,
		TEXT("[Photon] hero presentation team=%d parent=%s slots=%d color=(%.2f,%.2f,%.2f)"),
		static_cast<int32>(TeamId), *GetNameSafe(HeroParent), SlotCount,
		Shell.R, Shell.G, Shell.B);
}
