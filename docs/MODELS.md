# Models for Prestige IDE

A sweep of Hugging Face (October 2026) for uncensored local models that fit the reference PC
(RTX 3060 12 GB + RTX 2060 6 GB, 32 GB RAM) and can drive an agent with tool calls.

## Opus, Sonnet, Haiku and Fable

Anthropic's Claude models (Opus, Sonnet, Haiku, Fable) are **not open-weight**. Their weights have never been
published, so there is no local or "uncensored" copy of them, and any download claiming to be one is fake or
malware. What *does* exist:

- **Claude-distilled fine-tunes**: open models (Qwen, Gemma, Llama, gpt-oss) trained on text Claude wrote, e.g.
  `DavidAU/Qwen3.6-40B-Claude-4.6-Opus-Deckard-Heretic-…` or
  `mradermacher/Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled-heretic-…`. They imitate the style; they are not Claude.
- **"Fable" in DavidAU's model names** (e.g. *Qwen3.8-27B-TURBO-Fable-Cold-Fusion*) is DavidAU's own merge naming,
  unrelated to Anthropic's Fable.

Prestige IDE uses its own **tiers** instead: Deep, Main, Fast and Mini, each mapped to a local model in Settings.

## Recommended tiers for this PC

| Tier | Model | Where | Size | Notes |
|---|---|---|---|---|
| **Deep** | Qwen3.8 27B Uncensored HauhauCS Aggressive Q2_K_P (installed) | llama.cpp, 3060 | 10.9 GB | strongest reasoner that fits 12 GB whole; ~30 tok/s with MTP |
| **Main** | Qwen3.6 35B-A3B Heretic Q4_K_M (installed) | llama.cpp, 3060 + RAM | 21 GB | MoE, ~25–30 tok/s, reliable tool calls. Tested in Prestige IDE: read → edit → run → verify |
| **Fast** | Qwen3.5 9B Uncensored Q4_K_M (installed) | Ollama, 2060 | 6.7 GB | runs beside Main on the second card |
| **Mini** | Qwen3.5 4B (installed) | Ollama, 2060 | 3.4 GB | session titles and summaries |

## Worth trying (not installed)

| Model | Repo | Quant / size | Why |
|---|---|---|---|
| Qwen3.8 27B NEO-CODER Heretic (coding fine-tune) | `DavidAU/Qwen3.8-27B-TURBO-Fable-Cold-Fusion-735-882-Heretic-Uncensored-NEO-CODER-MAX-MTP-GGUF` | IQ3_M 14.5 GB (MTP) | uncensored 27B tuned for code. Needs the 3060 + 2060 together (`-2gpu` style preset, like your `qwen3.8-27b-uncensored-2gpu`) |
| Qwen3.8 27B Uncensored Cyber agentic | `cyjin-yl/Qwen3.8-27B-Uncensored-Cyber-agentic-imatrix-GGUF` | IQ4_XS 16.1 GB | tuned for agentic tool use; 2 GPUs |
| Qwen3.8 27B abliterated (huihui) | `huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF` | pick ≤ Q3 for 12 GB | most-downloaded abliteration of the 27B; a second opinion beside HauhauCS |
| Qwen3.6 35B-A3B Uncensored HauhauCS | `HauhauCS/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive` | Q4_K_M ~21 GB | same base as your Main, a different uncensoring; MoE so it runs from RAM like Heretic |
| Qwen3.8 9B Heretic | `mradermacher/Qwen3.8-9B-heretic-uncensored-GGUF` | Q4_K_M 5.6 GB | newer base than the installed 3.5 9B for the Fast tier; fits the 2060 |
| Gemma 4 12B Heretic abliterated | `culturerevolt/gemma-4-12b-heretic-abliterated-GGUF` | ~7 GB | vision + uncensored alternative for the 3060 |

Too big for this PC: Qwen3.8-Flash-Next (130 GB+ even at IQ3), DeepSeek V4 Flash, GLM-5.3 Flash, Qwen3.5 122B.

Download sizes, licenses and quality vary by uploader. Check each model card before downloading.
Abliterated or uncensored models have their refusals removed, so what they write is your responsibility.

## Adding a model

- **Ollama:** `ollama pull hf.co/<repo>:<quant>`, e.g. `ollama pull hf.co/mradermacher/Qwen3.8-9B-heretic-uncensored-GGUF:Q4_K_M`
- **llama.cpp router:** put the GGUF in `Workstation\models\gguf` and add a section to `bin\llama-models.ini`
  (copy the `qwen3.8-27b-uncensored` block), then restart the Workstation.

Prestige IDE lists every model both servers report. Map them to tiers in **Settings**.
