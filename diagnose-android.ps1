# diagnose-android.ps1 - run this WHILE the emulator or app is frozen.
# Writes what the PC, the emulator and Wiji are doing to C:\Square\emulator-diagnose.txt
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root "emulator-diagnose.txt"
$sdk = $null
foreach ($c in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA "Android\Sdk"))) { if ($c -and (Test-Path (Join-Path $c "platform-tools\adb.exe"))) { $sdk = $c; break } }
$adb = Join-Path $sdk "platform-tools\adb.exe"
function Section($title, $body) { "`r`n===== $title =====`r`n$body" | Out-File $out -Append -Encoding utf8 }
"Wiji emulator diagnosis $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File $out -Encoding utf8
Write-Host "Collecting (about 20 seconds)..."
$os = Get-CimInstance Win32_OperatingSystem
Section "PC memory" ("Free {0} GB of {1} GB" -f [math]::Round($os.FreePhysicalMemory/1MB,1), [math]::Round($os.TotalVisibleMemorySize/1MB,1))
$top = Get-Process | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ Name = $_.Name; GB = [math]::Round((($_.Group | Measure-Object WorkingSet64 -Sum).Sum)/1GB,2); CPU = [math]::Round((($_.Group | Measure-Object CPU -Sum).Sum),0) } } | Sort-Object GB -Descending | Select-Object -First 12
Section "Top memory users (GB, total CPU seconds)" (($top | ForEach-Object { '{0,6} GB {1,8}s  {2}' -f $_.GB, $_.CPU, $_.Name }) -join "`r`n")
try { $cpu = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average; Section "PC CPU load" "$cpu %" } catch {}
Section "adb devices" (& $adb devices 2>&1 | Out-String)
$job = Start-Job { param($adb) & $adb shell echo responsive 2>&1 | Out-String } -ArgumentList $adb
if (Wait-Job $job -Timeout 10) { Section "Emulator responds to adb" (Receive-Job $job) } else { Section "Emulator responds to adb" "NO - the emulator itself is frozen (not just the app)"; Stop-Job $job }
function Adb($title, $cmd, $tail = 0) {
  $j = Start-Job { param($adb, $cmd) & $adb shell $cmd 2>&1 | Out-String } -ArgumentList $adb, $cmd
  if (Wait-Job $j -Timeout 15) { $r = Receive-Job $j; if ($tail) { $r = (($r -split "`n") | Select-Object -Last $tail) -join "`n" }; Section $title $r } else { Section $title "(timed out)"; Stop-Job $j }
}
Adb "Emulator memory" "cat /proc/meminfo | head -5"
Adb "Emulator load and top processes" "top -b -n 1 -m 8 | head -16"
Adb "Screen in front" "dumpsys activity activities | grep -E 'ResumedActivity|topResumedActivity' | head -3"
Adb "Wiji process" "pidof com.mpho.dsquare; dumpsys meminfo com.mpho.dsquare | grep -E 'TOTAL PSS|TOTAL:' | head -2"
Adb "App not responding / crashes (logcat)" "logcat -d -t 3000 | grep -E 'ANR in|FATAL EXCEPTION|AndroidRuntime|Skipped [0-9]+ frames|lowmemorykiller|Out of memory|ReactNativeJS.*(Error|error)|Unable to load script|SoLoader' | tail -60"
Adb "Last Wiji log lines" "logcat -d -t 400 --pid=`$(pidof com.mpho.dsquare) | tail -60"
Write-Host "Done: $out" -ForegroundColor Green
