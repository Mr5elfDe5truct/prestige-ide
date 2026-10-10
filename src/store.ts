// Settings and sessions, saved as JSON in the app's data folder (%APPDATA%\com.rgstudios.prestige-ide).
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, StreamStats } from "./backends";

export type PermissionMode = "ask" | "acceptEdits" | "plan" | "bypass";
export type Tier = "deep" | "main" | "fast" | "mini";

export const TIERS: { id: Tier; label: string; hint: string }[] = [
  { id: "deep", label: "Deep", hint: "strongest reasoning, slowest" },
  { id: "main", label: "Main", hint: "everyday agent work" },
  { id: "fast", label: "Fast", hint: "quick edits and questions" },
  { id: "mini", label: "Mini", hint: "titles, summaries, tiny jobs" },
];

export interface Settings {
  ollamaCtx: number;
  swapBackends: boolean;
  tiers: Record<Tier, string>; // model keys (backend:id)
  defaultTier: Tier;
  defaultMode: PermissionMode;
  recentProjects: string[];
  autoCompact: boolean;
  maxTurns: number;
  webTools: boolean;
  userName: string;
  mcpUrl: string; // an mcpo endpoint; each of its MCP servers becomes a group of tools
  mcpEnabled: string[]; // the servers whose tools the agent gets
  think: boolean; // new sessions let the model think first
  subagentTier: Tier | "same"; // the model subagents use: the session's own, or a tier (Fast runs on the second GPU)
  outputStyle: string; // how replies are written (styles-output.ts); new sessions start with it
  trustedConfigs: Record<string, string>; // project settings files the user trusted: lower-cased path -> content hash
}

export const settings: Settings = {
  ollamaCtx: 32768,
  swapBackends: false,
  tiers: {
    deep: "llama:qwen3.8-27b-uncensored",
    main: "llama:qwen3.6-35b-uncensored",
    fast: "ollama:hf.co/LEONW24/Qwen3.5-9B-Uncensored:Q4_K_M",
    mini: "ollama:qwen3.5:4b",
  },
  defaultTier: "main",
  defaultMode: "ask",
  recentProjects: [],
  autoCompact: true,
  maxTurns: 60,
  webTools: true,
  userName: "",
  mcpUrl: "http://127.0.0.1:8200",
  // filesystem, desktop and fetch duplicate the built-in tools, so they start off.
  mcpEnabled: ["workstation", "browser", "time"],
  think: false, // off by default: in the bake-off it scored as well and ran about 3x faster (bench/results-2026-10-09.md)
  subagentTier: "same",
  outputStyle: "default",
  trustedConfigs: {},
};

export async function loadSettings(): Promise<boolean> {
  const raw = await invoke<string | null>("data_read", { rel: "settings.json" });
  if (raw) {
    const s = JSON.parse(raw);
    Object.assign(settings, s, { tiers: { ...settings.tiers, ...(s.tiers ?? {}) } });
    return true;
  }
  return false;
}

export async function saveSettings() {
  await invoke("data_write", { rel: "settings.json", content: JSON.stringify(settings, null, 2) });
}

export function rememberProject(path: string) {
  settings.recentProjects = [path, ...settings.recentProjects.filter((p) => p !== path)].slice(0, 12);
  void saveSettings();
}

/** What a tool call did, kept beside its result so the transcript can show it again after a restart. */
export interface ToolMeta {
  ok: boolean;
  denied?: boolean;
  ms?: number;
  path?: string;
  before?: string | null; // file text before an edit (null: the file was new)
  after?: string;
}

export interface StoredMessage extends ChatMessage {
  thinking?: string;
  stats?: StreamStats;
  meta?: ToolMeta;
  modelName?: string;
  archived?: boolean | number; // compacted away: shown, but not sent to the model (the number is the summary's `at`)
  summary?: boolean; // the summary that replaced archived messages
  hook?: boolean; // added by a hook, not typed by the user
  at?: number;
}

export interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface Session {
  id: string;
  title: string;
  project: string;
  created: number;
  updated: number;
  modelKey: string;
  mode: PermissionMode;
  messages: StoredMessage[];
  todos: Todo[];
  allow: string[]; // "run_command:npm test", "edit:*" … approved for the rest of the session
  pinned?: boolean;
  think?: boolean; // false: ask the model not to think first (faster); unset: the model's default
  outputStyle?: string;
}

export interface SessionStub {
  id: string;
  title: string;
  project: string;
  updated: number;
  pinned?: boolean;
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function listSessions(): Promise<SessionStub[]> {
  const raw = await invoke<string | null>("data_read", { rel: "sessions/index.json" });
  return raw ? JSON.parse(raw) : [];
}

async function writeIndex(list: SessionStub[]) {
  await invoke("data_write", { rel: "sessions/index.json", content: JSON.stringify(list) });
}

export async function loadSession(id: string): Promise<Session | null> {
  const raw = await invoke<string | null>("data_read", { rel: `sessions/${id}.json` });
  return raw ? JSON.parse(raw) : null;
}

let saveChain: Promise<void> = Promise.resolve();
/** Saves a session and its line in the index. Saves run one after another so the index never loses a write. */
export function saveSession(s: Session): Promise<void> {
  s.updated = Date.now();
  const snapshot = JSON.stringify(s);
  saveChain = saveChain.then(async () => {
    await invoke("data_write", { rel: `sessions/${s.id}.json`, content: snapshot });
    const list = (await listSessions()).filter((x) => x.id !== s.id);
    list.unshift({ id: s.id, title: s.title, project: s.project, updated: s.updated, pinned: s.pinned });
    await writeIndex(list);
  }).catch((e) => console.error("save failed", e));
  return saveChain;
}

export async function deleteSession(id: string) {
  await saveChain;
  await invoke("data_delete", { rel: `sessions/${id}.json` });
  await writeIndex((await listSessions()).filter((x) => x.id !== id));
}
