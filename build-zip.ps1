# Build a clean ZIP for Chrome Web Store submission
# Run: powershell -File build-zip.ps1

$zipName = "contextbridge-v1.1.0.zip"
$outputPath = Join-Path $PSScriptRoot $zipName

# Remove old ZIP if exists
if (Test-Path $outputPath) { Remove-Item $outputPath }

# Files and folders to include in the extension package
$includes = @(
    "manifest.json",
    "src",
    "assets"
)

# Create a temp directory for clean packaging
$tempDir = Join-Path $env:TEMP "contextbridge-build"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy included files/folders
foreach ($item in $includes) {
    $source = Join-Path $PSScriptRoot $item
    $dest = Join-Path $tempDir $item
    if (Test-Path $source -PathType Container) {
        Copy-Item $source $dest -Recurse
    } else {
        Copy-Item $source $dest
    }
}

# Create ZIP
Compress-Archive -Path "$tempDir\*" -DestinationPath $outputPath -Force

# Cleanup
Remove-Item $tempDir -Recurse -Force

Write-Host "Created: $zipName" -ForegroundColor Green
Write-Host ""
Write-Host "Contents:"
Write-Host "  manifest.json"
Write-Host "  assets/icons/ (4 icons)"
Write-Host "  src/background/ (worker, db, search, exporter)"
Write-Host "  src/content/ (extractor)"
Write-Host "  src/shared/ (constants)"
Write-Host "  src/sidepanel/ (html, css, js, chat, providers)"
Write-Host ""
Write-Host "Excluded: node_modules, tests, .kiro, .vscode, mock_backend.py, package.json, vitest.config.js, README.md"
