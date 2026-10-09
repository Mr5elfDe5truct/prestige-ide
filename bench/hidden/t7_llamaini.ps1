. "$PSScriptRoot\..\ps\llamaini.ps1"
$fail = 0
function Check($name, $got, $want) { if ($got -ne $want) { Write-Output "FAIL $name`n  got:  $got`n  want: $want"; $script:fail++ } }
Check "under 6 GB caps at 8192" (Convert-LlamaIni "[m]`r`nc = 32768" @{ LlamaFit = $true; LlamaGB = 4 }) "[m]`r`nc = 8192"
Check "under 6 GB leaves smaller alone" (Convert-LlamaIni "[m]`r`nc = 4096" @{ LlamaFit = $true; LlamaGB = 5.5 }) "[m]`r`nc = 4096"
Check "6 GB caps at 16384" (Convert-LlamaIni "[m]`r`nc = 32768" @{ LlamaFit = $true; LlamaGB = 6 }) "[m]`r`nc = 16384"
Check "8 GB keeps 12288" (Convert-LlamaIni "[m]`r`nc = 12288" @{ LlamaFit = $true; LlamaGB = 8 }) "[m]`r`nc = 12288"
Check "12 GB untouched" (Convert-LlamaIni "[m]`r`nc = 32768" @{ LlamaFit = $true; LlamaGB = 12 }) "[m]`r`nc = 32768"
Check "no fit, no cap" (Convert-LlamaIni "[m]`r`nc = 32768" @{ LlamaFit = $false; LlamaGB = 4; TensorSplit = "1,1" }) "[m]`r`nc = 32768"
exit $fail
