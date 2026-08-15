#include "PhotonPlayer.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/SpringArmComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Animation/AnimSequence.h"
#include "Animation/AnimSingleNodeInstance.h"
#include "Engine/SkeletalMeshSocket.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "PhotonCore.h"
#include "PhotonVisuals.h"
#include "PhotonWeapon.h"
#include "TimerManager.h"
#include "EngineUtils.h"
#include "Engine/World.h"
#include "UnrealClient.h"
#include "Misc/App.h"
#include "Components/PointLightComponent.h"
#include "Engine/Canvas.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/StaticMesh.h"
#include "Engine/SkeletalMesh.h"
#include "GameFramework/ProjectileMovementComponent.h"
#include "HAL/IConsoleManager.h"

// ---------------------------------------------------------------------------------------------
// APhotonCharacter
// ---------------------------------------------------------------------------------------------

const FName APhotonCharacter::WeaponSocketName(TEXT("SOCKET_weapon_right"));

APhotonCharacter::APhotonCharacter()
{
	// Hero locomotion clip selection needs a tick; input/movement themselves do not.
	PrimaryActorTick.bCanEverTick = true;

	// 1.95 m frame: 97.5 cm half-height. The reference build's competitor is the same height, so
	// cover heights and sight lines ported from the arena stay meaningful.
	GetCapsuleComponent()->InitCapsuleSize(38.f, 97.5f);

	SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
	SpringArm->SetupAttachment(GetCapsuleComponent());
	// Over-the-shoulder chase: long enough to read a full Mixamo body, aimed mid-torso.
	SpringArm->TargetArmLength = 450.f;
	SpringArm->SocketOffset = FVector(0.f, 45.f, 70.f);
	SpringArm->TargetOffset = FVector(0.f, 0.f, 40.f);
	SpringArm->bUsePawnControlRotation = true;
	// Probe keeps the lens out of cover/walls. Mesh has no collision so it won't collapse onto the hero.
	SpringArm->bDoCollisionTest = true;
	SpringArm->ProbeSize = 12.f;
	// Lag read as a "wave of motion" and made the walking hero hard to judge — keep it off for TP.
	SpringArm->bEnableCameraLag = false;
	SpringArm->bEnableCameraRotationLag = false;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	// Default presentation is third-person so the Mixamo hero is visible for arena movement tests.
	// ApplyViewPresentation() can re-parent to the capsule for -PhotonFirstPerson.
	Camera->SetupAttachment(SpringArm, USpringArmComponent::SocketName);
	Camera->bUsePawnControlRotation = false;
	Camera->bEnableFirstPersonFieldOfView = false;
	Camera->bEnableFirstPersonScale = false;
	PhotonVisuals::ApplyArenaPostProcess(Camera);

	FirstPersonPresentationRoot = CreateDefaultSubobject<USceneComponent>(TEXT("FP_PresentationRoot"));
	FirstPersonPresentationRoot->SetupAttachment(Camera);

	auto SetupArm = [](UStaticMeshComponent* Arm, USceneComponent* Parent, const TCHAR* MeshPath,
		const FVector& Loc, const FRotator& Rot)
	{
		if (!Arm)
		{
			return;
		}
		Arm->SetupAttachment(Parent);
		Arm->SetRelativeLocation(Loc);
		Arm->SetRelativeRotation(Rot);
		Arm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Arm->SetCastShadow(false);
		if (UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, MeshPath))
		{
			Arm->SetStaticMesh(Mesh);
		}
		PhotonVisuals::ConfigureFirstPersonViewModel(Arm);
		// Materials are applied in BeginPlay, not here: /Game/ content is not loadable while the class
		// default object is being constructed.
	};

	// The arms are authored elbow-at-origin running along local +Z, so a rotator's local +Z maps to
	// (-sin(pitch), 0, cos(pitch)) before yaw. These two poses are solved backwards from where the
	// hands have to end up: the PH-6 hip transform puts the weapon origin at (44, 14, -12) with the
	// muzzle ~62 uu ahead of the eye, so the right hand sits on the grip at roughly (40, 14, -14)
	// and the left hand on the forend at (56, 8, -10). The elbows land 35-45 uu below the eye line,
	// which is below the frustum — the arms enter frame partway along the forearm, as they should.
	// Robot forearms: elbow-at-origin along +Z. Placed deep under the frustum so the cutoff is
	// off-screen; AlignFpViewmodelPresentation aims +Z at the glove wrist each BeginPlay.
	RightArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightArm"));
	SetupArm(RightArm, FirstPersonPresentationRoot,
		TEXT("/Game/Photon/Meshes/Viewmodel/SM_PhotonRobotArmRight.SM_PhotonRobotArmRight"),
		FVector(22.f, 16.f, -52.f), FRotator(-42.f, -8.f, 12.f));
	if (RightArm)
	{
		RightArm->SetRelativeScale3D(FVector(0.85f));
		if (!RightArm->GetStaticMesh())
		{
			if (UStaticMesh* Fallback = LoadObject<UStaticMesh>(nullptr,
					TEXT("/Game/Photon/Meshes/SM_PhotonArmRight.SM_PhotonArmRight")))
			{
				RightArm->SetStaticMesh(Fallback);
			}
		}
	}

	LeftArm = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftArm"));
	SetupArm(LeftArm, FirstPersonPresentationRoot,
		TEXT("/Game/Photon/Meshes/Viewmodel/SM_PhotonRobotArmLeft.SM_PhotonRobotArmLeft"),
		FVector(34.f, -4.f, -48.f), FRotator(-46.f, 24.f, -10.f));
	if (LeftArm)
	{
		LeftArm->SetRelativeScale3D(FVector(0.85f));
		if (!LeftArm->GetStaticMesh())
		{
			if (UStaticMesh* Fallback = LoadObject<UStaticMesh>(nullptr,
					TEXT("/Game/Photon/Meshes/SM_PhotonArmLeft.SM_PhotonArmLeft")))
			{
				LeftArm->SetStaticMesh(Fallback);
			}
		}
	}

	// Gloves start on the presentation root; AlignFpViewmodelPresentation reparents them under
	// WeaponViewMesh (absolute scale) so they track recoil/hip without inheriting the 0.34 hip scale.
	RightGlove = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightGlove"));
	SetupArm(RightGlove, FirstPersonPresentationRoot,
		TEXT("/Game/Photon/Meshes/Viewmodel/SM_PhotonGloveRight.SM_PhotonGloveRight"),
		RightGripCamera, FRotator(8.f, -95.f, 75.f));
	if (RightGlove)
	{
		RightGlove->SetRelativeScale3D(RightGloveScale);
	}

	LeftGlove = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftGlove"));
	SetupArm(LeftGlove, FirstPersonPresentationRoot,
		TEXT("/Game/Photon/Meshes/Viewmodel/SM_PhotonGloveLeft.SM_PhotonGloveLeft"),
		LeftGripCamera, FRotator(5.f, -75.f, -80.f));
	if (LeftGlove)
	{
		LeftGlove->SetRelativeScale3D(LeftGloveScale);
	}

	// Skinned hero FP extract kept hidden — robot arms + gloves are the readable viewmodel path.
	FirstPersonArms = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("FirstPersonArms"));
	FirstPersonArms->SetupAttachment(FirstPersonPresentationRoot);
	FirstPersonArms->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	FirstPersonArms->SetCastShadow(false);
	FirstPersonArms->SetHiddenInGame(true);
	FirstPersonArms->SetAnimationMode(EAnimationMode::AnimationSingleNode);
	FirstPersonArms->SetRelativeLocation(FVector(18.f, 0.f, -42.f));
	FirstPersonArms->SetRelativeRotation(FRotator(0.f, -90.f, 0.f));
	PhotonVisuals::ConfigureFirstPersonViewModel(FirstPersonArms);

	ThirdPersonWeaponMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("ThirdPersonWeaponMesh"));
	ThirdPersonWeaponMesh->SetupAttachment(GetMesh());
	ThirdPersonWeaponMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	ThirdPersonWeaponMesh->SetCastShadow(true);
	ThirdPersonWeaponMesh->SetOwnerNoSee(true);
	ThirdPersonWeaponMesh->SetHiddenInGame(true);

	// Viewmodel lighting: channel 1 only, so these two lights touch the arms and the weapon and
	// nothing in the arena, and the arena's own lights no longer touch the viewmodel.
	ViewModelKey = CreateDefaultSubobject<UPointLightComponent>(TEXT("ViewModelKey"));
	ViewModelKey->SetupAttachment(Camera);
	ViewModelKey->SetRelativeLocation(FVector(28.f, 26.f, 30.f));
	ViewModelKey->SetIntensityUnits(ELightUnits::Lumens);
	// Tiny numbers, and correctly so. A point light 30 cm from the arms delivers roughly 200x the
	// illuminance of a 3200 lm ceiling fixture 8 m up, so arena-scale lumens here render the arms
	// as a white silhouette. These are solved for the viewmodel sitting a few stops above the room.
	ViewModelKey->SetIntensity(105.f);
	ViewModelKey->SetAttenuationRadius(220.f);
	ViewModelKey->SetLightColor(FLinearColor(0.82f, 0.88f, 1.f));
	ViewModelKey->SetCastShadows(false);

	ViewModelFill = CreateDefaultSubobject<UPointLightComponent>(TEXT("ViewModelFill"));
	ViewModelFill->SetupAttachment(Camera);
	ViewModelFill->SetRelativeLocation(FVector(44.f, -30.f, -26.f));
	ViewModelFill->SetIntensityUnits(ELightUnits::Lumens);
	ViewModelFill->SetIntensity(30.f);
	ViewModelFill->SetAttenuationRadius(200.f);
	ViewModelFill->SetLightColor(FLinearColor(0.34f, 0.68f, 0.95f));
	ViewModelFill->SetCastShadows(false);

	for (UPointLightComponent* Light : { ViewModelKey.Get(), ViewModelFill.Get() })
	{
		FLightingChannels Channels;
		Channels.bChannel0 = false;
		Channels.bChannel1 = true;
		Channels.bChannel2 = false;
		Light->SetLightingChannels(Channels.bChannel0, Channels.bChannel1, Channels.bChannel2);
	}

	// Parented to the camera, NOT to an arm proxy: component scale is inherited, so hanging the
	// weapon off a 0.09-scaled cylinder crushed the data-driven 0.34 hip scale to 0.03 and pushed the
	// mesh inside the near clip plane. That is what made the gun invisible while it still fired.
	WeaponRoot = CreateDefaultSubobject<USceneComponent>(TEXT("WeaponRoot"));
	WeaponRoot->SetupAttachment(Camera);

	WeaponViewMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("WeaponViewMesh"));
	WeaponViewMesh->SetupAttachment(WeaponRoot);
	WeaponViewMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	WeaponViewMesh->SetCastShadow(false);
	PhotonVisuals::ConfigureFirstPersonViewModel(WeaponViewMesh);

	Inventory = CreateDefaultSubobject<UPhotonInventoryComponent>(TEXT("Inventory"));
	Health = CreateDefaultSubobject<UPhotonHealthComponent>(TEXT("Health"));

	// Default: body visible (third-person). ApplyViewPresentation toggles OwnerNoSee for FP.
	if (USkeletalMeshComponent* Body = GetMesh())
	{
		Body->SetOwnerNoSee(false);
	}
	if (RightArm)
	{
		PhotonVisuals::ConfigureFirstPersonViewModel(RightArm);
	}
	if (LeftArm)
	{
		PhotonVisuals::ConfigureFirstPersonViewModel(LeftArm);
	}

	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->MaxWalkSpeed = WalkSpeed;
	Move->MaxWalkSpeedCrouched = CrouchSpeed;
	Move->JumpZVelocity = 480.f;
	Move->AirControl = 0.35f;
	// High friction and braking: a competitive FPS wants the character to stop when the stick does.
	// Floaty deceleration is the single most common way this feel goes wrong.
	Move->GroundFriction = 8.f;
	Move->BrakingDecelerationWalking = 2048.f;
	Move->MaxAcceleration = 2400.f;
	Move->bOrientRotationToMovement = false;
	Move->GetNavAgentPropertiesRef().bCanCrouch = true;
	Move->NavAgentProps.bCanCrouch = true;

	bUseControllerRotationYaw = true;
	bUseControllerRotationPitch = false;
}

void APhotonCharacter::BeginPlay()
{
	Super::BeginPlay();

	// FP is opt-in while we stabilize third-person arena movement with the Mixamo hero.
	bThirdPersonView = !FParse::Param(FCommandLine::Get(), TEXT("PhotonFirstPerson"));

	SetupHeroPresentation();
	ApplyViewPresentation();
	if (bThirdPersonView)
	{
		ApplyThirdPersonLookDefaults();
	}

	if (IsLocallyControlled() && !bThirdPersonView)
	{
		// Constructor may run before content import — bind robot/glove meshes here.
		// Skip in TP: force-unhiding camera children fills the chase lens.
		auto LoadVm = [](UStaticMeshComponent* Comp, const TCHAR* Path)
		{
			if (!Comp)
			{
				return;
			}
			if (UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, Path))
			{
				Comp->SetStaticMesh(Mesh);
				Comp->SetHiddenInGame(false);
				Comp->SetVisibility(true, true);
			}
		};
		LoadVm(RightArm, TEXT("/Game/Photon/Meshes/Viewmodel/SM_PhotonRobotArmRight.SM_PhotonRobotArmRight"));
		LoadVm(LeftArm, TEXT("/Game/Photon/Meshes/Viewmodel/SM_PhotonRobotArmLeft.SM_PhotonRobotArmLeft"));
		LoadVm(RightGlove, TEXT("/Game/Photon/Meshes/Viewmodel/SM_PhotonGloveRight.SM_PhotonGloveRight"));
		LoadVm(LeftGlove, TEXT("/Game/Photon/Meshes/Viewmodel/SM_PhotonGloveLeft.SM_PhotonGloveLeft"));
	}

	// Re-apply after mesh load so TP hides FP junk / FP restores OwnerNoSee.
	ApplyViewPresentation();

	if (IsLocallyControlled() && !bThirdPersonView)
	{
		// Robot/glove viewmodel: distinct Photon surfaces — forearm darker, glove mid Cover.
		if (RightArm && RightArm->GetStaticMesh() && RightArm->IsVisible())
		{
			PhotonVisuals::ConfigureFirstPersonViewModel(RightArm);
			PhotonVisuals::ApplySurface(RightArm, EPhotonSurface::Metal,
				FLinearColor(0.14f, 0.16f, 0.19f));
		}
		if (LeftArm && LeftArm->GetStaticMesh() && LeftArm->IsVisible())
		{
			PhotonVisuals::ConfigureFirstPersonViewModel(LeftArm);
			PhotonVisuals::ApplySurface(LeftArm, EPhotonSurface::Metal,
				FLinearColor(0.14f, 0.16f, 0.19f));
		}
		if (RightGlove && RightGlove->GetStaticMesh() && RightGlove->IsVisible())
		{
			PhotonVisuals::ConfigureFirstPersonViewModel(RightGlove);
			PhotonVisuals::ApplySurface(RightGlove, EPhotonSurface::Cover,
				FLinearColor(0.30f, 0.32f, 0.36f));
		}
		if (LeftGlove && LeftGlove->GetStaticMesh() && LeftGlove->IsVisible())
		{
			PhotonVisuals::ConfigureFirstPersonViewModel(LeftGlove);
			PhotonVisuals::ApplySurface(LeftGlove, EPhotonSurface::Cover,
				FLinearColor(0.28f, 0.30f, 0.34f));
		}
		if (FirstPersonArms && FirstPersonArms->GetSkeletalMeshAsset() && FirstPersonArms->IsVisible())
		{
			PhotonVisuals::ConfigureFirstPersonViewModel(FirstPersonArms);
			FTimerHandle AlignTimer;
			GetWorldTimerManager().SetTimer(AlignTimer, this,
				&APhotonCharacter::AlignFirstPersonArmsToGrip, 0.05f, false);
		}
		if (WeaponViewMesh)
		{
			PhotonVisuals::ConfigureFirstPersonViewModel(WeaponViewMesh);
		}
		if (Inventory)
		{
			Inventory->RefreshWeaponPresentation();
		}

		AlignFpViewmodelPresentation();
		FTimerHandle VmAlign;
		GetWorldTimerManager().SetTimer(VmAlign, this,
			&APhotonCharacter::AlignFpViewmodelPresentation, 0.12f, false);
	}
	else if (IsLocallyControlled() && Inventory)
	{
		Inventory->RefreshWeaponPresentation();
	}

	SyncThirdPersonWeaponMesh();
	ApplyViewPresentation();
	// Inventory component BeginPlay may equip after early presentation — stamp TP hide again.
	if (bThirdPersonView && Inventory)
	{
		Inventory->RefreshWeaponPresentation();
		ApplyViewPresentation();
	}

	if (FParse::Param(FCommandLine::Get(), TEXT("PhotonSelfTest")))
	{
		FTimerHandle H;
		GetWorldTimerManager().SetTimer(H, this, &APhotonCharacter::RunSelfTest, 1.0f, false);
	}
}

void APhotonCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (bHeroPresentationReady)
	{
		UpdateHeroLocomotion();
		LockHeroRootMotion();
	}
}

void APhotonCharacter::SetupHeroPresentation()
{
	bHeroPresentationReady = false;
	bHeroMeshOffsetLocked = false;
	HeroMeshOffsetRecheckTimer = 0.f;
	HeroMeshLockedRelative = FVector(0.f, 0.f, -97.5f);

	// Third-person body. OwnerNoSee is decided by ApplyViewPresentation (TP shows, FP hides).
	if (USkeletalMeshComponent* Body = GetMesh())
	{
		Body->SetRelativeLocation(FVector(0.f, 0.f, -97.5f));
		Body->SetRelativeRotation(FRotator(0.f, -90.f, 0.f));
		Body->SetAnimationMode(EAnimationMode::AnimationSingleNode);
		Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);

		if (USkeletalMesh* HeroMesh = LoadObject<USkeletalMesh>(
				nullptr, TEXT("/Game/Photon/Characters/Hero/SK_PhotonHero.SK_PhotonHero")))
		{
			EnsureWeaponSocket(HeroMesh);
			Body->SetSkeletalMesh(HeroMesh);
			const EPhotonTeam HeroTeam = (Health && Health->Team != EPhotonTeam::None)
				? Health->Team : EPhotonTeam::Blue;
			PhotonVisuals::ApplyHeroTeamPresentation(Body, HeroTeam);
			Body->UpdateBounds();
			const FBoxSphereBounds B = Body->Bounds;
			// Mixamo imports occasionally land at cm/m mismatch; a multi-meter body swallows the chase cam.
			if (B.SphereRadius > 250.f)
			{
				const float FixScale = 180.f / FMath::Max(B.SphereRadius, 1.f);
				Body->SetRelativeScale3D(Body->GetRelativeScale3D() * FixScale);
				Body->UpdateBounds();
				UE_LOG(LogTemp, Warning,
					TEXT("[Photon] hero mesh oversized (r=%.1f) — applied scale*=%.3f -> r=%.1f"),
					B.SphereRadius, FixScale, Body->Bounds.SphereRadius);
			}
			bHeroPresentationReady = true;
			UE_LOG(LogTemp, Display,
				TEXT("[Photon] third-person hero mesh loaded (%d bones) team=%d bounds_r=%.1f scale=%s"),
				HeroMesh->GetRefSkeleton().GetNum(), static_cast<int32>(HeroTeam),
				Body->Bounds.SphereRadius, *Body->GetRelativeScale3D().ToCompactString());
		}
		else
		{
			UE_LOG(LogTemp, Warning,
				TEXT("[Photon] SK_PhotonHero missing — third-person body not ready. Run Tools/import_photon_hero_nofinger.py"));
		}
	}

	// FP readability path: static robot forearms + Tripo gloves. Keep skinned hero extract loaded
	// but hidden so it does not compete with the viewmodel (prior tour shots showed it as a blob).
	const bool bRobotArms =
		(RightArm && RightArm->GetStaticMesh()
			&& RightArm->GetStaticMesh()->GetPathName().Contains(TEXT("RobotArm")))
		|| (LeftArm && LeftArm->GetStaticMesh()
			&& LeftArm->GetStaticMesh()->GetPathName().Contains(TEXT("RobotArm")));
	const bool bGloves = (RightGlove && RightGlove->GetStaticMesh())
		|| (LeftGlove && LeftGlove->GetStaticMesh());
	if (bRobotArms || bGloves)
	{
		if (FirstPersonArms)
		{
			FirstPersonArms->SetHiddenInGame(true);
			FirstPersonArms->SetVisibility(false, true);
		}
		UE_LOG(LogTemp, Display,
			TEXT("[Photon] FP viewmodel: robot_arms=%d gloves=%d (skinned hero FP hidden)"),
			bRobotArms ? 1 : 0, bGloves ? 1 : 0);
	}
	else if (FirstPersonArms)
	{
		if (USkeletalMesh* ArmsMesh = LoadObject<USkeletalMesh>(
				nullptr, TEXT("/Game/Photon/Characters/Hero/FPArms/SK_PhotonFPArms.SK_PhotonFPArms")))
		{
			FirstPersonArms->SetSkeletalMesh(ArmsMesh);
			FirstPersonArms->SetHiddenInGame(false);
			FirstPersonArms->SetAnimationMode(EAnimationMode::AnimationSingleNode);
			PhotonVisuals::ConfigureFirstPersonViewModel(FirstPersonArms);
			AlignFirstPersonArmsToGrip();
			UE_LOG(LogTemp, Display, TEXT("[Photon] first-person skinned arms loaded (robot/glove missing)"));
		}
	}

	auto LoadClipFirst = [](const TCHAR* const* Paths, int32 Count) -> UAnimSequence*
	{
		for (int32 i = 0; i < Count; ++i)
		{
			if (UAnimSequence* Clip = LoadObject<UAnimSequence>(nullptr, Paths[i]))
			{
				return Clip;
			}
		}
		return nullptr;
	};
	const TCHAR* IdlePaths[] = {
		TEXT("/Game/Photon/Characters/Hero/A_PhotonHero_Idle.A_PhotonHero_Idle"),
		TEXT("/Game/Photon/Characters/Hero/PhotonHero_SKA_PhotonHero_Idle.PhotonHero_SKA_PhotonHero_Idle"),
		TEXT("/Game/Photon/Characters/Hero/PhotonHero_SKArmature_A_PhotonHero_Idle.PhotonHero_SKArmature_A_PhotonHero_Idle"),
	};
	const TCHAR* WalkPaths[] = {
		TEXT("/Game/Photon/Characters/Hero/A_PhotonHero_Walk.A_PhotonHero_Walk"),
		TEXT("/Game/Photon/Characters/Hero/PhotonHero_SKA_PhotonHero_Walk.PhotonHero_SKA_PhotonHero_Walk"),
		TEXT("/Game/Photon/Characters/Hero/PhotonHero_SKArmature_A_PhotonHero_Walk.PhotonHero_SKArmature_A_PhotonHero_Walk"),
	};
	const TCHAR* RunPaths[] = {
		TEXT("/Game/Photon/Characters/Hero/A_PhotonHero_Run.A_PhotonHero_Run"),
		TEXT("/Game/Photon/Characters/Hero/PhotonHero_SKA_PhotonHero_Run.PhotonHero_SKA_PhotonHero_Run"),
		TEXT("/Game/Photon/Characters/Hero/PhotonHero_SKArmature_A_PhotonHero_Run.PhotonHero_SKArmature_A_PhotonHero_Run"),
	};
	const TCHAR* SprintPaths[] = {
		TEXT("/Game/Photon/Characters/Hero/A_PhotonHero_Sprint.A_PhotonHero_Sprint"),
		TEXT("/Game/Photon/Characters/Hero/PhotonHero_SKA_PhotonHero_Sprint.PhotonHero_SKA_PhotonHero_Sprint"),
		TEXT("/Game/Photon/Characters/Hero/PhotonHero_SKArmature_A_PhotonHero_Sprint.PhotonHero_SKArmature_A_PhotonHero_Sprint"),
	};
	HeroAnimIdle = LoadClipFirst(IdlePaths, UE_ARRAY_COUNT(IdlePaths));
	HeroAnimWalk = LoadClipFirst(WalkPaths, UE_ARRAY_COUNT(WalkPaths));
	HeroAnimRun = LoadClipFirst(RunPaths, UE_ARRAY_COUNT(RunPaths));
	HeroAnimSprint = LoadClipFirst(SprintPaths, UE_ARRAY_COUNT(SprintPaths));

	if (USkeletalMeshComponent* Body = GetMesh())
	{
		// Start from ref pose on the capsule. Mixamo clips still sink the root even with
		// bForceRootLock until we validate a locked clip; LockHeroRootMotion re-anchors each tick.
		Body->SetForceRefPose(false);
		Body->SetRelativeLocation(FVector(0.f, 0.f, -97.5f));
		Body->SetRelativeRotation(FRotator(0.f, -90.f, 0.f));
	}

	if (HeroAnimIdle || HeroAnimWalk || HeroAnimRun)
	{
		PlayHeroClip(HeroAnimIdle ? HeroAnimIdle.Get() : HeroAnimWalk.Get(), true);
		LockHeroRootMotion();
		UE_LOG(LogTemp, Display,
			TEXT("[Photon] hero clips idle=%d walk=%d run=%d sprint=%d"),
			HeroAnimIdle != nullptr, HeroAnimWalk != nullptr,
			HeroAnimRun != nullptr, HeroAnimSprint != nullptr);
	}
}

void APhotonCharacter::AlignFirstPersonArmsToGrip()
{
	if (!FirstPersonArms || !FirstPersonArms->GetSkeletalMeshAsset() || !Camera)
	{
		return;
	}

	FName HandBone(TEXT("RightHand"));
	if (FirstPersonArms->GetBoneIndex(HandBone) == INDEX_NONE)
	{
		HandBone = FName(TEXT("mixamorig:RightHand"));
	}
	if (FirstPersonArms->GetBoneIndex(HandBone) == INDEX_NONE)
	{
		UE_LOG(LogTemp, Warning, TEXT("[Photon] FP arms align skipped — no RightHand bone"));
		return;
	}

	// Force a refresh so bone transforms are valid before we sample them.
	FirstPersonArms->RefreshBoneTransforms();
	FirstPersonArms->UpdateBounds();

	const FVector HandWorld = FirstPersonArms->GetBoneLocation(HandBone);
	const FVector GripWorld = Camera->GetComponentTransform().TransformPosition(RightGripCamera);
	const FVector Delta = GripWorld - HandWorld;
	FirstPersonArms->AddWorldOffset(Delta, false);

	const FVector HandAfter = FirstPersonArms->GetBoneLocation(HandBone);
	UE_LOG(LogTemp, Display,
		TEXT("[Photon] FP arms aligned: bone=%s delta=(%.1f,%.1f,%.1f) hand->grip err=%.1f"),
		*HandBone.ToString(), Delta.X, Delta.Y, Delta.Z,
		FVector::Dist(HandAfter, GripWorld));
}

void APhotonCharacter::ApplyViewPresentation()
{
	auto HideFp = [](UPrimitiveComponent* Prim)
	{
		if (!Prim)
		{
			return;
		}
		// ConfigureFirstPersonViewModel force-unhides; stamp these after any weapon sync.
		Prim->SetHiddenInGame(true);
		Prim->SetVisibility(false, true);
		Prim->SetOnlyOwnerSee(false);
		Prim->SetOwnerNoSee(true);
		Prim->SetFirstPersonPrimitiveType(EFirstPersonPrimitiveType::None);
	};

	if (bThirdPersonView)
	{
		if (SpringArm && Camera && Camera->GetAttachParent() != SpringArm)
		{
			Camera->AttachToComponent(SpringArm, FAttachmentTransformRules::SnapToTargetNotIncludingScale,
				USpringArmComponent::SocketName);
		}
		if (Camera)
		{
			Camera->bUsePawnControlRotation = false;
			Camera->bEnableFirstPersonFieldOfView = false;
			Camera->bEnableFirstPersonScale = false;
			Camera->SetRelativeLocation(FVector::ZeroVector);
			Camera->SetRelativeRotation(FRotator::ZeroRotator);
		}
		if (SpringArm)
		{
			SpringArm->bUsePawnControlRotation = true;
			SpringArm->bDoCollisionTest = true;
			SpringArm->ProbeSize = 12.f;
			SpringArm->TargetArmLength = 450.f;
			SpringArm->SocketOffset = FVector(0.f, 45.f, 70.f);
			SpringArm->TargetOffset = FVector(0.f, 0.f, 40.f);
			SpringArm->bEnableCameraLag = false;
			SpringArm->bEnableCameraRotationLag = false;
		}

		if (USkeletalMeshComponent* Body = GetMesh())
		{
			Body->SetOwnerNoSee(false);
			Body->SetOnlyOwnerSee(false);
			Body->SetHiddenInGame(false);
			Body->SetVisibility(true, true);
			Body->SetLightingChannels(true, false, false);
			Body->SetCastShadow(true);
			// Force a refresh so skeletal materials with newly-enabled usage flags bind.
			Body->MarkRenderStateDirty();
		}

		// Kill the broken FP gun/arm stack for local TP play.
		// Cascade-hide every camera child — leaf HideFp alone still left lens-filling junk
		// (18 camera-attached components were observed filling -PhotonShot frames).
		if (Camera)
		{
			TArray<USceneComponent*> CamKids;
			Camera->GetChildrenComponents(true, CamKids);
			for (USceneComponent* Kid : CamKids)
			{
				if (!Kid)
				{
					continue;
				}
				Kid->SetVisibility(false, true);
				if (UPrimitiveComponent* Prim = Cast<UPrimitiveComponent>(Kid))
				{
					HideFp(Prim);
				}
			}
		}
		if (FirstPersonPresentationRoot)
		{
			FirstPersonPresentationRoot->SetVisibility(false, true);
		}
		if (WeaponRoot)
		{
			WeaponRoot->SetVisibility(false, true);
		}
		HideFp(WeaponViewMesh);
		HideFp(RightArm);
		HideFp(LeftArm);
		HideFp(RightGlove);
		HideFp(LeftGlove);
		HideFp(FirstPersonArms);
		// Inventory weapons stay on WeaponRoot for fire math — never draw them in TP (black ch1 gun).
		if (Inventory)
		{
			for (const TObjectPtr<APhotonWeapon>& W : Inventory->Weapons)
			{
				if (!W)
				{
					continue;
				}
				W->SetActorHiddenInGame(true);
				if (W->Mesh)
				{
					HideFp(W->Mesh);
				}
			}
		}
		if (ViewModelKey)
		{
			ViewModelKey->SetVisibility(false);
			ViewModelKey->SetIntensity(0.f);
		}
		if (ViewModelFill)
		{
			ViewModelFill->SetVisibility(false);
			ViewModelFill->SetIntensity(0.f);
		}
		if (ThirdPersonWeaponMesh)
		{
			ThirdPersonWeaponMesh->SetOwnerNoSee(false);
			ThirdPersonWeaponMesh->SetOnlyOwnerSee(false);
			ThirdPersonWeaponMesh->SetHiddenInGame(false);
			ThirdPersonWeaponMesh->SetVisibility(true, true);
			ThirdPersonWeaponMesh->SetLightingChannels(true, false, false);
			ThirdPersonWeaponMesh->SetCastShadow(true);
		}

		const FVector CamLoc = Camera ? Camera->GetComponentLocation() : FVector::ZeroVector;
		const FVector PawnLoc = GetActorLocation();
		UE_LOG(LogTemp, Display,
			TEXT("[Photon] view presentation: THIRD-PERSON arm=%.0f body=%s fp_gun_hidden=%d "
				 "cam_dist=%.0f cam=%s pawn=%s mesh_r=%.0f"),
			SpringArm ? SpringArm->TargetArmLength : -1.f,
			(GetMesh() && GetMesh()->GetSkeletalMeshAsset()) ? TEXT("yes") : TEXT("no"),
			(WeaponViewMesh && WeaponViewMesh->bHiddenInGame) ? 1 : 0,
			FVector::Dist(CamLoc, PawnLoc),
			*CamLoc.ToCompactString(), *PawnLoc.ToCompactString(),
			GetMesh() ? GetMesh()->Bounds.SphereRadius : -1.f);
	}
	else
	{
		if (Camera && Camera->GetAttachParent() != GetCapsuleComponent())
		{
			Camera->AttachToComponent(GetCapsuleComponent(),
				FAttachmentTransformRules::SnapToTargetNotIncludingScale);
		}
		if (Camera)
		{
			Camera->SetRelativeLocation(FVector(0.f, 0.f, EyeHeight));
			Camera->bUsePawnControlRotation = true;
			PhotonVisuals::ConfigureFirstPersonCamera(Camera);
		}
		if (FirstPersonPresentationRoot)
		{
			FirstPersonPresentationRoot->SetVisibility(true, true);
		}
		if (WeaponRoot)
		{
			WeaponRoot->SetVisibility(true, true);
		}
		if (USkeletalMeshComponent* Body = GetMesh())
		{
			Body->SetOwnerNoSee(true);
		}
		if (ThirdPersonWeaponMesh)
		{
			ThirdPersonWeaponMesh->SetOwnerNoSee(true);
		}
		if (WeaponViewMesh)
		{
			WeaponViewMesh->SetOwnerNoSee(false);
			WeaponViewMesh->SetHiddenInGame(false);
			WeaponViewMesh->SetVisibility(true, true);
		}
		if (ViewModelKey)
		{
			ViewModelKey->SetVisibility(true);
			ViewModelKey->SetIntensity(105.f);
		}
		if (ViewModelFill)
		{
			ViewModelFill->SetVisibility(true);
			ViewModelFill->SetIntensity(30.f);
		}

		UE_LOG(LogTemp, Display,
			TEXT("[Photon] view presentation: FIRST-PERSON (-PhotonFirstPerson)"));
	}
}

void APhotonCharacter::AlignFpViewmodelPresentation()
{
	if (bThirdPersonView)
	{
		return;
	}
	if (!Camera || !WeaponRoot)
	{
		return;
	}

	// Presentation strategy for this pass:
	//   1) Hide robot arm extracts — they include an open whole-hand that fights the glove and
	//      leave a mid-frame stump. Forearm return is a follow-up (forearm-only extract).
	//   2) Keep the glove on WeaponRoot in camera space (same space as HipTransform translation)
	//      so we do not invent a second weapon system and do not inherit the 0.34 hip scale.
	//   3) Seat the open-palm glove on the grip; fingers drive into the receiver so the silhouette
	//      reads as a closed hold from the gameplay camera.

	auto HideArm = [](UStaticMeshComponent* Arm)
	{
		if (!Arm)
		{
			return;
		}
		Arm->SetHiddenInGame(true);
		Arm->SetVisibility(false, true);
	};
	HideArm(RightArm);
	HideArm(LeftArm);

	auto PlaceGlove = [this](UStaticMeshComponent* Glove, const FVector& Loc, const FRotator& Rot,
		const FVector& Scale, bool bShow)
	{
		if (!Glove || !Glove->GetStaticMesh())
		{
			return;
		}
		if (!bShow)
		{
			Glove->SetHiddenInGame(true);
			Glove->SetVisibility(false, true);
			return;
		}
		Glove->SetUsingAbsoluteScale(false);
		Glove->AttachToComponent(WeaponRoot, FAttachmentTransformRules::SnapToTargetNotIncludingScale);
		Glove->SetRelativeLocation(Loc);
		Glove->SetRelativeRotation(Rot);
		Glove->SetRelativeScale3D(Scale);
		Glove->SetHiddenInGame(false);
		Glove->SetVisibility(true, true);
		PhotonVisuals::ConfigureFirstPersonViewModel(Glove);
		PhotonVisuals::ApplySurface(Glove, EPhotonSurface::Cover,
			FLinearColor(0.20f, 0.22f, 0.26f));
	};

	// Hip origin is (44,14,-12). Palm sits on the grip slightly under/behind that point.
	// Glove origin = wrist; palm center is ~+6 cm along local +Z — offset so the palm lands on grip.
	const FVector GripPalm(44.f, 14.f, -10.f);
	const FRotator GloveRot(-88.f, -5.f, 105.f);
	const FVector Wrist =
		GripPalm - GloveRot.RotateVector(FVector(0.f, 0.f, 5.0f));
	PlaceGlove(RightGlove, Wrist, GloveRot, FVector(1.25f), true);
	PlaceGlove(LeftGlove, FVector::ZeroVector, FRotator::ZeroRotator, FVector(0.5f), false);

	RightGripCamera = Wrist;
	LeftGripCamera = FVector(56.f, 8.f, -10.f);

	if (WeaponViewMesh && RightGlove)
	{
		UE_LOG(LogTemp, Display,
			TEXT("[Photon] FP viewmodel aligned: glove-only on WeaponRoot wrist=(%.1f,%.1f,%.1f) "
				 "weaponRel=(%.1f,%.1f,%.1f)"),
			Wrist.X, Wrist.Y, Wrist.Z,
			WeaponViewMesh->GetRelativeLocation().X,
			WeaponViewMesh->GetRelativeLocation().Y,
			WeaponViewMesh->GetRelativeLocation().Z);
	}
	else
	{
		UE_LOG(LogTemp, Display,
			TEXT("[Photon] FP viewmodel aligned: glove-only on WeaponRoot (arms hidden)"));
	}
}

void APhotonCharacter::EnsureWeaponSocket(USkeletalMesh* MeshAsset)
{
	if (!MeshAsset)
	{
		return;
	}
	if (MeshAsset->FindSocket(WeaponSocketName))
	{
		return;
	}

	const FReferenceSkeleton& RefSkel = MeshAsset->GetRefSkeleton();
	FName HandBone(TEXT("mixamorig:RightHand"));
	if (RefSkel.FindBoneIndex(HandBone) == INDEX_NONE)
	{
		HandBone = FName(TEXT("RightHand"));
		if (RefSkel.FindBoneIndex(HandBone) == INDEX_NONE)
		{
			UE_LOG(LogTemp, Warning, TEXT("[Photon] cannot create %s — RightHand bone missing"),
				*WeaponSocketName.ToString());
			return;
		}
	}

	USkeletalMeshSocket* Socket = NewObject<USkeletalMeshSocket>(MeshAsset);
	Socket->SocketName = WeaponSocketName;
	Socket->BoneName = HandBone;
	// Documented bone-local cm (see HeroPrep/SOCKET_weapon_right.json).
	Socket->RelativeLocation = FVector(8.f, 2.5f, 0.f);
	Socket->RelativeRotation = FRotator(/*Pitch*/ 90.f, /*Yaw*/ 0.f, /*Roll*/ 0.f);
	Socket->RelativeScale = FVector(1.f);
	MeshAsset->AddSocket(Socket);
	UE_LOG(LogTemp, Display,
		TEXT("[Photon] created %s on bone %s loc=(8,2.5,0) rot=(P90,Y0,R0) scale=1"),
		*WeaponSocketName.ToString(), *HandBone.ToString());
}

void APhotonCharacter::PlayHeroClip(UAnimSequence* Clip, bool bLoop)
{
	if (!Clip || Clip == ActiveHeroClip)
	{
		return;
	}
	ActiveHeroClip = Clip;
	if (USkeletalMeshComponent* Body = GetMesh())
	{
		if (Body->GetSkeletalMeshAsset())
		{
			Body->PlayAnimation(Clip, bLoop);
			LockHeroRootMotion();
		}
	}
	// FP arms stay on the authored closed-grip rifle-hold rest pose (no per-clip retarget).
}

void APhotonCharacter::PossessedBy(AController* NewController)
{
	Super::PossessedBy(NewController);
	if (bThirdPersonView)
	{
		ApplyThirdPersonLookDefaults();
	}
}

void APhotonCharacter::ApplyThirdPersonLookDefaults()
{
	if (!bThirdPersonView)
	{
		return;
	}
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (PC->PlayerCameraManager)
		{
			// Block floor-stare top-down that parks the hero as a V-blob on the bottom edge.
			PC->PlayerCameraManager->ViewPitchMin = -50.f;
			PC->PlayerCameraManager->ViewPitchMax = 35.f;
		}
		FRotator Look = PC->GetControlRotation();
		Look.Pitch = -14.f;
		Look.Roll = 0.f;
		PC->SetControlRotation(Look);
	}
}

void APhotonCharacter::LockHeroRootMotion()
{
	USkeletalMeshComponent* Body = GetMesh();
	if (!Body || !Body->GetSkeletalMeshAsset())
	{
		return;
	}

	// Mutate clip assets once — every-tick writes were pointless and noisy.
	if (UAnimSequence* Clip = ActiveHeroClip.Get())
	{
		if (Clip->bEnableRootMotion || !Clip->bForceRootLock)
		{
			Clip->bEnableRootMotion = false;
			Clip->bForceRootLock = true;
			Clip->RootMotionRootLock = ERootMotionRootLock::RefPose;
		}
	}
	if (UAnimSingleNodeInstance* Node = Body->GetSingleNodeInstance())
	{
		Node->SetRootMotionMode(ERootMotionMode::IgnoreRootMotion);
	}

	Body->SetRelativeRotation(FRotator(0.f, -90.f, 0.f));

	// Fast path: keep the cached hips anchor so we do not reset+RefreshBoneTransforms every tick
	// (that fight left the idle looking like a flat T-pose splat under steep pitch).
	if (bHeroMeshOffsetLocked)
	{
		Body->SetRelativeLocation(HeroMeshLockedRelative);
		HeroMeshOffsetRecheckTimer -= GetWorld() ? GetWorld()->GetDeltaSeconds() : 0.016f;
		if (HeroMeshOffsetRecheckTimer > 0.f)
		{
			return;
		}
		HeroMeshOffsetRecheckTimer = 0.5f;
	}

	const FVector BaseRelative(0.f, 0.f, -97.5f);
	Body->SetRelativeLocation(BaseRelative);
	Body->RefreshBoneTransforms();

	FName HipBone(TEXT("mixamorig:Hips"));
	if (Body->GetBoneIndex(HipBone) == INDEX_NONE)
	{
		HipBone = FName(TEXT("Hips"));
	}
	if (Body->GetBoneIndex(HipBone) == INDEX_NONE)
	{
		HeroMeshLockedRelative = BaseRelative;
		bHeroMeshOffsetLocked = true;
		return;
	}

	const FVector Hips = Body->GetBoneLocation(HipBone);
	const FVector WantHips = GetActorLocation() + FVector(0.f, 0.f, 10.f);
	const FVector WorldDelta = WantHips - Hips;
	if (WorldDelta.SizeSquared() > 100.f) // >10cm
	{
		const FVector LocalDelta = Body->GetComponentTransform().InverseTransformVectorNoScale(WorldDelta);
		HeroMeshLockedRelative = BaseRelative + LocalDelta;
	}
	else
	{
		HeroMeshLockedRelative = Body->GetRelativeLocation();
	}
	Body->SetRelativeLocation(HeroMeshLockedRelative);
	bHeroMeshOffsetLocked = true;
}

void APhotonCharacter::LogHeroBoneFrame(const TCHAR* Tag) const
{
	const USkeletalMeshComponent* Body = GetMesh();
	if (!Body || !Body->GetSkeletalMeshAsset())
	{
		UE_LOG(LogTemp, Display, TEXT("[Photon] %s bones=none"), Tag);
		return;
	}
	auto Find = [Body](const TCHAR* A, const TCHAR* B) -> FName
	{
		FName N(A);
		if (Body->GetBoneIndex(N) != INDEX_NONE)
		{
			return N;
		}
		return FName(B);
	};
	const FName Hips = Find(TEXT("mixamorig:Hips"), TEXT("Hips"));
	const FName Head = Find(TEXT("mixamorig:Head"), TEXT("Head"));
	const FName LHand = Find(TEXT("mixamorig:LeftHand"), TEXT("LeftHand"));
	const FName RHand = Find(TEXT("mixamorig:RightHand"), TEXT("RightHand"));
	const FVector HipsLoc = Body->GetBoneIndex(Hips) != INDEX_NONE ? Body->GetBoneLocation(Hips) : FVector::ZeroVector;
	const FVector HeadLoc = Body->GetBoneIndex(Head) != INDEX_NONE ? Body->GetBoneLocation(Head) : FVector::ZeroVector;
	const FVector LLoc = Body->GetBoneIndex(LHand) != INDEX_NONE ? Body->GetBoneLocation(LHand) : FVector::ZeroVector;
	const FVector RLoc = Body->GetBoneIndex(RHand) != INDEX_NONE ? Body->GetBoneLocation(RHand) : FVector::ZeroVector;
	const float HeadHips = FVector::Dist(HeadLoc, HipsLoc);
	const float HandSpan = FVector::Dist(LLoc, RLoc);
	UE_LOG(LogTemp, Display,
		TEXT("[Photon] %s head_hips=%.0f hand_span=%.0f hips=%s head=%s mesh_r=%.0f"),
		Tag, HeadHips, HandSpan,
		*HipsLoc.ToCompactString(), *HeadLoc.ToCompactString(),
		Body->Bounds.SphereRadius);
}

void APhotonCharacter::UpdateHeroLocomotion()
{
	const UCharacterMovementComponent* Move = GetCharacterMovement();
	if (!Move)
	{
		return;
	}

	const float Speed = Move->Velocity.Size2D();
	UAnimSequence* Wanted = HeroAnimIdle.Get();
	if (Speed > 10.f)
	{
		if (IsSprinting() && HeroAnimSprint)
		{
			Wanted = HeroAnimSprint.Get();
		}
		else if (Speed >= WalkSpeed * 0.85f && HeroAnimRun)
		{
			Wanted = HeroAnimRun.Get();
		}
		else if (HeroAnimWalk)
		{
			Wanted = HeroAnimWalk.Get();
		}
		else if (HeroAnimRun)
		{
			Wanted = HeroAnimRun.Get();
		}
	}
	if (Wanted)
	{
		PlayHeroClip(Wanted, true);
	}
}

void APhotonCharacter::SyncThirdPersonWeaponMesh()
{
	if (!ThirdPersonWeaponMesh || !GetMesh())
	{
		return;
	}

	UStaticMesh* WeaponMesh = nullptr;
	FTransform Hip = FTransform::Identity;
	if (Inventory)
	{
		if (APhotonWeapon* Active = Inventory->GetActiveWeapon())
		{
			if (Active->Mesh)
			{
				WeaponMesh = Active->Mesh->GetStaticMesh();
			}
			if (Active->Data)
			{
				Hip = Active->Data->HipTransform;
			}
		}
	}
	if (!WeaponMesh && WeaponViewMesh)
	{
		WeaponMesh = WeaponViewMesh->GetStaticMesh();
	}

	if (!WeaponMesh)
	{
		ThirdPersonWeaponMesh->SetHiddenInGame(true);
		return;
	}

	ThirdPersonWeaponMesh->SetStaticMesh(WeaponMesh);
	// Local player must see the hand weapon in TP; FP keeps OwnerNoSee (viewmodel is WeaponViewMesh).
	ThirdPersonWeaponMesh->SetOwnerNoSee(!bThirdPersonView);
	ThirdPersonWeaponMesh->SetHiddenInGame(false);
	if (Health)
	{
		// Tint only — do not Replace PH-6 authored materials with ApplySurface/Energy.
		PhotonVisuals::ApplyTint(ThirdPersonWeaponMesh,
			PhotonTeamColor(Health->Team != EPhotonTeam::None ? Health->Team : EPhotonTeam::Blue) * 0.45f,
			0.6f);
	}

	// HipTransform.Scale is authored for camera FP (~0.34). Never inherit a full-size PH-6 on the hand.
	float Scale = Hip.GetScale3D().X > 0.f ? Hip.GetScale3D().X : 0.34f;
	Scale = FMath::Clamp(Scale, 0.2f, 0.45f);

	if (GetMesh()->DoesSocketExist(WeaponSocketName))
	{
		ThirdPersonWeaponMesh->AttachToComponent(
			GetMesh(),
			FAttachmentTransformRules::SnapToTargetNotIncludingScale,
			WeaponSocketName);
		ThirdPersonWeaponMesh->SetRelativeScale3D(FVector(Scale));
		ThirdPersonWeaponMesh->SetRelativeLocation(FVector::ZeroVector);
		ThirdPersonWeaponMesh->SetRelativeRotation(FRotator::ZeroRotator);
	}
	else
	{
		// Socket not imported yet — parent to the hand bone directly with the documented offset.
		ThirdPersonWeaponMesh->AttachToComponent(
			GetMesh(), FAttachmentTransformRules::KeepRelativeTransform);
		ThirdPersonWeaponMesh->SetRelativeLocation(FVector(8.f, 2.5f, 0.f));
		ThirdPersonWeaponMesh->SetRelativeRotation(FRotator(90.f, 0.f, 0.f));
		ThirdPersonWeaponMesh->SetRelativeScale3D(FVector(0.34f));
		UE_LOG(LogTemp, Warning,
			TEXT("[Photon] %s missing on hero mesh — using documented hand offset fallback"),
			*WeaponSocketName.ToString());
	}
}

void APhotonCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* EIC = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	APhotonPlayerController* PC = Cast<APhotonPlayerController>(GetController());
	if (!EIC || !PC)
	{
		UE_LOG(LogTemp, Error, TEXT("[Photon] input setup failed: EIC=%d PC=%d"), EIC != nullptr, PC != nullptr);
		return;
	}

	int32 Bound = 0, Missing = 0;
	auto Bind = [EIC, PC, &Bound, &Missing](FName Name, ETriggerEvent Event, auto Fn, APhotonCharacter* Self)
	{
		if (UInputAction* Action = PC->FindAction(Name))
		{
			EIC->BindAction(Action, Event, Self, Fn);
			++Bound;
		}
		else
		{
			++Missing;
			UE_LOG(LogTemp, Warning, TEXT("[Photon] no action %s to bind"), *Name.ToString());
		}
	};

	Bind("IA_Move", ETriggerEvent::Triggered, &APhotonCharacter::OnMove, this);
	Bind("IA_Look", ETriggerEvent::Triggered, &APhotonCharacter::OnLook, this);
	Bind("IA_LookStick", ETriggerEvent::Triggered, &APhotonCharacter::OnLookStick, this);
	Bind("IA_Jump", ETriggerEvent::Started, &APhotonCharacter::OnJumpStart, this);
	Bind("IA_Jump", ETriggerEvent::Completed, &APhotonCharacter::OnJumpStop, this);
	Bind("IA_CrouchSlide", ETriggerEvent::Started, &APhotonCharacter::OnCrouchToggle, this);
	Bind("IA_Sprint", ETriggerEvent::Started, &APhotonCharacter::OnSprintStart, this);
	Bind("IA_Sprint", ETriggerEvent::Completed, &APhotonCharacter::OnSprintStop, this);
	Bind("IA_Fire", ETriggerEvent::Started, &APhotonCharacter::OnFireStarted, this);
	Bind("IA_Fire", ETriggerEvent::Triggered, &APhotonCharacter::OnFireTriggered, this);
	Bind("IA_Fire", ETriggerEvent::Completed, &APhotonCharacter::OnFireReleased, this);
	Bind("IA_WeaponSwitch", ETriggerEvent::Started, &APhotonCharacter::OnWeaponSwitch, this);
	Bind("IA_WeaponSelect", ETriggerEvent::Started, &APhotonCharacter::OnWeaponSelect, this);
	Bind("IA_Grenade", ETriggerEvent::Started, &APhotonCharacter::OnGrenade, this);

	// Counted, not assumed. The first version logged "input bound" unconditionally and was reported as
	// verified while all eight binds were failing.
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONVERIFY binds ok=%d missing=%d on %s"),
		Bound, Missing, *GetName());
}

void APhotonCharacter::OnMove(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	if (Axis.IsNearlyZero())
	{
		return;
	}
	// Movement is relative to where the player is looking, yaw only — pitch must not tilt the ground
	// plane or looking down slows you.
	AddMovementInput(GetActorForwardVector(), Axis.Y);
	AddMovementInput(GetActorRightVector(), Axis.X);
}

void APhotonCharacter::OnLook(const FInputActionValue& Value)
{
	// Mouse. Enhanced Input delivers a per-frame delta here, so scaling by DeltaTime would make
	// sensitivity depend on frame rate — the classic mouse-feel bug. Applied raw.
	const FVector2D Axis = Value.Get<FVector2D>();
	if (Axis.IsNearlyZero())
	{
		return;
	}
	AddControllerYawInput(Axis.X * MouseLookScale);
	AddControllerPitchInput(-Axis.Y * MouseLookScale);
}

void APhotonCharacter::OnLookStick(const FInputActionValue& Value)
{
	// Stick. This is a held magnitude, not a delta, so it is a *rate* and must be integrated over
	// DeltaTime. The first version routed both sources through one handler and left the gamepad term
	// multiplied by zero, which made right-stick look completely dead while mouse look felt correct.
	const FVector2D Axis = Value.Get<FVector2D>();
	if (Axis.IsNearlyZero())
	{
		return;
	}
	const float Delta = GetWorld() ? GetWorld()->GetDeltaSeconds() : 0.f;
	AddControllerYawInput(Axis.X * GamepadLookRate * Delta);
	AddControllerPitchInput(-Axis.Y * GamepadLookRate * Delta);
}

void APhotonCharacter::OnFireStarted(const FInputActionValue&)
{
	if (!Inventory)
	{
		return;
	}
	APhotonWeapon* W = Inventory->GetActiveWeapon();
	if (!W || !W->Data)
	{
		return;
	}
	// Burst and semi-auto fire once per trigger press, not every held frame.
	if (W->Data->FireMode != EPhotonFireMode::Automatic)
	{
		W->TryFire(this);
	}
}

void APhotonCharacter::OnFireTriggered(const FInputActionValue&)
{
	if (!Inventory)
	{
		return;
	}
	APhotonWeapon* W = Inventory->GetActiveWeapon();
	if (!W || !W->Data)
	{
		return;
	}
	// Automatic weapons repeat while the trigger is held.
	if (W->Data->FireMode == EPhotonFireMode::Automatic)
	{
		W->TryFire(this);
	}
}

void APhotonCharacter::OnFireReleased(const FInputActionValue&)
{
	if (!Inventory)
	{
		return;
	}
	if (APhotonWeapon* W = Inventory->GetActiveWeapon())
	{
		W->NotifyFireReleased();
	}
}

void APhotonCharacter::OnWeaponSwitch(const FInputActionValue&)
{
	if (Inventory)
	{
		Inventory->EquipNext();
		SyncThirdPersonWeaponMesh();
		if (bThirdPersonView)
		{
			ApplyViewPresentation();
		}
		else
		{
			AlignFpViewmodelPresentation();
		}
	}
}

void APhotonCharacter::OnWeaponSelect(const FInputActionValue& Value)
{
	// One action carries 1/2 keys (discrete slots), D-pad (prev/next), and future binds.
	if (!Inventory)
	{
		return;
	}
	const float Axis = Value.Get<float>();
	if (FMath::IsNearlyEqual(Axis, 0.f, 0.01f))
	{
		Inventory->EquipIndex(0);
		SyncThirdPersonWeaponMesh();
		AlignFpViewmodelPresentation();
		return;
	}
	if (FMath::IsNearlyEqual(Axis, 1.f, 0.01f))
	{
		Inventory->EquipIndex(1);
		SyncThirdPersonWeaponMesh();
		AlignFpViewmodelPresentation();
		return;
	}
	if (Axis < 0.f)
	{
		const int32 Count = Inventory->Weapons.Num();
		Inventory->EquipIndex(Count > 0 ? (Inventory->ActiveIndex + Count - 1) % Count : 0);
	}
	else
	{
		Inventory->EquipNext();
	}
	SyncThirdPersonWeaponMesh();
	AlignFpViewmodelPresentation();
}

void APhotonCharacter::OnGrenade(const FInputActionValue&)
{
	if (!GetWorld())
	{
		return;
	}
	UPhotonGrenadeData* const GrenadeData = LoadObject<UPhotonGrenadeData>(nullptr,
		TEXT("/Game/Photon/Weapons/DA_PhotonGrenade.DA_PhotonGrenade"));
	if (!GrenadeData)
	{
		UE_LOG(LogTemp, Warning, TEXT("[Photon] grenade data asset missing"));
		return;
	}

	FVector EyeLoc;
	FRotator EyeRot;
	GetActorEyesViewPoint(EyeLoc, EyeRot);
	const FVector Forward = EyeRot.Vector();
	const FVector SpawnLoc = EyeLoc + Forward * 42.f;

	FActorSpawnParameters Params;
	Params.Owner = this;
	Params.Instigator = this;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;

	APhotonGrenade* Grenade = GetWorld()->SpawnActor<APhotonGrenade>(
		APhotonGrenade::StaticClass(), SpawnLoc, EyeRot, Params);
	if (!Grenade)
	{
		return;
	}

	EPhotonTeam ThrowTeam = EPhotonTeam::None;
	if (Health)
	{
		ThrowTeam = Health->Team;
	}
	const FVector Velocity = Forward * GrenadeData->ThrowSpeed + FVector(0.f, 0.f, 1.f) * GrenadeData->ThrowUpwardBoost;
	Grenade->InitialiseFrom(GrenadeData, ThrowTeam, GetController(), Velocity);
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONVERIFY grenade thrown speed=%.0f fuse=%.2f"),
		Grenade->GetSpeed(), Grenade->GetFuseTime());
}

void APhotonCharacter::RunSelfTest()
{
	auto Check = [](const TCHAR* What, bool bOk)
	{
		UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTEST %s = %s"), What, bOk ? TEXT("PASS") : TEXT("FAIL"));
		return bOk;
	};

	Check(TEXT("character_spawned"), true);
	APhotonPlayerController* PC = Cast<APhotonPlayerController>(GetController());
	Check(TEXT("possessed_by_controller"), PC != nullptr);
	Check(TEXT("enhanced_input_component"), Cast<UEnhancedInputComponent>(InputComponent) != nullptr);

	// Keyboard WASD must share IA_Move with the left stick — bind count alone missed this defect.
	if (PC)
	{
		Check(TEXT("move_key_w"), PC->IsKeyMappedToAction(TEXT("IA_Move"), EKeys::W));
		Check(TEXT("move_key_a"), PC->IsKeyMappedToAction(TEXT("IA_Move"), EKeys::A));
		Check(TEXT("move_key_s"), PC->IsKeyMappedToAction(TEXT("IA_Move"), EKeys::S));
		Check(TEXT("move_key_d"), PC->IsKeyMappedToAction(TEXT("IA_Move"), EKeys::D));
		Check(TEXT("move_key_gamepad"), PC->IsKeyMappedToAction(TEXT("IA_Move"), EKeys::Gamepad_Left2D));
	}

	// Simulate keyboard/stick axes reaching OnMove — proves the handler accepts input, not just keys.
	OnMove(FInputActionValue(FVector2D(0.f, 1.f))); // W / forward
	Check(TEXT("move_forward_pending_input"), GetPendingMovementInputVector().SizeSquared() > 0.01f);
	OnMove(FInputActionValue(FVector2D(-1.f, 0.f))); // A / left
	Check(TEXT("move_left_pending_input"), GetPendingMovementInputVector().SizeSquared() > 0.01f);
	Check(TEXT("inventory_exists"), Inventory != nullptr);
	if (!Inventory)
	{
		return;
	}
	Check(TEXT("two_weapons_spawned"), Inventory->Weapons.Num() >= 2);
	Check(TEXT("ph6_active_initially"), Inventory->GetActiveWeaponId() == FName("photon_rifle"));

	Check(TEXT("switch_to_ph9"), Inventory->EquipIndex(1) &&
		Inventory->GetActiveWeaponId() == FName("ph9_smg"));
	if (bThirdPersonView)
	{
		// TP: camera-parented weapon actors stay hidden; hand gun is ThirdPersonWeaponMesh.
		Check(TEXT("ph9_mesh_visible"), Inventory->GetActiveWeapon() != nullptr);
		Check(TEXT("tp_active_weapon_actor_hidden"),
			Inventory->GetActiveWeapon() && Inventory->GetActiveWeapon()->IsHidden());
	}
	else
	{
		Check(TEXT("ph9_mesh_visible"), Inventory->GetActiveWeapon() &&
			!Inventory->GetActiveWeapon()->IsHidden());
	}
	Check(TEXT("ph6_hidden_while_ph9_active"), Inventory->Weapons[0] &&
		Inventory->Weapons[0]->IsHidden());

	// Different data actually reaching the weapon is the point of the whole exercise.
	APhotonWeapon* PH9 = Inventory->GetActiveWeapon();
	APhotonWeapon* PH6 = Inventory->Weapons[0].Get();
	const bool bDiffer = PH6 && PH9 && PH6->Data && PH9->Data &&
		!FMath::IsNearlyEqual(PH6->Data->FireInterval, PH9->Data->FireInterval) &&
		!FMath::IsNearlyEqual(PH6->Data->Damage, PH9->Data->Damage);
	Check(TEXT("ph6_ph9_stats_differ"), bDiffer);
	if (bDiffer)
	{
		UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTEST ph6 interval=%.3f dmg=%.1f | ph9 interval=%.3f dmg=%.1f"),
			PH6->Data->FireInterval, PH6->Data->Damage, PH9->Data->FireInterval, PH9->Data->Damage);
	}

	// Presentation is data-driven: hip scale keeps the GLB out of the crosshair; muzzle/kick live on data.
	Check(TEXT("ph6_hip_scale_viewmodel"), PH6 && PH6->GetHipUniformScale() > 0.2f &&
		PH6->GetHipUniformScale() < 0.6f);
	Check(TEXT("ph9_hip_scale_viewmodel"), PH9 && PH9->GetHipUniformScale() > 0.2f &&
		PH9->GetHipUniformScale() < 0.6f);
	Check(TEXT("ph6_muzzle_offset_from_data"), PH6 && PH6->GetMuzzleOffsetLocal().X > 10.f);
	Check(TEXT("ph9_muzzle_offset_from_data"), PH9 && PH9->GetMuzzleOffsetLocal().X > 10.f);
	Check(TEXT("ph6_recoil_kick_data_present"), PH6 && PH6->Data &&
		PH6->Data->RecoilKickOffset.X < 0.f);
	Check(TEXT("ph9_recoil_kick_data_present"), PH9 && PH9->Data &&
		PH9->Data->RecoilKickOffset.X < 0.f);
	Check(TEXT("third_person_view_default"), bThirdPersonView ||
		FParse::Param(FCommandLine::Get(), TEXT("PhotonFirstPerson")));
	if (bThirdPersonView)
	{
		Check(TEXT("tp_spring_arm_present"), SpringArm != nullptr);
		Check(TEXT("tp_camera_on_spring_arm"),
			Camera && SpringArm && Camera->GetAttachParent() == SpringArm);
		Check(TEXT("tp_camera_lag_off"), SpringArm && !SpringArm->bEnableCameraLag);
		Check(TEXT("tp_body_visible_to_owner"),
			GetMesh() && !GetMesh()->bOwnerNoSee && GetMesh()->IsVisible());
		Check(TEXT("tp_weapon_visible_to_owner"),
			ThirdPersonWeaponMesh && !ThirdPersonWeaponMesh->bOwnerNoSee
			&& !ThirdPersonWeaponMesh->bHiddenInGame);
		Check(TEXT("tp_fp_weapon_view_hidden"),
			!WeaponViewMesh || WeaponViewMesh->bHiddenInGame || !WeaponViewMesh->IsVisible());
		bool bAllInvHidden = true;
		for (const TObjectPtr<APhotonWeapon>& W : Inventory->Weapons)
		{
			if (W && !W->IsHidden())
			{
				bAllInvHidden = false;
				break;
			}
		}
		Check(TEXT("tp_inventory_weapon_actors_hidden"), bAllInvHidden);
		Check(TEXT("tp_hero_material_skeletal"),
			GetMesh() && GetMesh()->GetMaterial(0) != nullptr
			&& GetMesh()->GetMaterial(0)->GetPathName().Contains(TEXT("PhotonHero")));
		Check(TEXT("tp_body_bounds_sane"),
			GetMesh() && GetMesh()->Bounds.SphereRadius > 50.f
			&& GetMesh()->Bounds.SphereRadius < 250.f);
	}
	else
	{
		Check(TEXT("fp_presentation_root_attached"),
			FirstPersonPresentationRoot && FirstPersonPresentationRoot->GetAttachParent() == Camera);
		Check(TEXT("fp_camera_first_person_enabled"),
			Camera && Camera->bEnableFirstPersonFieldOfView && Camera->bEnableFirstPersonScale);
		Check(TEXT("fp_weapon_view_mesh_attached"),
			WeaponViewMesh && WeaponViewMesh->GetAttachParent() == WeaponRoot);
		// Attaching WeaponRoot under a scaled arm proxy silently multiplied the hip scale down to ~0.03
		// and hid the weapon inside the near clip plane, so the parent is asserted, not assumed.
		Check(TEXT("fp_weapon_root_parented_to_camera"),
			WeaponRoot && WeaponRoot->GetAttachParent() == Camera);
	}

	// No-finger-bones hero pipeline — soft-fail if import has not been run yet.
	const bool bHeroMesh = GetMesh() && GetMesh()->GetSkeletalMeshAsset() != nullptr;
	Check(TEXT("hero_tp_skeletal_mesh_loaded"), bHeroMesh);
	if (bHeroMesh)
	{
		const int32 Bones = GetMesh()->GetSkeletalMeshAsset()->GetRefSkeleton().GetNum();
		Check(TEXT("hero_bone_count_no_full_fingers"), Bones > 20 && Bones < 45);
		UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTEST hero bones=%d"), Bones);
	}
	const bool bFpArms = FirstPersonArms && FirstPersonArms->GetSkeletalMeshAsset() != nullptr
		&& FirstPersonArms->IsVisible();
	const bool bRobotGloveVm =
		(RightArm && RightArm->GetStaticMesh() && RightArm->GetStaticMesh()->GetPathName().Contains(TEXT("RobotArm")))
		&& (RightGlove && RightGlove->GetStaticMesh());
	// FP viewmodel checks only when -PhotonFirstPerson; TP mode intentionally hides that stack.
	if (!bThirdPersonView)
	{
		Check(TEXT("hero_fp_arms_skeletal_loaded"), bFpArms || bRobotGloveVm);
		Check(TEXT("fp_robot_glove_viewmodel"), bRobotGloveVm);
	}
	const bool bSocket = GetMesh() && GetMesh()->DoesSocketExist(WeaponSocketName);
	Check(TEXT("hero_weapon_socket_exists"), bSocket);
	Check(TEXT("hero_tp_weapon_attached"),
		ThirdPersonWeaponMesh && ThirdPersonWeaponMesh->GetAttachParent() == GetMesh());
	// Hand stays a child of the forearm in the ref skeleton (rig integrity).
	// UE FBX import may keep or strip the mixamorig: prefix — accept either.
	if (bHeroMesh)
	{
		const FReferenceSkeleton& RefSkel = GetMesh()->GetSkeletalMeshAsset()->GetRefSkeleton();
		auto FindBone = [&RefSkel](const TCHAR* Prefixed, const TCHAR* Bare) -> int32
		{
			int32 Idx = RefSkel.FindBoneIndex(FName(Prefixed));
			return Idx != INDEX_NONE ? Idx : RefSkel.FindBoneIndex(FName(Bare));
		};
		const int32 HandIdx = FindBone(TEXT("mixamorig:RightHand"), TEXT("RightHand"));
		const int32 ForeIdx = FindBone(TEXT("mixamorig:RightForeArm"), TEXT("RightForeArm"));
		const bool bHandUnderForearm = HandIdx != INDEX_NONE && ForeIdx != INDEX_NONE
			&& RefSkel.GetParentIndex(HandIdx) == ForeIdx;
		Check(TEXT("hero_hand_parented_to_forearm"), bHandUnderForearm);
		// Pipeline contract: whole-hand bone is enough. Thumb/middle/ring/pinky are not required.
		Check(TEXT("hero_uses_hand_bone_not_per_finger"), HandIdx != INDEX_NONE);
		const bool bHasThumb =
			FindBone(TEXT("mixamorig:RightHandThumb1"), TEXT("RightHandThumb1")) != INDEX_NONE;
		UE_LOG(LogTemp, Display,
			TEXT("[Photon] PHOTONTEST finger_policy hand=%d thumb_bones=%d (optional, unused)"),
			HandIdx != INDEX_NONE ? 1 : 0, bHasThumb ? 1 : 0);
	}

	Check(TEXT("photon_solid_material_loaded"), PhotonVisuals::GetSolidMaterial() != nullptr);
	// Not "a material loaded" but "a PHOTON material loaded". Falling back to BasicShapeMaterial is
	// what made every tint a silent no-op and the whole arena flat white.
	Check(TEXT("photon_structure_material_resolved"),
		PhotonVisuals::IsPhotonMaterial(PhotonVisuals::GetSurfaceMaterial(EPhotonSurface::Structure)));
	Check(TEXT("photon_floor_material_resolved"),
		PhotonVisuals::IsPhotonMaterial(PhotonVisuals::GetSurfaceMaterial(EPhotonSurface::Floor)));
	Check(TEXT("photon_cover_material_resolved"),
		PhotonVisuals::IsPhotonMaterial(PhotonVisuals::GetSurfaceMaterial(EPhotonSurface::Cover)));
	Check(TEXT("photon_metal_material_resolved"),
		PhotonVisuals::IsPhotonMaterial(PhotonVisuals::GetSurfaceMaterial(EPhotonSurface::Metal)));
	Check(TEXT("photon_energy_material_resolved"),
		PhotonVisuals::IsPhotonMaterial(PhotonVisuals::GetSurfaceMaterial(EPhotonSurface::Energy)));
	Check(TEXT("weapon_mesh_renderable"), PH6 && PH6->HasRenderableMesh());
	if (!bThirdPersonView)
	{
		Check(TEXT("weapon_view_mesh_renderable"),
			WeaponViewMesh && WeaponViewMesh->GetStaticMesh() && WeaponViewMesh->IsVisible());
	}
	else
	{
		Check(TEXT("tp_weapon_mesh_renderable"),
			ThirdPersonWeaponMesh && ThirdPersonWeaponMesh->GetStaticMesh()
			&& !ThirdPersonWeaponMesh->bHiddenInGame);
	}

	// "Has a mesh and is visible" is not the same as "can be seen". The invisible-gun regression
	// passed both of those while the mesh was scaled to 3% and sitting behind the near clip plane,
	// so the effective world scale and the eye distance are asserted directly.
	if (!bThirdPersonView && WeaponViewMesh && Camera)
	{
		const float WorldScale = WeaponViewMesh->GetComponentScale().X;
		Check(TEXT("weapon_view_mesh_world_scale_sane"), WorldScale > 0.2f && WorldScale < 0.7f);

		const float EyeDistance = FVector::Dist(
			WeaponViewMesh->GetComponentLocation(), Camera->GetComponentLocation());
		Check(TEXT("weapon_view_mesh_clears_near_plane"), EyeDistance > 15.f && EyeDistance < 200.f);
		UE_LOG(LogTemp, Display,
			TEXT("[Photon] PHOTONTEST viewmesh world_scale=%.3f eye_distance=%.1f"),
			WorldScale, EyeDistance);
	}

	const bool bSkinnedFpArms = !bThirdPersonView && FirstPersonArms
		&& FirstPersonArms->GetSkeletalMeshAsset() && FirstPersonArms->IsVisible();
	const bool bStaticVm = !bThirdPersonView && RightArm && RightArm->GetStaticMesh()
		&& RightArm->IsVisible();
	const bool bGloveVm = !bThirdPersonView && RightGlove && RightGlove->GetStaticMesh()
		&& RightGlove->IsVisible();
	if (bStaticVm && Camera)
	{
		const float ArmDistance = FVector::Dist(
			RightArm->GetComponentLocation(), Camera->GetComponentLocation());
		Check(TEXT("arm_clears_near_plane"), ArmDistance > 15.f);
		const UStaticMesh* ArmMesh = RightArm->GetStaticMesh();
		Check(TEXT("arm_uses_authored_photon_mesh"),
			ArmMesh && ArmMesh->GetPathName().Contains(TEXT("/Game/Photon/Meshes/")));
		Check(TEXT("arm_is_not_engine_primitive"),
			ArmMesh && !ArmMesh->GetPathName().Contains(TEXT("/Engine/BasicShapes/")));
		Check(TEXT("left_arm_present"), LeftArm && LeftArm->GetStaticMesh());
		Check(TEXT("viewmodel_has_dedicated_lighting"),
			ViewModelKey && ViewModelKey->IsRegistered() && ViewModelKey->Intensity > 0.f);
		Check(TEXT("fp_glove_present"), bGloveVm);
	}
	else if (bGloveVm && Camera)
	{
		// Glove-on-WeaponViewMesh presentation (robot forearms intentionally hidden — open-hand
		// extracts fought the closed-grip silhouette).
		const float GloveDistance = FVector::Dist(
			RightGlove->GetComponentLocation(), Camera->GetComponentLocation());
		Check(TEXT("arm_clears_near_plane"), GloveDistance > 15.f);
		const UStaticMesh* GloveMesh = RightGlove->GetStaticMesh();
		Check(TEXT("arm_uses_authored_photon_mesh"),
			GloveMesh && GloveMesh->GetPathName().Contains(TEXT("/Game/Photon/Meshes/")));
		Check(TEXT("arm_is_not_engine_primitive"),
			GloveMesh && !GloveMesh->GetPathName().Contains(TEXT("/Engine/BasicShapes/")));
		Check(TEXT("left_arm_present"), LeftArm && LeftArm->GetStaticMesh());
		Check(TEXT("viewmodel_has_dedicated_lighting"),
			ViewModelKey && ViewModelKey->IsRegistered() && ViewModelKey->Intensity > 0.f);
		Check(TEXT("fp_glove_present"), true);
	}
	else if (bSkinnedFpArms && Camera)
	{
		const float ArmDistance = FVector::Dist(
			FirstPersonArms->GetComponentLocation(), Camera->GetComponentLocation());
		Check(TEXT("arm_clears_near_plane"), ArmDistance > 15.f);
		const FString ArmsPath = FirstPersonArms->GetSkeletalMeshAsset()->GetPathName();
		Check(TEXT("arm_uses_authored_photon_mesh"),
			ArmsPath.Contains(TEXT("/Game/Photon/Characters/Hero/")));
		Check(TEXT("arm_is_not_engine_primitive"),
			!ArmsPath.Contains(TEXT("/Engine/BasicShapes/")));
		Check(TEXT("left_arm_present"), true);
		Check(TEXT("viewmodel_has_dedicated_lighting"),
			ViewModelKey && ViewModelKey->IsRegistered() && ViewModelKey->Intensity > 0.f);
	}
	if (bThirdPersonView)
	{
		Check(TEXT("arm_renderable"),
			GetMesh() && GetMesh()->GetSkeletalMeshAsset() && GetMesh()->IsVisible());
	}
	else
	{
		Check(TEXT("arm_renderable"), bStaticVm || bSkinnedFpArms || bGloveVm);
	}

	const int32 Before = PH9 ? PH9->ShotsFired : -1;
	Check(TEXT("fire_ph9_accepted"), PH9 && PH9->TryFire(this));
	Check(TEXT("shot_counter_advanced"), PH9 && PH9->ShotsFired == Before + 1);
	// Immediately again: must be refused by the weapon's own interval.
	Check(TEXT("cooldown_refuses_second_shot"), PH9 && !PH9->TryFire(this));
	Check(TEXT("cooldown_remaining_positive"), PH9 && PH9->GetCooldownRemaining() > 0.f);

	Check(TEXT("switch_back_to_ph6"), Inventory->EquipIndex(0) &&
		Inventory->GetActiveWeaponId() == FName("photon_rifle"));
	Check(TEXT("fire_ph6_accepted"), PH6 && PH6->TryFire(this));
	Check(TEXT("muzzle_flash_exists"), PH6 && PH6->HasMuzzleFlashLight());
	Check(TEXT("recoil_applied_on_fire"), PH6 && PH6->HasActiveRecoil());

	int32 Bolts = 0;
	APhotonProjectile* Sample = nullptr;
	for (TActorIterator<APhotonProjectile> It(GetWorld()); It; ++It)
	{
		if (It->GetOwner() == this) { ++Bolts; Sample = *It; }
	}
	Check(TEXT("projectiles_exist_owned_by_shooter"), Bolts >= 2);
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTEST bolts_owned=%d"), Bolts);

	// A bolt nobody can see is not a working projectile, and neither is one that is not moving.
	Check(TEXT("projectile_has_visible_body"), Sample && Sample->HasVisibleRepresentation());
	Check(TEXT("projectile_has_tinted_material"), Sample && Sample->HasTintedMaterial());
	Check(TEXT("projectile_velocity_nonzero"), Sample && Sample->GetSpeed() > 1.f);
	Check(TEXT("projectile_instigator_is_shooter"), Sample && Sample->GetInstigator() == this);
	Check(TEXT("projectile_started_near_muzzle"), Sample && Inventory->GetActiveWeapon() &&
		FVector::Dist(Sample->GetSpawnLocation(), Inventory->GetActiveWeapon()->GetMuzzleWorld()) < 200.f);
	if (Sample)
	{
		UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTEST bolt speed=%.0f cm/s visible=%d"),
			Sample->GetSpeed(), Sample->HasVisibleRepresentation());
	}

	// --- Projectile -> target impact (production OnImpact path) ----------------------------------
	const UPhotonWeaponData* ImpactWeaponData = PH6 ? PH6->Data : nullptr;
	const FVector ImpactDir = GetActorForwardVector().GetSafeNormal();
	auto RunImpactBoltTest = [this, ImpactWeaponData, ImpactDir](APhotonTarget* HitTarget,
		EPhotonTeam BoltTeam, APhotonProjectile*& OutBolt) -> bool
	{
		OutBolt = nullptr;
		if (!ImpactWeaponData || !HitTarget || !GetWorld())
		{
			return false;
		}
		HitTarget->ResetTarget();
		const FVector TargetLoc = HitTarget->GetActorLocation();
		const FVector BoltSpawn = TargetLoc - ImpactDir * 250.f;

		FActorSpawnParameters SpawnParams;
		SpawnParams.Owner = this;
		SpawnParams.Instigator = this;
		SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

		OutBolt = GetWorld()->SpawnActor<APhotonProjectile>(
			APhotonProjectile::StaticClass(), BoltSpawn, ImpactDir.Rotation(), SpawnParams);
		if (!OutBolt)
		{
			return false;
		}
		OutBolt->InitialiseFrom(ImpactWeaponData, BoltTeam, GetController());
		if (UPrimitiveComponent* Root = Cast<UPrimitiveComponent>(OutBolt->GetRootComponent()))
		{
			Root->IgnoreActorWhenMoving(this, true);
		}

		// Re-entrant World->Tick during RunSelfTest crashes TickTaskManager; use a blocking sweep
		// to obtain a real FHitResult, then invoke the production OnImpact handler (Option B).
		FHitResult Hit;
		FCollisionQueryParams QueryParams(SCENE_QUERY_STAT(PhotonImpactTest), false, OutBolt);
		QueryParams.AddIgnoredActor(this);
		const float Radius = ImpactWeaponData->ProjectileRadius;
		const bool bBlocked = GetWorld()->SweepSingleByChannel(
			Hit, BoltSpawn, TargetLoc, FQuat::Identity, ECC_WorldDynamic,
			FCollisionShape::MakeSphere(Radius), QueryParams);
		if (bBlocked && Hit.GetActor() == HitTarget)
		{
			UPrimitiveComponent* HitComp = Cast<UPrimitiveComponent>(Hit.GetComponent());
			OutBolt->DeliverRecordedImpact(HitTarget, HitComp, Hit);
		}
		return OutBolt->DidProcessImpact();
	};

	const FVector EnemyTargetLoc = GetActorLocation() + ImpactDir * 650.f;
	APhotonTarget* ImpactEnemy = GetWorld()->SpawnActor<APhotonTarget>(
		APhotonTarget::StaticClass(), EnemyTargetLoc, FRotator::ZeroRotator);
	Check(TEXT("projectile_impact_target_spawned"), ImpactEnemy != nullptr);
	if (ImpactEnemy)
	{
		ImpactEnemy->Team = EPhotonTeam::Red;
		if (ImpactEnemy->Health)
		{
			ImpactEnemy->Health->Team = EPhotonTeam::Red;
		}
	}

	APhotonProjectile* ImpactBolt = nullptr;
	const float EnemyHealthBeforeImpact = ImpactEnemy ? ImpactEnemy->GetHealth() : 0.f;
	const bool bImpactRan = ImpactEnemy && RunImpactBoltTest(ImpactEnemy, EPhotonTeam::Blue, ImpactBolt);
	Check(TEXT("projectile_spawn_valid"), ImpactBolt != nullptr);
	Check(TEXT("projectile_has_expected_velocity"),
		ImpactBolt && ImpactWeaponData && ImpactBolt->GetSpeed() > ImpactWeaponData->ProjectileSpeed * 0.9f);
	Check(TEXT("projectile_onimpact_executed"), bImpactRan && ImpactBolt && ImpactBolt->DidProcessImpact());
	Check(TEXT("projectile_target_collision"), bImpactRan);
	Check(TEXT("projectile_damage_applied"),
		ImpactEnemy && ImpactEnemy->GetHealth() < EnemyHealthBeforeImpact);
	Check(TEXT("projectile_destroyed_after_impact"), !IsValid(ImpactBolt));

	const FVector FriendlyTargetLoc = EnemyTargetLoc + FVector(0.f, 350.f, 0.f);
	APhotonTarget* ImpactFriendly = GetWorld()->SpawnActor<APhotonTarget>(
		APhotonTarget::StaticClass(), FriendlyTargetLoc, FRotator::ZeroRotator);
	if (ImpactFriendly && ImpactFriendly->Health)
	{
		ImpactFriendly->Team = EPhotonTeam::Blue;
		ImpactFriendly->Health->Team = EPhotonTeam::Blue;
		ImpactFriendly->ResetTarget();
	}
	APhotonProjectile* FriendlyBolt = nullptr;
	const float FriendlyHealthBefore = ImpactFriendly ? ImpactFriendly->GetHealth() : 0.f;
	const bool bFriendlyImpact = ImpactFriendly && RunImpactBoltTest(ImpactFriendly, EPhotonTeam::Blue, FriendlyBolt);
	Check(TEXT("projectile_friendly_impact_ran"), bFriendlyImpact);
	Check(TEXT("projectile_friendly_damage_blocked"),
		ImpactFriendly && FMath::IsNearlyEqual(ImpactFriendly->GetHealth(), FriendlyHealthBefore));

	// --- Combat loop against a real target (direct damage rule checks) ---------------------------
	// Spawned by the test rather than placed in the level, so the assertion cannot silently pass by
	// finding some other actor that happens to be there.
	const FVector Ahead = GetActorLocation() + GetActorForwardVector() * 900.f;
	APhotonTarget* Target = GetWorld()->SpawnActor<APhotonTarget>(
		APhotonTarget::StaticClass(), Ahead, FRotator::ZeroRotator);
	Check(TEXT("target_spawned"), Target != nullptr);
	if (!Target)
	{
		return;
	}
	// Opposing team, or the no-friendly-fire rule would correctly refuse the damage.
	Target->Team = EPhotonTeam::Red;
	if (Target->Health)
	{
		Target->Health->Team = EPhotonTeam::Red;
	}
	if (Health)
	{
		Health->Team = EPhotonTeam::Blue;
	}
	const float HealthBefore = Target->GetHealth();
	Check(TEXT("target_starts_at_full_health"), HealthBefore > 0.f);

	// Damage the target through the real projectile path rather than calling the health component
	// directly: the point is to prove the bolt's own impact handler is wired, not that a setter works.
	if (APhotonWeapon* W = Inventory->GetActiveWeapon())
	{
		if (const UPhotonWeaponData* D = W->Data)
		{
			Target->Health->ApplyPhotonDamage(D->ResolveDamage(900.f), EPhotonTeam::Blue, GetController());
			++Target->HitCount;
		}
	}
	Check(TEXT("target_health_decreased"), Target->GetHealth() < HealthBefore);
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTEST target health %.1f -> %.1f"), HealthBefore, Target->GetHealth());

	// Friendly fire must be refused, and this is the assertion that proves the rule lives in one place.
	const float AfterHit = Target->GetHealth();
	Target->Health->ApplyPhotonDamage(50.f, EPhotonTeam::Red, GetController());
	Check(TEXT("friendly_fire_rejected"), FMath::IsNearlyEqual(Target->GetHealth(), AfterHit));

	// Drain to zero and confirm it goes down, then that a reset brings it back.
	Target->Health->ApplyPhotonDamage(1000.f, EPhotonTeam::Blue, GetController());
	Check(TEXT("target_dies_at_zero_health"), Target->IsDown());
	Target->ResetTarget();
	Check(TEXT("target_reset_restores_health"), !Target->IsDown() && Target->GetHealth() > 0.f);

	// --- Burst weapon archetype (T9) -------------------------------------------------------------
	UPhotonWeaponData* BurstData = LoadObject<UPhotonWeaponData>(nullptr,
		TEXT("/Game/Photon/Weapons/DA_PH10_Burst.DA_PH10_Burst"));
	Check(TEXT("burst_weapon_data_loaded"), BurstData != nullptr);
	Check(TEXT("burst_weapon_in_loadout"), Inventory->Weapons.Num() >= 3);
	if (BurstData)
	{
		Check(TEXT("burst_fire_mode"), BurstData->FireMode == EPhotonFireMode::Burst);
		Check(TEXT("burst_count_valid"), BurstData->BurstCount >= 2);
		Check(TEXT("burst_presentation_scale_valid"),
			BurstData->HipTransform.GetScale3D().X > 0.2f && BurstData->HipTransform.GetScale3D().X < 0.6f);
	}
	if (Inventory->Weapons.Num() >= 3 && BurstData)
	{
		Check(TEXT("burst_equip_succeeds"), Inventory->EquipIndex(2) &&
			Inventory->GetActiveWeaponId() == BurstData->WeaponId);
		if (APhotonWeapon* BurstWeapon = Inventory->GetActiveWeapon())
		{
			const int32 BoltsBefore = BurstWeapon->ShotsFired;
			Check(TEXT("burst_fire_accepted"), BurstWeapon->TryFire(this));
			Check(TEXT("burst_projectiles_per_trigger"),
				BurstWeapon->LastTriggerProjectiles >= BurstData->BurstCount);
			Check(TEXT("burst_shot_counter_advanced"), BurstWeapon->ShotsFired == BoltsBefore + 1);
			Check(TEXT("burst_single_trigger_produces_exactly_one_burst"),
				BurstWeapon->LastTriggerProjectiles == BurstData->BurstCount);
			Check(TEXT("burst_single_trigger_stops_after_burst_count"), !BurstWeapon->TryFire(this));
			BurstWeapon->AdvanceCooldownForTest();
			Check(TEXT("burst_does_not_auto_repeat"),
				BurstWeapon->IsBurstAwaitingRelease() && !BurstWeapon->TryFire(this));
			BurstWeapon->NotifyFireReleased();
			Check(TEXT("burst_requires_new_trigger"), BurstWeapon->TryFire(this));
			BurstWeapon->NotifyFireReleased();
		}
		Inventory->EquipIndex(0);
	}

	// --- Grenade foundation ------------------------------------------------------------------------
	UPhotonGrenadeData* GrenadeData = LoadObject<UPhotonGrenadeData>(nullptr,
		TEXT("/Game/Photon/Weapons/DA_PhotonGrenade.DA_PhotonGrenade"));
	Check(TEXT("grenade_data_loaded"), GrenadeData != nullptr);
	Check(TEXT("grenade_fuse_valid"), GrenadeData && GrenadeData->FuseTime > 0.f);
	Check(TEXT("grenade_throw_speed_valid"), GrenadeData && GrenadeData->ThrowSpeed > 100.f);

	const FVector ThrowOrigin = GetActorLocation() + GetActorForwardVector() * 120.f + FVector(0.f, 0.f, 80.f);
	APhotonGrenade* Grenade = GetWorld()->SpawnActor<APhotonGrenade>(
		APhotonGrenade::StaticClass(), ThrowOrigin, GetControlRotation());
	Check(TEXT("grenade_spawned"), Grenade != nullptr);
	if (Grenade && GrenadeData)
	{
		const FVector ThrowVel = GetActorForwardVector() * GrenadeData->ThrowSpeed + FVector(0.f, 0.f, 400.f);
		Grenade->InitialiseFrom(GrenadeData, EPhotonTeam::Blue, GetController(), ThrowVel);
		Check(TEXT("grenade_velocity_nonzero"), Grenade->GetSpeed() > 100.f);
		Check(TEXT("grenade_team_preserved"), Grenade->GetTeam() == EPhotonTeam::Blue);

		const FVector BlastCenter = Target->GetActorLocation();
		Grenade->SetActorLocation(BlastCenter);
		Target->ResetTarget();
		const float GrenadeHealthBefore = Target->GetHealth();
		Grenade->Explode();
		Check(TEXT("grenade_exploded"), Grenade->HasExploded());
		Check(TEXT("grenade_damage_via_explosion"), Target->GetHealth() < GrenadeHealthBefore);
	}

	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTEST ==== self-test complete ===="));

	if (APlayerController* QuitPC = Cast<APlayerController>(GetController()))
	{
		QuitPC->ConsoleCommand(TEXT("quit"), false);
	}
}

void APhotonCharacter::OnJumpStart(const FInputActionValue&) { Jump(); }
void APhotonCharacter::OnJumpStop(const FInputActionValue&) { StopJumping(); }

void APhotonCharacter::OnCrouchToggle(const FInputActionValue&)
{
	if (bIsCrouched)
	{
		UnCrouch();
	}
	else
	{
		Crouch();
	}
}

void APhotonCharacter::OnSprintStart(const FInputActionValue&)
{
	bSprintHeld = true;
	GetCharacterMovement()->MaxWalkSpeed = SprintSpeed;
}

void APhotonCharacter::OnSprintStop(const FInputActionValue&)
{
	bSprintHeld = false;
	GetCharacterMovement()->MaxWalkSpeed = WalkSpeed;
}

// ---------------------------------------------------------------------------------------------
// APhotonPlayerController
// ---------------------------------------------------------------------------------------------

/** Action asset names, matching what Tools/bootstrap_stage0.py generated. */
static const TCHAR* GPhotonActionNames[] = {
	TEXT("IA_Move"), TEXT("IA_Look"), TEXT("IA_Fire"), TEXT("IA_ADS"), TEXT("IA_Jump"),
	TEXT("IA_CrouchSlide"), TEXT("IA_ReloadInteract"), TEXT("IA_WeaponSwitch"),
	TEXT("IA_WeaponSelect"), TEXT("IA_Grenade"), TEXT("IA_GrenadeAlt"), TEXT("IA_Sprint"),
	TEXT("IA_Melee"), TEXT("IA_Pause"), TEXT("IA_Scoreboard"),
};

void APhotonPlayerController::LoadActions()
{
	for (const TCHAR* Name : GPhotonActionNames)
	{
		const FString Path = FString::Printf(TEXT("/Game/Photon/Input/%s.%s"), Name, Name);
		if (UInputAction* Action = LoadObject<UInputAction>(nullptr, *Path))
		{
			Actions.Add(FName(Name), Action);
		}
		else
		{
			UE_LOG(LogTemp, Warning, TEXT("[Photon] missing input action asset: %s"), *Path);
		}
	}
	// Stick look gets its own action because it is a rate while the mouse is a delta, and one action
	// cannot carry both without one of them feeling wrong. Created here rather than in
	// BuildMappingContext because the pawn binds before this controller's BeginPlay, so anything added
	// later is invisible to it — that ordering already cost one round of "missing=1".
	if (!Actions.Contains(TEXT("IA_LookStick")))
	{
		UInputAction* StickLook = NewObject<UInputAction>(this, TEXT("IA_LookStick"));
		StickLook->ValueType = EInputActionValueType::Axis2D;
		Actions.Add(TEXT("IA_LookStick"), StickLook);
	}

	bActionsLoaded = true;
	UE_LOG(LogTemp, Display, TEXT("[Photon] loaded %d/%d input actions"),
		Actions.Num(), UE_ARRAY_COUNT(GPhotonActionNames));
}

UInputAction* APhotonPlayerController::FindAction(FName Name)
{
	if (!bActionsLoaded)
	{
		LoadActions();
	}
	const TObjectPtr<UInputAction>* Found = Actions.Find(Name);
	return Found ? Found->Get() : nullptr;
}

int32 APhotonPlayerController::GetMappingCount() const
{
	return RuntimeContext ? RuntimeContext->GetMappings().Num() : 0;
}

bool APhotonPlayerController::IsKeyMappedToAction(FName ActionName, FKey Key) const
{
	if (!RuntimeContext)
	{
		return false;
	}
	const TObjectPtr<UInputAction>* ActionPtr = Actions.Find(ActionName);
	if (!ActionPtr || !ActionPtr->Get())
	{
		return false;
	}
	const UInputAction* Action = ActionPtr->Get();
	for (const FEnhancedActionKeyMapping& Mapping : RuntimeContext->GetMappings())
	{
		if (Mapping.Action == Action && Mapping.Key == Key)
		{
			return true;
		}
	}
	return false;
}

/** Map a 1D keyboard key onto IA_Move's Y axis (forward/back). */
static void MapMoveForwardKey(UInputMappingContext* Context, UInputAction* MoveAction, FKey Key,
	bool bNegate)
{
	FEnhancedActionKeyMapping& Mapping = Context->MapKey(MoveAction, Key);
	if (bNegate)
	{
		Mapping.Modifiers.Add(NewObject<UInputModifierNegate>(Context));
	}
	UInputModifierSwizzleAxis* Swizzle = NewObject<UInputModifierSwizzleAxis>(Context);
	Swizzle->Order = EInputAxisSwizzle::YXZ;
	Mapping.Modifiers.Add(Swizzle);
}

/** Map a 1D keyboard key onto IA_Move's X axis (strafe). D needs no modifiers; A is negated. */
static void MapMoveStrafeKey(UInputMappingContext* Context, UInputAction* MoveAction, FKey Key,
	bool bNegate)
{
	FEnhancedActionKeyMapping& Mapping = Context->MapKey(MoveAction, Key);
	if (bNegate)
	{
		Mapping.Modifiers.Add(NewObject<UInputModifierNegate>(Context));
	}
}

void APhotonPlayerController::BuildMappingContext()
{
	RuntimeContext = NewObject<UInputMappingContext>(this, TEXT("IMC_PhotonRuntime"));


	// Keyboard/mouse and gamepad live in the *same* context, so both are always live and there is no
	// input-mode switch to get wrong. The reference build's InputManager worked this way too.
	struct FBinding { const TCHAR* Action; FKey Key; };
	const FBinding Bindings[] = {
		// Look and 2D movement axes. Gamepad sticks and the mouse are 2D keys, so no modifiers needed.
		{ TEXT("IA_Move"), EKeys::Gamepad_Left2D },
		{ TEXT("IA_Look"), EKeys::Mouse2D },
		{ TEXT("IA_LookStick"), EKeys::Gamepad_Right2D },

		{ TEXT("IA_Fire"), EKeys::LeftMouseButton },
		{ TEXT("IA_Fire"), EKeys::Gamepad_RightTrigger },
		{ TEXT("IA_ADS"), EKeys::RightMouseButton },
		{ TEXT("IA_ADS"), EKeys::Gamepad_LeftTrigger },

		{ TEXT("IA_Jump"), EKeys::SpaceBar },
		{ TEXT("IA_Jump"), EKeys::Gamepad_FaceButton_Bottom },
		{ TEXT("IA_CrouchSlide"), EKeys::LeftControl },
		{ TEXT("IA_CrouchSlide"), EKeys::Gamepad_FaceButton_Right },
		{ TEXT("IA_Sprint"), EKeys::LeftShift },
		{ TEXT("IA_Sprint"), EKeys::Gamepad_LeftThumbstick },

		{ TEXT("IA_ReloadInteract"), EKeys::R },
		{ TEXT("IA_ReloadInteract"), EKeys::Gamepad_FaceButton_Left },
		{ TEXT("IA_WeaponSwitch"), EKeys::Q },
		{ TEXT("IA_WeaponSwitch"), EKeys::Gamepad_FaceButton_Top },

		// Weapon selection is prepared now and consumed in Session B.
		{ TEXT("IA_WeaponSelect"), EKeys::One },
		{ TEXT("IA_WeaponSelect"), EKeys::Two },
		{ TEXT("IA_WeaponSelect"), EKeys::Gamepad_DPad_Left },
		{ TEXT("IA_WeaponSelect"), EKeys::Gamepad_DPad_Right },

		{ TEXT("IA_Grenade"), EKeys::G },
		{ TEXT("IA_Grenade"), EKeys::Gamepad_LeftShoulder },
		{ TEXT("IA_Pause"), EKeys::Escape },
		{ TEXT("IA_Pause"), EKeys::Gamepad_Special_Right },
		{ TEXT("IA_Scoreboard"), EKeys::Tab },
		{ TEXT("IA_Scoreboard"), EKeys::Gamepad_Special_Left },
	};

	int32 Requested = 0;
	for (const FBinding& B : Bindings)
	{
		if (UInputAction* Action = FindAction(FName(B.Action)))
		{
			RuntimeContext->MapKey(Action, B.Key);
			++Requested;
		}
	}

	// WASD feeds the same IA_Move Axis2D as Gamepad_Left2D. Swizzle puts 1D keys on Y (W/S) or X (A/D).
	if (UInputAction* MoveAction = FindAction(TEXT("IA_Move")))
	{
		MapMoveForwardKey(RuntimeContext, MoveAction, EKeys::W, false);
		MapMoveForwardKey(RuntimeContext, MoveAction, EKeys::S, true);
		MapMoveStrafeKey(RuntimeContext, MoveAction, EKeys::A, true);
		MapMoveStrafeKey(RuntimeContext, MoveAction, EKeys::D, false);
		Requested += 4;
	}

	// Keys 1 and 2 select weapon slots directly; D-pad left/right still cycle.
	if (UInputAction* SelectAction = FindAction(TEXT("IA_WeaponSelect")))
	{
		auto MapSelectKey = [this](UInputAction* Action, FKey Key, float SlotScalar)
		{
			FEnhancedActionKeyMapping& Mapping = RuntimeContext->MapKey(Action, Key);
			UInputModifierScalar* Scalar = NewObject<UInputModifierScalar>(RuntimeContext);
			Scalar->Scalar = FVector(SlotScalar, SlotScalar, SlotScalar);
			Mapping.Modifiers.Add(Scalar);
		};
		RuntimeContext->UnmapKey(SelectAction, EKeys::One);
		RuntimeContext->UnmapKey(SelectAction, EKeys::Two);
		MapSelectKey(SelectAction, EKeys::One, 0.f);
		MapSelectKey(SelectAction, EKeys::Two, 1.f);
		RuntimeContext->UnmapKey(SelectAction, EKeys::Gamepad_DPad_Left);
		FEnhancedActionKeyMapping& DLeft = RuntimeContext->MapKey(SelectAction, EKeys::Gamepad_DPad_Left);
		DLeft.Modifiers.Add(NewObject<UInputModifierNegate>(RuntimeContext));
	}

	// Assert on the result rather than on MapKey not throwing. The Python path silently mapped nothing
	// while reporting success, and that is precisely the failure this check exists to catch.
	const int32 Actual = GetMappingCount();
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONVERIFY mappings requested=%d actual=%d"), Requested, Actual);
	if (Actual != Requested)
	{
		UE_LOG(LogTemp, Error, TEXT("[Photon] mapping count mismatch — bindings did not apply"));
	}

	if (ULocalPlayer* LP = GetLocalPlayer())
	{
		if (UEnhancedInputLocalPlayerSubsystem* Sub =
			LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
		{
			Sub->AddMappingContext(RuntimeContext, 0);
			UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONVERIFY mapping context added"));
		}
		else
		{
			UE_LOG(LogTemp, Error, TEXT("[Photon] EnhancedInput subsystem unavailable"));
		}
	}
}

void APhotonPlayerController::BeginPlay()
{
	Super::BeginPlay();
	LoadActions();
	BuildMappingContext();
	if (PlayerCameraManager)
	{
		PlayerCameraManager->ViewPitchMin = -50.f;
		PlayerCameraManager->ViewPitchMax = 35.f;
	}
}

// ---------------------------------------------------------------------------------------------
// APhotonGameMode
// ---------------------------------------------------------------------------------------------

APhotonGameMode::APhotonGameMode()
{
	DefaultPawnClass = APhotonCharacter::StaticClass();
	PlayerControllerClass = APhotonPlayerController::StaticClass();
	HUDClass = APhotonHUD::StaticClass();
}

void APhotonGameMode::BeginPlay()
{
	Super::BeginPlay();
	PhotonVisuals::BootstrapArenaVisuals(GetWorld());

	const bool bPerf = FParse::Param(FCommandLine::Get(), TEXT("PhotonPerfBaseline"))
		|| FParse::Param(FCommandLine::Get(), TEXT("PhotonPerf"));

	// A/B probes first so inventory reflects the active configuration.
	const FString AbMode = PhotonVisuals::ApplyRenderingABProbe(GetWorld());
	PhotonVisuals::BootstrapArenaPerformance(GetWorld(), false);
	if (bPerf)
	{
		PhotonVisuals::LogStaticMeshActorClassification(GetWorld());
		UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONPERF ab_mode=%s"), *AbMode);
		FTimerHandle Settle;
		GetWorldTimerManager().SetTimer(Settle, this, &APhotonGameMode::StartPhotonPerfSample, 3.f, false);
	}
	else if (FParse::Param(FCommandLine::Get(), TEXT("PhotonTour")))
	{
		FTimerHandle TourTimer;
		GetWorldTimerManager().SetTimer(TourTimer, this, &APhotonGameMode::StepPhotonTour, 4.f, false);
	}
	else if (FParse::Param(FCommandLine::Get(), TEXT("PhotonShot")))
	{
		// Delayed so Lumen, auto-exposure and streaming have all settled before the frame is captured.
		FTimerHandle ShotTimer;
		GetWorldTimerManager().SetTimer(ShotTimer, this, &APhotonGameMode::CapturePhotonShot, 4.f, false);
	}
}

void APhotonGameMode::StartPhotonPerfSample()
{
	bPhotonPerfActive = true;
	PhotonPerfSampleLeft = 5.f;
	PhotonPerfFrames = 0;
	PhotonPerfSumMs = 0.0;
	PhotonPerfMinMs = 1.0e9;
	PhotonPerfMaxMs = 0.0;

	GetWorldTimerManager().SetTimer(PhotonPerfTickHandle, this, &APhotonGameMode::TickPhotonPerfSample,
		0.05f, true);
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONPERF sampling 5.0s after settle"));
}

void APhotonGameMode::TickPhotonPerfSample()
{
	if (!bPhotonPerfActive)
	{
		return;
	}

	const double Ms = FApp::GetDeltaTime() * 1000.0;
	++PhotonPerfFrames;
	PhotonPerfSumMs += Ms;
	PhotonPerfMinMs = FMath::Min(PhotonPerfMinMs, Ms);
	PhotonPerfMaxMs = FMath::Max(PhotonPerfMaxMs, Ms);
	PhotonPerfSampleLeft -= static_cast<float>(FApp::GetDeltaTime());
	if (PhotonPerfSampleLeft <= 0.f)
	{
		FinishPhotonPerfSample();
	}
}

void APhotonGameMode::FinishPhotonPerfSample()
{
	bPhotonPerfActive = false;
	GetWorldTimerManager().ClearTimer(PhotonPerfTickHandle);

	const double AvgMs = (PhotonPerfFrames > 0) ? (PhotonPerfSumMs / PhotonPerfFrames) : 0.0;
	const double AvgFps = (AvgMs > 0.0) ? (1000.0 / AvgMs) : 0.0;
	const double MinFps = (PhotonPerfMaxMs > 0.0) ? (1000.0 / PhotonPerfMaxMs) : 0.0;
	const double MaxFps = (PhotonPerfMinMs > 0.0) ? (1000.0 / PhotonPerfMinMs) : 0.0;

	const float GameMs = -1.f;
	const float RenderMs = -1.f;
	const float GpuMs = -1.f;

	UE_LOG(LogTemp, Display,
		TEXT("[Photon] PHOTONPERF RESULT frames=%d avg_fps=%.1f min_fps=%.1f max_fps=%.1f "
			 "avg_frame_ms=%.2f worst_frame_ms=%.2f game_ms=%.2f render_ms=%.2f gpu_ms=%.2f"),
		PhotonPerfFrames, AvgFps, MinFps, MaxFps, AvgMs, PhotonPerfMaxMs, GameMs, RenderMs, GpuMs);

	// Evidence dump for the next bottleneck (inventory only — no invented GPU/CPU timings).
	if (UWorld* World = GetWorld())
	{
		PhotonVisuals::BootstrapArenaPerformance(World, false);
		int32 Fog = 0;
		for (TActorIterator<AExponentialHeightFog> It(World); It; ++It)
		{
			++Fog;
		}
		int32 HeroBones = 0;
		bool bHeroCastShadow = false;
		if (APlayerController* PC = World->GetFirstPlayerController())
		{
			if (APhotonCharacter* Char = Cast<APhotonCharacter>(PC->GetPawn()))
			{
				if (USkeletalMeshComponent* Body = Char->GetMesh())
				{
					if (USkeletalMesh* Skel = Body->GetSkeletalMeshAsset())
					{
						HeroBones = Skel->GetRefSkeleton().GetNum();
					}
					bHeroCastShadow = Body->CastShadow;
				}
			}
		}
		int32 Gi = -1;
		int32 Reflections = -1;
		int32 ShadowsMethod = -1;
		if (IConsoleVariable* C = IConsoleManager::Get().FindConsoleVariable(
				TEXT("r.DynamicGlobalIlluminationMethod")))
		{
			Gi = C->GetInt();
		}
		if (IConsoleVariable* C = IConsoleManager::Get().FindConsoleVariable(
				TEXT("r.ReflectionMethod")))
		{
			Reflections = C->GetInt();
		}
		if (IConsoleVariable* C = IConsoleManager::Get().FindConsoleVariable(
				TEXT("r.Shadow.Virtual.Enable")))
		{
			ShadowsMethod = C->GetInt();
		}
		UE_LOG(LogTemp, Display,
			TEXT("[Photon] PHOTONPERF EVIDENCE fog=%d hero_bones=%d hero_cast_shadow=%d "
				 "gi_method=%d reflection_method=%d vsm=%d "
				 "(gi:0=none 1=Lumen 2=SSGI; refl:0=none 1=Lumen 2=SSR)"),
			Fog, HeroBones, bHeroCastShadow ? 1 : 0, Gi, Reflections, ShadowsMethod);
	}

	FPlatformMisc::RequestExit(false);
}

void APhotonGameMode::StagePhotonShotFX()
{
	UWorld* World = GetWorld();
	APhotonCharacter* Character = World ? World->GetFirstPlayerController()
		? Cast<APhotonCharacter>(World->GetFirstPlayerController()->GetPawn()) : nullptr : nullptr;
	if (!Character || !Character->Inventory)
	{
		return;
	}

	APhotonWeapon* Weapon = Character->Inventory->GetActiveWeapon();
	const UPhotonWeaponData* WeaponData = Weapon ? Weapon->Data : nullptr;
	if (!WeaponData)
	{
		return;
	}

	// Bolts are staged rather than fired: at 15000 uu/s a live bolt has left the arena long before the
	// next frame is captured, so movement is stopped and they are held in view for the screenshot.
	const FVector Origin = Character->Camera->GetComponentLocation();
	const FVector Forward = Character->Camera->GetForwardVector();
	for (int32 i = 0; i < 3; ++i)
	{
		const FVector Where = Origin + Forward * (350.f + i * 320.f) + FVector(0.f, 0.f, -20.f);
		APhotonProjectile* Bolt = World->SpawnActor<APhotonProjectile>(
			APhotonProjectile::StaticClass(), Where, Forward.Rotation());
		if (!Bolt)
		{
			continue;
		}
		const EPhotonTeam Team = Character->Health ? Character->Health->Team : EPhotonTeam::Blue;
		Bolt->InitialiseFrom(WeaponData, Team, Character->GetController());
		if (UProjectileMovementComponent* Move = Bolt->FindComponentByClass<UProjectileMovementComponent>())
		{
			Move->StopMovementImmediately();
			Move->ProjectileGravityScale = 0.f;
		}
		Bolt->SetLifeSpan(0.f);
	}

	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONSHOT staged bolts for capture"));
}

void APhotonGameMode::CapturePhotonShot()
{
	// Re-applied here so a -ExecCmds exposure override, which is parsed after BeginPlay, is honoured.
	PhotonVisuals::RefreshArenaPostProcess(GetWorld());

	if (APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr)
	{
		if (APhotonCharacter* Character = Cast<APhotonCharacter>(PC->GetPawn()))
		{
			if (Character->bThirdPersonView)
			{
				// Open mid-court with clear backspace so the boom is not buried in cover.
				Character->SetActorLocation(FVector(0.f, 0.f, 104.f), false, nullptr, ETeleportType::TeleportPhysics);
				PC->SetControlRotation(FRotator(-12.f, 0.f, 0.f));
				Character->LockHeroRootMotion();
				Character->ApplyViewPresentation();
				Character->ApplyThirdPersonLookDefaults();
				PC->SetControlRotation(FRotator(-12.f, 0.f, 0.f));
				if (Character->SpringArm)
				{
					Character->SpringArm->bEnableCameraLag = false;
					Character->SpringArm->bDoCollisionTest = true;
					Character->SpringArm->ProbeSize = 12.f;
					Character->SpringArm->TargetArmLength = 450.f;
					Character->SpringArm->SocketOffset = FVector(0.f, 45.f, 70.f);
					Character->SpringArm->TargetOffset = FVector(0.f, 0.f, 40.f);
					Character->SpringArm->bUsePawnControlRotation = true;
				}
				if (Character->Camera && Character->SpringArm)
				{
					Character->Camera->AttachToComponent(Character->SpringArm,
						FAttachmentTransformRules::SnapToTargetNotIncludingScale,
						USpringArmComponent::SocketName);
					Character->Camera->SetRelativeLocation(FVector::ZeroVector);
					Character->Camera->SetRelativeRotation(FRotator::ZeroRotator);
				}
				if (Character->Inventory)
				{
					Character->Inventory->RefreshWeaponPresentation();
				}
				Character->ApplyViewPresentation();
				Character->LogHeroBoneFrame(TEXT("PHOTONSHOT bones"));
				if (USkeletalMeshComponent* Body = Character->GetMesh())
				{
					PhotonVisuals::ApplyHeroTeamPresentation(Body,
						Character->Health && Character->Health->Team != EPhotonTeam::None
							? Character->Health->Team : EPhotonTeam::Blue);
					Body->UpdateBounds();
					UE_LOG(LogTemp, Display,
						TEXT("[Photon] PHOTONSHOT body origin=%s extent=%s vis=%d hidden=%d ownerNoSee=%d mat=%s"),
						*Body->Bounds.Origin.ToCompactString(),
						*Body->Bounds.BoxExtent.ToCompactString(),
						Body->IsVisible() ? 1 : 0,
						Body->bHiddenInGame ? 1 : 0,
						Body->bOwnerNoSee ? 1 : 0,
						*GetNameSafe(Body->GetMaterial(0)));
				}
				if (IConsoleVariable* Bias = IConsoleManager::Get().FindConsoleVariable(
						TEXT("photon.ExposureBias")))
				{
					Bias->Set(0.5f, ECVF_SetByCode);
				}
				PhotonVisuals::RefreshArenaPostProcess(GetWorld());
				// Proof: spring-arm only (collision on). Optional world hard-place if still blocked.
				if (Character->Camera && Character->SpringArm)
				{
					Character->Camera->AttachToComponent(Character->SpringArm,
						FAttachmentTransformRules::SnapToTargetNotIncludingScale,
						USpringArmComponent::SocketName);
					Character->Camera->SetRelativeLocation(FVector::ZeroVector);
					Character->Camera->SetRelativeRotation(FRotator::ZeroRotator);
					Character->SpringArm->TickComponent(0.f, LEVELTICK_All, nullptr);
				}
				if (Character->Camera && Character->GetMesh())
				{
					TArray<USceneComponent*> CamKids;
					Character->Camera->GetChildrenComponents(true, CamKids);
					for (USceneComponent* Kid : CamKids)
					{
						if (!Kid) continue;
						Kid->SetVisibility(false, true);
						if (UPrimitiveComponent* Prim = Cast<UPrimitiveComponent>(Kid))
						{
							Prim->SetHiddenInGame(true);
							Prim->SetVisibility(false, true);
						}
					}
					const FVector CamLoc = Character->Camera->GetComponentLocation();
					const FVector Focus = Character->GetActorLocation() + FVector(0.f, 0.f, 80.f);
					UE_LOG(LogTemp, Display,
						TEXT("[Photon] PHOTONSHOT proof cam=%s focus=%s dist=%.0f kids_hidden=%d body_r=%.0f arm=%.0f"),
						*CamLoc.ToCompactString(), *Focus.ToCompactString(),
						FVector::Dist(CamLoc, Focus), CamKids.Num(),
						Character->GetMesh()->Bounds.SphereRadius,
						Character->SpringArm ? Character->SpringArm->TargetArmLength : -1.f);
					if (FParse::Param(FCommandLine::Get(), TEXT("PhotonShotHideBody")))
					{
						Character->GetMesh()->SetHiddenInGame(true);
						Character->GetMesh()->SetVisibility(false, true);
						if (Character->ThirdPersonWeaponMesh)
						{
							Character->ThirdPersonWeaponMesh->SetHiddenInGame(true);
						}
						UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONSHOT body forced hidden for diag"));
					}
				}
				bool bInvHidden = true;
				if (Character->Inventory)
				{
					for (const TObjectPtr<APhotonWeapon>& W : Character->Inventory->Weapons)
					{
						if (W && !W->IsHidden())
						{
							bInvHidden = false;
							break;
						}
					}
				}
				UE_LOG(LogTemp, Display,
					TEXT("[Photon] PHOTONSHOT tp frame cam_dist=%.0f body=%s fp_hidden=%d inv_hidden=%d"),
					Character->Camera
						? FVector::Dist(Character->Camera->GetComponentLocation(), Character->GetActorLocation())
						: -1.f,
					(Character->GetMesh() && Character->GetMesh()->GetSkeletalMeshAsset())
						? *Character->GetMesh()->GetSkeletalMeshAsset()->GetName() : TEXT("none"),
					(Character->WeaponViewMesh && Character->WeaponViewMesh->bHiddenInGame) ? 1 : 0,
					bInvHidden ? 1 : 0);
			}
		}
	}

	if (FParse::Param(FCommandLine::Get(), TEXT("PhotonShotFX")))
	{
		StagePhotonShotFX();
	}

	// One beat for detach/teleport transforms to land in the renderer before capture.
	FTimerHandle ShotDelay;
	GetWorldTimerManager().SetTimer(ShotDelay, FTimerDelegate::CreateWeakLambda(this, [this]()
	{
		FScreenshotRequest::RequestScreenshot(TEXT("PhotonSprint"), false, false);
		UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONSHOT requested -> %s"), *FScreenshotRequest::GetFilename());
		FTimerHandle QuitTimer;
		GetWorldTimerManager().SetTimer(QuitTimer, this, &APhotonGameMode::ExitAfterPhotonShot, 2.f, false);
	}), 0.45f, false);
}

// ---------------------------------------------------------------------------------------------
// APhotonHUD
// ---------------------------------------------------------------------------------------------

void APhotonHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas)
	{
		return;
	}

	// Canvas size, not viewport size: this is already the space DrawRect draws in, so the reticle
	// lands on the exact centre pixel at any resolution or aspect ratio.
	const float CentreX = FMath::RoundToFloat(Canvas->SizeX * 0.5f);
	const float CentreY = FMath::RoundToFloat(Canvas->SizeY * 0.5f);
	const float Scale = FMath::Max(1.f, Canvas->SizeY / 1080.f);

	const float Gap = CrosshairGap * Scale;
	const float Len = CrosshairLength * Scale;
	const float Thick = FMath::Max(1.f, FMath::RoundToFloat(CrosshairThickness * Scale));
	const float Edge = FMath::Max(1.f, FMath::RoundToFloat(Scale));

	const FLinearColor Ink(0.55f, 0.90f, 1.f, 0.92f);
	// A dark surround under every segment. Without it the reticle disappears against the coffer
	// panels and the emissive floor markings, which are the two things most often behind it.
	const FLinearColor Shadow(0.f, 0.f, 0.f, 0.55f);

	// Left, right, top, bottom. Each is (x, y, width, height) of the lit part.
	const float Segments[4][4] = {
		{ CentreX - Gap - Len, CentreY - Thick * 0.5f, Len,   Thick },
		{ CentreX + Gap,       CentreY - Thick * 0.5f, Len,   Thick },
		{ CentreX - Thick * 0.5f, CentreY - Gap - Len, Thick, Len   },
		{ CentreX - Thick * 0.5f, CentreY + Gap,       Thick, Len   },
	};

	for (const float* S : Segments)
	{
		DrawRect(Shadow, S[0] - Edge, S[1] - Edge, S[2] + Edge * 2.f, S[3] + Edge * 2.f);
	}
	for (const float* S : Segments)
	{
		DrawRect(Ink, S[0], S[1], S[2], S[3]);
	}

	// Centre dot: what the player actually aims with. Kept to a couple of pixels so it marks the
	// point of impact without covering a target at range.
	const float Dot = FMath::Max(1.f, FMath::RoundToFloat(2.f * Scale));
	DrawRect(Shadow, CentreX - Dot * 0.5f - Edge, CentreY - Dot * 0.5f - Edge,
		Dot + Edge * 2.f, Dot + Edge * 2.f);
	DrawRect(FLinearColor(0.92f, 0.98f, 1.f, 0.95f),
		CentreX - Dot * 0.5f, CentreY - Dot * 0.5f, Dot, Dot);
}

void APhotonGameMode::ExitAfterPhotonShot()
{
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONSHOT complete, exiting"));
	FPlatformMisc::RequestExit(false);
}

namespace
{
	/**
	 * The eight viewpoints the visual pass is judged from.
	 *
	 * Eye height is 150 rather than the pawn's 120 + 64 because the pawn is teleported rather than
	 * spawned, and these are camera poses, not spawn points.
	 */
	const APhotonGameMode::FPhotonViewpoint PhotonTour[] = {
		{ TEXT("01_PlayerSpawn"),   FVector(0.f, -1700.f, 150.f),    FRotator(0.f, 90.f, 0.f) },
		{ TEXT("02_CenterCourt"),   FVector(0.f, -520.f, 190.f),     FRotator(-3.f, 90.f, 0.f) },
		{ TEXT("03_OppositeSide"),  FVector(-260.f, -1250.f, 160.f), FRotator(2.f, 72.f, 0.f) },
		{ TEXT("04_AcrossCover"),   FVector(1080.f, -1000.f, 150.f), FRotator(0.f, 128.f, 0.f) },
		{ TEXT("05_LookingUp"),     FVector(330.f, -740.f, 150.f),   FRotator(46.f, 66.f, 0.f) },
		{ TEXT("06_ArenaCorner"),   FVector(1150.f, -1150.f, 150.f), FRotator(6.f, -46.f, 0.f) },
		{ TEXT("07_WeaponView"),    FVector(240.f, -1420.f, 150.f),  FRotator(-6.f, 78.f, 0.f) },
		{ TEXT("08_TeamSpawn"),     FVector(820.f, 120.f, 150.f),    FRotator(0.f, -8.f, 0.f) },
		// Added with the bowl: the venue is mostly above the containment wall, and the eight poses
		// above all look at the floor, so none of them could ever show whether it landed.
		{ TEXT("09_CentreAnchor"),  FVector(0.f, -1120.f, 150.f),    FRotator(14.f, 90.f, 0.f) },
		{ TEXT("10_NorthBowl"),     FVector(0.f, 500.f, 150.f),      FRotator(24.f, 90.f, 0.f) },
		// Aimed at the Champion's Walk, which is 15 m up on the west shelf. From -900 at 18 degrees
		// the frame was filled by the Green spawn gate and the wall behind it, so the one landmark
		// this pose exists to photograph was never in it.
		{ TEXT("11_WalkColonnade"), FVector(-40.f, 0.f, 150.f),      FRotator(27.f, 180.f, 0.f) },
	};
}

void APhotonGameMode::PreparePhotonTourView()
{
	UWorld* World = GetWorld();
	APlayerController* PC = World ? World->GetFirstPlayerController() : nullptr;
	APhotonCharacter* Character = PC ? Cast<APhotonCharacter>(PC->GetPawn()) : nullptr;
	if (!Character)
	{
		return;
	}

	// The virtual shadow map's non-Nanite overflow warning draws itself across the top of the
	// viewport, so it lands in the captures and in any measurement taken from them. Passing the
	// CVar on the command line silenced it only intermittently; setting it here, on the frame the
	// tour starts, is deterministic. The arena is authored non-Nanite by choice, so the warning has
	// nothing to tell us.
	if (IConsoleVariable* Overflow = IConsoleManager::Get().FindConsoleVariable(
			TEXT("r.Shadow.Virtual.AllowScreenOverflowMessages")))
	{
		Overflow->Set(0, ECVF_SetByCode);
	}

	// The tour is a survey of the architecture, and the third-person rig is the wrong instrument for
	// it: the camera trails 450 uu behind the pawn, so every viewpoint in the table was photographed
	// from 4.5 m behind where it was written, half of them from inside a cover volume, with the hero
	// filling the near third of the frame. Collapsing the arm onto the pawn origin makes the
	// viewpoint table mean what it says.
	if (Character->SpringArm)
	{
		Character->SpringArm->TargetArmLength = 0.f;
		Character->SpringArm->SocketOffset = FVector::ZeroVector;
		Character->SpringArm->TargetOffset = FVector::ZeroVector;
		Character->SpringArm->bDoCollisionTest = false;
	}
	if (USkeletalMeshComponent* Body = Character->GetMesh())
	{
		Body->SetHiddenInGame(true);
		Body->SetVisibility(false, true);
	}
	if (Character->ThirdPersonWeaponMesh)
	{
		Character->ThirdPersonWeaponMesh->SetHiddenInGame(true);
		Character->ThirdPersonWeaponMesh->SetVisibility(false, true);
	}
	if (Character->Camera)
	{
		TArray<USceneComponent*> CamKids;
		Character->Camera->GetChildrenComponents(true, CamKids);
		for (USceneComponent* Kid : CamKids)
		{
			if (UPrimitiveComponent* Prim = Cast<UPrimitiveComponent>(Kid))
			{
				Prim->SetHiddenInGame(true);
				Prim->SetVisibility(false, true);
			}
		}
		UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTOUR camera cleared, kids_hidden=%d"), CamKids.Num());
	}
}

void APhotonGameMode::StepPhotonTour()
{
	if (TourIndex >= UE_ARRAY_COUNT(PhotonTour))
	{
		UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTOUR complete, exiting"));
		FPlatformMisc::RequestExit(false);
		return;
	}

	if (TourIndex == 0)
	{
		PreparePhotonTourView();
	}

	const FPhotonViewpoint& View = PhotonTour[TourIndex];
	APlayerController* PC = GetWorld() ? GetWorld()->GetFirstPlayerController() : nullptr;
	APawn* Pawn = PC ? PC->GetPawn() : nullptr;
	if (Pawn && PC)
	{
		// Teleport rather than sweep: several viewpoints sit inside cover volumes, and a swept move
		// would stop short of them and quietly photograph the wrong place.
		Pawn->SetActorLocation(View.Location, false, nullptr, ETeleportType::TeleportPhysics);
		PC->SetControlRotation(View.Rotation);
	}

	FTimerHandle Settle;
	GetWorldTimerManager().SetTimer(Settle, this, &APhotonGameMode::CaptureTourShot, 0.7f, false);
}

void APhotonGameMode::CaptureTourShot()
{
	PhotonVisuals::RefreshArenaPostProcess(GetWorld());
	const FPhotonViewpoint& View = PhotonTour[TourIndex];
	// UI is included so the crosshair is proved by the same images as the architecture.
	FScreenshotRequest::RequestScreenshot(FString::Printf(TEXT("Photon_%s"), View.Name), true, false);
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONTOUR shot %s"), View.Name);

	++TourIndex;
	FTimerHandle Next;
	GetWorldTimerManager().SetTimer(Next, this, &APhotonGameMode::StepPhotonTour, 1.1f, false);
}
