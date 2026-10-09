// The agent's tools: what the model can call, how each runs, and which ones need the user's say-so.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { errMsg, http } from "./backends";
import { settings, type PermissionMode, type ToolMeta, type Todo } from "./store";
import { callTool, enabledTools, findTool } from "./mcp";

export const MCPO = "http://127.0.0.1:8200";

export type Kind = "read" | "edit" | "exec" | "web" | "meta" | "mcp";

interface ToolSpec {
  name: string;
  kind: Kind;
  description: string;
  parameters: any;
}

const obj = (props: Record<string, any>, required: string[]) => ({ type: "object", properties: props, required });
const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });

export const SPECS: ToolSpec[] = [
  {
    name: "read_file",
    kind: "read",
    description:
      "Read a text file. Returns lines numbered like `cat -n` (the numbers are not part of the file). Reads up to 2000 lines; use offset and limit for longer files. Read a file before editing it.",
    parameters: obj({ path: str("File path, relative to the project or absolute"), offset: num("First line to read (1-based)"), limit: num("How many lines") }, ["path"]),
  },
  {
    name: "write_file",
    kind: "edit",
    description: "Create a file or replace a file's whole contents. Prefer edit_file for changes to an existing file. Parent folders are created.",
    parameters: obj({ path: str("File path"), content: str("The complete new contents") }, ["path", "content"]),
  },
  {
    name: "edit_file",
    kind: "edit",
    description:
      "Replace an exact piece of text in a file. old_string must match the file exactly (whitespace and indentation included, without the line-number prefix from read_file) and be unique unless replace_all is true. Include enough surrounding lines to make it unique.",
    parameters: obj(
      { path: str("File path"), old_string: str("Exact text to replace"), new_string: str("Replacement text"), replace_all: bool("Replace every occurrence") },
      ["path", "old_string", "new_string"],
    ),
  },
  {
    name: "list_dir",
    kind: "read",
    description: "List one folder's files and subfolders.",
    parameters: obj({ path: str("Folder, relative to the project (default: the project root)") }, []),
  },
  {
    name: "glob",
    kind: "read",
    description: 'Find files by name pattern, e.g. "**/*.ts" or "src/**/test_*.py". Respects .gitignore. Newest first.',
    parameters: obj({ pattern: str("Glob pattern"), path: str("Folder to search (default: project root)") }, ["pattern"]),
  },
  {
    name: "grep",
    kind: "read",
    description: "Search file contents with a regular expression (Rust regex syntax). Respects .gitignore. Returns path:line: text.",
    parameters: obj(
      {
        pattern: str("Regular expression"),
        path: str("Folder or file to search (default: project root)"),
        glob: str('Only files matching this glob, e.g. "*.rs"'),
        ignore_case: bool("Case-insensitive"),
        files_only: bool("Return only the matching file paths"),
      },
      ["pattern"],
    ),
  },
  {
    name: "run_command",
    kind: "exec",
    description:
      "Run a PowerShell command in the project folder (Windows). Use it for builds, tests, git, package managers and scripts. Not for reading or searching files (use read_file, glob, grep). Output is returned when it finishes; long-running servers should not be started here.",
    parameters: obj(
      { command: str("The PowerShell command"), description: str("What it does, in a few words"), timeout_ms: num("Timeout in ms (default 120000, max 600000)") },
      ["command"],
    ),
  },
  {
    name: "todo_write",
    kind: "meta",
    description:
      "Keep a task list for multi-step work. Send the whole list each time. Mark one item in_progress while you work on it and completed as soon as it is done.",
    parameters: obj(
      {
        todos: {
          type: "array",
          items: obj({ content: str("The task"), status: { type: "string", enum: ["pending", "in_progress", "completed"] } }, ["content", "status"]),
        },
      },
      ["todos"],
    ),
  },
  {
    name: "web_search",
    kind: "web",
    description: "Search the web (DuckDuckGo). Returns titles, addresses and snippets. Use web_fetch to read a page.",
    parameters: obj({ query: str("Search query") }, ["query"]),
  },
  {
    name: "web_fetch",
    kind: "web",
    description: "Fetch a web page as readable text (Markdown). Good for documentation and error lookups.",
    parameters: obj({ url: str("http(s) address"), start_index: num("Start at this character, to read on after a cut-off page") }, ["url"]),
  },
];

export async function toolSchemas(mode: PermissionMode): Promise<any[]> {
  const builtIn = SPECS.filter((s) => settings.webTools || s.kind !== "web")
    .filter((s) => mode !== "plan" || s.kind === "read" || s.kind === "web")
    .map((s) => ({ type: "function", function: { name: s.name, description: s.description, parameters: s.parameters } }));
  const mcp = (await enabledTools())
    .filter((t) => mode !== "plan" || t.readOnly)
    .map((t) => ({ type: "function", function: { name: t.name, description: `[${t.server}] ${t.description}`, parameters: t.parameters } }));
  return [...builtIn, ...mcp];
}

export function kindOf(name: string): Kind | undefined {
  const spec = SPECS.find((s) => s.name === name);
  if (spec) return spec.kind;
  const t = findTool(name);
  return t ? (t.readOnly ? "read" : "mcp") : undefined;
}

/** The rule an approval adds when the user says "don't ask again" for this call. */
export function allowRuleFor(name: string, args: any): string {
  if (kindOf(name) === "edit") return "edit:*";
  if (name === "run_command") {
    const words = String(args?.command ?? "").trim().split(/\s+/);
    // "npm run build" → "npm run", "git status" → "git status", "cargo test --x" → "cargo test"
    return `run_command:${words.slice(0, 2).join(" ")}`;
  }
  return `${name}:*`;
}

export function needsApproval(name: string, args: any, mode: PermissionMode, allow: string[]): boolean {
  const kind = kindOf(name);
  if (!kind || kind === "read" || kind === "web" || kind === "meta") return false;
  if (mode === "bypass") return false;
  if (kind === "edit" && (mode === "acceptEdits" || allow.includes("edit:*"))) return false;
  if (name === "run_command") {
    const cmd = String(args?.command ?? "").trim();
    // Chained commands always ask: an approved prefix shouldn't let "; rm" ride along.
    if (/[;&|`]|\$\(/.test(cmd)) return true;
    return !allow.some((r) => r.startsWith("run_command:") && cmd.startsWith(r.slice("run_command:".length)));
  }
  return !allow.includes(`${name}:*`);
}

// ---- paths

export function resolvePath(root: string, p: string | undefined): string {
  const raw = (p ?? "").trim().replace(/\\/g, "/");
  if (!raw || raw === ".") return root.replace(/\\/g, "/");
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith("//")) return raw;
  const parts = (root.replace(/\\/g, "/").replace(/\/$/, "") + "/" + raw.replace(/^\.\//, "")).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== ".") out.push(part);
  }
  return out.join("/");
}

export function relPath(root: string, p: string): string {
  const r = root.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  const n = p.replace(/\\/g, "/");
  return n.toLowerCase().startsWith(r.toLowerCase()) ? n.slice(r.length) : n;
}

// ---- running tools

export interface ToolContext {
  root: string;
  signal: AbortSignal;
  onOutput?: (chunk: string) => void; // live command output
  setTodos: (t: Todo[]) => void;
}

export interface ToolResult {
  content: string;
  meta: ToolMeta;
}

const numbered = (text: string, start: number) =>
  text
    .split("\n")
    .map((l, i) => `${String(start + i).padStart(6)}\t${l.length > 2000 ? l.slice(0, 2000) + "…" : l}`)
    .join("\n");

async function readText(path: string): Promise<string | null> {
  if (!(await invoke<boolean>("fs_exists", { path }))) return null;
  return invoke<string>("fs_read", { path });
}

async function mcpo(path: string, body: any, timeoutMs = 60000): Promise<string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await http(`${MCPO}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`tool server answered ${r.status}: ${text.slice(0, 300)}`);
    try {
      const j = JSON.parse(text);
      return typeof j === "string" ? j : Array.isArray(j) ? j.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n") : JSON.stringify(j, null, 1);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(t);
  }
}

/** DuckDuckGo's HTML results: titles, real addresses (from uddg=) and snippets. */
function parseDdg(html: string): string {
  const hits: string[] = [];
  const blocks = html.split(/class="result__body|class="result results_links/).slice(1);
  for (const b of blocks) {
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const enc = a[1].match(/[?&]uddg=([^&]+)/);
    const url = enc ? decodeURIComponent(enc[1]) : a[1];
    if (/duckduckgo\.com\/y\.js|ad_provider/.test(a[1] + url)) continue;
    const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    const snip = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    hits.push(`${hits.length + 1}. ${strip(a[2])}\n   ${url}\n   ${snip ? strip(snip[1]) : ""}`);
    if (hits.length >= 8) break;
  }
  return hits.join("\n");
}

export async function runTool(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
  const t0 = performance.now();
  const done = (content: string, meta: Partial<ToolMeta> = {}): ToolResult => ({ content, meta: { ok: true, ms: performance.now() - t0, ...meta } });
  const fail = (content: string, meta: Partial<ToolMeta> = {}): ToolResult => ({ content: `Error: ${content}`, meta: { ok: false, ms: performance.now() - t0, ...meta } });
  try {
    switch (name) {
      case "read_file": {
        const path = resolvePath(ctx.root, args.path);
        const text = await invoke<string>("fs_read", { path });
        const lines = text.split(/\r?\n/);
        const start = Math.max(1, Number(args.offset) || 1);
        const limit = Math.max(1, Number(args.limit) || 2000);
        const slice = lines.slice(start - 1, start - 1 + limit);
        let out = numbered(slice.join("\n"), start);
        if (start - 1 + limit < lines.length) out += `\n… ${lines.length - (start - 1 + limit)} more lines (use offset ${start + limit})`;
        if (!text.length) out = "(empty file)";
        return done(out, { path });
      }
      case "write_file": {
        const path = resolvePath(ctx.root, args.path);
        const before = await readText(path);
        const content = String(args.content ?? "");
        await invoke("fs_write", { path, content });
        return done(`${before === null ? "Created" : "Wrote"} ${relPath(ctx.root, path)} (${content.split("\n").length} lines)`, { path, before, after: content });
      }
      case "edit_file": {
        const path = resolvePath(ctx.root, args.path);
        const before = await readText(path);
        if (before === null) return fail(`${args.path} does not exist. Use write_file to create it.`);
        let oldS = String(args.old_string ?? "");
        let newS = String(args.new_string ?? "");
        if (!oldS) return fail("old_string is empty. Use write_file to replace a whole file.");
        if (oldS === newS) return fail("old_string and new_string are the same.");
        // Files with Windows line endings: the model writes \n, so match with \r\n.
        if (!before.includes(oldS) && before.includes("\r\n")) {
          const crlf = (s: string) => s.replace(/\r?\n/g, "\r\n");
          if (before.includes(crlf(oldS))) {
            oldS = crlf(oldS);
            newS = crlf(newS);
          }
        }
        const count = before.split(oldS).length - 1;
        if (count === 0) return fail(`old_string was not found in ${args.path}. Read the file again and copy the text exactly (without line-number prefixes).`);
        if (count > 1 && !args.replace_all) return fail(`old_string appears ${count} times in ${args.path}. Add surrounding lines to make it unique, or set replace_all.`);
        const after = args.replace_all ? before.split(oldS).join(newS) : before.replace(oldS, () => newS);
        await invoke("fs_write", { path, content: after });
        return done(`Edited ${relPath(ctx.root, path)}${count > 1 ? ` (${count} places)` : ""}`, { path, before, after });
      }
      case "list_dir": {
        const path = resolvePath(ctx.root, args.path);
        const list = await invoke<{ name: string; is_dir: boolean; size: number }[]>("fs_list", { path });
        if (!list.length) return done("(empty folder)");
        return done(list.map((e) => (e.is_dir ? `${e.name}/` : `${e.name}  (${e.size} B)`)).join("\n"));
      }
      case "glob": {
        const root = resolvePath(ctx.root, args.path);
        const hits = await invoke<string[]>("fs_glob", { root, pattern: String(args.pattern ?? "*"), limit: 200 });
        return done(hits.length ? hits.map((h) => relPath(ctx.root, h)).join("\n") + (hits.length === 200 ? "\n… (first 200)" : "") : "No files found.");
      }
      case "grep": {
        const path = resolvePath(ctx.root, args.path);
        const hits = await invoke<{ path: string; line: number; text: string }[]>("fs_grep", {
          path,
          pattern: String(args.pattern ?? ""),
          glob: args.glob ?? null,
          ignoreCase: !!args.ignore_case,
          limit: args.files_only ? 5000 : 250,
        });
        if (!hits.length) return done("No matches.");
        if (args.files_only) return done([...new Set(hits.map((h) => relPath(ctx.root, h.path)))].join("\n"));
        return done(hits.map((h) => `${relPath(ctx.root, h.path)}:${h.line}: ${h.text}`).join("\n") + (hits.length >= 250 ? "\n… (first 250 matches)" : ""));
      }
      case "run_command": {
        const id = Math.random().toString(36).slice(2);
        const un = await listen<{ data: string }>(`cmd-out-${id}`, (e) => ctx.onOutput?.(e.payload.data));
        const onAbort = () => void invoke("kill_command", { id });
        ctx.signal.addEventListener("abort", onAbort);
        try {
          const r = await invoke<{ output: string; code: number | null; timed_out: boolean; killed: boolean }>("run_command", {
            id,
            cwd: ctx.root,
            command: String(args.command ?? ""),
            timeoutMs: Number(args.timeout_ms) || 120000,
          });
          const out = r.output.trim() || "(no output)";
          if (r.killed) return fail(`${out}\n\n[stopped by the user]`);
          if (r.timed_out) return fail(`${out}\n\n[timed out after ${Math.round((Number(args.timeout_ms) || 120000) / 1000)} s and was stopped]`);
          return r.code === 0 ? done(out) : fail(`${out}\n\n[exit code ${r.code}]`);
        } finally {
          un();
          ctx.signal.removeEventListener("abort", onAbort);
        }
      }
      case "todo_write": {
        const todos: Todo[] = (Array.isArray(args.todos) ? args.todos : []).map((t: any) => ({
          content: String(t.content ?? t.task ?? ""),
          status: ["pending", "in_progress", "completed"].includes(t.status) ? t.status : "pending",
        }));
        ctx.setTodos(todos);
        return done(`Task list updated (${todos.filter((t) => t.status === "completed").length}/${todos.length} done).`);
      }
      case "web_search": {
        const html = await mcpo("/fetch/fetch", { url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(args.query ?? ""))}`, raw: true, max_length: 120000 }, 45000);
        const hits = parseDdg(html);
        return hits ? done(hits) : fail("no results (the search may have been rate-limited; try again in a moment)");
      }
      case "web_fetch": {
        const text = await mcpo("/fetch/fetch", { url: String(args.url ?? ""), max_length: 12000, start_index: Number(args.start_index) || 0 }, 60000);
        return done(text);
      }
      default: {
        const t = findTool(name);
        if (t) {
          const r = await callTool(t, args, ctx.signal);
          return r.ok ? done(r.text) : fail(r.text);
        }
        return fail(`there is no tool called "${name}". Available: ${SPECS.map((s) => s.name).join(", ")}`);
      }
    }
  } catch (e) {
    return fail(errMsg(e) === "not reachable" && kindOf(name) === "web" ? "the Workstation tool server (:8200) is not running" : errMsg(e));
  }
}

/** A short label for a call, e.g. `Read src/main.ts` or `Run npm test`. */
export function describeCall(root: string, name: string, args: any): { verb: string; target: string } {
  const p = (x: any) => relPath(root, resolvePath(root, x));
  switch (name) {
    case "read_file":
      return { verb: "Read", target: p(args.path) + (args.offset ? ` (from line ${args.offset})` : "") };
    case "write_file":
      return { verb: "Write", target: p(args.path) };
    case "edit_file":
      return { verb: "Edit", target: p(args.path) };
    case "list_dir":
      return { verb: "List", target: p(args.path || ".") };
    case "glob":
      return { verb: "Glob", target: String(args.pattern ?? "") };
    case "grep":
      return { verb: "Grep", target: `"${args.pattern ?? ""}"${args.glob ? ` in ${args.glob}` : ""}` };
    case "run_command":
      return { verb: "Run", target: String(args.command ?? "") };
    case "todo_write":
      return { verb: "Update todos", target: "" };
    case "web_search":
      return { verb: "Search", target: String(args.query ?? "") };
    case "web_fetch":
      return { verb: "Fetch", target: String(args.url ?? "") };
    default: {
      const t = findTool(name);
      if (t) return { verb: `${t.server} · ${t.op}`, target: JSON.stringify(args ?? {}).slice(0, 100) };
      return { verb: name, target: JSON.stringify(args).slice(0, 80) };
    }
  }
}
