# Run from the repository root after npm install and npm run db:migrate.
$ErrorActionPreference = 'Stop'
if (-not $env:OPENPAYABLES_DATABASE_URL) { throw 'Set OPENPAYABLES_DATABASE_URL first.' }
if (-not $env:OPENPAYABLES_OPERATOR_ID) { throw 'Set OPENPAYABLES_OPERATOR_ID first.' }

function Invoke-Cli([string[]] $Arguments) {
  $output = & npm run --silent cli -- @Arguments
  if ($LASTEXITCODE -ne 0) { throw "OpenPayables CLI failed: $($Arguments -join ' ')" }
  return ($output | Out-String | ConvertFrom-Json)
}

$suffix = [guid]::NewGuid().ToString('N').Substring(0, 8)
$project = "openpayables-demo-$suffix"
$alice = "alice-$suffix"
$bob = "bob-$suffix"

Invoke-Cli -Arguments @('project','create',$project,'OpenPayables local demo') | Out-Null
Invoke-Cli -Arguments @('contributor','create',$alice,'Alice') | Out-Null
Invoke-Cli -Arguments @('contributor','create',$bob,'Bob') | Out-Null
Invoke-Cli -Arguments @('project','join',$project,$alice) | Out-Null
Invoke-Cli -Arguments @('project','join',$project,$bob) | Out-Null

$source = "example/repo#$suffix"
$award = Invoke-Cli -Arguments @('credit','award',$project,$alice,'development','large','github',$source,'author','Accepted feature')
Invoke-Cli -Arguments @('credit','award',$project,$bob,'review','medium','github',$source,'reviewer','Accepted review') | Out-Null

$balances = Invoke-Cli -Arguments @('credit','balances',$project)
Write-Host 'Expected balances: Alice=8, Bob=3'
$balances | Format-Table contributorId, points

$proposal = Invoke-Cli -Arguments @('proposal','open',$project,'What should we build next?','Advisory priority vote')
Invoke-Cli -Arguments @('proposal','vote',$proposal.id,$alice,'yes') | Out-Null
Invoke-Cli -Arguments @('proposal','vote',$proposal.id,$bob,'no') | Out-Null
$tally = Invoke-Cli -Arguments @('proposal','tally',$proposal.id)
Write-Host 'Expected tally: Yes=8, No=3'
$tally.tally | Format-List

if (($balances | Where-Object { $_.contributorId -eq $alice }).points -ne 8 -or
    ($balances | Where-Object { $_.contributorId -eq $bob }).points -ne 3 -or
    $tally.tally.yes -ne 8 -or $tally.tally.no -ne 3) {
  throw 'Checkpoint A demo assertions failed.'
}
Write-Host "Checkpoint A demo PASS (project=$project; example award=$($award.id))."
