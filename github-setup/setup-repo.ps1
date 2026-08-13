# Sprint 0 / gestión de proyecto — paso 1 de 2.
# Corre esto UNA VEZ desde la raíz del repo (carpeta wow-analytics, no desde github-setup/).
#
# Uso:
#   cd wow-analytics
#   .\github-setup\setup-repo.ps1

$ErrorActionPreference = "Stop"

Write-Host "=== 1. Verificando GitHub CLI ===" -ForegroundColor Cyan
gh --version
if ($LASTEXITCODE -ne 0) {
  Write-Host "gh no está instalado. Instálalo desde https://cli.github.com/ y vuelve a correr este script." -ForegroundColor Red
  exit 1
}

Write-Host "`n=== 2. Verificando login ===" -ForegroundColor Cyan
gh auth status
if ($LASTEXITCODE -ne 0) {
  Write-Host "No estás logueado. Abriendo 'gh auth login' (sigue las instrucciones en pantalla)..." -ForegroundColor Yellow
  gh auth login
}

Write-Host "`n=== 3. Inicializando git local (si no existe ya) ===" -ForegroundColor Cyan
if (-not (Test-Path ".git")) {
  git init
  git add .
  git commit -m "Initial commit: Sprint 0 data validation"
} else {
  Write-Host "Ya existe un repo git local, se salta git init." -ForegroundColor Yellow
}

Write-Host "`n=== 4. Creando el repo en GitHub (privado) y haciendo push ===" -ForegroundColor Cyan
gh repo create wow-pvp-intelligence --private --source=. --remote=origin --push

Write-Host "`n=== 5. Creando labels ===" -ForegroundColor Cyan
$labels = Get-Content "$PSScriptRoot\labels.json" -Raw | ConvertFrom-Json
foreach ($l in $labels) {
  Write-Host "  Label: $($l.name)"
  gh label create $l.name --color $l.color --description $l.description --force
}

Write-Host "`n=== 6. Creando milestones ===" -ForegroundColor Cyan
$milestones = Get-Content "$PSScriptRoot\milestones.json" -Raw | ConvertFrom-Json
foreach ($m in $milestones) {
  Write-Host "  Milestone: $($m.title)"
  gh api repos/{owner}/{repo}/milestones -f title="$($m.title)" -f description="$($m.description)" -f state="open" | Out-Null
}

Write-Host "`n=== Listo ===" -ForegroundColor Green
Write-Host "Repo creado, labels y milestones listos. Siguiente paso: .\github-setup\create-issues.ps1"
