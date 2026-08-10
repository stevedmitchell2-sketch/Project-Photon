#include "Modules/ModuleManager.h"

// Primary game module. IMPLEMENT_PRIMARY_GAME_MODULE is required for the module to be the one that
// owns the game target; without it UBT builds the module but the game has no entry point.
IMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, Photon, "Photon");
