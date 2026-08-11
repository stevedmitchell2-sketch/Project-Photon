@echo off
setlocal
set "BLENDER=C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
set "SCRIPT=%~dp0prep_photon_hero_blender.py"
set "PHOTON_HERO_FBX=C:\Users\Home\Downloads\futuristic+athlete+3d+model\tripo_convert_2259b18c-7904-4bb7-bcaf-3ab3fbe3736a.fbx"

if not exist "%BLENDER%" (
  echo Blender not found at "%BLENDER%"
  exit /b 1
)
if not exist "%PHOTON_HERO_FBX%" (
  echo FBX not found at "%PHOTON_HERO_FBX%"
  exit /b 1
)

echo Running Photon hero prep...
"%BLENDER%" --background --python "%SCRIPT%"
set "STATUS=%~dp0..\Content\Photon\Characters\HeroPrep\photon_hero_prep_status.txt"
if exist "%STATUS%" (
  type "%STATUS%"
  findstr /I /C:"PASSED" "%STATUS%" >nul
  if errorlevel 1 (
    echo PIPELINE VALIDATION FAILED
    exit /b 2
  )
  echo PIPELINE VALIDATION PASSED
  exit /b 0
)
echo Missing status file
exit /b 1
