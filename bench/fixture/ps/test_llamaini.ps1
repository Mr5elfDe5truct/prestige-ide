# Checks Convert-LlamaIni. Exit code 0 when everything passes.
. "$PSScriptRoot\llamaini.ps1"
$fail = 0
function Check($name, $got, $want) {
    if ($got -ne $want) { Write-Output "FAIL $name`n  got:  $got`n  want: $want"; $script:fail++ } else { Write-Output "ok   $name" }
}
$ini = "[*]`r`nn-gpu-layers = 99`r`n[m]`r`nc = 32768"
Check "no plan leaves it alone" (Convert-LlamaIni $ini $null) $ini
Check "12 GB card with fit: offload lines go" (Convert-LlamaIni $ini @{ LlamaFit = $true; LlamaGB = 12 }) "[*]`r`n[m]`r`nc = 32768"
exit $fail
