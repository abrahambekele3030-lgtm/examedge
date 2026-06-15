#!/usr/bin/env pwsh
# sync.ps1 — Run this whenever you update web files to sync to Android
# Usage: .\sync.ps1

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

Write-Host "📦 Syncing web assets to www/..." -ForegroundColor Cyan

$files = @("index.html", "manifest.json", "service-worker.js", "visuals_manifest.json")
foreach ($f in $files) {
    Copy-Item $f -Destination "www\" -Force
    Write-Host "  ✔ $f" -ForegroundColor Green
}

$dirs = @("css", "js", "images", "data")
foreach ($d in $dirs) {
    Copy-Item $d -Destination "www\$d" -Recurse -Force
    Write-Host "  ✔ $d/" -ForegroundColor Green
}

Write-Host "`n🔄 Running Capacitor sync..." -ForegroundColor Cyan
npx cap sync android

Write-Host "`n✅ Done! Open Android Studio to build the APK:" -ForegroundColor Yellow
Write-Host "   npx cap open android" -ForegroundColor White
