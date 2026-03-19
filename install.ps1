# Neural Link — Install to global location
# Copies src/, bin/, config to ~/.copilot/neural-link/
# Preserves existing weights/ and logs/ directories
#
# Usage: pwsh install.ps1
#   or:  powershell -File install.ps1

$ErrorActionPreference = 'Stop'

$SOURCE_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$TARGET_DIR = Join-Path $HOME '.copilot' 'neural-link'

Write-Host "Neural Link — Install" -ForegroundColor Cyan
Write-Host "  Source: $SOURCE_DIR"
Write-Host "  Target: $TARGET_DIR"
Write-Host ""

# Create target directory structure
$dirs = @('src', 'bin')
foreach ($d in $dirs) {
    $targetSubDir = Join-Path $TARGET_DIR $d
    if (-not (Test-Path $targetSubDir)) {
        New-Item -ItemType Directory -Path $targetSubDir -Force | Out-Null
    }
}

# Copy source files (overwrites existing)
Write-Host "  Copying src/ ..." -ForegroundColor Yellow
Get-ChildItem -Path (Join-Path $SOURCE_DIR 'src') -Filter '*.js' | ForEach-Object {
    Copy-Item $_.FullName -Destination (Join-Path $TARGET_DIR 'src' $_.Name) -Force
}

Write-Host "  Copying bin/ ..." -ForegroundColor Yellow
Get-ChildItem -Path (Join-Path $SOURCE_DIR 'bin') -Filter '*' | ForEach-Object {
    Copy-Item $_.FullName -Destination (Join-Path $TARGET_DIR 'bin' $_.Name) -Force
}

Write-Host "  Copying config ..." -ForegroundColor Yellow
Copy-Item (Join-Path $SOURCE_DIR 'neural-link.config.json') -Destination $TARGET_DIR -Force
Copy-Item (Join-Path $SOURCE_DIR 'package.json') -Destination $TARGET_DIR -Force

# Ensure weights/ and logs/ directories exist but NEVER overwrite contents
$preserveDirs = @('weights', 'logs')
foreach ($d in $preserveDirs) {
    $p = Join-Path $TARGET_DIR $d
    if (-not (Test-Path $p)) {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
        Write-Host "  Created $d/" -ForegroundColor Green
    } else {
        Write-Host "  Preserved existing $d/" -ForegroundColor Green
    }
}

# Summary
$fileCount = (Get-ChildItem -Path $TARGET_DIR -Recurse -File).Count
Write-Host ""
Write-Host "  Installed $fileCount files to $TARGET_DIR" -ForegroundColor Cyan
Write-Host "  Entry points:" -ForegroundColor Cyan
Write-Host "    PS1: $TARGET_DIR\bin\neural-link.ps1"
Write-Host "    SH:  $TARGET_DIR/bin/neural-link.sh"
Write-Host ""
Write-Host "  Done." -ForegroundColor Green
