param(
  [Parameter(Mandatory = $true)]
  [string]$CycleId,
  [string]$RootDir = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $RootDir) {
  $RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
  $RootDir = (Resolve-Path $RootDir).Path
}

$reportsDir = Join-Path $RootDir "reports\review-cycles\$CycleId"
$templatesDir = Join-Path $RootDir "docs\review\templates"

if (Test-Path -LiteralPath $reportsDir) {
  throw "Cycle directory already exists: $reportsDir"
}

New-Item -ItemType Directory -Path $reportsDir -Force | Out-Null
Copy-Item -Path (Join-Path $templatesDir 'opportunities_template.csv') -Destination (Join-Path $reportsDir 'opportunities.csv')
Copy-Item -Path (Join-Path $templatesDir 'reviewers_template.csv') -Destination (Join-Path $reportsDir 'reviewers.csv')
Copy-Item -Path (Join-Path $templatesDir 'cycle_scoring_template.csv') -Destination (Join-Path $reportsDir 'scores.csv')
Copy-Item -Path (Join-Path $templatesDir 'disagreement_log_template.csv') -Destination (Join-Path $reportsDir 'disagreements.csv')

Write-Host "Created review cycle scaffold: $reportsDir"
