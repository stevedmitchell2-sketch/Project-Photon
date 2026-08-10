#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "GameFramework/Actor.h"
#include "Components/ActorComponent.h"
#include "PhotonCore.generated.h"

class UNiagaraSystem;
class USoundBase;
class UStaticMesh;
class UProjectileMovementComponent;
class USphereComponent;
class UStaticMeshComponent;
class UPointLightComponent;

/**
 * Project Photon — Unreal Stage 0 core types.
 *
 * NOTE ON VERIFICATION: none of this has been compiled. No C++ toolchain is installed on this
 * machine (no MSVC, no Windows SDK, no clang — see docs/UNREAL_STAGE0.md), so Unreal Build Tool
 * cannot run. Treat every file in this module as unverified source, not as a working build.
 *
 * It is written anyway because the design it carries is the part of the reference build worth
 * keeping: measured weapon values, the team-colour rule, and the constraint that no weapon
 * behaviour lives outside data.
 */

/** Team identity. Four teams because the Photon design calls for four; the reference build ran two. */
UENUM(BlueprintType)
enum class EPhotonTeam : uint8
{
	None   UMETA(DisplayName = "None"),
	Red    UMETA(DisplayName = "Red"),
	Green  UMETA(DisplayName = "Green"),
	Blue   UMETA(DisplayName = "Blue"),
	Yellow UMETA(DisplayName = "Yellow"),
};

/** How a weapon is fed. The reference build had exactly one model; the roster needs both. */
UENUM(BlueprintType)
enum class EPhotonFeedMode : uint8
{
	/** Recharging energy cell — the PH-6 model. No reload, no reserve. */
	EnergyCell UMETA(DisplayName = "Energy Cell"),
	/** Magazine + reserve + reload. Nothing in the reference build implemented this. */
	Magazine   UMETA(DisplayName = "Magazine"),
};

UENUM(BlueprintType)
enum class EPhotonFireMode : uint8
{
	Automatic UMETA(DisplayName = "Automatic"),
	Semi      UMETA(DisplayName = "Semi"),
	Burst     UMETA(DisplayName = "Burst"),
};

/**
 * Team colour lookup.
 *
 * Deliberately one free function rather than a colour stored per actor. The reference build learned
 * that team colour has to be derivable from team id alone, or projectiles, avatars, HUD and arena
 * accents drift out of agreement with one another.
 */
PHOTON_API FLinearColor PhotonTeamColor(EPhotonTeam Team);

/**
 * One weapon, as data. Direct port of `src/config/weapons.ts`.
 *
 * This holds a line the reference build already held and must not lose: **no weapon behaviour is
 * hardcoded anywhere else.** The PH-6's eight-shot cell is a number in this asset, not a constant in
 * the firing code — which is exactly what allowed four more weapons to be added to the reference
 * build without touching the simulation.
 *
 * Units differ from the reference build: Unreal is centimetres, the TS build was metres. Speeds and
 * distances are therefore x100. Getting this wrong is the single most likely porting error.
 *
 * Fields marked NEW are gaps the migration assessment identified in the reference build.
 */
UCLASS(BlueprintType)
class PHOTON_API UPhotonWeaponData : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, Category = "Identity") FName WeaponId;
	UPROPERTY(EditDefaultsOnly, Category = "Identity") FText DisplayName;
	UPROPERTY(EditDefaultsOnly, Category = "Identity") TObjectPtr<UStaticMesh> Mesh;

	// --- Feed ---
	UPROPERTY(EditDefaultsOnly, Category = "Feed") EPhotonFeedMode FeedMode = EPhotonFeedMode::EnergyCell;
	/** Shots before the cell must cycle (EnergyCell) or the magazine empties (Magazine). */
	UPROPERTY(EditDefaultsOnly, Category = "Feed") int32 Capacity = 8;
	/** Magazine mode only. NEW — the reference build had no reserve pool. */
	UPROPERTY(EditDefaultsOnly, Category = "Feed") int32 ReserveAmmo = 0;
	/** Magazine mode only. NEW — the reference build had no reload at all. */
	UPROPERTY(EditDefaultsOnly, Category = "Feed") float ReloadTime = 0.f;
	UPROPERTY(EditDefaultsOnly, Category = "Feed") float RechargeDuration = 1.85f;
	UPROPERTY(EditDefaultsOnly, Category = "Feed") float TrickleDelay = 2.4f;
	UPROPERTY(EditDefaultsOnly, Category = "Feed") float TrickleRate = 0.55f;

	// --- Handling ---
	UPROPERTY(EditDefaultsOnly, Category = "Handling") EPhotonFireMode FireMode = EPhotonFireMode::Automatic;
	UPROPERTY(EditDefaultsOnly, Category = "Handling") float FireInterval = 0.17f;
	UPROPERTY(EditDefaultsOnly, Category = "Handling") int32 BurstCount = 3;
	/** NEW — the reference build switched instantly, because it could not switch at all. */
	UPROPERTY(EditDefaultsOnly, Category = "Handling") float EquipTime = 0.35f;
	UPROPERTY(EditDefaultsOnly, Category = "Handling") float UnequipTime = 0.25f;

	// --- Ballistics (centimetres) ---
	UPROPERTY(EditDefaultsOnly, Category = "Ballistics") TSubclassOf<class APhotonProjectile> ProjectileClass;
	/** 215 m/s in the reference build becomes 21500 cm/s here. */
	UPROPERTY(EditDefaultsOnly, Category = "Ballistics") float ProjectileSpeed = 21500.f;
	UPROPERTY(EditDefaultsOnly, Category = "Ballistics") float ProjectileLifetime = 1.6f;
	UPROPERTY(EditDefaultsOnly, Category = "Ballistics") float ProjectileRadius = 9.f;

	// --- Damage ---
	UPROPERTY(EditDefaultsOnly, Category = "Damage") float Damage = 28.f;
	UPROPERTY(EditDefaultsOnly, Category = "Damage") float HeadshotMultiplier = 1.7f;
	UPROPERTY(EditDefaultsOnly, Category = "Damage") float FalloffStart = 2800.f;
	UPROPERTY(EditDefaultsOnly, Category = "Damage") float FalloffEnd = 5500.f;
	UPROPERTY(EditDefaultsOnly, Category = "Damage") float MinDamageScale = 0.62f;

	// --- Accuracy (degrees of cone half-angle) ---
	UPROPERTY(EditDefaultsOnly, Category = "Accuracy") float SpreadBase = 0.35f;
	UPROPERTY(EditDefaultsOnly, Category = "Accuracy") float SpreadMoving = 1.15f;
	UPROPERTY(EditDefaultsOnly, Category = "Accuracy") float SpreadAir = 2.4f;
	UPROPERTY(EditDefaultsOnly, Category = "Accuracy") float SpreadAds = 0.08f;
	UPROPERTY(EditDefaultsOnly, Category = "Accuracy") float SpreadPerShot = 0.34f;
	UPROPERTY(EditDefaultsOnly, Category = "Accuracy") float SpreadMax = 3.6f;
	UPROPERTY(EditDefaultsOnly, Category = "Accuracy") float SpreadRecovery = 3.2f;

	// --- Recoil (degrees) ---
	UPROPERTY(EditDefaultsOnly, Category = "Recoil") float RecoilPitch = 0.85f;
	UPROPERTY(EditDefaultsOnly, Category = "Recoil") float RecoilYaw = 0.22f;
	UPROPERTY(EditDefaultsOnly, Category = "Recoil") float RecoilRecoveryHalfLife = 0.11f;

	// --- ADS ---
	UPROPERTY(EditDefaultsOnly, Category = "ADS") float AdsTime = 0.16f;
	UPROPERTY(EditDefaultsOnly, Category = "ADS") float AdsFovScale = 0.72f;
	UPROPERTY(EditDefaultsOnly, Category = "ADS") float AdsSensitivityScale = 0.68f;

	/**
	 * Hip and ADS are separate authored transforms, not one pose at two sizes.
	 *
	 * The reference build proved why: interpolating position alone made ADS read as a zoom rather
	 * than as the weapon being brought to the eye. The attitude has to travel as well as the offset.
	 * Values are the reference build's HIP/ADS poses converted to centimetres.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Presentation")
	FTransform HipTransform = FTransform(
		FRotator(-1.5f, 2.f, 0.f), FVector(44.f, 14.f, -12.f), FVector(0.34f));

	UPROPERTY(EditDefaultsOnly, Category = "Presentation")
	FTransform AdsTransform = FTransform(
		FRotator(0.f, 0.f, 0.f), FVector(50.f, 3.f, -10.f), FVector(0.34f));

	/** Muzzle flash / bolt origin in mesh local space. Used when no SOCKET_muzzle exists. */
	UPROPERTY(EditDefaultsOnly, Category = "Presentation")
	FVector MuzzleOffset = FVector(52.f, 0.f, 2.f);

	/** View-model kick applied on each shot, in weapon-local space (cm / degrees). */
	UPROPERTY(EditDefaultsOnly, Category = "Presentation")
	FVector RecoilKickOffset = FVector(-2.8f, 0.f, 0.45f);

	/** Multiplier from RecoilPitch (degrees) to mesh pitch kick. */
	UPROPERTY(EditDefaultsOnly, Category = "Presentation")
	float RecoilMeshPitchScale = 3.5f;

	// --- Feel ---
	UPROPERTY(EditDefaultsOnly, Category = "Feel") float CameraShake = 0.35f;
	UPROPERTY(EditDefaultsOnly, Category = "Feel") float RumbleStrong = 0.28f;
	UPROPERTY(EditDefaultsOnly, Category = "Feel") float RumbleWeak = 0.55f;
	UPROPERTY(EditDefaultsOnly, Category = "Feel") float RumbleDuration = 0.07f;

	// --- FX ---
	UPROPERTY(EditDefaultsOnly, Category = "FX") TObjectPtr<UNiagaraSystem> MuzzleFX;
	UPROPERTY(EditDefaultsOnly, Category = "FX") TObjectPtr<USoundBase> FireSound;

	/** Current cone half-angle. One function so hip, ADS, moving and airborne stay consistent. */
	UFUNCTION(BlueprintCallable, Category = "Photon")
	float ResolveSpread(bool bAiming, float Speed, bool bAirborne, float Heat) const;

	/** Damage after distance falloff, in the same units the reference build used. */
	UFUNCTION(BlueprintCallable, Category = "Photon")
	float ResolveDamage(float DistanceCm) const;
};

/** Data-driven grenade tuning — one asset per grenade type. */
UCLASS(BlueprintType)
class PHOTON_API UPhotonGrenadeData : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditDefaultsOnly, Category = "Identity") FName GrenadeId;
	UPROPERTY(EditDefaultsOnly, Category = "Identity") FText DisplayName;

	UPROPERTY(EditDefaultsOnly, Category = "Throw") float ThrowSpeed = 2200.f;
	UPROPERTY(EditDefaultsOnly, Category = "Throw") float ThrowUpwardBoost = 620.f;
	UPROPERTY(EditDefaultsOnly, Category = "Throw") float FuseTime = 2.0f;
	UPROPERTY(EditDefaultsOnly, Category = "Throw") float Bounciness = 0.45f;

	UPROPERTY(EditDefaultsOnly, Category = "Explosion") float ExplosionRadius = 450.f;
	UPROPERTY(EditDefaultsOnly, Category = "Explosion") float MaxDamage = 80.f;
	UPROPERTY(EditDefaultsOnly, Category = "Explosion") float MinDamageScale = 0.2f;

	UFUNCTION(BlueprintCallable, Category = "Photon")
	float ResolveExplosionDamage(float DistanceCm) const;
};

/**
 * Thrown energy grenade — gravity, bounce, fuse, radial damage through UPhotonHealthComponent.
 *
 * Authority: fuse countdown and damage run on the server (HasAuthority). No client prediction yet.
 */
UCLASS()
class PHOTON_API APhotonGrenade : public AActor
{
	GENERATED_BODY()

public:
	APhotonGrenade();

	void InitialiseFrom(const UPhotonGrenadeData* InData, EPhotonTeam InTeam, AController* InInstigator,
		const FVector& InitialVelocity);

	/** Apply radial damage and destroy. Server-authoritative. */
	void Explode();

	float GetSpeed() const;
	float GetFuseTime() const { return Data ? Data->FuseTime : 0.f; }
	EPhotonTeam GetTeam() const { return Team; }
	bool HasExploded() const { return bExploded; }

protected:
	virtual void BeginPlay() override;

	UFUNCTION()
	void OnHit(UPrimitiveComponent* HitComp, AActor* OtherActor, UPrimitiveComponent* OtherComp,
		FVector NormalImpulse, const FHitResult& Hit);

	void ArmFuse();

	UPROPERTY(VisibleAnywhere) TObjectPtr<USphereComponent> Collision;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UProjectileMovementComponent> Movement;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Body;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UPointLightComponent> Glow;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UPointLightComponent> ExplosionFlash;

	UPROPERTY() TObjectPtr<const UPhotonGrenadeData> Data;
	UPROPERTY(Replicated) EPhotonTeam Team = EPhotonTeam::None;
	bool bExploded = false;
	FTimerHandle FuseTimer;

public:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};

/**
 * A travelling energy bolt.
 *
 * Bolts are real actors with travel time, not hitscan — carried over deliberately from the reference
 * build, where projectile speed is a per-weapon tuning lever (the PH-4 at 420 m/s versus the PH-7 at
 * 118 m/s is most of what makes those two weapons feel different).
 *
 * Replication note: this is spawned authoritatively on the server. A client-side cosmetic bolt fired
 * immediately on input is the standard companion to this and is NOT implemented here — see
 * docs/UNREAL_STAGE0.md, "intentionally stubbed".
 */
UCLASS()
class PHOTON_API APhotonProjectile : public AActor
{
	GENERATED_BODY()

public:
	APhotonProjectile();

	/** Configures speed, lifetime, radius, damage and team colour from the firing weapon's data. */
	void InitialiseFrom(const UPhotonWeaponData* Data, EPhotonTeam InTeam, AController* InInstigator);

	/**
	 * Self-test helper: invokes the production OnImpact handler with a recorded hit.
	 * Used when headless simulation does not produce a physics OnComponentHit in time.
	 */
	void DeliverRecordedImpact(AActor* OtherActor, UPrimitiveComponent* OtherComp, const FHitResult& Hit);

	bool DidProcessImpact() const { return bImpactProcessed; }

protected:
	virtual void BeginPlay() override;

	UFUNCTION()
	void OnImpact(UPrimitiveComponent* HitComp, AActor* OtherActor, UPrimitiveComponent* OtherComp,
		FVector NormalImpulse, const FHitResult& Hit);

	UPROPERTY(VisibleAnywhere) TObjectPtr<USphereComponent> Collision;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UProjectileMovementComponent> Movement;

	/**
	 * The bolt's body and its glow.
	 *
	 * A mesh plus a small team-coloured point light rather than a Niagara system: this is a laser-tag
	 * bolt, and the light is what makes it readable against dark arena geometry at gameplay distance
	 * without authoring a particle asset. Cheap enough to have dozens in flight.
	 */
	UPROPERTY(VisibleAnywhere) TObjectPtr<UStaticMeshComponent> Body;
	UPROPERTY(VisibleAnywhere) TObjectPtr<UPointLightComponent> Glow;

	/** Replicated so late-joining clients tint the bolt correctly rather than showing it neutral. */
	UPROPERTY(Replicated) EPhotonTeam Team = EPhotonTeam::None;

	UPROPERTY() TObjectPtr<const UPhotonWeaponData> SourceData;
	FVector SpawnLocation = FVector::ZeroVector;
	bool bImpactProcessed = false;

public:
	/** True only when the bolt has geometry that is actually being drawn. */
	bool HasVisibleRepresentation() const;
	bool HasTintedMaterial() const;
	float GetSpeed() const;
	FVector GetSpawnLocation() const { return SpawnLocation; }
protected:

public:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};

/**
 * Health, damage, death and team, on a component.
 *
 * A component rather than a Character member so that the bot, the player and any future destructible
 * share exactly one damage path. The reference build's combat system was a free function over actor
 * state, which worked but meant every new damageable thing had to be taught about it separately.
 */
UCLASS(ClassGroup = (Photon), meta = (BlueprintSpawnableComponent))
class PHOTON_API UPhotonHealthComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPhotonHealthComponent();

	DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FPhotonDiedSignature, AController*, Killer);
	UPROPERTY(BlueprintAssignable) FPhotonDiedSignature OnDied;

	UPROPERTY(EditDefaultsOnly, Category = "Photon") float MaxHealth = 100.f;

	/** Replicated: the HUD and every remote client read this, so it cannot live client-side. */
	UPROPERTY(ReplicatedUsing = OnRep_Health, BlueprintReadOnly, Category = "Photon")
	float Health = 100.f;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "Photon")
	EPhotonTeam Team = EPhotonTeam::None;

	UPROPERTY(BlueprintReadOnly, Category = "Photon") bool bDead = false;

	/**
	 * Applies damage, server-authoritative.
	 *
	 * Friendly fire is rejected here rather than at the projectile, so every damage source inherits
	 * the rule automatically. The reference build's design has no friendly fire.
	 */
	UFUNCTION(BlueprintCallable, Category = "Photon")
	void ApplyPhotonDamage(float Amount, EPhotonTeam FromTeam, AController* Killer);

	UFUNCTION(BlueprintCallable, Category = "Photon")
	void ResetForRespawn();

protected:
	UFUNCTION() void OnRep_Health();

public:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};
