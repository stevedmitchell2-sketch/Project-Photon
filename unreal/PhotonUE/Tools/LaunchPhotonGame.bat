@echo off
setlocal EnableExtensions

rem Launch Project Photon in standalone game mode (first-person player view).
rem This is NOT the editor viewport — you should see the weapon, arms, and arena
rem from the possessed player camera.

set "UE_EDITOR=C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe"
set "PROJECT=%~dp0..\PhotonUE.uproject"
set "MAP=/Game/Photon/Maps/L_PhotonGrey"

if not exist "%UE_EDITOR%" (
    echo [Photon] Unreal Engine 5.8 not found:
    echo   %UE_EDITOR%
    echo.
    echo Install UE 5.8 or edit Tools\LaunchPhotonGame.bat with your engine path.
    pause
    exit /b 1
)

if not exist "%PROJECT%" (
    echo [Photon] Project file not found:
    echo   %PROJECT%
    pause
    exit /b 1
)

echo [Photon] Launching game mode...
echo   Map: %MAP%
echo   Controls: WASD move, mouse look, LMB fire, G grenade, 1/2 weapons, Q cycle
echo.

start "" "%UE_EDITOR%" "%PROJECT%" %MAP% -game -windowed -ResX=1920 -ResY=1080 -log

endlocal
