# Model bake-off

Twelve coding tasks taken from Prestige and the Custom AI Workstation, run through Prestige IDE's real agent loop on
local models and graded automatically.

| Kind | Tasks |
|---|---|
| Bug fixes (seeded into real code) | `t01` clip cutter (Python), `t02` streamed emote tags (TypeScript), `t03` time estimates (TypeScript), `t04` llama.cpp ini (PowerShell) |
| Features (written to a spec) | `t05` segment merging (Python), `t06` image fitting (TypeScript), `t07` small-card context cap (PowerShell), `t12` command line (Python) |
| Codebase questions | `t08`–`t10`, answered from the real repos in Plan mode and graded on exact facts |
| Refactor | `t11` rename across files, still type-checking |

- `fixture/` the project each code task starts from (`bench.py prepare` seeds the task's bug into a fresh copy)
- `hidden/` the grading tests; they're copied in only after the model has finished
- `bench.py validate` proves every hidden test fails on the unsolved task and passes on a reference fix
- `run.mjs` drives a dev build over the WebView's debugging port (the `src/bench.ts` hook, dev builds only)
- `report.py` turns `results.jsonl` into a Markdown report

```powershell
cd bench\fixture; npm install; cd ..\..
python bench\bench.py validate
$env:BENCH_REPOS = "<folder with prestige\ and custom-ai-workstation\>"
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"; npm run tauri dev   # in another terminal
node bench\run.mjs ..\bakeoff-results main-think main-fast hauhau-27b neocoder-27b huihui-27b
python bench\report.py ..\bakeoff-results > ..\bakeoff-results\report.md
```
