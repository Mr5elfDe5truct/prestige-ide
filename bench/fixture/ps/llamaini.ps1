# From the Custom AI Workstation's scripts/gpu-config.ps1: the runtime copy of bin\llama-models.ini for a GPU plan.
# $Plan has LlamaFit (let llama.cpp fit the model to the card), LlamaGB (the card's size) and TensorSplit.

# The runtime copy of bin\llama-models.ini for this plan (the tuned values stay as they are on a 12 GB card).
function Convert-LlamaIni($Text, $Plan) {
    if (-not $Plan -or -not ($Plan.LlamaFit -or $Plan.TensorSplit)) { return $Text }
    $lines = foreach ($l in ($Text -split "`r?`n")) {
        if ($Plan.LlamaFit) {
            if ($l -match '^\s*(n-gpu-layers|ngl|n-cpu-moe|cpu-moe)\s*=') { continue }
            # Small cards: cap the context so --fit spends the VRAM on layers rather than cache.
            if ($Plan.LlamaGB -lt 10 -and $l -match '^\s*(c|ctx-size)\s*=\s*(\d+)' -and [int]$Matches[2] -gt 16384) { $l = "$($Matches[1]) = 16384" }
        }
        $l
        if ($l -match '^\s*\[\*\]' -and $Plan.TensorSplit) { "tensor-split = $($Plan.TensorSplit)" }
    }
    ($lines -join "`r`n")
}
