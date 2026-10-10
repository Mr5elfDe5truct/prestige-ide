<p align="center">
  <img src="docs/screenshot.png" alt="Prestige IDE fixing a bug with a local model: tool cards, a diff, and the Changes pane" width="100%">
</p>

<h1 align="center">Prestige IDE</h1>

<p align="center">
  <b>An agentic coding IDE that runs on your own models.</b><br>
  Ask it to build, fix or explain. It reads your code, edits files, runs PowerShell and checks its work,<br>
  all on your PC through the <a href="https://github.com/Mr5elfDe5truct/custom-ai-workstation">Custom AI Workstation</a>. No accounts, no cloud, no API keys.
</p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-d9a441?style=for-the-badge">
  <img alt="Windows 11" src="https://img.shields.io/badge/Windows%2011-native-0078D4?style=for-the-badge&logo=windows11&logoColor=white">
  <img alt="100% local" src="https://img.shields.io/badge/100%25%20local-offline-1a1111?style=for-the-badge&labelColor=d6202b">
  <br>
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white">
  <img alt="Rust" src="https://img.shields.io/badge/Rust-native-CE422B?style=flat-square&logo=rust&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-UI-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Monaco" src="https://img.shields.io/badge/Monaco-editor-0f0a0a?style=flat-square">
  <img alt="Ollama" src="https://img.shields.io/badge/Ollama-models-0f0a0a?style=flat-square&logo=ollama">
  <img alt="llama.cpp" src="https://img.shields.io/badge/llama.cpp-router-0f0a0a?style=flat-square">
</p>

---

## 🧭 What it does

| | Feature | How |
|---|---|---|
| 🤖 | **Agent loop** | The model calls tools (read, write, edit, list, glob, grep, run PowerShell, todo list, web search and fetch), sees the results and keeps going until the job is done, then says what it changed and how it checked it |
| 🛡️ | **Permission modes** | **Ask before edits** (default), **Accept edits**, **Plan mode** (read-only, ends with a plan you approve) and **Bypass**. Switch with **Shift+Tab**. Every edit and command shows first, with a diff; answer **1** yes, **2** yes and don't ask again for this command or for edits, **3** no, or type what to do instead |
| 🧾 | **Tool cards with diffs** | Each step is a card: edits show a unified diff with line numbers and +/− counts, commands show their output live as it runs, failures open themselves |
| 🔀 | **Changes pane** | Every file the session touched, diffed against how it was before the session (Monaco's diff editor, side by side or inline), with **Revert** |
| 📝 | **Files pane** | Folder tree (respects .gitignore) and Monaco editor tabs: syntax colouring, minimap, Ctrl+S to save. Files the agent changes reload on their own unless you have unsaved edits. Right-click a file to @-mention it |
| 💻 | **Terminal** | Real PowerShell terminals (ConPTY + xterm.js) in tabs, opened in the project folder |
| 🗂️ | **Sessions** | Every conversation saved on your PC, titled by the Mini model, grouped by date, searchable, pinnable, and resumable with its diffs and tool cards |
| 🎚️ | **Model tiers** | **Deep**, **Main**, **Fast** and **Mini**, each mapped to any Ollama or llama.cpp model in Settings; switch per session from the model chip. 🔓 marks uncensored models |
| 📎 | **@-mentions** | `@src/main.ts` attaches a file, `@src/main.ts:10-40` a range, `@src/` a folder listing, with autocomplete |
| ⌨️ | **Slash commands** | `/init` writes a PRESTIGE.md for the project · `/compact` summarises to free context · `/review` reviews uncommitted changes · `/commit` · `/pr` · `/plan` · `/rewind` · `/model` · `/style` · `/schedule` · `/clear` · `/help`, plus your own in `.prestige/commands/*.md` (`$ARGUMENTS` is replaced) |
| 📚 | **Project instructions** | `PRESTIGE.md`, `CLAUDE.md`, `AGENTS.md` or `.github/copilot-instructions.md` in the project root go into every prompt, with the git branch and status |
| 🧠 | **Context that lasts** | A context meter on the composer; at 80% the conversation is summarised automatically and the work carries on |
| 🧵 | **Message queue** | Type while it works: your message waits its turn. **Esc** stops, **↑** brings back your last message |
| 🔌 | **MCP tools** | Every MCP server on an mcpo endpoint (the Workstation's `:8200`: workstation scout, Playwright browser, time, files, desktop, and anything added from Prestige's tool store) becomes agent tools, switched per server in Settings. Read-only tools run freely; the rest ask first, with "don't ask again" per tool |
| ↺ | **Checkpoints and rewind** | Every message is a checkpoint. Hover it and **Rewind** (or `/rewind`) to put back every file the agent changed since, as it was then, drop the later turns and edit the message. It tells you which commands ran since, because their effects can't be undone |
| 🖼️ | **Pictures** | Paste, drop or attach screenshots and mockups for vision models (Qwen3.6 35B, Qwen3.8 27B and the other llama.cpp models here read them); resized to 1568 px |
| ✻ | **Thinking on/off** | Per session from the composer. Off answers straight away: the same bug fix took 40 s instead of about 2½ minutes on Qwen3.6 35B |
| 🤝 | **Subagents** | The `task` tool hands a research job to a helper with a fresh context and read-only tools; only its report comes back, so the main conversation stays small. Runs on the session's model, or a tier you pick (Fast runs on the second GPU) |
| ⎇ | **Git** | A branch chip in the header with changed files and ahead/behind. Switch or create branches, pull (fast-forward only), push, `/commit`, `/pr` (opens a pull request with `gh`), and **New session in a worktree** for parallel work on its own branch |
| 📜 | **Settings files and hooks** | `.prestige/settings.json` (see below) holds allow/deny rules and hooks that run PowerShell around the agent |
| 🌐 | **Preview** | A Preview tab shows the app you're building from its dev server; **Start dev server** guesses the command (npm/pnpm/yarn `dev`, Django, a static page), runs it in a terminal and picks up its address. The agent's `preview_page` tool screenshots the page with headless Edge or Chrome and reads its console errors, so a vision model can check its own UI changes (local addresses only) |
| 📓 | **Notebooks** | `.ipynb` files read as numbered cells with their outputs, and `notebook_edit` replaces, inserts or deletes one cell while keeping the file valid |
| ⏰ | **Scheduled runs** | Agent jobs on a timetable while the app is open (daily at a time, or every few hours), like Prestige's Missions: nightly tests, a dependency check, a morning summary. Unattended runs decline anything that would ask (your settings-file allow rules still apply), and each result is saved as a session with a notification. The clock button or `/schedule` |
| 🎨 | **Output styles** | `/style`: Default, Terse, Explanatory, or Learning (it leaves small `TODO(you)` pieces for you to write), plus your own in `.prestige/output-styles/*.md` |
| 🛡️ | **Guarded reads and fetches** | Reading outside the project asks first, and fetching a web page asks once per site, so a repo with hidden instructions can't quietly send your files out |
| 🎩 | **Works with Prestige** | **Start** brings up the Workstation when its models aren't running; Prestige leaves the stack running while the IDE is open, and opens the IDE from its top bar |
| 🧩 | **Text tool-call fallback** | Models that write `<tool_call>`, `<function=…>` or a bare tool name with `<param>` tags into their reply instead of the tool field still work |

## 📜 Settings files and hooks

Three files, merged in this order: `%USERPROFILE%\.prestige\settings.json` (yours, every project),
`<project>\.prestige\settings.json` (the project's, shared in git) and `<project>\.prestige\settings.local.json`
(yours, this project only). Open or create them from **Settings**.

```json
{
  "permissions": {
    "allow": ["run_command(npm test*)", "run_command(git status*)", "edit_file(src/**)"],
    "deny": ["run_command(git push*)", "write_file(.env*)", "edit_file(.env*)"]
  },
  "hooks": {
    "UserPromptSubmit": [{ "command": "Write-Output ('Branch: ' + (git branch --show-current))" }],
    "PreToolUse": [{ "matcher": "run_command", "command": "if ($env:PRESTIGE_COMMAND -match 'Remove-Item') { 'No deleting here.'; exit 2 }" }],
    "PostToolUse": [{ "matcher": "edit_file|write_file", "command": "if ($env:PRESTIGE_FILE -like '*.py') { python -m py_compile $env:PRESTIGE_FILE; if ($LASTEXITCODE) { exit 2 } }" }],
    "Stop": [{ "command": "npm test 2>&1 | Out-Null; if ($LASTEXITCODE) { 'Tests fail: fix them before finishing.'; exit 2 }" }]
  }
}
```

- **Rules** are `tool` or `tool(pattern)`: a command glob for `run_command`, a path glob for file tools, `*` in tool names
  (`browser__*`). Deny beats allow and applies even in Bypass mode; allow skips the prompt. Chained commands
  (`;`, `|`, `&&`) always ask. A path rule only covers the file tools, not a shell command that writes the same file.
- **Hooks** are PowerShell, run in the project folder, with `PRESTIGE_EVENT`, `PRESTIGE_TOOL`, `PRESTIGE_FILE`,
  `PRESTIGE_COMMAND`, `PRESTIGE_PROJECT` and the whole event as JSON in `PRESTIGE_HOOK_INPUT`. Exit 0 carries on
  (PostToolUse output goes to the model, UserPromptSubmit output is added to your message); **exit 2 blocks** and the
  output says why (PreToolUse: the call doesn't run; UserPromptSubmit: the message isn't sent; Stop: the agent keeps
  working, up to 3 times). `matcher` is a regex on the tool name.
- **Trust:** a project file that adds allow rules or hooks does nothing until you trust it (a banner asks), and asks again
  whenever it changes. Its deny rules apply straight away.

## 🖥️ Requirements

- **The [Custom AI Workstation](https://github.com/Mr5elfDe5truct/custom-ai-workstation)** running: Ollama on `:11434`, the
  llama.cpp router on `:8081`, and (for web search) the mcpo tool server on `:8200`. The dots at the bottom of the
  sidebar show which are up.
- A model that can call tools. Tested with **Qwen3.6 35B-A3B Heretic**: read → edit → run → verify, ~29 tok/s on an
  RTX 3060 12 GB once loaded.
- Windows 11 (WebView2 is built in).

See **[docs/MODELS.md](docs/MODELS.md)** for the model sweep: which uncensored models fit 12 GB + 6 GB cards and how
to map them to tiers. (Claude Opus, Sonnet, Haiku and Fable are not open-weight and can't run locally; that page explains
what the "Claude-distilled" fine-tunes on Hugging Face actually are.)

## 🛠️ Build from source

You need [Node.js](https://nodejs.org) LTS, [Rust](https://rustup.rs) (stable, MSVC) and
[Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with **Desktop development with C++**.

```powershell
git clone https://github.com/Mr5elfDe5truct/prestige-ide
cd prestige-ide
npm install
npm run tauri dev     # development window with hot reload
npm run tauri build   # installer in src-tauri\target\release\bundle\nsis\
```

## ⌨️ Keys

| Key | |
|---|---|
| Enter / Shift+Enter | send / new line |
| Shift+Tab | next permission mode |
| Esc | stop the agent |
| ↑ (empty box) | edit your last message |
| Ctrl+N | new session |
| Ctrl+B | sidebar |
| Ctrl+E / Ctrl+D / Ctrl+` | Files / Changes / Terminal |
| Ctrl+S (editor) | save |

## 🏗️ How it's built

| Part | What |
|---|---|
| `src/agent.ts` | the agent loop, system prompt (project instructions, git state), compaction, titles |
| `src/tools.ts` | tool schemas, permission rules and execution |
| `src/backends.ts` | streaming chat with tool calls for Ollama and llama.cpp, shared shape with Prestige |
| `src/config.ts`, `src/hooks.ts` | settings files: allow/deny rules, trust, hooks |
| `src/subagent.ts`, `src/mcp.ts`, `src/rewind.ts`, `src/git.ts` | subagents, MCP tools, checkpoints, the branch chip |
| `src/schedules.ts`, `src/notebook.ts`, `src/styles-output.ts` | scheduled runs, notebooks, output styles |
| `src/ui/` | transcript and tool cards, Files (Monaco), Changes (Monaco diff), Terminal (xterm.js), Preview, settings, schedules |
| `src-tauri/` (Rust + Tauri 2) | file reading, writing, glob and grep with `ignore`/`globset`/`regex`, PowerShell runs with streamed output and stop, ConPTY terminals via `portable-pty`, page screenshots for preview_page, sessions and settings in `%APPDATA%\com.rgstudios.prestige-ide` |
| `test/`, `bench/` | tests against a fake Tauri backend (`npm test`, `cargo test`), and the model bake-off |

## 🔗 Part of the R.G. Studios stack

- **[Custom AI Workstation](https://github.com/Mr5elfDe5truct/custom-ai-workstation)**: the services and models
- **[Prestige](https://github.com/Mr5elfDe5truct/prestige)**: chat, voice, images, video and songs
- **Prestige IDE**: coding

## 📜 License

[MIT](LICENSE) © 2026 Ryan B. Gyles. Designed and built by Ryan B. Gyles · R.G. Studios. The models and apps it
connects to keep their own licenses.
