@echo off
setlocal
set "BLENDER=C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
set "SCRIPT=%~dp0prep_photon_hero_nofinger.py"
if not exist "%BLENDER%" (
  echo Blender not found at "%BLENDER%"
  exit /b 1
)
"%BLENDER%" -b -P "%SCRIPT%"
exit /b %ERRORLEVEL%
