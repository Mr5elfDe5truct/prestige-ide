# createReactFilter replaces reactFilter everywhere, and everything still type-checks.
$root = Split-Path $PSScriptRoot -Parent
$fail = 0
$old = Select-String -Path "$root\ts\*.ts" -Pattern '\breactFilter\b' -CaseSensitive
if ($old) { Write-Output "FAIL old name still used:"; $old | ForEach-Object { Write-Output "  $_" }; $fail++ }
$def = Select-String -Path "$root\ts\emotes.ts" -Pattern 'export function createReactFilter\b' -CaseSensitive
if (-not $def) { Write-Output "FAIL createReactFilter isn't exported from emotes.ts"; $fail++ }
$uses = (Select-String -Path "$root\ts\chat.ts" -Pattern '\bcreateReactFilter\b' -CaseSensitive -AllMatches | ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum
if ($uses -lt 3) { Write-Output "FAIL chat.ts should import and use createReactFilter (found $uses mentions)"; $fail++ }
Push-Location $root
npx tsc -p . --noEmit
if ($LASTEXITCODE) { Write-Output "FAIL typecheck"; $fail++ }
Pop-Location
exit $fail
