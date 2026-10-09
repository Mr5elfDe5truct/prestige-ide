// Hooks: PowerShell commands from the settings files that run around the agent's work.
// Each gets PRESTIGE_EVENT, PRESTIGE_PROJECT, PRESTIGE_TOOL, PRESTIGE_FILE, PRESTIGE_COMMAND and the whole event as
// JSON in PRESTIGE_HOOK_INPUT. Exit code 0: carry on (output is passed along where it's useful). Exit code 2: block,
// and the output tells the model (or you) why. Any other code: a warning, then carry on.
import { invoke } from "@tauri-apps/api/core";
import { config, type HookEvent } from "./config";
import { resolvePath } from "./tools";

export interface HookOutcome {
  blocked: boolean; // some hook exited with 2
  output: string; // what the hooks printed (for blocks: the reason)
  warnings: string[];
}

export async function runHooks(event: HookEvent, root: string, data: { tool?: string; args?: any; result?: string; prompt?: string }): Promise<HookOutcome> {
  const hooks = config().hooks[event].filter((hk) => {
    if (!data.tool || !hk.matcher || hk.matcher === "*") return true;
    try {
      return new RegExp(`^(?:${hk.matcher})$`).test(data.tool);
    } catch {
      return hk.matcher === data.tool;
    }
  });
  const out: HookOutcome = { blocked: false, output: "", warnings: [] };
  if (!hooks.length) return out;
  const input = JSON.stringify({
    event,
    project: root,
    tool: data.tool,
    args: data.args,
    result: data.result?.slice(0, 8000),
    prompt: data.prompt?.slice(0, 8000),
  });
  const env: Record<string, string> = {
    PRESTIGE_EVENT: event,
    PRESTIGE_PROJECT: root,
    PRESTIGE_TOOL: data.tool ?? "",
    PRESTIGE_FILE: data.args?.path ? resolvePath(root, data.args.path) : "",
    PRESTIGE_COMMAND: data.tool === "run_command" ? String(data.args?.command ?? "") : "",
    PRESTIGE_HOOK_INPUT: input.slice(0, 30000), // Windows caps environment variables at 32k characters
  };
  for (const hk of hooks) {
    try {
      const r = await invoke<{ output: string; code: number | null; timed_out: boolean }>("run_command", {
        id: "hook-" + Math.random().toString(36).slice(2),
        cwd: root,
        command: hk.command,
        timeoutMs: (hk.timeout ?? 60) * 1000,
        env,
      });
      const text = r.output.trim();
      if (r.timed_out) out.warnings.push(`hook timed out: ${hk.command.slice(0, 80)}`);
      else if (r.code === 2) {
        out.blocked = true;
        out.output += (out.output ? "\n" : "") + (text || "Blocked by a hook.");
        break;
      } else if (r.code !== 0) out.warnings.push(`hook exited ${r.code}: ${hk.command.slice(0, 60)}${text ? ` — ${text.slice(0, 200)}` : ""}`);
      else if (text) out.output += (out.output ? "\n" : "") + text;
    } catch (e) {
      out.warnings.push(`hook failed to start: ${e}`);
    }
  }
  return out;
}
