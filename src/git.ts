// Git for the header's branch chip: status, branches, switching, worktrees, pull and push. These are the user's own
// clicks, so they run directly (no approval prompt); anything that could lose work asks in the UI first.
import { invoke } from "@tauri-apps/api/core";

export interface GitStatus {
  repo: boolean;
  branch: string;
  changed: number; // files with uncommitted changes (including untracked)
  ahead: number;
  behind: number;
  upstream: boolean;
  remote: string; // origin's URL, if any
}

export async function git(cwd: string, args: string, timeoutMs = 60000): Promise<{ ok: boolean; out: string }> {
  const r = await invoke<{ output: string; code: number | null }>("run_command", {
    id: "git-" + Math.random().toString(36).slice(2),
    cwd,
    // -c core.quotepath=off keeps non-ASCII paths readable; GIT_TERMINAL_PROMPT=0 stops a hidden credential prompt
    // from hanging the call.
    command: `$env:GIT_TERMINAL_PROMPT='0'; git -c core.quotepath=off ${args}`,
    timeoutMs,
  });
  return { ok: r.code === 0, out: r.output.trim() };
}

export async function status(cwd: string): Promise<GitStatus> {
  const none: GitStatus = { repo: false, branch: "", changed: 0, ahead: 0, behind: 0, upstream: false, remote: "" };
  if (!cwd) return none;
  const s = await git(cwd, "status --porcelain=v2 --branch", 15000);
  if (!s.ok) return none;
  const out: GitStatus = { ...none, repo: true };
  for (const line of s.out.split(/\r?\n/)) {
    if (line.startsWith("# branch.head ")) out.branch = line.slice(14);
    else if (line.startsWith("# branch.upstream ")) out.upstream = true;
    else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) {
        out.ahead = Number(m[1]);
        out.behind = Number(m[2]);
      }
    } else if (line && !line.startsWith("#")) out.changed++;
  }
  if (out.branch === "(detached)") out.branch = "detached HEAD";
  const r = await git(cwd, "remote get-url origin", 10000);
  if (r.ok) out.remote = r.out;
  return out;
}

export async function branches(cwd: string): Promise<{ local: string[]; current: string }> {
  const r = await git(cwd, "branch --format=%(refname:short) --sort=-committerdate", 15000);
  const st = await git(cwd, "branch --show-current", 10000);
  return { local: r.ok ? r.out.split(/\r?\n/).filter(Boolean) : [], current: st.out };
}

/** A safe branch or folder name from what the user typed. */
export function slug(name: string): string {
  return name.trim().replace(/[^\w./-]+/g, "-").replace(/^[-./]+|[-./]+$/g, "").slice(0, 60);
}

export const switchBranch = (cwd: string, b: string) => git(cwd, `switch "${b}"`);
export const createBranch = (cwd: string, b: string) => git(cwd, `switch -c "${b}"`);
export const pull = (cwd: string) => git(cwd, "pull --ff-only", 180000);
export const push = (cwd: string, setUpstream: boolean) => git(cwd, setUpstream ? "push -u origin HEAD" : "push", 180000);

/** A new worktree beside the repo (<repo>-<name>) on a new branch, for working in parallel without touching this one. */
export async function addWorktree(cwd: string, name: string): Promise<{ ok: boolean; out: string; path: string }> {
  const root = (await git(cwd, "rev-parse --show-toplevel", 10000)).out.replace(/\\/g, "/");
  const path = `${root}-${slug(name).replace(/\//g, "-")}`;
  const r = await git(cwd, `worktree add -b "${slug(name)}" "${path}"`, 120000);
  return { ...r, path };
}
