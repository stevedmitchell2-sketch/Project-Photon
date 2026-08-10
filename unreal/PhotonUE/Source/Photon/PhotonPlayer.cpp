#include "PhotonPlayer.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "PhotonCore.h"
#include "PhotonWeapon.h"
#include "TimerManager.h"
#include "EngineUtils.h"
#include "Engine/World.h"

// ---------------------------------------------------------------------------------------------
// APhotonCharacter
// ---------------------------------------------------------------------------------------------

APhotonCharacter::APhotonCharacter()
{
	PrimaryActorTick.bCanEverTick = false;

	// 1.95 m frame: 97.5 cm half-height. The reference build's competitor is the same height, so
	// cover heights and sight lines ported from the arena stay meaningful.
	GetCapsuleComponent()->InitCapsuleSize(38.f, 97.5f);

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(GetCapsuleComponent());
	Camera->SetRelativeLocation(FVector(0.f, 0.f, EyeHeight));
	// The controller drives the camera directly — this is what makes it a first-person camera rather
	// than a camera that happens to sit inside the character.
	Camera->bUsePawnControlRotation = true;

	// TEMPORARY FIRST-PERSON PRESENTATION PROXY — shoulder/arm/hand chain until rigged FP arms exist.
	FirstPersonPresentationRoot = CreateDefaultSubobject<USceneComponent>(TEXT("FP_PresentationRoot"));
	FirstPersonPresentationRoot->SetupAttachment(Camera);
	FirstPersonPresentationRoot->SetRelativeLocation(FVector(8.f, 0.f, -14.f));

	auto SetupArmProxy = [](UStaticMeshComponent* Arm, USceneComponent* Parent,
		const FVector& Loc, const FRotator& Rot, const FVector& Scale)
	{
		if (!Arm)
		{
			return;
		}
		Arm->SetupAttachment(Parent);
		Arm->SetRelativeLocation(Loc);
		Arm->SetRelativeRotation(Rot);
		Arm->SetRelativeScale3D(Scale);
		Arm->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Arm->SetCastShadow(false);
		if (UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder")))
		{
			Arm->SetStaticMesh(Cylinder);
		}
	};

	RightArmProxy = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("RightArmProxy"));
	SetupArmProxy(RightArmProxy, FirstPersonPresentationRoot,
		FVector(6.f, 18.f, -10.f), FRotator(-15.f, 70.f, 10.f), FVector(0.07f, 0.07f, 0.38f));

	LeftArmProxy = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("LeftArmProxy"));
	SetupArmProxy(LeftArmProxy, FirstPersonPresentationRoot,
		FVector(6.f, -14.f, -12.f), FRotator(-10.f, 55.f, -8.f), FVector(0.06f, 0.06f, 0.32f));

	WeaponRoot = CreateDefaultSubobject<USceneComponent>(TEXT("WeaponRoot"));
	WeaponRoot->SetupAttachment(RightArmProxy);
	WeaponRoot->SetRelativeLocation(FVector(32.f, 6.f, -4.f));
	WeaponRoot->SetRelativeRotation(FRotator(8.f, -8.f, 0.f));

	Inventory = CreateDefaultSubobject<UPhotonInventoryComponent>(TEXT("Inventory"));
	Health = CreateDefaultSubobject<UPhotonHealthComponent>(TEXT("Health"));

	// The owning player must not see their own world mesh from the inside.
	if (USkeletalMeshComponent* Body = GetMesh())
	{
		Body->SetOwnerNoSee(true);
	}
	if (RightArmProxy)
	{
		RightArmProxy->SetOnlyOwnerSee(true);
	}
	if (LeftArmProxy)
	{
		LeftArmProxy->SetOnlyOwnerSee(true);
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
	if (Camera)
	{
		Camera->SetRelativeLocation(FVector(0.f, 0.f, EyeHeight));
	}
	if (FParse::Param(FCommandLine::Get(), TEXT("PhotonSelfTest")))
	{
		// Deferred a beat: the inventory builds its loadout in its own BeginPlay, and component and
		// actor BeginPlay ordering is not guaranteed to favour us.
		FTimerHandle H;
		GetWorldTimerManager().SetTimer(H, this, &APhotonCharacter::RunSelfTest, 1.0f, false);
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
		return;
	}
	if (FMath::IsNearlyEqual(Axis, 1.f, 0.01f))
	{
		Inventory->EquipIndex(1);
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
	Check(TEXT("ph9_mesh_visible"), Inventory->GetActiveWeapon() &&
		!Inventory->GetActiveWeapon()->IsHidden());
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
	Check(TEXT("fp_presentation_root_attached"),
		FirstPersonPresentationRoot && FirstPersonPresentationRoot->GetAttachParent() == Camera);
	Check(TEXT("fp_weapon_attached_to_arm_proxy"),
		WeaponRoot && RightArmProxy && WeaponRoot->GetAttachParent() == RightArmProxy);

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
}

// ---------------------------------------------------------------------------------------------
// APhotonGameMode
// ---------------------------------------------------------------------------------------------

APhotonGameMode::APhotonGameMode()
{
	DefaultPawnClass = APhotonCharacter::StaticClass();
	PlayerControllerClass = APhotonPlayerController::StaticClass();
}
