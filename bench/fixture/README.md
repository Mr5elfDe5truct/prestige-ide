# Prestige snippets

Pieces of Prestige and the Custom AI Workstation, kept small enough to test on their own.

- `py/transcribe_clips.py`: cutting a diarized recording into clips for speech-to-text
- `ts/emotes.ts`, `ts/chat.ts`: the streamed `[react: …]` tag filter and a reply collector that uses it
- `ts/genmath.ts`: image sizes, frame counts and time estimates for generation
- `ps/llamaini.ps1`: turning bin\llama-models.ini into the runtime copy for a GPU plan

## Tests

- Python: `python -m unittest discover -s py -p "test_*.py"`
- TypeScript: `npm test` (Node's test runner) and `npm run typecheck`
- PowerShell: `powershell -NoProfile -File ps\test_llamaini.ps1`
