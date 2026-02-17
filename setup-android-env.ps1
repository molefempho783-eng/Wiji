# Setup Android Environment Variables
# Run this script as Administrator or it will set for Current User only

$sdkPath = "$env:LOCALAPPDATA\Android\Sdk"

if (-not (Test-Path $sdkPath)) {
    Write-Host "ERROR: Android SDK not found at $sdkPath" -ForegroundColor Red
    Write-Host "Please install Android Studio first." -ForegroundColor Yellow
    exit 1
}

Write-Host "Setting up Android environment variables..." -ForegroundColor Green
Write-Host "SDK Path: $sdkPath" -ForegroundColor Cyan

# Set ANDROID_HOME for Current User
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdkPath, "User")

# Get current PATH
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

# Paths to add
$pathsToAdd = @(
    "$sdkPath\platform-tools",
    "$sdkPath\tools",
    "$sdkPath\tools\bin",
    "$sdkPath\emulator"
)

# Add paths if they don't already exist
$updatedPath = $currentPath
foreach ($path in $pathsToAdd) {
    if ($currentPath -notlike "*$path*") {
        if ($updatedPath) {
            $updatedPath += ";$path"
        } else {
            $updatedPath = $path
        }
        Write-Host "Adding to PATH: $path" -ForegroundColor Yellow
    } else {
        Write-Host "Already in PATH: $path" -ForegroundColor Gray
    }
}

# Update PATH
[Environment]::SetEnvironmentVariable("Path", $updatedPath, "User")

Write-Host "`n✅ Environment variables set successfully!" -ForegroundColor Green
Write-Host "`n⚠️  IMPORTANT: Close and reopen PowerShell for changes to take effect." -ForegroundColor Yellow
Write-Host "`nTo verify, run in a NEW PowerShell window:" -ForegroundColor Cyan
Write-Host "  adb version" -ForegroundColor White
Write-Host "  java -version" -ForegroundColor White

