param(
  [string]$Version = "0.1.3",
  [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$outputRoot = Join-Path $projectRoot $OutputDirectory
$stagingRoot = Join-Path ([IO.Path]::GetTempPath()) ("automation-hub-package-" + [Guid]::NewGuid().ToString("N"))
$packageName = "automation-hub-source-$Version.zip"
$packagePath = Join-Path $outputRoot $packageName
$checksumPath = "$packagePath.sha256"
$packageEntries = @(
  ".dockerignore",
  ".env.example",
  "compose.yaml",
  "Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "DEPLOYMENT.md",
  "scripts",
  "apps/api/package.json",
  "apps/api/tsconfig.json",
  "apps/api/tsconfig.build.json",
  "apps/api/src",
  "apps/admin/package.json",
  "apps/admin/tsconfig.json",
  "apps/admin/vite.config.ts",
  "apps/admin/index.html",
  "apps/admin/src",
  "apps/extension"
)

try {
  New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
  foreach ($entry in $packageEntries) {
    $source = Join-Path $projectRoot $entry
    $destination = Join-Path $stagingRoot $entry
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse -Force
  }
  $excludedDirectories = Get-ChildItem -Path $stagingRoot -Directory -Recurse | Where-Object { $_.Name -in @("node_modules", "dist", "data") } | Sort-Object { $_.FullName.Length } -Descending
  foreach ($directory in $excludedDirectories) { if (Test-Path -LiteralPath $directory.FullName) { Remove-Item -LiteralPath $directory.FullName -Recurse -Force } }
  Get-ChildItem -Path $stagingRoot -File -Recurse | Where-Object { $_.Name -eq ".env" -or $_.Extension -in @(".log", ".zip") } | Remove-Item -Force
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  if (Test-Path -LiteralPath $packagePath) { Remove-Item -LiteralPath $packagePath -Force }
  Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $packagePath -CompressionLevel Optimal
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $packagePath).Hash.ToLowerInvariant()
  Set-Content -LiteralPath $checksumPath -Value "$hash  $packageName" -Encoding ascii
  Write-Output $packagePath
  Write-Output $checksumPath
} finally {
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $resolvedStaging = [IO.Path]::GetFullPath($stagingRoot)
  if ($resolvedStaging.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedStaging)) {
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
  }
}
