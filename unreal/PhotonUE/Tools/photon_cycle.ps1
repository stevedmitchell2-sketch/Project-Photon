# Photon iteration driver: build -> run python tool -> self test -> screenshot tour.
#
# Every stage is opt-in so a render-only loop does not pay for a C++ build, which is the difference
# between a 30 second iteration and a four minute one.
#
#   .\photon_cycle.ps1 -Build -Kit -Arena -SelfTest -Tour
#   .\photon_cycle.ps1 -Tour
param(
    [switch]$Build,
    [switch]$Kit,
    [switch]$Arena,
    [switch]$SelfTest,
    [switch]$Tour,
    [switch]$Shot,
    [string]$Script = ""
)

$ErrorActionPreference = "Continue"
$UERoot   = "C:\Program Files\Epic Games\UE_5.8"
$BuildBat = "$UERoot\Engine\Build\BatchFiles\Build.bat"
$UECmd    = "$UERoot\Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$UE       = "$UERoot\Engine\Binaries\Win64\UnrealEditor.exe"
$Root     = Split-Path -Parent $PSScriptRoot
$PROJ     = Join-Path $Root "PhotonUE.uproject"
$MAP      = "/Game/Photon/Maps/L_PhotonGrey"
$ShotDir  = Join-Path $Root "Saved\Screenshots\WindowsEditor"
$Log      = Join-Path $Root "Saved\Logs\PhotonUE.log"

function Section($t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }

Stop-Process -Name UnrealEditor, UnrealEditor-Cmd -Force -EA SilentlyContinue
Start-Sleep -Milliseconds 500

if ($Build) {
    Section "BUILD"
    & $BuildBat PhotonEditor Win64 Development -Project="$PROJ" -WaitMutex 2>&1 |
        Select-String -Pattern "error C|error LNK|error :|Result:|Total execution|Succeeded|FAILED"
    if ($LASTEXITCODE -ne 0) { Write-Host "BUILD FAILED" -ForegroundColor Red; exit 1 }
}

function Run-Py($path, $filter) {
    # Forward slashes are not optional. UE runs the -script= value through a backslash-escape pass,
    # and this project lives under "...\Desktop\100 men vs gorilla\...", where \100 is a valid octal
    # escape for '@'. Every script load failed against a path reading "Desktop@ men vs gorilla".
    $safe = $path -replace '\\', '/'
    & $UECmd "$PROJ" -unattended -nop4 -nosplash -stdout -FullStdOutLogOutput "-run=pythonscript" "-script=$safe" 2>&1 |
        Select-String -Pattern $filter
}

if ($Kit) {
    Section "MESH KIT"
    Run-Py (Join-Path $PSScriptRoot "photon_mesh_kit.py") "PHOTONKIT|built |FAILED|EXCEPTION|Traceback|Error:"
}

if ($Arena) {
    Section "ARENA BUILD"
    Run-Py (Join-Path $PSScriptRoot "build_photon_arena.py") "PHOTONBUILD|Traceback|Error:"
}

if ($Script -ne "") {
    Section "SCRIPT $Script"
    Run-Py (Join-Path $PSScriptRoot $Script) "PHOTON|Traceback|Error:"
}

if ($SelfTest) {
    Section "SELF TEST"
    $lines = & $UECmd "$PROJ" $MAP -game -nullrhi -unattended -nosplash -stdout -PhotonSelfTest 2>&1 |
        Select-String -Pattern "PHOTONTEST"
    $pass = @($lines | Where-Object { $_ -match "= PASS" }).Count
    $fail = @($lines | Where-Object { $_ -match "= FAIL" })
    Write-Host "assertions=$($pass + $fail.Count) pass=$pass fail=$($fail.Count)"
    $fail | ForEach-Object { Write-Host $_ -ForegroundColor Red }
}

function Wait-Shots($pattern, $expected, $minutes) {
    $deadline = (Get-Date).AddMinutes($minutes)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 4
        $n = (Get-ChildItem "$ShotDir\$pattern" -EA SilentlyContinue).Count
        if ($n -ge $expected) { Start-Sleep 3; break }
    }
    Stop-Process -Name UnrealEditor -Force -EA SilentlyContinue
    Get-ChildItem "$ShotDir\$pattern" -EA SilentlyContinue |
        Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
}

if ($Tour) {
    Section "TOUR"
    Remove-Item "$ShotDir\Photon_0*.png", "$ShotDir\Photon_1*.png" -Force -EA SilentlyContinue
    Start-Process -FilePath $UE -ArgumentList "`"$PROJ`"", $MAP, "-game", "-windowed",
        "-ResX=1600", "-ResY=900", "-PhotonTour", "-log"
    Wait-Shots "Photon_*.png" 11 5
}

if ($Shot) {
    Section "SHOT"
    Remove-Item "$ShotDir\PhotonSprint*.png" -Force -EA SilentlyContinue
    Start-Process -FilePath $UE -ArgumentList "`"$PROJ`"", $MAP, "-game", "-windowed",
        "-ResX=1600", "-ResY=900", "-PhotonShot", "-log"
    Wait-Shots "PhotonSprint*.png" 1 3
}

Section "DONE"
