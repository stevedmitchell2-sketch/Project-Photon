#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/GameModeBase.h"
#include "PhotonPlayer.generated.h"

class UCameraComponent;
class UInputAction;
class UInputMappingContext;
struct FInputActionValue;

/**
 * Photon's first-person character.
 *
 * Built on `ACharacter` and `UCharacterMovementComponent` deliberately: the reference build
 * hand-rolled its own movement integrator because it had to, and the one thing that buys in Unreal is
 * replicated client prediction for free. Reinventing it here would throw that away.
 *
 * Movement values are ported from the measured Three.js build rather than invented — walk 5.2 m/s and
 * sprint 8.4 m/s are the speeds the arena's engagement distances and bot difficulty ladder were tuned
 * against, expressed here in cm/s.
 */
UCLASS()
class PHOTON_API APhotonCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	APhotonCharacter();

	/** Eye height above the capsule centre. ~1.75 m eye line on a 1.95 m frame. */
	UPROPERTY(EditDefaultsOnly, Category = "Photon|Camera")
	float EyeHeight = 64.f;

	UPROPERTY(EditDefaultsOnly, Category = "Photon|Movement") float WalkSpeed = 520.f;
	UPROPERTY(EditDefaultsOnly, Category = "Photon|Movement") float SprintSpeed = 840.f;
	UPROPERTY(EditDefaultsOnly, Category = "Photon|Movement") float CrouchSpeed = 300.f;

	/** Degrees per second at full stick deflection. Tuned for a console-feel right stick. */
	UPROPERTY(EditDefaultsOnly, Category = "Photon|Look") float GamepadLookRate = 140.f;
	/** Degrees per mouse unit. Enhanced Input delivers mouse deltas already frame-independent. */
	UPROPERTY(EditDefaultsOnly, Category = "Photon|Look") float MouseLookScale = 0.6f;

	UPROPERTY(VisibleAnywhere, Category = "Photon") TObjectPtr<UCameraComponent> Camera;

	/**
	 * The first-person weapon root.
	 *
	 * Parented to the camera, so the view model inherits look rotation without the world mesh being
	 * involved. This is the Unreal-native answer to a problem the reference build fought for a whole
	 * session: with a dedicated FP setup the weapon is no longer clamped by the world camera's near
	 * plane, which is what capped how large the PH-6 could be drawn. Session B hangs the mesh here.
	 */
	UPROPERTY(VisibleAnywhere, Category = "Photon") TObjectPtr<USceneComponent> WeaponRoot;

	bool IsSprinting() const { return bSprintHeld && !bIsCrouched; }

protected:
	virtual void BeginPlay() override;
	virtual void SetupPlayerInputComponent(class UInputComponent* PlayerInputComponent) override;

	void OnMove(const FInputActionValue& Value);
	/** Mouse look: the value is already a per-frame delta, so it must NOT be scaled by DeltaTime. */
	void OnLook(const FInputActionValue& Value);
	/** Stick look: the value is a held deflection, so it MUST be scaled by DeltaTime. */
	void OnLookStick(const FInputActionValue& Value);
	void OnJumpStart(const FInputActionValue& Value);
	void OnJumpStop(const FInputActionValue& Value);
	void OnCrouchToggle(const FInputActionValue& Value);
	void OnSprintStart(const FInputActionValue& Value);
	void OnSprintStop(const FInputActionValue& Value);

	bool bSprintHeld = false;
};

/**
 * Photon's player controller. Owns input *registration*; the pawn owns input *response*.
 *
 * The mapping context is built in C++ at runtime rather than read from `IMC_Photon`. That is a
 * deliberate reversal: the editor asset exists but carries zero bindings, because the Python API in
 * this engine build cannot construct an `FKey` and so cannot author them. In C++ `EKeys::SpaceBar` is
 * simply available, which makes the bindings ordinary versioned source code that can be diffed and
 * reviewed — better than a binary asset either way.
 */
UCLASS()
class PHOTON_API APhotonPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	/** Built in BeginPlay. Public so tests and logging can assert on the mapping count. */
	UPROPERTY(Transient) TObjectPtr<UInputMappingContext> RuntimeContext;

	/** Actions, loaded from the generated /Game/Photon/Input assets. */
	UPROPERTY(Transient) TMap<FName, TObjectPtr<UInputAction>> Actions;

	/**
	 * Loads the action set on first use.
	 *
	 * Lazy on purpose: the pawn's SetupPlayerInputComponent runs *before* this controller's BeginPlay,
	 * so loading in BeginPlay left the map empty at bind time and every BindAction silently no-opped.
	 * The mapping context still reported 27/27, which is why this was initially mistaken for working.
	 */
	UInputAction* FindAction(FName Name);

	/** Number of key mappings actually present. The only honest measure that binding worked. */
	UFUNCTION(BlueprintCallable, Category = "Photon")
	int32 GetMappingCount() const;

protected:
	virtual void BeginPlay() override;

	void LoadActions();
	bool bActionsLoaded = false;
	void BuildMappingContext();
};

/** Smallest game mode that puts a Photon player in a level. Networking is Session C. */
UCLASS()
class PHOTON_API APhotonGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	APhotonGameMode();
};
