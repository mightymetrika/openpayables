# Self-hosted technical preview acceptance: run only on a dedicated TEST database.
# Compiles, packs, installs OUTSIDE the checkout, and runs both installed binaries.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$testUrl = $env:OPENPAYABLES_TEST_DATABASE_URL
if ([string]::IsNullOrWhiteSpace($testUrl) -or $testUrl -notmatch '/openpayables_test(?:\?|$)') {
    throw 'Set OPENPAYABLES_TEST_DATABASE_URL to your dedicated openpayables_test database.'
}
if ($env:OPENPAYABLES_DATABASE_URL -eq $testUrl) {
    throw 'Development and TEST database URLs must differ.'
}
$originalDatabase = $env:OPENPAYABLES_DATABASE_URL
$originalOperator = $env:OPENPAYABLES_OPERATOR_ID
$working = Join-Path ([System.IO.Path]::GetTempPath()) ('openpayables-preview-' + [guid]::NewGuid().ToString('N'))
New-Item -Path $working -ItemType Directory -Force | Out-Null
$atRoot = $false
$atConsumer = $false
try {
    Push-Location -LiteralPath $root
    $atRoot = $true
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript build failed.' }
    $packRaw = & npm pack --ignore-scripts --json --pack-destination $working
    if ($LASTEXITCODE -ne 0) { throw 'npm pack failed.' }
    $packages = @(($packRaw | Out-String | ConvertFrom-Json))
    if ($packages.Count -ne 1) { throw 'Expected exactly one npm package.' }
    $package = $packages[0]
    $paths = @($package.files | ForEach-Object { [string]$_.path })
    foreach ($needed in @('dist/cli/index.js', 'dist/storage/postgres/migrate.js', 'sql/011_checkpoint_c13.sql', 'sql/001_checkpoint_a.sql', 'package.json', 'README.md', 'LICENSE')) {
        if ($paths -notcontains $needed) { throw "Missing package file: $needed" }
    }
    foreach ($path in $paths) {
        if ($path -notmatch '^(dist/|sql/|README\.md$|LICENSE$|package\.json$)') { throw "Unexpected packaged file: $path" }
        if ($path -match '(?i)(\.env|\.pem$|\.key$|node_modules|\.git/)') { throw "Potential secret or local artifact packaged: $path" }
    }
    $tarball = Join-Path $working ([string]$package.filename)
    if (-not (Test-Path -LiteralPath $tarball)) { throw 'Package archive was not created.' }
    Pop-Location
    $atRoot = $false

    $consumer = Join-Path $working 'independent-operator'
    New-Item -Path $consumer -ItemType Directory -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $consumer 'package.json'), '{"name":"openpayables-preview-acceptance","private":true,"version":"1.0.0"}', ([System.Text.UTF8Encoding]::new($false)))
    Push-Location -LiteralPath $consumer
    $atConsumer = $true
    & npm install --no-audit --no-fund --ignore-scripts -- $tarball
    if ($LASTEXITCODE -ne 0) { throw 'Independent operator install failed.' }
    $cli = Join-Path $consumer 'node_modules\.bin\openpayables.cmd'
    $migrator = Join-Path $consumer 'node_modules\.bin\openpayables-migrate.cmd'
    if (-not (Test-Path -LiteralPath $cli) -or -not (Test-Path -LiteralPath $migrator)) {
        throw 'Installed CLI or migrator is missing.'
    }

    $helpText = (& $cli --help | Out-String)
    if ($LASTEXITCODE -ne 0 -or $helpText -notmatch 'distribution create-revenue') {
        throw 'Installed CLI help check failed.'
    }
    $env:OPENPAYABLES_DATABASE_URL = $testUrl
    $env:OPENPAYABLES_OPERATOR_ID = 'preview-smoke-operator'
    & $migrator
    if ($LASTEXITCODE -ne 0) { throw 'Installed migrator failed.' }

    function Invoke-PreviewCli([string[]] $Arguments) {
        $output = & $cli @Arguments
        if ($LASTEXITCODE -ne 0) { throw "Installed CLI failed: $($Arguments -join ' ')" }
        return ($output | Out-String | ConvertFrom-Json)
    }
    $suffix = [guid]::NewGuid().ToString('N').Substring(0,8)
    $project = "preview-$suffix"
    $alice = "preview-alice-$suffix"
    $bob = "preview-bob-$suffix"
    Invoke-PreviewCli -Arguments @('project','create',$project,'Technical preview synthetic project') | Out-Null
    Invoke-PreviewCli -Arguments @('contributor','create',$alice,'Synthetic Alice') | Out-Null
    Invoke-PreviewCli -Arguments @('contributor','create',$bob,'Synthetic Bob') | Out-Null
    Invoke-PreviewCli -Arguments @('project','join',$project,$alice) | Out-Null
    Invoke-PreviewCli -Arguments @('project','join',$project,$bob) | Out-Null
    $source = "synthetic-$suffix"
    Invoke-PreviewCli -Arguments @('credit','award',$project,$alice,'development','large','manual',$source,'author','Accepted synthetic work') | Out-Null
    Invoke-PreviewCli -Arguments @('credit','award',$project,$bob,'review','medium','manual',$source,'reviewer','Accepted synthetic review') | Out-Null
    $proposal = Invoke-PreviewCli -Arguments @('proposal','open',$project,'Technical preview vote','Synthetic advisory governance')
    Invoke-PreviewCli -Arguments @('proposal','vote',$proposal.id,$alice,'yes') | Out-Null
    Invoke-PreviewCli -Arguments @('proposal','vote',$proposal.id,$bob,'no') | Out-Null
    $votes = Invoke-PreviewCli -Arguments @('proposal','tally',$proposal.id)
    if ($votes.tally.yes -ne 8 -or $votes.tally.no -ne 3) { throw 'Unexpected vote tally.' }
    $draft = Invoke-PreviewCli -Arguments @('distribution','create-revenue',$project,"synthetic-$suffix",'10000','300','1200','500','2500',"policy-$suffix","synthetic-ledger-$suffix")
    if ($draft.basis.poolCents -ne 2000) { throw 'Unexpected calculated revenue pool.' }
    $preview = Invoke-PreviewCli -Arguments @('distribution','preview',$project,'2000')
    if ($preview.allocatedCents -ne 2000 -or $preview.paymentObligationsCreated -ne 0) { throw 'Preview was not read-only.' }
    # Legacy operator attestation is intentionally TEST-only. No provider request is made.
    Invoke-PreviewCli -Arguments @('fund','add',$project,'2000',"synthetic-funds-$suffix") | Out-Null
    $approval = Invoke-PreviewCli -Arguments @('distribution','approve',$draft.id)
    $a = @($approval.allocations | Where-Object { $_.contributorId -eq $alice })
    $b = @($approval.allocations | Where-Object { $_.contributorId -eq $bob })
    if ($a.Count -ne 1 -or $b.Count -ne 1 -or $a[0].amountCents -ne 1455 -or $b[0].amountCents -ne 545) {
        throw 'Unexpected deterministic allocation for 8:3 credits.'
    }
    $shown = Invoke-PreviewCli -Arguments @('distribution','show',$draft.id)
    if ($shown.revenueBasis.policyReference -ne "policy-$suffix" -or $shown.obligations.Count -ne 2) {
        throw 'Stored period or revenue-policy basis is missing.'
    }
    if (@($shown.obligations | Where-Object { $_.status -ne 'held' }).Count -ne 0) {
        throw 'Obligations must remain held without connected recipients.'
    }
    Write-Host "Technical preview package smoke PASS (project=$project)."
    Write-Host 'Installed binaries and migrations PASS; 8:3 votes PASS; 2000-cent revenue basis and 1455/545 allocation PASS.'
    Write-Host 'No external GitHub, Stripe, bank payout or LIVE payment operations were performed.'
}
finally {
    if ($atConsumer) { Pop-Location }
    if ($atRoot) { Pop-Location }
    $env:OPENPAYABLES_DATABASE_URL = $originalDatabase
    $env:OPENPAYABLES_OPERATOR_ID = $originalOperator
    Remove-Item -LiteralPath $working -Force -Recurse -ErrorAction SilentlyContinue
}
