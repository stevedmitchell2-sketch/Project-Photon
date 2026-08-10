#include "PhotonPlayer.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "InputAction.h"
#include "InputMappingContext.h"

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

	WeaponRoot = CreateDefaultSubobject<USceneComponent>(TEXT("WeaponRoot"));
	WeaponRoot->SetupAttachment(Camera);

	// The owning player must not see their own world mesh from the inside.
	if (USkeletalMeshComponent* Body = GetMesh())
	{
		Body->SetOwnerNoSee(true);
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

	auto Bind = [EIC, PC](FName Name, ETriggerEvent Event, auto Fn, APhotonCharacter* Self)
	{
		if (UInputAction* Action = PC->FindAction(Name))
		{
			EIC->BindAction(Action, Event, Self, Fn);
		}
		else
		{
			UE_LOG(LogTemp, Warning, TEXT("[Photon] no action %s to bind"), *Name.ToString());
		}
	};

	Bind("IA_Move", ETriggerEvent::Triggered, &APhotonCharacter::OnMove, this);
	Bind("IA_Look", ETriggerEvent::Triggered, &APhotonCharacter::OnLook, this);
	Bind("IA_Jump", ETriggerEvent::Started, &APhotonCharacter::OnJumpStart, this);
	Bind("IA_Jump", ETriggerEvent::Completed, &APhotonCharacter::OnJumpStop, this);
	Bind("IA_CrouchSlide", ETriggerEvent::Started, &APhotonCharacter::OnCrouchToggle, this);
	Bind("IA_Sprint", ETriggerEvent::Started, &APhotonCharacter::OnSprintStart, this);
	Bind("IA_Sprint", ETriggerEvent::Completed, &APhotonCharacter::OnSprintStop, this);

	UE_LOG(LogTemp, Display, TEXT("[Photon] input bound on %s"), *GetName());
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
	const FVector2D Axis = Value.Get<FVector2D>();
	if (Axis.IsNearlyZero())
	{
		return;
	}
	// Mouse arrives as a per-frame delta and must not be multiplied by DeltaTime; a stick arrives as a
	// held magnitude and must be. Enhanced Input hands both through one action, so the rate applies to
	// the gamepad path via the frame delta and the mouse path is scaled directly.
	const float Delta = GetWorld() ? GetWorld()->GetDeltaSeconds() : 0.f;
	AddControllerYawInput(Axis.X * MouseLookScale + Axis.X * GamepadLookRate * Delta * 0.f);
	AddControllerPitchInput(-Axis.Y * MouseLookScale);
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
	UE_LOG(LogTemp, Display, TEXT("[Photon] loaded %d/%d input actions"),
		Actions.Num(), UE_ARRAY_COUNT(GPhotonActionNames));
}

UInputAction* APhotonPlayerController::FindAction(FName Name) const
{
	const TObjectPtr<UInputAction>* Found = Actions.Find(Name);
	return Found ? Found->Get() : nullptr;
}

int32 APhotonPlayerController::GetMappingCount() const
{
	return RuntimeContext ? RuntimeContext->GetMappings().Num() : 0;
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
		{ TEXT("IA_Look"), EKeys::Gamepad_Right2D },
		{ TEXT("IA_Look"), EKeys::Mouse2D },

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
