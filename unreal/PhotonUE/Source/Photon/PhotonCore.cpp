#include "PhotonCore.h"

#include "Components/SphereComponent.h"
#include "GameFramework/ProjectileMovementComponent.h"
#include "Net/UnrealNetwork.h"

// UNVERIFIED: no C++ toolchain on this machine, so this has never been compiled.
// See docs/UNREAL_STAGE0.md.

FLinearColor PhotonTeamColor(EPhotonTeam Team)
{
	switch (Team)
	{
	case EPhotonTeam::Red:    return FLinearColor(1.00f, 0.25f, 0.32f);
	case EPhotonTeam::Green:  return FLinearColor(0.28f, 1.00f, 0.55f);
	case EPhotonTeam::Blue:   return FLinearColor(0.30f, 0.66f, 1.00f);
	case EPhotonTeam::Yellow: return FLinearColor(1.00f, 0.82f, 0.30f);
	default:                  return FLinearColor(0.70f, 0.78f, 0.86f);
	}
}

// ---------------------------------------------------------------------------------------------
// UPhotonWeaponData
// ---------------------------------------------------------------------------------------------

float UPhotonWeaponData::ResolveSpread(bool bAiming, float Speed, bool bAirborne, float Heat) const
{
	// Order matters. The base state is chosen first, per-shot heat is added second, and the clamp is
	// applied last. Clamping before adding heat would silently make sustained fire tighter than the
	// opening shot, which is the opposite of the intent.
	float Base = bAiming ? SpreadAds : SpreadBase;
	if (bAirborne)
	{
		Base = FMath::Max(Base, SpreadAir);
	}
	else if (Speed > 50.f) // cm/s — below this the player is effectively standing still
	{
		Base = FMath::Max(Base, SpreadMoving);
	}
	return FMath::Min(Base + Heat, SpreadMax);
}

float UPhotonWeaponData::ResolveDamage(float DistanceCm) const
{
	if (DistanceCm <= FalloffStart)
	{
		return Damage;
	}
	if (DistanceCm >= FalloffEnd)
	{
		return Damage * MinDamageScale;
	}
	const float Span = FMath::Max(1.f, FalloffEnd - FalloffStart);
	const float Alpha = (DistanceCm - FalloffStart) / Span;
	return Damage * FMath::Lerp(1.f, MinDamageScale, Alpha);
}

// ---------------------------------------------------------------------------------------------
// APhotonProjectile
// ---------------------------------------------------------------------------------------------

APhotonProjectile::APhotonProjectile()
{
	bReplicates = true;
	SetReplicateMovement(true);

	Collision = CreateDefaultSubobject<USphereComponent>(TEXT("Collision"));
	Collision->InitSphereRadius(9.f);
	Collision->SetCollisionProfileName(TEXT("BlockAllDynamic"));
	Collision->SetNotifyRigidBodyCollision(true);
	RootComponent = Collision;

	Movement = CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("Movement"));
	Movement->SetUpdatedComponent(Collision);
	Movement->bRotationFollowsVelocity = true;
	// Zero gravity keeps aim honest. The reference build kept gravity as per-weapon data for future
	// arcing weapons and never used it; same here.
	Movement->ProjectileGravityScale = 0.f;
}

void APhotonProjectile::InitialiseFrom(const UPhotonWeaponData* Data, EPhotonTeam InTeam,
	AController* InInstigator)
{
	if (!Data)
	{
		return;
	}
	SourceData = Data;
	Team = InTeam;
	SetInstigator(InInstigator ? InInstigator->GetPawn() : nullptr);

	Collision->SetSphereRadius(Data->ProjectileRadius);
	Movement->InitialSpeed = Data->ProjectileSpeed;
	Movement->MaxSpeed = Data->ProjectileSpeed;
	SetLifeSpan(Data->ProjectileLifetime);
}

void APhotonProjectile::BeginPlay()
{
	Super::BeginPlay();
	SpawnLocation = GetActorLocation();
	Collision->OnComponentHit.AddDynamic(this, &APhotonProjectile::OnImpact);
}

void APhotonProjectile::OnImpact(UPrimitiveComponent*, AActor* OtherActor, UPrimitiveComponent*,
	FVector, const FHitResult& Hit)
{
	// Damage is server-only. Clients still see the impact because the actor's destruction and the
	// impact effect are cosmetic and can be spawned locally.
	if (HasAuthority() && SourceData && OtherActor)
	{
		if (UPhotonHealthComponent* Health = OtherActor->FindComponentByClass<UPhotonHealthComponent>())
		{
			const float Travelled = FVector::Dist(SpawnLocation, Hit.ImpactPoint);
			Health->ApplyPhotonDamage(SourceData->ResolveDamage(Travelled), Team,
				GetInstigatorController());
		}
	}
	Destroy();
}

void APhotonProjectile::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(APhotonProjectile, Team);
}

// ---------------------------------------------------------------------------------------------
// UPhotonHealthComponent
// ---------------------------------------------------------------------------------------------

UPhotonHealthComponent::UPhotonHealthComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
	SetIsReplicatedByDefault(true);
}

void UPhotonHealthComponent::ApplyPhotonDamage(float Amount, EPhotonTeam FromTeam, AController* Killer)
{
	// Server authority, checked here rather than at each call site so no damage source can bypass it.
	if (!GetOwner() || !GetOwner()->HasAuthority() || bDead || Amount <= 0.f)
	{
		return;
	}
	// No friendly fire, per the Photon design. Rejecting it here means every future damage source —
	// grenades, environmental hazards, melee — inherits the rule without knowing about it.
	if (FromTeam != EPhotonTeam::None && FromTeam == Team)
	{
		return;
	}

	Health = FMath::Max(0.f, Health - Amount);
	if (Health <= 0.f)
	{
		bDead = true;
		OnDied.Broadcast(Killer);
	}
}

void UPhotonHealthComponent::ResetForRespawn()
{
	Health = MaxHealth;
	bDead = false;
}

void UPhotonHealthComponent::OnRep_Health()
{
	// Hook for HUD/hit-flash reaction on the owning client. Intentionally empty in Stage 0.
}

void UPhotonHealthComponent::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(UPhotonHealthComponent, Health);
	DOREPLIFETIME(UPhotonHealthComponent, Team);
}
