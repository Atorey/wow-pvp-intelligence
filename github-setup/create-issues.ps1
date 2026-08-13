# Sprint 0 / gestión de proyecto — paso 2 de 2.
# Requiere haber corrido setup-repo.ps1 antes (labels y milestones deben existir).
#
# Uso:
#   cd wow-analytics
#   .\github-setup\create-issues.ps1

$ErrorActionPreference = "Continue"  # seguimos aunque un issue falle, para no perder el resto del lote

$issues = Get-Content "$PSScriptRoot\issues.json" -Raw | ConvertFrom-Json

$created = 0
$closed = 0
$failed = 0

foreach ($issue in $issues) {
  Write-Host "→ $($issue.title)" -ForegroundColor Cyan

  $labelArg = $issue.labels -join ","
  $args = @("issue", "create", "--title", $issue.title, "--body", $issue.body, "--label", $labelArg)

  if ($issue.milestone) {
    $args += @("--milestone", $issue.milestone)
  }

  $url = & gh @args 2>&1

  if ($LASTEXITCODE -ne 0) {
    Write-Host "  ⚠️  Fallo creando el issue: $url" -ForegroundColor Red
    $failed++
    continue
  }

  $created++
  Write-Host "  Creado: $url"

  if ($issue.state -eq "closed") {
    $issueNumber = ($url -split "/")[-1]
    if ($issue.closeComment) {
      gh issue close $issueNumber --comment $issue.closeComment | Out-Null
    } else {
      gh issue close $issueNumber | Out-Null
    }
    $closed++
    Write-Host "  Cerrado (ya estaba completado o es 'won't do')."
  }
}

Write-Host "`n=== Resumen ===" -ForegroundColor Green
Write-Host "Issues creados: $created"
Write-Host "Issues cerrados automáticamente: $closed"
Write-Host "Fallos: $failed"

if ($failed -gt 0) {
  Write-Host "`nRevisa los fallos arriba — la causa más común es un label o milestone que no se creó bien en setup-repo.ps1." -ForegroundColor Yellow
}
