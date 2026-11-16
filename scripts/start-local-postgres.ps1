# Requires Docker Desktop running. Binds PostgreSQL to localhost only.
$ErrorActionPreference = 'Stop'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker was not found. Install/start Docker Desktop, or use an existing dedicated PostgreSQL database.'
}
$container = 'openpayables-pg'
$existing = & docker ps -a --filter "name=^/$container`$" --format '{{.Names}}'
if ($LASTEXITCODE -ne 0) { throw 'Cannot communicate with Docker Desktop.' }
if ($existing -eq $container) {
  & docker start $container | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to start existing OpenPayables PostgreSQL container.' }
} else {
  & docker run -d --name $container `
    -e POSTGRES_USER=openpayables `
    -e POSTGRES_PASSWORD=openpayables_local_only `
    -e POSTGRES_DB=openpayables `
    -p '127.0.0.1:55432:5432' `
    -v openpayables_pg_data:/var/lib/postgresql/data `
    postgres:16-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to create the OpenPayables PostgreSQL container.' }
}
$env:OPENPAYABLES_DATABASE_URL = 'postgresql://openpayables:openpayables_local_only@127.0.0.1:55432/openpayables'
$env:OPENPAYABLES_OPERATOR_ID = 'local-operator'
Write-Host 'Waiting for OpenPayables PostgreSQL to become ready...'
$ready = $false
for ($i = 1; $i -le 30; $i++) {
  & docker exec $container pg_isready -U openpayables -d openpayables *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'PostgreSQL did not become ready.' }
Write-Host 'Development database ready. Environment variables set for this PowerShell session.'
