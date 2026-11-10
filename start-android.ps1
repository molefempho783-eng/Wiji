# start-android.ps1 - starts the Android emulator and runs Wiji on it.
#
#   Run from C:\Square:   npm run emulator
#   Rebuild the app too:  npm run emulator -- -Rebuild     (needed after adding a native package)
#   Pick an emulator:     npm run emulator -- -Avd Pixel_7
#
# Everything it does is written to C:\Square\emulator-log.txt.
param(
  [string]$Avd = "",
  [switch]$Rebuild,
  [switch]$NoMetro,
  [switch]$Force,
  [switch]$SkipInstall
)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$log = Join-Path $root "emulator-log.txt"
"" | Out-File $log -Encoding utf8
function Say($msg, $color = "White") {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  Write-Host $line -ForegroundColor $color
  $line | Out-File $log -Append -Encoding utf8
}
function Note($text) { $text | Out-File $log -Append -Encoding utf8 }
function Fail($msg, $fix) {
  Say "PROBLEM: $msg" "Red"
  if ($fix) { Say "FIX: $fix" "Yellow" }
  Say "Full log: $log" "Gray"
  exit 1
}

Say "Wiji emulator start ($(Get-Date -Format 'yyyy-MM-dd'))" "Cyan"

# ---------- 1. Find the Android SDK ----------
$sdk = $null
foreach ($c in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA "Android\Sdk"))) {
  if ($c -and (Test-Path (Join-Path $c "platform-tools\adb.exe"))) { $sdk = $c; break }
}
if (-not $sdk) { Fail "Android SDK not found." "Open Android Studio > More Actions > SDK Manager and install the SDK, then run this again." }
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$adb = Join-Path $sdk "platform-tools\adb.exe"
$emu = Join-Path $sdk "emulator\emulator.exe"
$env:Path = "$(Join-Path $sdk 'platform-tools');$(Join-Path $sdk 'emulator');$env:Path"
Say "SDK: $sdk"
if (-not (Test-Path $emu)) { Fail "The emulator program is not installed." "Android Studio > SDK Manager > SDK Tools > tick 'Android Emulator' > Apply." }

# Gradle needs to know where the SDK is
$lp = Join-Path $root "android\local.properties"
if (-not (Test-Path $lp)) {
  "sdk.dir=$($sdk -replace '\\','\\')" | Out-File $lp -Encoding ascii
  Say "Created android\local.properties"
}

# ---------- 2. Machine checks ----------
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $freeRam = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
  $totalRam = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  Say "Memory: $freeRam GB free of $totalRam GB"
  $top = Get-Process | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ Name = $_.Name; GB = [math]::Round((($_.Group | Measure-Object WorkingSet64 -Sum).Sum) / 1GB, 2) } } | Sort-Object GB -Descending | Select-Object -First 10
  Note "--- top memory users (GB) ---`r`n$(($top | ForEach-Object { '{0,6}  {1}' -f $_.GB, $_.Name }) -join "`r`n")"
  $emuRunning = [bool](Get-Process -Name "qemu-system-*" -ErrorAction SilentlyContinue)
  if ($emuRunning) { Say "The emulator is already running, so the memory check is skipped." }
  if ($freeRam -lt 4 -and -not $emuRunning) {
    Say "LOW MEMORY: only $freeRam GB free. The emulator needs about 4 GB, so it will freeze." "Red"
    Say "Biggest memory users right now:" "Yellow"
    $top | Select-Object -First 5 | ForEach-Object { Say ("   {0} GB  {1}" -f $_.GB, $_.Name) "Yellow" }
    Say "Close what you don't need (browser tabs, Android Studio, Docker), then run this again." "Yellow"
    if ($freeRam -lt 3 -and -not $Force) { Say "Stopping here so your PC doesn't lock up. To start anyway: npm run emulator -- -Force" "Red"; Say "Full log: $log" "Gray"; exit 1 }
  }
  $avdHome = if ($env:ANDROID_AVD_HOME) { $env:ANDROID_AVD_HOME } else { Join-Path $env:USERPROFILE ".android\avd" }
  $drive = (Get-Item $env:USERPROFILE).PSDrive
  $freeDisk = [math]::Round($drive.Free / 1GB, 1)
  Say "Disk $($drive.Name): $freeDisk GB free"
  if ($freeDisk -lt 5) { Say "Low disk space: the emulator needs about 5 GB free to start reliably." "Yellow" }
} catch { Say "Could not read memory/disk info: $_" "Gray" }

$accel = & $emu -accel-check 2>&1 | Out-String
Note "--- accel-check ---`r`n$accel"
if ($accel -notmatch "is installed and usable|accel:\s*0") {
  Say "Hardware acceleration may be off (see log). The emulator will be very slow or will not start." "Yellow"
  Say "If it fails: Windows Features > turn on 'Windows Hypervisor Platform', then restart the PC." "Yellow"
} else { Say "Hardware acceleration: OK" }

# ---------- 3. Is a device already connected? ----------
& $adb start-server 2>&1 | Out-Null
function Get-Devices {
  $out = & $adb devices 2>&1 | Out-String
  $list = @()
  foreach ($l in ($out -split "`r?`n")) { if ($l -match "^(\S+)\s+(device|offline|unauthorized)\s*$") { $list += [pscustomobject]@{ Id = $Matches[1]; State = $Matches[2] } } }
  return ,$list
}
function Boot-Done($id) {
  $v = (& $adb -s $id shell getprop sys.boot_completed 2>$null | Out-String).Trim()
  return $v -eq "1"
}
$devices = Get-Devices
Note "--- adb devices ---`r`n$($devices | Out-String)"
if ($devices | Where-Object { $_.State -eq "offline" }) {
  Say "A device is stuck 'offline': restarting adb." "Yellow"
  & $adb kill-server 2>&1 | Out-Null; Start-Sleep 2; & $adb start-server 2>&1 | Out-Null
  $devices = Get-Devices
}
$target = ($devices | Where-Object { $_.State -eq "device" } | Select-Object -First 1).Id

# Asked for a specific emulator while a different one is running: close the running one first
if ($Avd -and $target -and $target -like "emulator-*") {
  $runningName = ((& $adb -s $target emu avd name 2>$null | Out-String) -split "`r?`n" | Where-Object { $_ -and $_ -ne "OK" } | Select-Object -First 1)
  if ($runningName) { $runningName = $runningName.Trim() }
  if ($runningName -and $runningName -ne $Avd) {
    Say "Closing the running emulator ($runningName) to start $Avd instead." "Yellow"
    & $adb -s $target emu kill 2>&1 | Out-Null
    $wait = 0
    while ((Get-Process -Name "qemu-system-*" -ErrorAction SilentlyContinue) -and $wait -lt 30) { Start-Sleep 1; $wait++ }
    Get-Process -Name "qemu-system-*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
    $target = $null
  }
}

# ---------- 4. Start the emulator if nothing is running ----------
if (-not $target) {
  $avds = @(& $emu -list-avds 2>$null | Where-Object { $_ -and $_ -notmatch "^(INFO|WARNING|ERROR)" })
  Note "--- avds ---`r`n$($avds -join "`r`n")"
  if ($avds.Count -eq 0) { Fail "You have no emulators (virtual devices)." "Android Studio > More Actions > Virtual Device Manager > Create Device (Pixel 7, newest x86_64 system image)." }
  if (-not $Avd) { $Avd = $avds[0] }
  if ($avds -notcontains $Avd) { Fail "Emulator '$Avd' does not exist." "Available: $($avds -join ', ')" }
  Say "Emulator: $Avd (available: $($avds -join ', '))"

  # Leftover lock files from a crashed emulator make it refuse to start
  $running = Get-Process -Name "qemu-system-*", "emulator" -ErrorAction SilentlyContinue
  if (-not $running) {
    $avdDir = Join-Path $avdHome "$Avd.avd"
    Get-ChildItem $avdDir -Filter "*.lock" -Force -ErrorAction SilentlyContinue | ForEach-Object {
      Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
      Say "Removed stale lock: $($_.Name)" "Yellow"
    }
  }

  function Start-Emu($extraArgs, $label) {
    $o = Join-Path $root "emulator-out.txt"; $e = Join-Path $root "emulator-err.txt"
    $emuArgs = @("-avd", $Avd, "-no-snapshot-load", "-no-boot-anim") + $extraArgs
    Say "Starting emulator ($label): emulator $($emuArgs -join ' ')" "Cyan"
    $p = Start-Process -FilePath $emu -ArgumentList $emuArgs -PassThru -RedirectStandardOutput $o -RedirectStandardError $e
    $deadline = (Get-Date).AddMinutes(5)
    while ((Get-Date) -lt $deadline) {
      Start-Sleep 5
      $d = (Get-Devices | Where-Object { $_.Id -like "emulator-*" -and $_.State -eq "device" } | Select-Object -First 1).Id
      if ($d -and (Boot-Done $d)) { return $d }
      if ($p.HasExited -and -not (Get-Process -Name "qemu-system-*" -ErrorAction SilentlyContinue)) { Say "The emulator closed by itself (exit code $($p.ExitCode))." "Red"; break }
      Write-Host "." -NoNewline
    }
    Write-Host ""
    Note "--- emulator output ($label) ---"
    foreach ($f in @($o, $e)) { if (Test-Path $f) { Get-Content $f -Tail 60 | Out-File $log -Append -Encoding utf8 } }
    if (Get-Process -Name "qemu-system-*" -ErrorAction SilentlyContinue) { Say "Not booted after 5 minutes: stopping it." "Yellow" }
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    Get-Process -Name "qemu-system-*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep 3
    return $null
  }

  $target = Start-Emu @("-gpu", "auto") "normal"
  if (-not $target) {
    Say "Trying again with software graphics (fixes most black-screen and crash-on-start problems)." "Yellow"
    $target = Start-Emu @("-gpu", "swiftshader_indirect", "-no-snapshot") "safe graphics"
  }
  if (-not $target) {
    $tail = (Get-Content $log -Tail 80 | Out-String)
    $fix = "Send Claude the file emulator-log.txt."
    if ($tail -match "hardware acceleration|WHPX|HAXM|hypervisor") { $fix = "Turn on 'Windows Hypervisor Platform' and 'Virtual Machine Platform' in Windows Features, restart, and run this again." }
    elseif ($tail -match "Not enough (disk )?space|No space left") { $fix = "Free up disk space (at least 5 GB) and run this again." }
    elseif ($tail -match "Cannot find AVD system path|system image|broken AVD") { $fix = "The emulator's system image is missing: Android Studio > Virtual Device Manager > delete '$Avd' and create a new device." }
    Fail "The emulator did not start." $fix
  }
}
Say "Device ready: $target" "Green"

# ---------- 5. Install Wiji ----------
$pkg = "com.mpho.dsquare"
$apk = Join-Path $root "android\app\build\outputs\apk\debug\app-debug.apk"
$installed = ((& $adb -s $target shell pm list packages $pkg 2>$null | Out-String) -match [regex]::Escape($pkg))
if ($Rebuild -or (-not $installed -and -not (Test-Path $apk))) {
  Say "Building and installing Wiji (first build can take 10-20 minutes)..." "Cyan"
  $env:ANDROID_SERIAL = $target
  & npx expo run:android 2>&1 | ForEach-Object { Write-Host $_; "$_" | Out-File $log -Append -Encoding utf8 }
  if ($LASTEXITCODE -ne 0) { Fail "The build failed." "Send Claude the file emulator-log.txt." }
  exit 0   # expo run:android already started Metro and opened the app
}
# Always put the latest build on the device: an older copy that is missing a native package
# makes the app hang after "loading 100%".
if ((Test-Path $apk) -and -not $SkipInstall) {
  Say "Installing the latest Wiji build ($((Get-Item $apk).LastWriteTime.ToString('d MMM HH:mm')))... about 30 seconds" "Cyan"
  $out = & $adb -s $target install -r $apk 2>&1 | Out-String
  Note $out
  if ($out -notmatch "Success") {
    if ($out -match "INSUFFICIENT_STORAGE") { Fail "The emulator's storage is full." "Android Studio > Virtual Device Manager > the device's menu > Wipe Data, then run this again." }
    if ($out -match "UPDATE_INCOMPATIBLE|signatures do not match") {
      Say "An older copy with a different signature is installed: replacing it." "Yellow"
      & $adb -s $target uninstall $pkg 2>&1 | Out-Null
      $out = & $adb -s $target install -r $apk 2>&1 | Out-String; Note $out
    }
    if ($out -notmatch "Success") { Fail "Could not install the app: $($out.Trim())" "Send Claude the file emulator-log.txt." }
  }
  Say "Wiji installed." "Green"
} elseif ($installed) { Say "Using the copy of Wiji already on the device." } else { Fail "Wiji is not installed and there is no build to install." "Run: npm run emulator -- -Rebuild" }

# ---------- 6. Connect the app to Metro and open it ----------
& $adb -s $target reverse tcp:8081 tcp:8081 2>&1 | Out-Null
Say "Connected the emulator to Metro (port 8081)."
if ($NoMetro) { Say "Done. Start Metro yourself with: npx expo start --dev-client" "Green"; exit 0 }
$busy = Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue
if ($busy) {
  Say "Metro is already running on port 8081: opening Wiji." "Green"
  & $adb -s $target shell am start -a android.intent.action.VIEW -d "square://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081" $pkg 2>&1 | Out-Null
  exit 0
}
Say "Starting Metro and opening Wiji on the emulator. Leave this window open." "Green"
$env:ANDROID_SERIAL = $target
& npx expo start --dev-client --android
