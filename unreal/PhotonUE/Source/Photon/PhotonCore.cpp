#include "PhotonCore.h"
#include "PhotonVisuals.h"

#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Engine/StaticMesh.h"
#include "UObject/ConstructorHelpers.h"
#include "GameFramework/ProjectileMovementComponent.h"
#include "Net/UnrealNetwork.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "EngineUtils.h"

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
	// Unaffiliated energy is Photon cyan, not neutral grey. The previous near-white made bolts fired
	// by a teamless player read as colourless specks against the arena instead of as Photon energy.
	default:                  return FLinearColor(0.35f, 0.82f, 1.00f);
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

float UPhotonGrenadeData::ResolveExplosionDamage(float DistanceCm) const
{
	if (DistanceCm >= ExplosionRadius)
	{
		return MaxDamage * MinDamageScale;
	}
	const float Alpha = DistanceCm / FMath::Max(1.f, ExplosionRadius);
	return MaxDamage * FMath::Lerp(1.f, MinDamageScale, Alpha);
}

// ---------------------------------------------------------------------------------------------
// APhotonGrenade
// ---------------------------------------------------------------------------------------------

APhotonGrenade::APhotonGrenade()
{
	bReplicates = true;
	SetReplicateMovement(true);

	Collision = CreateDefaultSubobject<USphereComponent>(TEXT("Collision"));
	Collision->InitSphereRadius(12.f);
	Collision->SetCollisionProfileName(TEXT("BlockAllDynamic"));
	Collision->SetNotifyRigidBodyCollision(true);
	RootComponent = Collision;

	Movement = CreateDefaultSubobject<UProjectileMovementComponent>(TEXT("Movement"));
	Movement->SetUpdatedComponent(Collision);
	Movement->bRotationFollowsVelocity = true;
	Movement->ProjectileGravityScale = 1.f;
	Movement->bShouldBounce = true;

	Glow = CreateDefaultSubobject<UPointLightComponent>(TEXT("Glow"));
	Glow->SetupAttachment(Collision);
	Glow->SetIntensity(1800.f);
	Glow->SetAttenuationRadius(220.f);
	Glow->SetCastShadows(false);

	Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	Body->SetupAttachment(Collision);
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Body->SetCastShadow(false);
	if (UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere")))
	{
		Body->SetStaticMesh(Sphere);
	}
	Body->SetRelativeScale3D(FVector(0.24f));

	ExplosionFlash = CreateDefaultSubobject<UPointLightComponent>(TEXT("ExplosionFlash"));
	ExplosionFlash->SetupAttachment(Collision);
	ExplosionFlash->SetIntensity(0.f);
	ExplosionFlash->SetAttenuationRadius(600.f);
	ExplosionFlash->SetCastShadows(false);
	ExplosionFlash->SetVisibility(false);
}

void APhotonGrenade::InitialiseFrom(const UPhotonGrenadeData* InData, EPhotonTeam InTeam,
	AController* InInstigator, const FVector& InitialVelocity)
{
	Data = InData;
	Team = InTeam;
	SetInstigator(InInstigator ? InInstigator->GetPawn() : nullptr);
	if (!Data)
	{
		return;
	}

	const FLinearColor Colour = PhotonTeamColor(InTeam);
	if (Glow)
	{
		Glow->SetLightColor(Colour);
	}
	if (Body)
	{
		PhotonVisuals::ApplyEnergyTint(Body, Colour);
	}
	Movement->ProjectileGravityScale = 1.f;
	Movement->Bounciness = Data->Bounciness;
	Movement->Friction = 0.4f;
	Movement->Velocity = InitialVelocity;
	Movement->UpdateComponentVelocity();

	if (HasActorBegunPlay())
	{
		ArmFuse();
	}
}

void APhotonGrenade::BeginPlay()
{
	Super::BeginPlay();
	Collision->OnComponentHit.AddDynamic(this, &APhotonGrenade::OnHit);
	if (Data)
	{
		ArmFuse();
	}
}

void APhotonGrenade::ArmFuse()
{
	if (!Data || !GetWorld() || bExploded)
	{
		return;
	}
	GetWorldTimerManager().ClearTimer(FuseTimer);
	GetWorldTimerManager().SetTimer(FuseTimer, this, &APhotonGrenade::Explode, Data->FuseTime, false);
}

void APhotonGrenade::OnHit(UPrimitiveComponent*, AActor* OtherActor, UPrimitiveComponent*, FVector,
	const FHitResult&)
{
	if (OtherActor && OtherActor == GetOwner())
	{
		return;
	}
	// Bounce is handled by UProjectileMovementComponent; fuse keeps running.
}

void APhotonGrenade::Explode()
{
	if (bExploded || !GetWorld())
	{
		return;
	}
	bExploded = true;
	GetWorldTimerManager().ClearTimer(FuseTimer);

	if (HasAuthority() && Data)
	{
		for (TActorIterator<AActor> It(GetWorld()); It; ++It)
		{
			AActor* Other = *It;
			if (!Other || Other == this || Other == GetOwner())
			{
				continue;
			}
			const float Dist = FVector::Dist(GetActorLocation(), Other->GetActorLocation());
			if (Dist > Data->ExplosionRadius)
			{
				continue;
			}
			if (UPhotonHealthComponent* Health = Other->FindComponentByClass<UPhotonHealthComponent>())
			{
				Health->ApplyPhotonDamage(
					Data->ResolveExplosionDamage(Dist), Team, GetInstigatorController());
			}
		}
	}

	if (ExplosionFlash)
	{
		ExplosionFlash->SetVisibility(true);
		ExplosionFlash->SetLightColor(PhotonTeamColor(Team));
		ExplosionFlash->SetIntensity(45000.f);
	}
	if (Glow)
	{
		Glow->SetIntensity(0.f);
	}
	if (Body)
	{
		// The shell is consumed by the detonation; leaving it visible reads as a grenade sitting
		// inside its own explosion.
		Body->SetVisibility(false);
	}
	Movement->StopMovementImmediately();

	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONVERIFY grenade exploded team=%d radius=%.0f"),
		static_cast<int32>(Team), Data ? Data->ExplosionRadius : 0.f);

	// 0.05s is three frames at 60Hz — the flash was being destroyed before it could register as an
	// explosion. Damage has already been applied above, so this only extends the visual.
	SetLifeSpan(0.22f);
}

float APhotonGrenade::GetSpeed() const
{
	return Movement ? Movement->Velocity.Size() : 0.f;
}

void APhotonGrenade::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(APhotonGrenade, Team);
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

	Body = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Body"));
	Body->SetupAttachment(Collision);
	Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Body->SetCastShadow(false);
	if (UStaticMesh* Sphere = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere")))
	{
		Body->SetStaticMesh(Sphere);
	}
	// The engine sphere is 100 cm; a bolt reads best at roughly a hand's width, stretched along travel.
	Body->SetRelativeScale3D(FVector(0.34f, 0.11f, 0.11f));

	Glow = CreateDefaultSubobject<UPointLightComponent>(TEXT("Glow"));
	Glow->SetupAttachment(Collision);
	Glow->SetIntensity(2600.f);
	Glow->SetAttenuationRadius(340.f);
	Glow->SetCastShadows(false);
}

bool APhotonProjectile::HasVisibleRepresentation() const
{
	return Body != nullptr && Body->GetStaticMesh() != nullptr && Body->IsVisible();
}

bool APhotonProjectile::HasTintedMaterial() const
{
	return Body != nullptr && Body->GetMaterial(0) != nullptr;
}

float APhotonProjectile::GetSpeed() const
{
	return Movement ? Movement->Velocity.Size() : 0.f;
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
	// Team colour drives the bolt, so red and blue fire are distinguishable at a glance. Both the light
	// and the body take it; the body needs a dynamic material instance to accept a colour at all.
	const FLinearColor Colour = PhotonTeamColor(InTeam);
	if (Glow)
	{
		Glow->SetLightColor(Colour);
	}
	if (Body)
	{
		// Bright enough to read at speed, but not so bright that the tonemapper clips it: at 12 the
		// bolt saturated to a white dot and lost the team colour entirely.
		PhotonVisuals::ApplyEnergyTint(Body, Colour, 4.f);
		// A faster weapon gets a longer bolt, so PH-6 and PH-9 fire is visually distinguishable.
		const float Stretch = FMath::GetMappedRangeValueClamped(
			FVector2D(15000.f, 45000.f), FVector2D(0.26f, 0.62f), Data->ProjectileSpeed);
		Body->SetRelativeScale3D(FVector(Stretch, 0.11f, 0.11f));
	}
	// InitialSpeed is only read by UProjectileMovementComponent::BeginPlay, which has already run by
	// the time the weapon configures the bolt — setting it here did nothing and the self-test caught it
	// as a 1 cm/s projectile. Velocity has to be assigned directly.
	Movement->InitialSpeed = Data->ProjectileSpeed;
	Movement->MaxSpeed = Data->ProjectileSpeed;
	Movement->Velocity = GetActorForwardVector() * Data->ProjectileSpeed;
	Movement->UpdateComponentVelocity();
	SetLifeSpan(Data->ProjectileLifetime);
}

void APhotonProjectile::BeginPlay()
{
	Super::BeginPlay();
	SpawnLocation = GetActorLocation();
	Collision->OnComponentHit.AddDynamic(this, &APhotonProjectile::OnImpact);
}

void APhotonProjectile::DeliverRecordedImpact(AActor* OtherActor, UPrimitiveComponent* OtherComp,
	const FHitResult& Hit)
{
	OnImpact(Collision, OtherActor, OtherComp, FVector::ZeroVector, Hit);
}

void APhotonProjectile::OnImpact(UPrimitiveComponent*, AActor* OtherActor, UPrimitiveComponent*,
	FVector, const FHitResult& Hit)
{
	bImpactProcessed = true;
	// Damage is server-only. Clients still see the impact because the actor's destruction and the
	// impact effect are cosmetic and can spawn locally.
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
