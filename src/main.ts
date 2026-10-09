// Prestige IDE: sessions, the composer, slash commands, @-mentions, models and modes, and the side panel.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./styles.css";
import "./ui/monaco";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { errMsg, http, listModels, LLAMA, OLLAMA, type ModelInfo } from "./backends";
import { compact, makeTitle, runAgent, type AgentUI } from "./agent";
import {
  deleteSession,
  listSessions,
  loadSession,
  loadSettings,
  newId,
  rememberProject,
  saveSession,
  saveSettings,
  settings,
  TIERS,
  type PermissionMode,
  type Session,
  type SessionStub,
  type StoredMessage,
  type Tier,
  type Todo,
} from "./store";
import { MCPO, relPath, resolvePath } from "./tools";
import { assistantBlock, h, toolCard, userBubble } from "./ui/transcript";
import { FilesPane } from "./ui/files";
import { ChangesPane, sessionChanges } from "./ui/changes";
import { TerminalPane } from "./ui/terminal";
import { openSettings } from "./ui/settings";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const transcript = $("transcript");
const input = $<HTMLTextAreaElement>("input");
const sendBtn = $<HTMLButtonElement>("send");
const statusEl = $("status");
const popup = $("popup");

let models: ModelInfo[] = [];
let session: Session | null = null;
let project = "";
let running: AbortController | null = null;
let queue: string[] = [];
let stubs: SessionStub[] = [];

const MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: "ask", label: "Ask before edits", hint: "asks before changing files or running commands" },
  { id: "acceptEdits", label: "Accept edits", hint: "edits files freely; asks before commands" },
  { id: "plan", label: "Plan mode", hint: "reads and plans only; changes nothing" },
  { id: "bypass", label: "Bypass permissions", hint: "never asks. Use in a folder you can restore" },
];

// ---------- status

let statusTimer = 0;
function status(text: string, sticky = false) {
  statusEl.textContent = text;
  clearTimeout(statusTimer);
  if (text && !sticky) statusTimer = window.setTimeout(() => (statusEl.textContent = running ? "Working…" : ""), 4000);
}

async function checkBackends() {
  const el = $("backend-status");
  const ping = async (url: string) => {
    try {
      const c = new AbortController();
      setTimeout(() => c.abort(), 2000);
      return (await http(url, { signal: c.signal })).status < 500;
    } catch {
      return false;
    }
  };
  const [o, l, t] = await Promise.all([ping(`${OLLAMA}/api/version`), ping(`${LLAMA}/models`), ping(`${MCPO}/openapi.json`)]);
  el.innerHTML = "";
  for (const [name, ok, hint] of [
    ["Ollama", o, ":11434"],
    ["llama.cpp", l, ":8081"],
    ["Tools", t, ":8200 (web search)"],
  ] as const) {
    const s = h("span", `svc ${ok ? "up" : "down"}`, name);
    s.title = `${name} ${hint}: ${ok ? "running" : "not reachable. Start the Workstation (start-all.ps1)"}`;
    el.append(s);
  }
}

// ---------- models

async function refreshModels() {
  try {
    models = (await listModels()).models;
  } catch {
    models = [];
  }
  drawModelChip();
}

function modelFor(key: string | undefined): ModelInfo | undefined {
  return models.find((m) => m.key === key);
}

function currentModel(): ModelInfo | undefined {
  return modelFor(session?.modelKey) ?? modelFor(pendingModel) ?? modelFor(settings.tiers[settings.defaultTier]) ?? models[0];
}

function tierOf(key: string): Tier | undefined {
  return TIERS.find((t) => settings.tiers[t.id] === key)?.id;
}

function drawModelChip() {
  const m = currentModel();
  const t = m && tierOf(m.key);
  $("model-btn").innerHTML = "";
  $("model-btn").append(h("span", "chip-k", t ? TIERS.find((x) => x.id === t)!.label : "Model"), h("span", "", m ? m.name : "no models found"));
  drawCtx();
}

function drawCtx() {
  const m = currentModel();
  const last = [...(session?.messages ?? [])].reverse().find((x) => x.stats?.promptTokens);
  const used = last?.stats?.promptTokens ?? 0;
  const el = $("ctx-meter");
  if (!m || !used) {
    el.textContent = "";
    return;
  }
  const pct = Math.min(100, Math.round((used / m.ctx) * 100));
  el.textContent = `${pct}% context`;
  el.title = `${used.toLocaleString()} of ${m.ctx.toLocaleString()} tokens. /compact to summarise and free space.`;
  el.className = `ctx-meter ${pct > 80 ? "hot" : pct > 60 ? "warm" : ""}`;
}

function showMenu(anchor: HTMLElement, items: ({ label: string; sub?: string; on?: boolean; action: () => void } | "sep" | string)[]) {
  const menu = $("menu");
  menu.innerHTML = "";
  for (const it of items) {
    if (it === "sep") menu.append(h("div", "menu-sep"));
    else if (typeof it === "string") menu.append(h("div", "menu-head", it));
    else {
      const row = h("button", `menu-item ${it.on ? "on" : ""}`);
      row.append(h("span", "menu-label", it.label));
      if (it.sub) row.append(h("span", "menu-sub", it.sub));
      row.onclick = () => {
        menu.hidden = true;
        it.action();
      };
      menu.append(row);
    }
  }
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const mh = menu.offsetHeight;
  menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = r.top - mh - 6 > 8 ? `${r.top - mh - 6}px` : `${r.bottom + 6}px`;
  setTimeout(() => document.addEventListener("mousedown", function off(e) {
    if (!menu.contains(e.target as Node)) {
      menu.hidden = true;
      document.removeEventListener("mousedown", off);
    }
  }), 0);
}

$("model-btn").onclick = async () => {
  await refreshModels();
  const cur = currentModel()?.key;
  const pick = (key: string) => {
    if (session) {
      session.modelKey = key;
      void saveSession(session);
    }
    pendingModel = key;
    drawModelChip();
  };
  const items: Parameters<typeof showMenu>[1] = ["Tiers"];
  for (const t of TIERS) {
    const m = modelFor(settings.tiers[t.id]);
    items.push({ label: `${t.label} · ${m?.name ?? "not set"}`, sub: t.hint, on: m?.key === cur, action: () => m && pick(m.key) });
  }
  items.push("sep", "All models");
  for (const m of models) items.push({ label: (m.uncensored ? "🔓 " : "") + m.name, sub: m.detail, on: m.key === cur, action: () => pick(m.key) });
  if (!models.length) items.push({ label: "No models found", sub: "Start the Workstation, then try again", action: () => {} });
  showMenu($("model-btn"), items);
};
let pendingModel = "";

// ---------- modes

function drawMode() {
  const mode = session?.mode ?? settings.defaultMode;
  const m = MODES.find((x) => x.id === mode)!;
  const b = $("mode-btn");
  b.textContent = m.label;
  b.className = `chip-btn mode-${mode}`;
  b.title = `${m.hint} (Shift+Tab to switch)`;
}

function setMode(mode: PermissionMode) {
  if (session) {
    session.mode = mode;
    void saveSession(session);
  } else settings.defaultMode = mode;
  drawMode();
}

$("mode-btn").onclick = () =>
  showMenu(
    $("mode-btn"),
    MODES.map((m) => ({ label: m.label, sub: m.hint, on: (session?.mode ?? settings.defaultMode) === m.id, action: () => setMode(m.id) })),
  );

// ---------- sessions

function relTime(t: number) {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)}d`;
  return new Date(t).toLocaleDateString();
}

async function drawSessions() {
  stubs = await listSessions();
  const list = $("session-list");
  const q = $<HTMLInputElement>("session-search").value.trim().toLowerCase();
  list.innerHTML = "";
  const shown = stubs
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.project.toLowerCase().includes(q))
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated);
  let group = "";
  for (const s of shown) {
    const g = s.pinned ? "Pinned" : Date.now() - s.updated < 86400000 ? "Today" : Date.now() - s.updated < 86400000 * 7 ? "This week" : "Older";
    if (g !== group) {
      group = g;
      list.append(h("div", "session-group", g));
    }
    const row = h("div", `session-row ${session?.id === s.id ? "active" : ""}`);
    const title = h("div", "session-title", s.title || "Untitled");
    const sub = h("div", "session-sub", `${s.project.split(/[\\/]/).filter(Boolean).pop() ?? ""} · ${relTime(s.updated)}`);
    row.append(title, sub);
    row.title = `${s.title}\n${s.project}`;
    row.onclick = () => void openSession(s.id);
    row.oncontextmenu = (e) => {
      e.preventDefault();
      showMenu(row, [
        { label: s.pinned ? "Unpin" : "Pin", action: () => void patchSession(s.id, (x) => (x.pinned = !x.pinned)) },
        {
          label: "Rename",
          action: () => {
            const t = prompt("Session name", s.title);
            if (t?.trim()) void patchSession(s.id, (x) => (x.title = t.trim()));
          },
        },
        { label: "Open folder in Explorer", action: () => void invoke("reveal", { path: s.project }) },
        "sep",
        {
          label: "Delete",
          action: async () => {
            if (!confirm(`Delete “${s.title}”? This can't be undone.`)) return;
            await deleteSession(s.id);
            if (session?.id === s.id) newSession();
            void drawSessions();
          },
        },
      ]);
    };
    list.append(row);
  }
  if (!shown.length) list.append(h("div", "session-none", q ? "No matches" : "No sessions yet"));
}
$("session-search").oninput = () => void drawSessions();

async function patchSession(id: string, fn: (s: Session) => void) {
  const s = session?.id === id ? session : await loadSession(id);
  if (!s) return;
  fn(s);
  await saveSession(s);
  if (session?.id === id) drawHeader();
  void drawSessions();
}

async function openSession(id: string) {
  if (running) {
    status("Stop the current task first (Esc)");
    return;
  }
  const s = await loadSession(id);
  if (!s) return;
  session = s;
  await setProject(s.project, false);
  drawAll();
}

function newSession() {
  if (running) {
    status("Stop the current task first (Esc)");
    return;
  }
  session = null;
  queue = [];
  drawAll();
  input.focus();
}

function ensureSession(): Session {
  if (session) return session;
  session = {
    id: newId(),
    title: "",
    project,
    created: Date.now(),
    updated: Date.now(),
    modelKey: pendingModel || currentModel()?.key || "",
    mode: settings.defaultMode,
    messages: [],
    todos: [],
    allow: [],
  };
  changes.setSession(session);
  return session;
}

$("new-session").onclick = () => newSession();

// ---------- project

async function setProject(path: string, remember = true) {
  project = path.replace(/\\/g, "/").replace(/\/$/, "");
  $("project-name").textContent = project.split("/").filter(Boolean).pop() ?? project;
  $("project-name").title = project;
  if (remember) rememberProject(project);
  terminal.cwd = project;
  await files.setProject(project);
}

async function pickFolder(): Promise<string | null> {
  const p = await openDialog({ directory: true, multiple: false, title: "Choose a project folder" });
  return typeof p === "string" ? p : null;
}

$("project-btn").onclick = () => {
  const items: Parameters<typeof showMenu>[1] = [
    {
      label: "Open folder…",
      action: async () => {
        const p = await pickFolder();
        if (p) {
          await setProject(p);
          newSession();
        }
      },
    },
  ];
  if (settings.recentProjects.length) items.push("sep", "Recent");
  for (const p of settings.recentProjects)
    items.push({
      label: p.split("/").filter(Boolean).pop() ?? p,
      sub: p,
      on: p === project,
      action: async () => {
        await setProject(p);
        newSession();
      },
    });
  showMenu($("project-btn"), items);
};

// ---------- drawing the conversation

let stick = true;
transcript.addEventListener("scroll", () => {
  stick = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
});
const scroll = () => {
  if (stick) transcript.scrollTop = transcript.scrollHeight;
};

function openPath(p: string, line?: number) {
  if (!project) return;
  showPane("files");
  void files.openFile(resolvePath(project, p), line);
}

function drawAll() {
  drawHeader();
  drawMode();
  drawModelChip();
  drawTranscript();
  drawTodos(session?.todos ?? []);
  changes.setSession(session);
  drawChangesCount();
  void drawSessions();
  $("plan-bar").hidden = true;
}

function drawHeader() {
  $("chat-title").textContent = session?.title || "New session";
  $("chat-sub").textContent = project || "No project folder";
}

function drawTranscript() {
  transcript.innerHTML = "";
  const msgs = session?.messages ?? [];
  $("welcome").hidden = msgs.length > 0;
  if (!msgs.length) drawWelcome();
  const calls = new Map<string, any>();
  for (const m of msgs) {
    if (m.role === "user") transcript.append(userBubble(m));
    else if (m.role === "assistant") {
      if (m.content || m.thinking) transcript.append(assistantBlock(m, openPath, scroll).el);
      for (const c of m.tool_calls ?? []) calls.set(c.id, c);
    } else if (m.role === "tool") {
      const call = calls.get(m.tool_call_id ?? "") ?? { id: m.tool_call_id, name: m.tool_name, arguments: {} };
      transcript.append(toolCard(call, m, { root: session!.project, onOpen: (p) => openPath(p), onScroll: scroll }).el);
    }
  }
  stick = true;
  requestAnimationFrame(scroll);
}

function drawWelcome() {
  const w = $("welcome");
  w.innerHTML = "";
  const box = h("div", "welcome-box");
  box.append(h("div", "welcome-mark", "◆"), h("h1", "", project ? `What should we build in ${project.split("/").pop()}?` : "Open a project folder to start"));
  const m = currentModel();
  box.append(h("p", "welcome-sub", m ? `${m.name} · runs on this PC` : "No local models found. Start the Workstation (start-all.ps1)."));
  if (!project) {
    const b = h("button", "btn primary", "Open folder…");
    b.onclick = async () => {
      const p = await pickFolder();
      if (p) {
        await setProject(p);
        drawAll();
      }
    };
    box.append(b);
  } else {
    const ideas = h("div", "ideas");
    for (const [t, p] of [
      ["Explain this codebase", "Give me an overview of this codebase: what it does, how it's structured, and where the main entry points are."],
      ["Write PRESTIGE.md", "/init"],
      ["Find and fix a bug", "Look for likely bugs in this project, show me the most serious one with evidence, and propose a fix."],
      ["Run the tests", "Find out how this project's tests are run, run them, and fix any failures."],
    ]) {
      const b = h("button", "idea", t);
      b.onclick = () => {
        input.value = p;
        void send();
      };
      ideas.append(b);
    }
    box.append(ideas);
  }
  w.append(box);
}

function drawTodos(todos: Todo[]) {
  const el = $("todos");
  el.innerHTML = "";
  el.hidden = !todos.length || todos.every((t) => t.status === "completed");
  if (el.hidden) return;
  const done = todos.filter((t) => t.status === "completed").length;
  el.append(h("div", "todos-head", `Tasks · ${done}/${todos.length}`));
  for (const t of todos) {
    const row = h("div", `todo ${t.status}`);
    row.append(h("span", "todo-box", t.status === "completed" ? "✓" : t.status === "in_progress" ? "◐" : ""), h("span", "", t.content));
    el.append(row);
  }
}

function drawChangesCount() {
  const n = sessionChanges(session).length;
  $("changes-count").textContent = n ? String(n) : "";
}

// ---------- the composer

function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 260) + "px";
}
input.addEventListener("input", () => {
  autosize();
  void updatePopup();
});

function setRunning(on: boolean) {
  sendBtn.classList.toggle("stop", on);
  sendBtn.textContent = on ? "■" : "↑";
  sendBtn.title = on ? "Stop (Esc)" : "Send (Enter)";
  if (!on) status("");
  else status("Working…", true);
}

sendBtn.onclick = () => {
  if (running && !input.value.trim()) stop();
  else void send();
};

function stop() {
  running?.abort();
  transcript.querySelectorAll<HTMLElement>(".tool.asking").forEach((c) => (c as any)._cancel?.());
}

const SLASH: { cmd: string; hint: string }[] = [
  { cmd: "/init", hint: "write a PRESTIGE.md with this project's commands and conventions" },
  { cmd: "/compact", hint: "summarise the conversation to free context (add a focus)" },
  { cmd: "/clear", hint: "start a new session in this project" },
  { cmd: "/plan", hint: "switch to Plan mode" },
  { cmd: "/model", hint: "pick a model" },
  { cmd: "/review", hint: "review the uncommitted changes for bugs" },
  { cmd: "/commit", hint: "write a commit message and commit the changes" },
  { cmd: "/help", hint: "what Prestige IDE can do" },
];

let popupItems: { label: string; sub: string; apply: () => void }[] = [];
let popupSel = 0;
let fileCache: { root: string; at: number; files: string[] } | null = null;

async function projectFiles(): Promise<string[]> {
  if (fileCache && fileCache.root === project && Date.now() - fileCache.at < 15000) return fileCache.files;
  const files = await invoke<string[]>("fs_glob", { root: project, pattern: "**/*", limit: 5000 }).catch(() => []);
  fileCache = { root: project, at: Date.now(), files: files.map((f) => relPath(project, f)) };
  return fileCache.files;
}

async function customCommands(): Promise<{ cmd: string; hint: string; path: string }[]> {
  if (!project) return [];
  const list = await invoke<string[]>("fs_glob", { root: `${project}/.prestige/commands`, pattern: "*.md", limit: 100 }).catch(() => []);
  return list.map((p) => ({ cmd: "/" + p.split("/").pop()!.replace(/\.md$/, ""), hint: "project command", path: p }));
}

async function updatePopup() {
  const v = input.value;
  const caret = input.selectionStart ?? v.length;
  const before = v.slice(0, caret);
  popupItems = [];
  const slash = v.match(/^\/(\S*)$/);
  const at = before.match(/(^|\s)@([^\s@]*)$/);
  if (slash) {
    const q = slash[1].toLowerCase();
    const all = [...SLASH, ...(await customCommands())];
    popupItems = all
      .filter((c) => c.cmd.slice(1).toLowerCase().startsWith(q))
      .map((c) => ({
        label: c.cmd,
        sub: c.hint,
        apply: () => {
          input.value = c.cmd + " ";
          autosize();
        },
      }));
  } else if (at && project) {
    const q = at[2].toLowerCase();
    const files = await projectFiles();
    const scored = files
      .map((f) => {
        const fl = f.toLowerCase();
        const base = fl.split("/").pop()!;
        const score = !q ? 1 : base.startsWith(q) ? 3 : base.includes(q) ? 2 : fl.includes(q) ? 1 : 0;
        return { f, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.f.length - b.f.length)
      .slice(0, 12);
    popupItems = scored.map(({ f }) => ({
      label: f.split("/").pop()!,
      sub: f,
      apply: () => {
        const start = caret - at[2].length;
        input.value = v.slice(0, start) + f + " " + v.slice(caret);
        input.selectionStart = input.selectionEnd = start + f.length + 1;
        autosize();
      },
    }));
  }
  popupSel = 0;
  drawPopup();
}

function drawPopup() {
  popup.innerHTML = "";
  popup.hidden = !popupItems.length;
  popupItems.forEach((it, i) => {
    const row = h("div", `popup-row ${i === popupSel ? "sel" : ""}`);
    row.append(h("span", "popup-label", it.label), h("span", "popup-sub", it.sub));
    row.onmousedown = (e) => {
      e.preventDefault();
      it.apply();
      popupItems = [];
      drawPopup();
      input.focus();
    };
    popup.append(row);
  });
  popup.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
}

input.addEventListener("keydown", (e) => {
  if (!popup.hidden && popupItems.length) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      popupSel = (popupSel + (e.key === "ArrowDown" ? 1 : -1) + popupItems.length) % popupItems.length;
      drawPopup();
      e.preventDefault();
      return;
    }
    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
      popupItems[popupSel].apply();
      popupItems = [];
      drawPopup();
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      popupItems = [];
      drawPopup();
      e.preventDefault();
      return;
    }
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void send();
  } else if (e.key === "Escape" && running) {
    e.preventDefault();
    stop();
  } else if (e.key === "Tab" && e.shiftKey) {
    e.preventDefault();
    const i = MODES.findIndex((m) => m.id === (session?.mode ?? settings.defaultMode));
    setMode(MODES[(i + 1) % MODES.length].id);
  } else if (e.key === "ArrowUp" && !input.value) {
    const last = [...(session?.messages ?? [])].reverse().find((m) => m.role === "user" && !m.summary);
    if (last) {
      input.value = last.content.replace(/\n\n<attached-files>[\s\S]*$/, "");
      autosize();
      e.preventDefault();
    }
  }
});

/** @path mentions: attach the files' contents (or a line range) to the message. */
async function withMentions(text: string): Promise<string> {
  const found = [...text.matchAll(/(?:^|\s)@([^\s@]+)/g)].map((m) => m[1]);
  const parts: string[] = [];
  for (const raw of [...new Set(found)]) {
    const m = raw.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/)!;
    const path = resolvePath(project, m[1]);
    try {
      if (path.endsWith("/")) {
        const list = await invoke<{ name: string; is_dir: boolean }[]>("fs_list", { path });
        parts.push(`<file path="${m[1]}">\n${list.map((e) => e.name + (e.is_dir ? "/" : "")).join("\n")}\n</file>`);
        continue;
      }
      let t = await invoke<string>("fs_read", { path });
      if (m[2]) {
        const lines = t.split(/\r?\n/);
        t = lines.slice(Number(m[2]) - 1, Number(m[3] ?? m[2])).join("\n");
      }
      parts.push(`<file path="${m[1]}">\n${t.slice(0, 60000)}\n</file>`);
    } catch {
      // not a file: leave the @word as it is
    }
  }
  return parts.length ? `${text}\n\n<attached-files>\n${parts.join("\n")}\n</attached-files>` : text;
}

async function send() {
  let text = input.value.trim();
  if (!text) return;
  if (!project) {
    const p = await pickFolder();
    if (!p) return;
    await setProject(p);
  }
  if (running) {
    queue.push(text);
    input.value = "";
    autosize();
    drawQueue();
    return;
  }
  input.value = "";
  autosize();
  popupItems = [];
  drawPopup();

  // Slash commands
  const [cmd, ...rest] = text.split(/\s+/);
  const arg = text.slice(cmd.length).trim();
  if (cmd.startsWith("/")) {
    switch (cmd) {
      case "/clear":
        newSession();
        return;
      case "/help":
        showHelp();
        return;
      case "/plan":
        setMode("plan");
        if (!arg) return;
        text = arg;
        break;
      case "/model":
        $("model-btn").click();
        return;
      case "/compact": {
        const s = session;
        const m = currentModel();
        if (!s || !m) return;
        running = new AbortController();
        setRunning(true);
        status("Compacting…", true);
        try {
          await compact(s, m, arg, running.signal);
          await saveSession(s);
          drawTranscript();
          drawCtx();
          status("Compacted");
        } catch (e) {
          status(`Couldn't compact: ${errMsg(e)}`);
        } finally {
          running = null;
          setRunning(false);
        }
        return;
      }
      case "/init":
        text =
          "Analyse this codebase and write a PRESTIGE.md file at the project root for future coding sessions. Include: how to build, run, lint and test (including running a single test); the high-level architecture and how the main parts fit together (the things you only learn by reading several files); and the project's conventions. Be concise and specific; don't list every file or invent anything you didn't see. If PRESTIGE.md, CLAUDE.md, AGENTS.md or README.md already exist, read them first and improve on them." +
          (arg ? `\n\nAlso: ${arg}` : "");
        break;
      case "/review":
        text = `Review the uncommitted changes in this repository (git diff, including staged). Look for real bugs: logic errors, edge cases, crashes, security problems, and broken behaviour. For each finding give the file:line, what goes wrong and when, and a suggested fix. Skip style nits. ${arg}`;
        break;
      case "/commit":
        text = `Look at git status and git diff, then stage the relevant changes and commit them with a clear, conventional commit message that explains why. Don't push. ${arg}`;
        break;
      default: {
        const custom = (await customCommands()).find((c) => c.cmd === cmd);
        if (custom) {
          text = (await invoke<string>("fs_read", { path: custom.path })).replace(/\$ARGUMENTS/g, rest.join(" "));
        }
      }
    }
  }

  const model = currentModel();
  if (!model) {
    status("No models: start the Workstation, then pick a model");
    await refreshModels();
    return;
  }
  const s = ensureSession();
  if (!s.modelKey) s.modelKey = model.key;
  const firstPrompt = !s.messages.length;
  const content = await withMentions(text);
  const userMsg: StoredMessage = { role: "user", content, at: Date.now() };
  s.messages.push(userMsg);
  $("welcome").hidden = true;
  transcript.append(userBubble(userMsg));
  stick = true;
  scroll();
  $("plan-bar").hidden = true;
  if (firstPrompt) {
    s.title = text.replace(/\s+/g, " ").slice(0, 48);
    drawHeader();
    const mini = modelFor(settings.tiers.mini);
    void makeTitle(mini, text).then((t) => {
      if (s.title === text.replace(/\s+/g, " ").slice(0, 48)) {
        s.title = t;
        if (session === s) drawHeader();
        void saveSession(s).then(drawSessions);
      }
    });
  }
  await saveSession(s);
  void drawSessions();
  await run(s, model);
}

async function run(s: Session, model: ModelInfo) {
  running = new AbortController();
  setRunning(true);
  const calls = new Map<string, ReturnType<typeof toolCard>>();
  const ui: AgentUI = {
    assistant(msg) {
      const b = assistantBlock(msg, openPath, scroll);
      transcript.append(b.el);
      scroll();
      return b.view;
    },
    tool(call, msg) {
      const c = toolCard(call, msg, { root: s.project, onOpen: (p) => openPath(p), onScroll: scroll });
      calls.set(call.id, c);
      transcript.append(c.el);
      scroll();
      return c.view;
    },
    approve(call) {
      notifyIfHidden("Prestige IDE needs your approval");
      return calls.get(call.id)!.ask();
    },
    todos(t) {
      drawTodos(t);
    },
    fileChanged(path) {
      void files.fileChanged(path);
      fileCache = null;
      drawChangesCount();
      changes.setSession(s);
    },
    status(t) {
      status(t || "Working…", true);
    },
    save() {
      void saveSession(s);
      drawCtx();
    },
  };
  try {
    await runAgent(s, model, ui, running.signal);
  } catch (e) {
    const err = h("div", "turn error");
    err.textContent = `Error: ${errMsg(e)}${errMsg(e) === "not reachable" ? ` — is ${model.backend === "llama" ? "llama.cpp (:8081)" : "Ollama (:11434)"} running? Start the Workstation.` : ""}`;
    transcript.append(err);
    scroll();
  } finally {
    running = null;
    setRunning(false);
    await saveSession(s);
    void drawSessions();
    drawCtx();
    drawTodos(s.todos);
    void files.refresh();
    notifyIfHidden("Prestige IDE finished");
  }
  if (s.mode === "plan" && session === s) $("plan-bar").hidden = false;
  if (queue.length && session === s) {
    input.value = queue.shift()!;
    drawQueue();
    void send();
  }
}

function drawQueue() {
  const q = $("queue");
  q.hidden = !queue.length;
  q.innerHTML = "";
  queue.forEach((t, i) => {
    const row = h("div", "queued");
    row.append(h("span", "queued-k", "Queued"), h("span", "queued-t", t));
    const x = h("button", "tab-x", "×");
    x.onclick = () => {
      queue.splice(i, 1);
      drawQueue();
    };
    row.append(x);
    q.append(row);
  });
}

function approvePlan(mode: PermissionMode) {
  setMode(mode);
  $("plan-bar").hidden = true;
  input.value = "The plan is approved. Go ahead and implement it.";
  void send();
}
$("plan-approve").onclick = () => approvePlan("acceptEdits");
$("plan-approve-ask").onclick = () => approvePlan("ask");
$("plan-keep").onclick = () => {
  $("plan-bar").hidden = true;
  input.focus();
};

function notifyIfHidden(text: string) {
  if (document.hasFocus()) return;
  try {
    if (Notification.permission === "granted") new Notification(text);
    else if (Notification.permission !== "denied") void Notification.requestPermission();
  } catch {
    // notifications unavailable
  }
}

function showHelp() {
  const m: StoredMessage = {
    role: "assistant",
    modelName: "Prestige IDE",
    content: `**Prestige IDE** runs an agent on your own models: it reads, searches and edits your files, runs PowerShell, and checks its work.

| | |
|---|---|
| **Enter** / **Shift+Enter** | send / new line |
| **@file** | attach a file (\`@src/main.ts:10-40\` for lines, \`@src/\` for a folder listing) |
| **/** | commands: ${SLASH.map((s) => `\`${s.cmd}\``).join(" ")}, plus \`.prestige/commands/*.md\` in your project |
| **Shift+Tab** | switch mode: Ask before edits → Accept edits → Plan → Bypass |
| **Esc** | stop the agent |
| **↑** | edit your last message |
| **Ctrl+N / Ctrl+B / Ctrl+E / Ctrl+D / Ctrl+\`** | new session / sidebar / files / changes / terminal |

Project instructions are read from \`PRESTIGE.md\`, \`CLAUDE.md\` or \`AGENTS.md\` in the project root. Tiers (Deep, Main, Fast, Mini) map to your models in Settings.`,
  };
  transcript.append(assistantBlock(m, openPath, scroll).el);
  $("welcome").hidden = true;
  scroll();
}

// ---------- the side panel

const files = new FilesPane({
  mention: (rel) => {
    input.value = (input.value ? input.value.replace(/\s*$/, " ") : "") + "@" + rel + " ";
    autosize();
    input.focus();
  },
  status: (t) => status(t),
});
const changes = new ChangesPane({
  open: (p) => openPath(p),
  changed: (p) => void files.fileChanged(p),
  status: (t) => status(t),
});
const terminal = new TerminalPane();
const panes: Record<string, { el: HTMLElement; shown?: () => void }> = {
  files: { el: files.el, shown: () => files.layout() },
  changes: { el: changes.el, shown: () => void changes.render() },
  terminal: { el: terminal.el, shown: () => terminal.ensure() },
};
for (const p of Object.values(panes)) {
  p.el.hidden = true;
  $("panel-body").append(p.el);
}
let activePane = "";

function showPane(name: string, toggle = false) {
  const panel = $("panel");
  if (toggle && activePane === name && !panel.hidden) {
    panel.hidden = true;
    $("splitter").hidden = true;
    activePane = "";
  } else {
    panel.hidden = false;
    $("splitter").hidden = false;
    activePane = name;
    for (const [k, p] of Object.entries(panes)) p.el.hidden = k !== name;
    panes[name].shown?.();
  }
  document.querySelectorAll<HTMLElement>(".pane-btn, .panel-tab").forEach((b) => b.classList.toggle("active", b.dataset.pane === activePane));
}
document.querySelectorAll<HTMLElement>(".pane-btn").forEach((b) => (b.onclick = () => showPane(b.dataset.pane!, true)));
document.querySelectorAll<HTMLElement>(".panel-tab").forEach((b) => (b.onclick = () => showPane(b.dataset.pane!)));
$("panel-close").onclick = () => showPane(activePane, true);
$("splitter").hidden = true;

// Drag the splitter to size the panel.
$("splitter").onmousedown = (e) => {
  e.preventDefault();
  const panel = $("panel");
  const startX = e.clientX;
  const startW = panel.offsetWidth;
  document.body.classList.add("dragging");
  const move = (ev: MouseEvent) => {
    const w = Math.max(360, Math.min(innerWidth - 480, startW - (ev.clientX - startX)));
    panel.style.width = `${w}px`;
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    document.body.classList.remove("dragging");
    try {
      localStorage.setItem("panelWidth", panel.style.width);
    } catch {
      // storage unavailable
    }
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
};
try {
  const w = localStorage.getItem("panelWidth");
  if (w) $("panel").style.width = w;
} catch {
  // storage unavailable
}

$("toggle-sidebar").onclick = () => document.body.classList.toggle("no-sidebar");
$("settings-btn").onclick = () =>
  openSettings($<HTMLDialogElement>("settings"), models, async () => {
    await saveSettings();
    await refreshModels();
    drawMode();
  });

document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === "n") newSession();
  else if (k === "b") document.body.classList.toggle("no-sidebar");
  else if (k === "e") showPane("files", true);
  else if (k === "d") showPane("changes", true);
  else if (k === "`") showPane("terminal", true);
  else if (k === "l") input.focus();
  else return;
  e.preventDefault();
});

// ---------- start

async function start() {
  const hadSettings = await loadSettings().catch(() => false);
  if (!hadSettings) {
    // First run: two or more cards means the Workstation keeps Ollama and llama.cpp apart, so no swapping.
    settings.swapBackends = (await invoke<number>("gpu_count").catch(() => 1)) < 2;
    await saveSettings();
  }
  await refreshModels();
  void checkBackends();
  setInterval(() => void checkBackends(), 20000);
  if (settings.recentProjects[0]) await setProject(settings.recentProjects[0], false);
  drawAll();
  autosize();
  input.focus();
}
void start();
