# Prestige IDE

Tauri 2 desktop app: TypeScript + Vite front end (`src/`), Rust back end (`src-tauri/`). Windows only for now.

## Commands
- `npm install` then `npm run tauri dev` (dev window, Vite on 127.0.0.1:1430)
- `npx tsc` type-checks the front end; `cargo check` in `src-tauri` checks the Rust side
- `npm run tauri build` builds the NSIS installer in `src-tauri/target/release/bundle/nsis/`

## Architecture
- `src/agent.ts` the agent loop and system prompt; `src/tools.ts` tool schemas, permissions and execution;
  `src/backends.ts` Ollama (:11434) and llama.cpp router (:8081) streaming with tool calls (shared shape with Prestige)
- `src/store.ts` settings and sessions, saved through Rust `data_*` commands in `%APPDATA%\com.rgstudios.prestige-ide`
- `src/main.ts` sessions sidebar, composer, slash commands, @-mentions, side panel wiring
- `src/ui/` transcript rendering, Files (Monaco), Changes (Monaco diff + revert), Terminal (xterm + ConPTY), settings
- `src-tauri/src/fsops.rs` read/write/list/glob/grep (respects .gitignore), `shell.rs` PowerShell runs with streamed
  output and kill, `pty.rs` terminals, `lib.rs` data folder and command registration

## Conventions
- Plain DOM + TypeScript, no framework; build elements with `h()` from `src/ui/transcript.ts`
- Comments explain why, in plain sentences, like the Prestige repo
- Anything that changes files or runs commands goes through `needsApproval` in `tools.ts`
