// Settings: which local model each tier uses, context, permissions and the agent's limits.
import { settings, TIERS, type PermissionMode, type Tier } from "../store";
import type { ModelInfo } from "../backends";
import { h } from "./transcript";
import { discover } from "../mcp";
import { homeDir } from "@tauri-apps/api/path";
import type { LoadedFile } from "../config";

export function openSettings(
  dlg: HTMLDialogElement,
  models: ModelInfo[],
  onSave: () => Promise<void>,
  cfg: { project: string; files: () => LoadedFile[]; open: (path: string) => void },
) {
  dlg.innerHTML = "";
  const form = h("form", "settings-form");
  form.method = "dialog";
  form.append(h("h2", "", "Settings"));

  form.append(h("h3", "", "Model tiers"));
  form.append(h("p", "hint", "Each tier is a local model. New sessions start on the default tier; switch per session from the model chip. 🔓 marks uncensored models."));
  const selects: Partial<Record<Tier, HTMLSelectElement>> = {};
  for (const t of TIERS) {
    const row = h("label", "row");
    row.append(h("span", "row-label", `${t.label}`), h("span", "row-hint", t.hint));
    const sel = h("select") as HTMLSelectElement;
    const cur = settings.tiers[t.id];
    if (cur && !models.some((m) => m.key === cur)) sel.append(new Option(`${cur} (not found)`, cur));
    for (const m of models) sel.append(new Option(`${m.uncensored ? "🔓 " : ""}${m.name} — ${m.detail}`, m.key));
    sel.value = cur;
    selects[t.id] = sel;
    row.append(sel);
    form.append(row);
  }
  const defTier = h("select") as HTMLSelectElement;
  for (const t of TIERS) defTier.append(new Option(t.label, t.id));
  defTier.value = settings.defaultTier;
  form.append(labelled("Default tier for new sessions", "", defTier));

  form.append(h("h3", "", "Agent"));
  const mode = h("select") as HTMLSelectElement;
  for (const [v, l] of [
    ["ask", "Ask before edits"],
    ["acceptEdits", "Accept edits"],
    ["plan", "Plan mode"],
    ["bypass", "Bypass permissions"],
  ])
    mode.append(new Option(l, v));
  mode.value = settings.defaultMode;
  form.append(labelled("Default permission mode", "", mode));
  const subTier = h("select") as HTMLSelectElement;
  subTier.append(new Option("Same as the session", "same"));
  for (const t of TIERS) subTier.append(new Option(t.label, t.id));
  subTier.value = settings.subagentTier;
  form.append(labelled("Subagent model", "Fast runs on the second GPU, so it doesn't swap out the main model; the session's model is smarter", subTier));
  const turns = num(settings.maxTurns, 5, 500);
  form.append(labelled("Steps per request", "most model turns before it stops and asks to continue", turns));
  const auto = check(settings.autoCompact);
  form.append(labelled("Auto-compact", "summarise the conversation when it nears the model's context", auto));
  const web = check(settings.webTools);
  form.append(labelled("Web search and fetch", "through the Workstation's tool server (:8200); only searches leave the PC", web));

  form.append(h("h3", "", "MCP tools"));
  form.append(
    h("p", "hint", "MCP servers on an mcpo endpoint (the Workstation's is :8200; add servers with its tool store or mcpo-config.json). Each server you tick gives the agent its tools. Read-only ones run freely; the rest ask first. Fewer tools means faster, more accurate local models."),
  );
  const mcpUrl = h("input") as HTMLInputElement;
  mcpUrl.value = settings.mcpUrl;
  form.append(labelled("Endpoint", "", mcpUrl));
  const mcpList = h("div", "mcp-list", "Looking for servers…");
  form.append(mcpList);
  const mcpChecks = new Map<string, HTMLInputElement>();
  const loadMcp = async () => {
    const prev = settings.mcpUrl;
    settings.mcpUrl = mcpUrl.value.trim() || prev;
    const { servers, tools } = await discover(true);
    settings.mcpUrl = prev;
    mcpList.innerHTML = "";
    mcpChecks.clear();
    if (!servers.length) mcpList.textContent = "No servers found at this endpoint.";
    for (const sv of servers) {
      const box = check(settings.mcpEnabled.includes(sv.id));
      box.disabled = !!sv.error;
      if (!sv.error) mcpChecks.set(sv.id, box);
      const ro = tools.filter((t) => t.server === sv.id && t.readOnly).length;
      const hint = sv.error ? `not reachable: ${sv.error}` : `${sv.tools} tools · ${ro} read-only`;
      mcpList.append(labelled(sv.id, hint, box));
    }
  };
  mcpUrl.onchange = () => void loadMcp();
  void loadMcp();

  form.append(h("h3", "", "Permission rules and hooks"));
  form.append(
    h("p", "hint", 'Settings files hold "allow" and "deny" rules (e.g. run_command(npm test*), edit_file(src/**), browser__*) and hooks: PowerShell that runs on PreToolUse, PostToolUse, UserPromptSubmit and Stop. Exit code 2 from a hook blocks and its output says why. Deny rules always apply; a project file\'s allow rules and hooks wait until you trust it.'),
  );
  const fileList = h("div", "mcp-list");
  const loaded = cfg.files();
  for (const f of loaded) {
    const state = !f.ok ? `invalid JSON: ${f.error}` : f.needsTrust ? "not trusted yet: only its deny rules apply" : "active";
    const b = h("button", "btn small", "Open") as HTMLButtonElement;
    b.type = "button";
    b.onclick = () => cfg.open(f.path);
    fileList.append(labelled(`${f.scope}: ${f.path}`, state, b));
  }
  if (!loaded.length) fileList.append(h("p", "hint", "No settings files yet."));
  form.append(fileList);
  const newBar = h("div", "dialog-bar left");
  const mk = (label: string, path: () => Promise<string>) => {
    const b = h("button", "btn small", label) as HTMLButtonElement;
    b.type = "button";
    b.onclick = async () => cfg.open(await path());
    newBar.append(b);
  };
  mk("Your settings file", async () => `${(await homeDir()).replace(/\\/g, "/").replace(/\/$/, "")}/.prestige/settings.json`);
  if (cfg.project) {
    mk("Project settings (shared)", async () => `${cfg.project}/.prestige/settings.json`);
    mk("Project settings (just you)", async () => `${cfg.project}/.prestige/settings.local.json`);
  }
  form.append(newBar);

  form.append(h("h3", "", "Models"));
  const ctx = num(settings.ollamaCtx, 2048, 262144);
  form.append(labelled("Ollama context (tokens)", "llama.cpp models use the context the router gives them", ctx));
  const swap = check(settings.swapBackends);
  form.append(labelled("Free VRAM when switching servers", "unload Ollama before a llama.cpp model and back. Turn on with one GPU", swap));

  const bar = h("div", "dialog-bar");
  const cancel = h("button", "btn", "Cancel");
  cancel.type = "button";
  cancel.onclick = () => dlg.close();
  const save = h("button", "btn primary", "Save");
  save.type = "submit";
  bar.append(cancel, save);
  form.append(bar);
  form.onsubmit = async (e) => {
    e.preventDefault();
    for (const t of TIERS) settings.tiers[t.id] = selects[t.id]!.value;
    settings.defaultTier = defTier.value as Tier;
    settings.defaultMode = mode.value as PermissionMode;
    settings.maxTurns = Number(turns.value) || 60;
    settings.subagentTier = subTier.value as Tier | "same";
    settings.autoCompact = auto.checked;
    settings.webTools = web.checked;
    settings.ollamaCtx = Number(ctx.value) || 32768;
    settings.swapBackends = swap.checked;
    settings.mcpUrl = mcpUrl.value.trim() || settings.mcpUrl;
    if (mcpChecks.size) settings.mcpEnabled = [...mcpChecks].filter(([, b]) => b.checked).map(([id]) => id);
    await discover(true);
    await onSave();
    dlg.close();
  };
  dlg.append(form);
  dlg.showModal();
}

function labelled(label: string, hint: string, control: HTMLElement) {
  const row = h("label", "row");
  row.append(h("span", "row-label", label));
  if (hint) row.append(h("span", "row-hint", hint));
  row.append(control);
  return row;
}

function num(v: number, min: number, max: number) {
  const i = h("input") as HTMLInputElement;
  i.type = "number";
  i.min = String(min);
  i.max = String(max);
  i.value = String(v);
  return i;
}

function check(v: boolean) {
  const i = h("input") as HTMLInputElement;
  i.type = "checkbox";
  i.checked = v;
  return i;
}
