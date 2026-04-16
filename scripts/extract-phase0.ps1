param(
  [string]$SourceHtml = $(if ($env:METASPRINT_AUTOPILOT_HTML) { $env:METASPRINT_AUTOPILOT_HTML } else { "$PSScriptRoot\..\metasprint-autopilot.html" }),
  [string]$OutputDir = "$PSScriptRoot\..\extracts\phase0"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SourceHtml)) {
  throw "Source HTML not found: $SourceHtml"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$lines = Get-Content -LiteralPath $SourceHtml

function Find-Line([string]$needle, [int]$Occurrence = 1) {
  $seen = 0
  for ($i = 0; $i -lt $lines.Length; $i++) {
    if ($lines[$i].Contains($needle)) {
      $seen += 1
      if ($seen -eq $Occurrence) {
        return $i + 1
      }
    }
  }
  throw "Marker not found: $needle (occurrence $Occurrence)"
}

function Write-Range([string]$FileName, [int]$StartLine, [int]$EndLine, [string]$Title) {
  if ($StartLine -lt 1 -or $EndLine -gt $lines.Length -or $StartLine -gt $EndLine) {
    throw "Invalid range for ${FileName}: $StartLine..$EndLine"
  }

  $outPath = Join-Path $OutputDir $FileName
  $header = @(
    "# Phase 0 extraction: $Title",
    "# Source: $SourceHtml",
    "# ExtractedAt: $(Get-Date -Format o)",
    "# LineRange: $StartLine..$EndLine",
    ""
  )

  ($header + $lines[($StartLine - 1)..($EndLine - 1)]) | Set-Content -Path $outPath -Encoding UTF8
  Write-Host "Wrote $FileName ($StartLine..$EndLine)"
}

$discoverStart = Find-Line '<section id="phase-discover"'
$discoverEnd = (Find-Line '<section id="phase-protocol"') - 1

$taxonomyStart = Find-Line 'CARDIAC UNIVERSE' 1
$dataLoadingStart = Find-Line 'CARDIAC UNIVERSE' 2
$aactStart = Find-Line 'AACT UNIVERSE' 1
$drillStart = Find-Line '// === DRILL-DOWN PANEL (click-to-expand provenance system) ==='
$rendererStart = Find-Line '// --- Main Ayat Universe Renderer ---'
$protocolStart = Find-Line '// PROSPERO PROTOCOL GENERATOR'

Write-Range -FileName 'discover-phase-markup.html' -StartLine $discoverStart -EndLine $discoverEnd -Title 'Discover phase HTML section'
Write-Range -FileName 'universe-taxonomy-and-state.js' -StartLine $taxonomyStart -EndLine ($dataLoadingStart - 1) -Title 'Universe taxonomy and state constants'
Write-Range -FileName 'universe-data-loading.js' -StartLine $dataLoadingStart -EndLine ($aactStart - 1) -Title 'Universe data loading and sync pipeline'
Write-Range -FileName 'aact-universe-and-graph.js' -StartLine $aactStart -EndLine ($drillStart - 1) -Title 'AACT universe fetch and graph preparation'
Write-Range -FileName 'drilldown-and-view-switching.js' -StartLine $drillStart -EndLine ($rendererStart - 1) -Title 'Drill-down system and universe view switching'
Write-Range -FileName 'universe-renderers.js' -StartLine $rendererStart -EndLine ($protocolStart - 1) -Title 'Ayat renderer and all discovery views'

$manifest = [ordered]@{
  source = $SourceHtml
  generatedAt = (Get-Date -Format o)
  extracts = @(
    @{ file = 'discover-phase-markup.html'; start = $discoverStart; end = $discoverEnd },
    @{ file = 'universe-taxonomy-and-state.js'; start = $taxonomyStart; end = ($dataLoadingStart - 1) },
    @{ file = 'universe-data-loading.js'; start = $dataLoadingStart; end = ($aactStart - 1) },
    @{ file = 'aact-universe-and-graph.js'; start = $aactStart; end = ($drillStart - 1) },
    @{ file = 'drilldown-and-view-switching.js'; start = $drillStart; end = ($rendererStart - 1) },
    @{ file = 'universe-renderers.js'; start = $rendererStart; end = ($protocolStart - 1) }
  )
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $OutputDir 'manifest.json') -Encoding UTF8
Write-Host 'Phase 0 extraction complete.'
