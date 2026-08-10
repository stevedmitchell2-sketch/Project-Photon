#include "PhotonWeapon.h"

#include "Components/StaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/PrimitiveComponent.h"
#include "Engine/StaticMesh.h"
#include "Net/UnrealNetwork.h"
#include "PhotonCore.h"
#include "PhotonPlayer.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "TimerManager.h"
#include "GameFramework/PlayerController.h"

// ---------------------------------------------------------------------------------------------
// APhotonWeapon
// ---------------------------------------------------------------------------------------------

APhotonWeapon::APhotonWeapon()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = false;
	bReplicates = true;

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	// The view model must never collide or cast into the world — it lives in front of the camera.
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Mesh->SetCastShadow(false);
	RootComponent = Mesh;

	MuzzleFlash = CreateDefaultSubobject<UPointLightComponent>(TEXT("MuzzleFlash"));
	MuzzleFlash->SetupAttachment(Mesh);
	MuzzleFlash->SetIntensity(0.f);
	MuzzleFlash->SetAttenuationRadius(180.f);
	MuzzleFlash->SetLightColor(FLinearColor(0.55f, 0.85f, 1.f));
	MuzzleFlash->SetCastShadows(false);
	MuzzleFlash->SetVisibility(false);
}

void APhotonWeapon::InitialiseFromData(const UPhotonWeaponData* InData)
{
	Data = InData;
	if (!Data)
	{
		return;
	}
	if (Data->Mesh)
	{
		Mesh->SetStaticMesh(Data->Mesh);
	}
	// The first-person pose is authored per weapon in the data asset, so a longer or shorter weapon
	// sits correctly without code changes.
	HipPose = Data->HipTransform;
	UpdateWeaponPose();
	UpdateMuzzleAttachment();
}

void APhotonWeapon::UpdateMuzzleAttachment()
{
	if (MuzzleFlash && Data)
	{
		MuzzleFlash->SetRelativeLocation(Data->MuzzleOffset);
	}
}

void APhotonWeapon::UpdateWeaponPose()
{
	if (!Mesh)
	{
		return;
	}
	const FTransform Kick(WeaponRecoilRotation, WeaponRecoilOffset);
	Mesh->SetRelativeTransform(Kick * HipPose);
}

void APhotonWeapon::PulseMuzzleFlash()
{
	if (!MuzzleFlash || !GetWorld())
	{
		return;
	}
	MuzzleFlash->SetIntensity(12000.f);
	MuzzleFlash->SetVisibility(true);
	GetWorldTimerManager().ClearTimer(MuzzleFlashTimer);
	GetWorldTimerManager().SetTimer(MuzzleFlashTimer, this, &APhotonWeapon::EndMuzzleFlash, 0.06f, false);
}

void APhotonWeapon::EndMuzzleFlash()
{
	if (MuzzleFlash)
	{
		MuzzleFlash->SetIntensity(0.f);
		MuzzleFlash->SetVisibility(false);
	}
}

void APhotonWeapon::ApplyRecoil(APhotonCharacter* Shooter)
{
	if (!Data || !Shooter)
	{
		return;
	}
	if (APlayerController* PC = Cast<APlayerController>(Shooter->GetController()))
	{
		PC->AddPitchInput(-Data->RecoilPitch);
		PC->AddYawInput(FMath::FRandRange(-Data->RecoilYaw, Data->RecoilYaw));
	}
	// Kick the view model back along local -X (down the barrel) with a slight pitch bump.
	const FVector Kick = Data->RecoilKickOffset;
	WeaponRecoilOffset += FVector(Kick.X, FMath::FRandRange(-Kick.Y, Kick.Y), Kick.Z);
	WeaponRecoilRotation += FRotator(
		-Data->RecoilPitch * Data->RecoilMeshPitchScale,
		FMath::FRandRange(-1.2f, 1.2f), 0.f);
	UpdateWeaponPose();
	SetActorTickEnabled(true);
}

void APhotonWeapon::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	if (!Data)
	{
		SetActorTickEnabled(false);
		return;
	}
	const float HalfLife = FMath::Max(0.01f, Data->RecoilRecoveryHalfLife);
	const float Decay = FMath::Exp2(-DeltaTime / HalfLife);
	WeaponRecoilOffset *= Decay;
	WeaponRecoilRotation.Pitch *= Decay;
	WeaponRecoilRotation.Yaw *= Decay;
	WeaponRecoilRotation.Roll *= Decay;
	UpdateWeaponPose();
	if (WeaponRecoilOffset.SizeSquared() < 0.01f &&
		WeaponRecoilRotation.IsNearlyZero(0.05f))
	{
		WeaponRecoilOffset = FVector::ZeroVector;
		WeaponRecoilRotation = FRotator::ZeroRotator;
		UpdateWeaponPose();
		SetActorTickEnabled(false);
	}
}

FVector APhotonWeapon::GetMuzzleWorld() const
{
	if (Mesh && Mesh->DoesSocketExist(TEXT("SOCKET_muzzle")))
	{
		return Mesh->GetSocketLocation(TEXT("SOCKET_muzzle"));
	}
	return Mesh && Data
		? Mesh->GetComponentTransform().TransformPosition(Data->MuzzleOffset)
		: GetActorLocation();
}

float APhotonWeapon::GetCooldownRemaining() const
{
	if (!Data || !GetWorld())
	{
		return 0.f;
	}
	const float Elapsed = GetWorld()->GetTimeSeconds() - LastFireTime;
	return FMath::Max(0.f, Data->FireInterval - Elapsed);
}

bool APhotonWeapon::SpawnProjectile(APhotonCharacter* Shooter, const FRotator& Aim, float YawSpreadDegrees)
{
	if (!Data || !Shooter || !GetWorld())
	{
		return false;
	}

	UClass* BoltClass = Data->ProjectileClass ? Data->ProjectileClass.Get() : APhotonProjectile::StaticClass();
	const FVector Origin = GetMuzzleWorld();
	FRotator ShotAim = Aim;
	ShotAim.Yaw += YawSpreadDegrees;

	FActorSpawnParameters Params;
	Params.Owner = Shooter;
	Params.Instigator = Shooter;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	APhotonProjectile* Bolt = GetWorld()->SpawnActor<APhotonProjectile>(
		BoltClass, Origin, ShotAim, Params);
	if (!Bolt)
	{
		return false;
	}

	EPhotonTeam Team = EPhotonTeam::None;
	if (const UPhotonHealthComponent* Health = Shooter->FindComponentByClass<UPhotonHealthComponent>())
	{
		Team = Health->Team;
	}
	Bolt->InitialiseFrom(Data, Team, Shooter->GetController());
	Bolt->SetActorEnableCollision(true);
	if (UPrimitiveComponent* BoltRoot = Cast<UPrimitiveComponent>(Bolt->GetRootComponent()))
	{
		BoltRoot->IgnoreActorWhenMoving(Shooter, true);
	}
	return true;
}

bool APhotonWeapon::TryFire(APhotonCharacter* Shooter)
{
	if (!Data || !Shooter || !GetWorld())
	{
		return false;
	}
	if (GetCooldownRemaining() > 0.f)
	{
		return false;
	}
	LastFireTime = GetWorld()->GetTimeSeconds();
	LastTriggerProjectiles = 0;

	FRotator Aim = Shooter->GetControlRotation();
	if (const APlayerController* PC = Cast<APlayerController>(Shooter->GetController()))
	{
		FVector EyeLoc; FRotator EyeRot;
		PC->GetPlayerViewPoint(EyeLoc, EyeRot);
		Aim = EyeRot;
	}

	const int32 ShotsThisTrigger =
		(Data->FireMode == EPhotonFireMode::Burst) ? FMath::Max(1, Data->BurstCount) : 1;
	for (int32 i = 0; i < ShotsThisTrigger; ++i)
	{
		const float SpreadYaw = (ShotsThisTrigger > 1)
			? FMath::Lerp(-Data->SpreadBase, Data->SpreadBase, static_cast<float>(i) / (ShotsThisTrigger - 1))
			: 0.f;
		if (SpawnProjectile(Shooter, Aim, SpreadYaw))
		{
			++LastTriggerProjectiles;
		}
	}
	if (LastTriggerProjectiles == 0)
	{
		return false;
	}

	++ShotsFired;
	PulseMuzzleFlash();
	ApplyRecoil(Shooter);
	UE_LOG(LogTemp, Display,
		TEXT("[Photon] PHOTONVERIFY fired weapon=%s shot=%d bolts=%d mode=%d"),
		*Data->WeaponId.ToString(), ShotsFired, LastTriggerProjectiles, static_cast<int32>(Data->FireMode));
	return true;
}

// ---------------------------------------------------------------------------------------------
// UPhotonInventoryComponent
// ---------------------------------------------------------------------------------------------

UPhotonInventoryComponent::UPhotonInventoryComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
	SetIsReplicatedByDefault(true);
}

void UPhotonInventoryComponent::BeginPlay()
{
	Super::BeginPlay();
	BuildLoadout();
}

void UPhotonInventoryComponent::BuildLoadout()
{
	if (Weapons.Num() > 0)
	{
		return; // already built
	}
	// Default loadout by path when nothing is configured, so a bare PhotonCharacter placed in a level
	// is still armed. PH-6 first: it is the balanced primary and the weapon the player should start on.
	if (Loadout.Num() == 0)
	{
		const TCHAR* Paths[] = {
			TEXT("/Game/Photon/Weapons/DA_PH6_PhotonRifle.DA_PH6_PhotonRifle"),
			TEXT("/Game/Photon/Weapons/DA_PH9_Swift.DA_PH9_Swift"),
			TEXT("/Game/Photon/Weapons/DA_PH10_Burst.DA_PH10_Burst"),
		};
		for (const TCHAR* Path : Paths)
		{
			if (UPhotonWeaponData* D = LoadObject<UPhotonWeaponData>(nullptr, Path))
			{
				Loadout.Add(D);
			}
			else
			{
				UE_LOG(LogTemp, Error, TEXT("[Photon] missing weapon data: %s"), Path);
			}
		}
	}

	APhotonCharacter* Owner = Cast<APhotonCharacter>(GetOwner());
	if (!Owner || !Owner->WeaponRoot)
	{
		UE_LOG(LogTemp, Error, TEXT("[Photon] inventory owner is not a PhotonCharacter with a WeaponRoot"));
		return;
	}

	for (const TObjectPtr<UPhotonWeaponData>& D : Loadout)
	{
		if (!D)
		{
			continue;
		}
		FActorSpawnParameters Params;
		Params.Owner = Owner;
		Params.Instigator = Owner;
		APhotonWeapon* W = GetWorld()->SpawnActor<APhotonWeapon>(
			APhotonWeapon::StaticClass(), FTransform::Identity, Params);
		if (!W)
		{
			continue;
		}
		W->InitialiseFromData(D);
		// Attached to the camera-parented WeaponRoot, so the view model follows look rotation without
		// the world mesh being involved. This is what the reference build could not do with one camera.
		W->AttachToComponent(Owner->WeaponRoot, FAttachmentTransformRules::KeepRelativeTransform);
		W->SetActorHiddenInGame(true);
		Weapons.Add(W);
	}

	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONVERIFY loadout weapons=%d of data=%d"),
		Weapons.Num(), Loadout.Num());

	if (Weapons.Num() > 0)
	{
		EquipIndex(0);
	}
}

bool UPhotonInventoryComponent::EquipIndex(int32 Index)
{
	if (!Weapons.IsValidIndex(Index) || !Weapons[Index])
	{
		UE_LOG(LogTemp, Warning, TEXT("[Photon] equip refused, invalid index %d of %d"), Index, Weapons.Num());
		return false;
	}
	if (ActiveIndex == Index)
	{
		return true;
	}
	ActiveIndex = Index;
	ApplyActiveVisibility();
	// Report the resulting state, not the request. Returning true from "I asked it to equip" is how a
	// switch that did nothing gets reported as working.
	const bool bOk = GetActiveWeapon() != nullptr && !GetActiveWeapon()->IsHidden();
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONVERIFY equip index=%d id=%s visible=%d"),
		ActiveIndex, *GetActiveWeaponId().ToString(), bOk);
	return bOk;
}

bool UPhotonInventoryComponent::EquipNext()
{
	if (Weapons.Num() == 0)
	{
		return false;
	}
	return EquipIndex((ActiveIndex + 1) % Weapons.Num());
}

void UPhotonInventoryComponent::ApplyActiveVisibility()
{
	for (int32 i = 0; i < Weapons.Num(); ++i)
	{
		if (Weapons[i])
		{
			Weapons[i]->SetActorHiddenInGame(i != ActiveIndex);
		}
	}
}

void UPhotonInventoryComponent::OnRep_ActiveIndex()
{
	ApplyActiveVisibility();
}

APhotonWeapon* UPhotonInventoryComponent::GetActiveWeapon() const
{
	return Weapons.IsValidIndex(ActiveIndex) ? Weapons[ActiveIndex].Get() : nullptr;
}

FName UPhotonInventoryComponent::GetActiveWeaponId() const
{
	const APhotonWeapon* W = GetActiveWeapon();
	return (W && W->Data) ? W->Data->WeaponId : NAME_None;
}

void UPhotonInventoryComponent::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);
	DOREPLIFETIME(UPhotonInventoryComponent, ActiveIndex);
}

// ---------------------------------------------------------------------------------------------
// APhotonTarget
// ---------------------------------------------------------------------------------------------

APhotonTarget::APhotonTarget()
{
	PrimaryActorTick.bCanEverTick = false;
	bReplicates = true;

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	if (UStaticMesh* Cyl = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder")))
	{
		Mesh->SetStaticMesh(Cyl);
	}
	// A slim standing pylon rather than a crate: this is a competition venue, not a shooting range.
	Mesh->SetRelativeScale3D(FVector(0.45f, 0.45f, 1.8f));
	// Must block the bolt's BlockAllDynamic profile or nothing can ever hit it.
	Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Mesh->SetCollisionProfileName(TEXT("BlockAllDynamic"));
	Mesh->SetNotifyRigidBodyCollision(true);
	RootComponent = Mesh;

	Health = CreateDefaultSubobject<UPhotonHealthComponent>(TEXT("Health"));
}

void APhotonTarget::BeginPlay()
{
	Super::BeginPlay();
	if (Health)
	{
		Health->Team = Team;
		Health->OnDied.AddDynamic(this, &APhotonTarget::HandleDied);
	}
	Skin = Mesh ? Mesh->CreateAndSetMaterialInstanceDynamic(0) : nullptr;
	if (Skin)
	{
		const FLinearColor C = PhotonTeamColor(Team) * 0.35f;
		Skin->SetVectorParameterValue(TEXT("Color"), C);
		Skin->SetVectorParameterValue(TEXT("BaseColor"), C);
	}
}

float APhotonTarget::GetHealth() const { return Health ? Health->Health : 0.f; }
bool APhotonTarget::IsDown() const { return Health ? Health->bDead : false; }

void APhotonTarget::ResetTarget()
{
	if (Health)
	{
		Health->ResetForRespawn();
	}
	HitCount = 0;
	SetActorHiddenInGame(false);
	Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
}

void APhotonTarget::HandleDied(AController*)
{
	// Disabled rather than destroyed, so the same actor can be reset and reused during testing.
	SetActorHiddenInGame(true);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	UE_LOG(LogTemp, Display, TEXT("[Photon] PHOTONVERIFY target down after %d hits"), HitCount);
}

void APhotonTarget::Flash()
{
	if (Skin)
	{
		const FLinearColor C = PhotonTeamColor(Team) * 0.35f;
		Skin->SetVectorParameterValue(TEXT("Color"), C);
		Skin->SetVectorParameterValue(TEXT("BaseColor"), C);
	}
}
