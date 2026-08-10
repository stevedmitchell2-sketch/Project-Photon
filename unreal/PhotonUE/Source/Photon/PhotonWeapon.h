#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Components/ActorComponent.h"
#include "PhotonWeapon.generated.h"

class UPhotonWeaponData;
class UStaticMeshComponent;
class APhotonCharacter;

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

	UPROPERTY(BlueprintReadOnly, Category = "Photon") TObjectPtr<const UPhotonWeaponData> Data;

	/**
	 * Muzzle offset in the mesh's local space.
	 *
	 * The PH-6 GLB ships with no `SOCKET_muzzle` — a gap carried over from the reference build, where
	 * it meant first-person bolts never left the barrel. This offset is the stand-in; once a socket is
	 * authored on the static mesh, `GetMuzzleWorld` should prefer it.
	 */
	UPROPERTY(EditDefaultsOnly, Category = "Photon") FVector MuzzleOffset = FVector(52.f, 0.f, 2.f);

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

	int32 ShotsFired = 0;

protected:
	float LastFireTime = -1000.f;
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
