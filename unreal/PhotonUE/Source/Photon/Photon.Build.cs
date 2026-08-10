using UnrealBuildTool;

public class Photon : ModuleRules
{
	public Photon(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core", "CoreUObject", "Engine", "InputCore",
			"EnhancedInput",   // Controller-first input; see PhotonCharacter
			"AIModule", "NavigationSystem",
			"Niagara",         // Projectile / muzzle / impact VFX
			"UMG", "Slate", "SlateCore",
		});

		PrivateDependencyModuleNames.AddRange(new string[] { });
	}
}
