param(
    [string]$CommitMessage = "Deploy mobile PWA"
)

# Paths to the repos
$mobileRepo = "C:\anime-va-mobile"
$publicRepo = "C:\anime-va-updates"

Write-Host "=== Anime VA Mobile Deploy ==="

if (-not (Test-Path $mobileRepo)) {
    Write-Host "ERROR: Mobile repo path not found: $mobileRepo" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $publicRepo)) {
    Write-Host "ERROR: Public repo path not found: $publicRepo" -ForegroundColor Red
    exit 1
}

Write-Host "Mobile repo: $mobileRepo"
Write-Host "Public repo: $publicRepo"
Write-Host ""

# Copy web/ from private to public
$source = Join-Path $mobileRepo "web"
$dest   = Join-Path $publicRepo "web"

if (-not (Test-Path $source)) {
    Write-Host "ERROR: Source web folder not found: $source" -ForegroundColor Red
    exit 1
}

Write-Host "Copying web/ from private to public with robocopy..."
Write-Host "  From: $source"
Write-Host "  To:   $dest"
Write-Host ""

# /E = copy subdirs, including empty
# /NFL /NDL /NP to reduce noise; /NJH /NJS no headers/summary
robocopy $source $dest /E /NFL /NDL /NP /NJH /NJS | Out-Null

if ($LASTEXITCODE -ge 8) {
    Write-Host "ERROR: robocopy reported a failure (exit code $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Copy complete."
Write-Host ""

# Commit + push in the public repo
Set-Location $publicRepo

# Check if there are changes
$changes = git status --porcelain

if ([string]::IsNullOrWhiteSpace($changes)) {
    Write-Host "No changes detected in $publicRepo\web. Nothing to commit."
    exit 0
}

Write-Host "Changes detected in public repo. Committing..."
git add web

git commit -m $CommitMessage

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git commit failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Pushing to origin..."
git push

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: git push failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Deploy complete! 🎉" -ForegroundColor Green
