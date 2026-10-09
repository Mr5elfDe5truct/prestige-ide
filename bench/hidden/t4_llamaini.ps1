. "$PSScriptRoot\..\ps\llamaini.ps1"
$fail = 0
function Check($name, $got, $want) { if ($got -ne $want) { Write-Output "FAIL $name`n  got:  $got`n  want: $want"; $script:fail++ } }
$plan = @{ LlamaFit = $true; LlamaGB = 8 }
Check "big context is capped" (Convert-LlamaIni "[m]`r`nc = 32768" $plan) "[m]`r`nc = 16384"
Check "small context is left alone" (Convert-LlamaIni "[m]`r`nc = 8192" $plan) "[m]`r`nc = 8192"
Check "ctx-size spelling" (Convert-LlamaIni "[m]`r`nctx-size = 4096" $plan) "[m]`r`nctx-size = 4096"
Check "12 GB untouched" (Convert-LlamaIni "[m]`r`nc = 32768" @{ LlamaFit = $true; LlamaGB = 12 }) "[m]`r`nc = 32768"
exit $fail
