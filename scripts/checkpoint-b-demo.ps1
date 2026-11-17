# Creates a separate local TEST project; cannot initiate payments.
$ErrorActionPreference = 'Stop'
if (-not $env:OPENPAYABLES_DATABASE_URL) { throw 'Set OPENPAYABLES_DATABASE_URL first.' }
if (-not $env:OPENPAYABLES_OPERATOR_ID) { throw 'Set OPENPAYABLES_OPERATOR_ID first.' }
function Invoke-Cli([string[]] $Arguments) {
  $output = & npm run --silent cli -- @Arguments
  if ($LASTEXITCODE -ne 0) { throw "OpenPayables CLI failed: $($Arguments -join ' ')" }
  return ($output | Out-String | ConvertFrom-Json)
}
$suffix = [guid]::NewGuid().ToString('N').Substring(0,8)
$project = "openpayables-funding-$suffix"
$alice = "alice-$suffix"
$bob = "bob-$suffix"
Invoke-Cli -Arguments @('project','create',$project,'Funded test project') | Out-Null
Invoke-Cli -Arguments @('contributor','create',$alice,'Alice') | Out-Null
Invoke-Cli -Arguments @('contributor','create',$bob,'Bob') | Out-Null
Invoke-Cli -Arguments @('project','join',$project,$alice) | Out-Null
Invoke-Cli -Arguments @('project','join',$project,$bob) | Out-Null
$source = "demo/repo#$suffix"
Invoke-Cli -Arguments @('credit','award',$project,$alice,'development','large','github',$source,'author','Accepted code') | Out-Null
Invoke-Cli -Arguments @('credit','award',$project,$bob,'review','medium','github',$source,'reviewer','Accepted review') | Out-Null
Invoke-Cli -Arguments @('fund','add',$project,'1100',"pilot-$suffix") | Out-Null
$period = Invoke-Cli -Arguments @('distribution','create',$project,"pilot-$suffix",'1100')
$approved = Invoke-Cli -Arguments @('distribution','approve',$period.id)
$shown = Invoke-Cli -Arguments @('distribution','show',$period.id)
$funds = Invoke-Cli -Arguments @('fund','status',$project)
$aliceCents = ($approved.allocations | Where-Object contributorId -EQ $alice).amountCents
$bobCents = ($approved.allocations | Where-Object contributorId -EQ $bob).amountCents
if ($aliceCents -ne 800 -or $bobCents -ne 300 -or $funds.remainingCents -ne 0) {
  throw "Unexpected allocations (Alice=$aliceCents, Bob=$bobCents, remaining=$($funds.remainingCents))"
}
if (@($shown.obligations | Where-Object status -NE 'held').Count -ne 0) {
  throw 'Unconnected contributors must remain held'
}
Write-Host "Checkpoint B local money-allocation demo PASS (project=$project)"
Write-Host 'Verified: 8:3 credit -> 800/300 cents; 0 unreserved cents; both obligations held.'
Write-Host 'No Stripe API calls or real payments were performed.'
