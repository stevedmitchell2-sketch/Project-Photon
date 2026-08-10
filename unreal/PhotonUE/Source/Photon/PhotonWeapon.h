#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/ActorComponent.h"
#include "PhotonCore.h"   // EPhotonTeam, UPhotonHealthComponent
#include "PhotonWeapon.generated.h"

class UPhotonWeaponData;
class UStaticMeshComponent;
class UPointLightComponent;
class APhotonCharacter;
class UPhotonHealthComponent;

/**
 * One weapon in the player's hands.
 *
 * Holds no statistics of its own. Everything — fire interval, damage, projectile class and speed,
 * spread, the first-person pose — comes from `UPhotonWeaponData`, so a new weapon is a new asset
 * rather than a new class or another branch in a switch. That is the property the reference build
 * had and the one worth preserving above all others here.
 */
UCLASS()
class PHOTON_API APhotonWeapon : public AActor
{
	GENERATED_BODY()

public:
	APhotonWeapon();

	UPROPERTY(VisibleAnywhere, Category = "Photon") TObjectPtr<UStaticMeshComponent> Mesh;

	/** Short-lived muzzle flash — pulsed in TryFire, not a Niagara dependency. */
	UPROPERTY(VisibleAnywhere, Category = "Photon") TObjectPtr<UPointLightComponent> MuzzleFlash;

	UPROPERTY(BlueprintReadOnly, Category = "Photon") TObjectPtr<const UPhotonWeaponData> Data;

	/** Configures mesh and pose from the data asset. Safe to call once, at spawn. */
	void InitialiseFromData(const UPhotonWeaponData* InData);

	/** World-space muzzle. Prefers a real socket if the mesh has one. */
	FVector GetMuzzleWorld() const;

	/**
	 * Fires if the weapon's own fire interval allows it.
	 *
	 * Returns false when refused, so the caller can distinguish "shot" from "still cooling". The
	 * cooldown lives here rather than in the character because it is a property of the weapon.
	 */
	bool TryFire(APhotonCharacter* Shooter);

	/** Seconds until the next shot is permitted; 0 when ready. */
	float GetCooldownRemaining() const;

	/** Self-test accessors — not gameplay API. */
	bool HasMuzzleFlashLight() const { return MuzzleFlash != nullptr; }
	bool HasActiveRecoil() const { return !WeaponRecoilOffset.IsNearlyZero() || !WeaponRecoilRotation.IsNearlyZero(0.05f); }
	FVector GetMuzzleOffsetLocal() const { return Data ? Data->MuzzleOffset : FVector::ZeroVector; }
	float GetHipUniformScale() const { return Data ? Data->HipTransform.GetScale3D().X : 0.f; }

	int32 ShotsFired = 0;

protected:
	virtual void Tick(float DeltaTime) override;

	float LastFireTime = -1000.f;
	FTransform HipPose;
	FVector WeaponRecoilOffset = FVector::ZeroVector;
	FRotator WeaponRecoilRotation = FRotator::ZeroRotator;
	FTimerHandle MuzzleFlashTimer;

	void PulseMuzzleFlash();
	void ApplyRecoil(APhotonCharacter* Shooter);
	void UpdateWeaponPose();
	void UpdateMuzzleAttachment();
	void EndMuzzleFlash();
};

/**
 * Owns the player's weapons and which one is in hand.
 *
 * Weapons are spawned once at BeginPlay and then hidden or shown, rather than destroyed and
 * respawned on every switch — switching has to be cheap enough to spam without allocating.
 */
UCLASS(ClassGroup = (Photon), meta = (BlueprintSpawnableComponent))
class PHOTON_API UPhotonInventoryComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UPhotonInventoryComponent();

	/** The loadout, as data. Populated from /Game/Photon/Weapons if left empty. */
	UPROPERTY(EditDefaultsOnly, Category = "Photon")
	TArray<TObjectPtr<UPhotonWeaponData>> Loadout;

	UPROPERTY(BlueprintReadOnly, Category = "Photon")
	TArray<TObjectPtr<APhotonWeapon>> Weapons;

	/** Replicated so remote clients can show the right weapon in third person later. */
	UPROPERTY(ReplicatedUsing = OnRep_ActiveIndex, BlueprintReadOnly, Category = "Photon")
	int32 ActiveIndex = INDEX_NONE;

	/** Spawns every weapon in the loadout and equips the first. Idempotent. */
	void BuildLoadout();

	/** Returns true only if the requested weapon is now actually the active one. */
	bool EquipIndex(int32 Index);

	bool EquipNext();

	APhotonWeapon* GetActiveWeapon() const;

	/** Name of the active weapon's data asset, for logging and HUD. */
	FName GetActiveWeaponId() const;

protected:
	virtual void BeginPlay() override;
	UFUNCTION() void OnRep_ActiveIndex();
	void ApplyActiveVisibility();

public:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
};

/**
 * A shootable practice target.
 *
 * Deliberately thin and deliberately temporary: it exists so the combat loop can be verified against
 * something that actually takes damage, not as a permanent gameplay dependency. It reuses
 * `UPhotonHealthComponent` rather than carrying its own health, so friendly-fire rules and the
 * authority check are inherited rather than reimplemented — which is the whole reason health lives on
 * a component.
 */
UCLASS()
class PHOTON_API APhotonTarget : public AActor
{
	GENERATED_BODY()

public:
	APhotonTarget();

	UPROPERTY(VisibleAnywhere, Category = "Photon") TObjectPtr<UStaticMeshComponent> Mesh;
	UPROPERTY(VisibleAnywhere, Category = "Photon") TObjectPtr<UPhotonHealthComponent> Health;

	/** Which team the target belongs to; drives its colour and who may damage it. */
	UPROPERTY(EditAnywhere, Category = "Photon") EPhotonTeam Team = EPhotonTeam::Blue;

	int32 HitCount = 0;

	UFUNCTION(BlueprintCallable, Category = "Photon") float GetHealth() const;
	UFUNCTION(BlueprintCallable, Category = "Photon") bool IsDown() const;
	UFUNCTION(BlueprintCallable, Category = "Photon") void ResetTarget();

protected:
	virtual void BeginPlay() override;
	UFUNCTION() void HandleDied(AController* Killer);
	void Flash();

	UPROPERTY() TObjectPtr<class UMaterialInstanceDynamic> Skin;
	FTimerHandle FlashTimer;
};
