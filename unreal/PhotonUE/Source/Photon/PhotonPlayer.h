#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "GameFramework/HUD.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/GameModeBase.h"
#include "PhotonPlayer.generated.h"

class UCameraComponent;
class UInputAction;
class UInputMappingContext;
class UPhotonInventoryComponent;
class UPhotonHealthComponent;
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

	/** Boom for third-person follow camera (Capsule → SpringArm → Camera). */
	UPROPERTY(VisibleAnywhere, Category = "Photon|Camera")
	TObjectPtr<class USpringArmComponent> SpringArm;

	/**
	 * When true (default), local player sees the Mixamo hero + chase cam for arena movement.
	 * Pass -PhotonFirstPerson to restore the FP viewmodel path (arms/gloves still paused/rough).
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Photon|Camera")
	bool bThirdPersonView = true;

	/** The first-person weapon root. Parented to the camera; see the constructor for why. */
	UPROPERTY(VisibleAnywhere, Category = "Photon") TObjectPtr<USceneComponent> WeaponRoot;

	/** Anchor for the first-person arms: Camera → FirstPersonPresentationRoot → arms. */
	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<USceneComponent> FirstPersonPresentationRoot;

	/**
	 * Legacy static FP arm proxies (/Game/Photon/Meshes/SM_PhotonArm*).
	 *
	 * Kept as a fallback when SK_PhotonFPArms is not imported yet. When the authored skeletal
	 * arms load successfully they are hidden — the no-finger-bones pipeline does not depend on them.
	 */
	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<class UStaticMeshComponent> RightArm;

	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<class UStaticMeshComponent> LeftArm;

	/**
	 * Closed-grip gloves (Tripo SM_PhotonGlove*) placed at the hip-grip points.
	 * Whole-hand meshes — no finger-bone animation. Weapon stays on Camera → WeaponRoot.
	 */
	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<class UStaticMeshComponent> RightGlove;

	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<class UStaticMeshComponent> LeftGlove;

	/** Camera-space grip targets (cm) — shared with weapon recoil so gloves track the kick. */
	UPROPERTY(EditDefaultsOnly, Category = "Photon|Presentation")
	FVector RightGripCamera = FVector(40.f, 14.f, -14.f);

	UPROPERTY(EditDefaultsOnly, Category = "Photon|Presentation")
	FVector LeftGripCamera = FVector(56.f, 8.f, -10.f);

	UPROPERTY(EditDefaultsOnly, Category = "Photon|Presentation")
	FVector RightGloveScale = FVector(0.38f);

	UPROPERTY(EditDefaultsOnly, Category = "Photon|Presentation")
	FVector LeftGloveScale = FVector(0.38f);

	/**
	 * Optional skinned FP arms from the hero extract (SK_PhotonFPArms).
	 * Prefer robot forearm static meshes + gloves for readability; this stays as fallback.
	 */
	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<class USkeletalMeshComponent> FirstPersonArms;

	/**
	 * Third-person weapon mesh attached to SOCKET_weapon_right on GetMesh().
	 *
	 * Local player uses Camera→WeaponRoot for the viewmodel; this mesh is OwnerNoSee so others
	 * still see a weapon in the hero's hand without depending on finger bones.
	 */
	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<class UStaticMeshComponent> ThirdPersonWeaponMesh;

	/** Deterministic TP weapon socket name on SK_PhotonHero / mixamorig:RightHand. */
	static const FName WeaponSocketName;

	/**
	 * Lights the viewmodel and nothing else.
	 *
	 * On lighting channel 1, and the arms and weapon are moved off channel 0 to match. Without this
	 * the only way to make the weapon readable is to raise the arena lights until the arena itself
	 * is washed out — the two are the same control otherwise.
	 */
	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<class UPointLightComponent> ViewModelKey;

	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<class UPointLightComponent> ViewModelFill;

	/** Visible first-person weapon mesh — lives on the pawn, not the weapon logic actor. */
	UPROPERTY(VisibleAnywhere, Category = "Photon|Presentation")
	TObjectPtr<class UStaticMeshComponent> WeaponViewMesh;

	UPROPERTY(VisibleAnywhere, Category = "Photon") TObjectPtr<UPhotonInventoryComponent> Inventory;
	UPROPERTY(VisibleAnywhere, Category = "Photon") TObjectPtr<UPhotonHealthComponent> Health;

	bool IsSprinting() const { return bSprintHeld && !bIsCrouched; }

	/**
	 * Drives the Session B acceptance sequence and asserts on the resulting state at every step.
	 *
	 * Exists because the switching and firing paths cannot be exercised by hand from a headless run,
	 * and "it compiled" is not evidence. Enabled with -PhotonSelfTest on the command line.
	 */
	void RunSelfTest();

	/** Applies third-person chase cam + visible hero, or FP viewmodel path. */
	void ApplyViewPresentation();

	/** Keep Mixamo root bone glued to the capsule (clips otherwise drift the body out of frame). */
	void LockHeroRootMotion();

	/** Log hips/head/hand spans — catches T-pose / exploded skinning in -PhotonShot. */
	void LogHeroBoneFrame(const TCHAR* Tag) const;

	/** Level chase pitch so the Mixamo body sits mid-lower frame (not a floor stare). */
	void ApplyThirdPersonLookDefaults();

protected:
	virtual void BeginPlay() override;
	virtual void PossessedBy(AController* NewController) override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(class UInputComponent* PlayerInputComponent) override;

	void SetupHeroPresentation();
	/** Ensures SOCKET_weapon_right exists on the hero skeletal mesh (authored offsets). */
	void EnsureWeaponSocket(class USkeletalMesh* MeshAsset);
	/** Translates skinned FP arms so RightHand lands on the hip-grip point (camera space). */
	void AlignFirstPersonArmsToGrip();
	/**
	 * Parents gloves to WeaponViewMesh (absolute scale) and tucks robot forearms so the FP
	 * silhouette reads as glove-on-weapon, not floating imported pieces.
	 */
	void AlignFpViewmodelPresentation();
	/** Speed-based single-node clip selection (idle / walk / run / sprint). No AnimBP required. */
	void UpdateHeroLocomotion();
	void PlayHeroClip(class UAnimSequence* Clip, bool bLoop);
	void SyncThirdPersonWeaponMesh();

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
	void OnFireStarted(const FInputActionValue& Value);
	void OnFireTriggered(const FInputActionValue& Value);
	void OnFireReleased(const FInputActionValue& Value);
	void OnWeaponSwitch(const FInputActionValue& Value);
	void OnWeaponSelect(const FInputActionValue& Value);
	void OnGrenade(const FInputActionValue& Value);

	bool bSprintHeld = false;
	bool bHeroPresentationReady = false;

	UPROPERTY(Transient) TObjectPtr<class UAnimSequence> HeroAnimIdle;
	UPROPERTY(Transient) TObjectPtr<class UAnimSequence> HeroAnimWalk;
	UPROPERTY(Transient) TObjectPtr<class UAnimSequence> HeroAnimRun;
	UPROPERTY(Transient) TObjectPtr<class UAnimSequence> HeroAnimSprint;
	UPROPERTY(Transient) TObjectPtr<class UAnimSequence> ActiveHeroClip;

	/** Cached mesh relative location after hips re-anchor (avoids fighting anim every tick). */
	bool bHeroMeshOffsetLocked = false;
	FVector HeroMeshLockedRelative = FVector(0.f, 0.f, -97.5f);
	float HeroMeshOffsetRecheckTimer = 0.f;
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

	/** True when the runtime context maps Key to Action — used by self-test, not as movement proof. */
	bool IsKeyMappedToAction(FName ActionName, FKey Key) const;

protected:
	virtual void BeginPlay() override;

	void LoadActions();
	bool bActionsLoaded = false;
	void BuildMappingContext();
};

/**
 * Photon's first-person HUD. Currently just the crosshair.
 *
 * Drawn on the canvas rather than placed as world geometry in front of the camera, because the
 * centre of the screen is a UI fact, not a world one: a world-space reticle drifts with field of
 * view, aspect ratio and any weapon pose change, and is never quite where the shot goes.
 */
UCLASS()
class PHOTON_API APhotonHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

	/** Half the gap at the centre, in pixels at 1080p. Kept small — this is a marksman's reticle. */
	UPROPERTY(EditDefaultsOnly, Category = "Photon|HUD") float CrosshairGap = 5.f;
	UPROPERTY(EditDefaultsOnly, Category = "Photon|HUD") float CrosshairLength = 7.f;
	UPROPERTY(EditDefaultsOnly, Category = "Photon|HUD") float CrosshairThickness = 2.f;
};

/** Smallest game mode that puts a Photon player in a level. Networking is Session C. */
UCLASS()
class PHOTON_API APhotonGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	APhotonGameMode();

	/** One pose in the -PhotonTour screenshot sequence. Public so the tour table can live in the .cpp. */
	struct FPhotonViewpoint
	{
		const TCHAR* Name;
		FVector Location;
		FRotator Rotation;
	};

protected:
	virtual void BeginPlay() override;

	/**
	 * Headless visual capture, enabled with -PhotonShot.
	 *
	 * Visual work cannot be verified by assertions, and stopping for a manual PIE session after every
	 * material change is not a workable loop. This renders a real frame to Saved/Screenshots and exits.
	 */
	void CapturePhotonShot();
	void ExitAfterPhotonShot();

	/** Hold a few live bolts in front of the camera so -PhotonShot can verify projectile readability. */
	void StagePhotonShotFX();

	/**
	 * Scripted screenshot tour, enabled with -PhotonTour.
	 *
	 * -PhotonShot only ever showed the arena from the spawn, which is exactly the one angle a
	 * greybox can be made to look acceptable from. The tour poses the pawn at a fixed set of
	 * viewpoints and captures each one, so a visual change has to survive being looked at from the
	 * centre, from a corner, and from underneath the ceiling before it counts as an improvement.
	 */
	void StepPhotonTour();
	void CaptureTourShot();

	/** Collapse the chase rig onto the pawn origin and hide the hero, so the tour photographs the arena. */
	void PreparePhotonTourView();

	/** -PhotonPerf: sample FPS / frame times after the level settles, then exit. */
	void StartPhotonPerfSample();
	void TickPhotonPerfSample();
	void FinishPhotonPerfSample();

	int32 TourIndex = 0;

	bool bPhotonPerfActive = false;
	float PhotonPerfSampleLeft = 0.f;
	int32 PhotonPerfFrames = 0;
	double PhotonPerfSumMs = 0.0;
	double PhotonPerfMinMs = 1.0e9;
	double PhotonPerfMaxMs = 0.0;
	FTimerHandle PhotonPerfTickHandle;
};
