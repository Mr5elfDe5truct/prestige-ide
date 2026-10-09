// Settings files: permission rules and hooks, like Claude Code's settings.json.
//   %USERPROFILE%\.prestige\settings.json      yours, every project
//   <project>\.prestige\settings.json          the project's, shared in git
//   <project>\.prestige\settings.local.json    yours, this project only (keep it out of git)
// A project file can loosen permissions (allow rules) and run commands (hooks), so it only takes effect once the
// user has trusted that exact content. Deny rules always apply: they can only make things safer.
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { relPath, resolvePath } from "./tools";
import { saveSettings, settings } from "./store";

export type HookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop";
export const HOOK_EVENTS: HookEvent[] = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"];

export interface Hook {
  matcher?: string; // regex on the tool name (tool events only); empty or "*" matches every tool
  command: string; // PowerShell, run in the project folder
  timeout?: number; // seconds (default 60)
  source: string; // the file it came from, for messages
}

export interface FileConfig {
  permissions?: { allow?: string[]; deny?: string[] };
  hooks?: Partial<Record<HookEvent, { matcher?: string; command: string; timeout?: number }[]>>;
}

export interface LoadedFile {
  path: string;
  scope: "user" | "project" | "local";
  ok: boolean;
  error?: string;
  trusted: boolean; // user files are always trusted
  needsTrust: boolean; // it loosens something and hasn't been trusted yet
  config: FileConfig;
  hash: string;
}

export interface Effective {
  allow: string[];
  deny: string[];
  hooks: Record<HookEvent, Hook[]>;
  files: LoadedFile[];
}

let current: Effective = { allow: [], deny: [], hooks: { PreToolUse: [], PostToolUse: [], UserPromptSubmit: [], Stop: [] }, files: [] };
export const config = () => current;

async function hash(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

const loosens = (c: FileConfig) => !!(c.permissions?.allow?.length || Object.values(c.hooks ?? {}).some((l) => l?.length));

export async function loadConfig(project: string): Promise<Effective> {
  const home = (await homeDir()).replace(/\\/g, "/").replace(/\/$/, "");
  const candidates: { path: string; scope: LoadedFile["scope"] }[] = [{ path: `${home}/.prestige/settings.json`, scope: "user" }];
  if (project) {
    candidates.push({ path: `${project}/.prestige/settings.json`, scope: "project" });
    candidates.push({ path: `${project}/.prestige/settings.local.json`, scope: "local" });
  }
  const files: LoadedFile[] = [];
  for (const c of candidates) {
    if (!(await invoke<boolean>("fs_exists", { path: c.path }).catch(() => false))) continue;
    let text = "";
    try {
      text = await invoke<string>("fs_read", { path: c.path });
      const cfg = JSON.parse(text) as FileConfig;
      const h = await hash(text);
      const trusted = c.scope === "user" || settings.trustedConfigs[c.path.toLowerCase()] === h;
      files.push({ ...c, ok: true, config: cfg, hash: h, trusted, needsTrust: !trusted && loosens(cfg) });
    } catch (e) {
      files.push({ ...c, ok: false, error: String(e), config: {}, hash: "", trusted: false, needsTrust: false });
    }
  }
  const eff: Effective = { allow: [], deny: [], hooks: { PreToolUse: [], PostToolUse: [], UserPromptSubmit: [], Stop: [] }, files };
  for (const f of files) {
    if (!f.ok) continue;
    eff.deny.push(...(f.config.permissions?.deny ?? []));
    if (!f.trusted) continue;
    eff.allow.push(...(f.config.permissions?.allow ?? []));
    for (const ev of HOOK_EVENTS) for (const hk of f.config.hooks?.[ev] ?? []) if (hk?.command) eff.hooks[ev].push({ ...hk, source: f.path });
  }
  current = eff;
  return eff;
}

export async function trust(f: LoadedFile) {
  settings.trustedConfigs[f.path.toLowerCase()] = f.hash;
  await saveSettings();
}

// ---- rules: "tool" or "tool(pattern)"; * in a tool name matches anything (browser__*)

function globRe(glob: string, pathLike: boolean): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += pathLike ? "[^/]*" : ".*";
    } else if (c === "?") re += pathLike ? "[^/]" : ".";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

const PATH_TOOLS = new Set(["read_file", "write_file", "edit_file", "list_dir"]);

function ruleMatches(rule: string, name: string, args: any, root: string): boolean {
  const m = rule.trim().match(/^([\w*.-]+)(?:\((.*)\))?$/);
  if (!m) return false;
  if (!globRe(m[1], false).test(name)) return false;
  if (m[2] === undefined || m[2] === "*") return true;
  if (name === "run_command") return globRe(m[2], false).test(String(args?.command ?? "").trim());
  if (PATH_TOOLS.has(name)) return globRe(m[2].replace(/\\/g, "/"), true).test(relPath(root, resolvePath(root, args?.path)));
  return globRe(m[2], false).test(JSON.stringify(args ?? {}));
}

/** What the settings files say about a call: deny wins over allow; undefined means no rule applies. */
export function decide(name: string, args: any, root: string): { decision: "allow" | "deny"; rule: string } | undefined {
  const deny = current.deny.find((r) => ruleMatches(r, name, args, root));
  if (deny) return { decision: "deny", rule: deny };
  // An allowed command prefix mustn't let a chained "; something else" ride along.
  if (name === "run_command" && /[;&|`]|\$\(/.test(String(args?.command ?? ""))) return undefined;
  const allow = current.allow.find((r) => ruleMatches(r, name, args, root));
  return allow ? { decision: "allow", rule: allow } : undefined;
}

export const TEMPLATE = `{
  "permissions": {
    "allow": ["run_command(npm test*)", "run_command(git status*)", "run_command(git diff*)"],
    "deny": ["run_command(git push*)", "write_file(.env*)", "edit_file(.env*)"]
  },
  "hooks": {
    "PostToolUse": [
      { "matcher": "edit_file|write_file", "command": "Write-Output \\"edited $env:PRESTIGE_FILE\\"" }
    ]
  }
}
`;
