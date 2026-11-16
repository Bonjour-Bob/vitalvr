# Vital Algo: adds Vital Algo to the SteamVR apps (or removes it with -Remove), so
# it can be started with SteamVR: SteamVR settings > Startup / Shutdown >
# Choose startup overlay apps > Vital Algo.
param(
	[string]$Exe,
	[string]$ManifestDir,
	[switch]$Remove
)
$ErrorActionPreference = "Stop"
# SteamVR does not read JSON files with a BOM
$utf8 = New-Object System.Text.UTF8Encoding($false)

$steam = (Get-ItemProperty -Path "HKCU:\Software\Valve\Steam" -ErrorAction SilentlyContinue).SteamPath
if (-not $steam) { Write-Host "Steam not found."; exit 0 }
$appConfig = Join-Path ($steam -replace "/", "\") "config\appconfig.json"
$manifest = Join-Path $ManifestDir "vitalalgo.vrmanifest"

$json = if (Test-Path $appConfig) { Get-Content $appConfig -Raw | ConvertFrom-Json } else { New-Object PSObject }
$paths = @(@($json.manifest_paths) | Where-Object { $_ -and ($_ -ne $manifest) })

if ($Remove) {
	if (Test-Path $manifest) { Remove-Item $manifest -Force }
} else {
	$app = [ordered]@{
		app_key = "dev.vitalvr.VitalAlgo"
		launch_type = "binary"
		binary_path_windows = $Exe
		arguments = ""
		is_dashboard_overlay = $true
		strings = @{ en_us = @{ name = "Vital Algo"; description = "Vital Algo" } }
	}
	$doc = [ordered]@{ source = "builtin"; applications = @($app) }
	[System.IO.File]::WriteAllText($manifest, ($doc | ConvertTo-Json -Depth 6), $utf8)
	$paths += $manifest
}

$json | Add-Member -NotePropertyName manifest_paths -NotePropertyValue $paths -Force
[System.IO.File]::WriteAllText($appConfig, ($json | ConvertTo-Json -Depth 6), $utf8)
exit 0
