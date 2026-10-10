// The agent loop: send the conversation, stream the reply, run the tools it asks for (asking first where needed),
// feed the results back, and repeat until the model answers without calling a tool.
import { invoke } from "@tauri-apps/api/core";
import { complete, errMsg, extractTextToolCalls, streamChat, type ChatMessage, type ModelInfo, type StreamStats, type ToolCall } from "./backends";
import { settings, type Session, type StoredMessage, type Todo, type ToolMeta } from "./store";
import { allowRuleFor, needsApproval, runTool, toolSchemas } from "./tools";
import { runSubagent } from "./subagent";
import { stylePrompt } from "./styles-output";
import { decide } from "./config";
import { runHooks } from "./hooks";

export type Approval = { allow: true; always?: boolean } | { allow: false; feedback?: string };

export interface AssistantView {
  text(t: string): void;
  thinking(t: string): void;
  stats(s: StreamStats): void;
  end(msg: StoredMessage): void;
}

export interface ToolView {
  output(chunk: string): void;
  end(result: StoredMessage): void;
}

export interface AgentUI {
  assistant(msg: StoredMessage): AssistantView;
  tool(call: ToolCall, msg: StoredMessage): ToolView;
  approve(call: ToolCall): Promise<Approval>;
  todos(t: Todo[]): void;
  fileChanged(path: string, meta: ToolMeta): void;
  status(text: string): void;
  save(): void;
  subagentModel(): ModelInfo; // the model subagents run on
  note(msg: StoredMessage): void; // a message added by a hook
}

const PROJECT_FILES = ["PRESTIGE.md", "CLAUDE.md", "AGENTS.md", ".github/copilot-instructions.md"];

async function projectNotes(root: string): Promise<string> {
  const out: string[] = [];
  for (const f of PROJECT_FILES) {
    const p = `${root.replace(/\\/g, "/")}/${f}`;
    try {
      if (await invoke<boolean>("fs_exists", { path: p })) out.push(`## ${f}\n\n${(await invoke<string>("fs_read", { path: p })).slice(0, 20000)}`);
    } catch {
      // unreadable: skip it
    }
  }
  return out.join("\n\n");
}

async function gitLine(root: string): Promise<string> {
  try {
    const r = await invoke<{ output: string; code: number | null }>("run_command", {
      id: "git-" + Math.random().toString(36).slice(2),
      cwd: root,
      command: "git rev-parse --abbrev-ref HEAD 2>$null; git status --short 2>$null | Select-Object -First 15",
      timeoutMs: 8000,
    });
    if (r.code !== 0 || !r.output.trim()) return "Git: not a git repository.";
    const [branch, ...status] = r.output.trim().split(/\r?\n/);
    return `Git: branch ${branch}.${status.length ? ` Uncommitted changes:\n${status.join("\n")}` : " Working tree clean."}`;
  } catch {
    return "";
  }
}

export async function systemPrompt(s: Session, model: ModelInfo): Promise<string> {
  const [notes, git, replies] = await Promise.all([projectNotes(s.project), gitLine(s.project), stylePrompt(s.outputStyle, s.project)]);
  const planMode =
    s.mode === "plan"
      ? `\n\n# Plan mode is ON\nYou may only read and search: read_file, list_dir, glob, grep (and web tools). Do not try to change files, run commands or keep a todo list. Read only what you need (usually a few files), then stop calling tools and reply with a concise, numbered implementation plan: which files change and what changes in each. The user approves the plan before anything is changed.`
      : "";
  return `You are Prestige, an agentic coding assistant built into Prestige IDE. You run entirely on the user's own PC, on the local model ${model.name}. You help with software engineering: writing code, fixing bugs, refactoring, explaining code, running builds and tests.

# How to work
- Use the tools to look at the real code before answering questions about it or changing it. Never guess file contents.
- Search with glob and grep, then read the relevant files. Prefer edit_file for changes; read a file first so old_string matches exactly.
- Make the change the user asked for, completely, and no more. Match the surrounding code's style, naming and comment density.
- For broad questions that need many files read ("how does X work", "where is Y used"), hand the research to a subagent with the task tool and work from its report. Do small, targeted lookups yourself.
${s.mode === "plan" ? "" : "- For multi-step work, keep a todo list with todo_write and update it as you go.\n"}- After changing code, verify it when you can (build, type-check, run the tests) with run_command, and fix what breaks.
- Don't start long-running servers or interactive programs with run_command; tell the user the command to run instead.
- If something is ambiguous and the choice matters, ask one short question instead of guessing.
- Never invent results. If a command failed or a step was skipped, say so.

# Replies
${replies}

# Environment
- OS: Windows. Shell for run_command: Windows PowerShell 5.1 (use PowerShell syntax; no && chaining, use ; or if ($?) { }).
- Project root (the working directory): ${s.project}
- Relative paths are resolved from the project root.
- Date: ${new Date().toISOString().slice(0, 10)}
${git ? `- ${git}` : ""}${planMode}${notes ? `\n\n# Project instructions\nThe project gives these instructions. Follow them.\n\n${notes}` : ""}`;
}

/** The messages the model sees: the system prompt and every message not compacted away, without UI-only fields. */
function apiMessages(system: string, msgs: StoredMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of msgs) {
    if (m.archived) continue;
    const c: ChatMessage = { role: m.role, content: m.content };
    if (m.images?.length) c.images = m.images;
    if (m.tool_calls?.length) c.tool_calls = m.tool_calls;
    if (m.role === "tool") {
      c.tool_call_id = m.tool_call_id;
      c.tool_name = m.tool_name;
    }
    out.push(c);
  }
  return out;
}

/** Thinking some templates leave inline as <think>…</think>. */
function splitThink(text: string): { text: string; thinking: string } {
  const m = text.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  if (!m) return { text, thinking: "" };
  return { thinking: m[1].trim(), text: text.slice(m[0].length).trim() };
}

export async function compact(s: Session, model: ModelInfo, focus = "", signal?: AbortSignal): Promise<void> {
  const live = s.messages.filter((m) => !m.archived);
  if (live.length < 3) return;
  const transcript = live
    .map((m) => {
      if (m.role === "tool") return `[tool result ${m.tool_name}] ${m.content.slice(0, 1500)}`;
      const calls = m.tool_calls?.map((c) => `[called ${c.name} ${JSON.stringify(c.arguments).slice(0, 300)}]`).join(" ") ?? "";
      return `[${m.role}] ${m.content.slice(0, 4000)} ${calls}`;
    })
    .join("\n\n")
    .slice(-60000);
  const summary = await complete(
    model,
    [
      {
        role: "system",
        content:
          "You summarise a coding session so it can continue with less context. Keep: the user's goals and requests, decisions made, files read and changed (with paths), the current state of the work, errors still open, and the next steps. Be specific and complete; use headings and bullet points.",
      },
      { role: "user", content: `${focus ? `Focus on: ${focus}\n\n` : ""}Session so far:\n\n${transcript}` },
    ],
    signal,
  );
  const at = Date.now();
  for (const m of live) m.archived = at;
  s.messages.push({ role: "user", content: `This session was compacted. Summary of the conversation so far:\n\n${summary}`, summary: true, at });
}

export async function runAgent(s: Session, model: ModelInfo, ui: AgentUI, signal: AbortSignal): Promise<void> {
  const system = await systemPrompt(s, model);
  const tools = await toolSchemas(s.mode);
  const allowed = new Set(tools.map((t) => t.function.name));
  let stopHookRounds = 0;
  for (let turn = 0; turn < settings.maxTurns; turn++) {
    if (signal.aborted) return;
    const msg: StoredMessage = { role: "assistant", content: "", thinking: "", modelName: model.name, at: Date.now() };
    s.messages.push(msg);
    const view = ui.assistant(msg);
    let result: StreamStats & { toolCalls: ToolCall[] };
    try {
      result = await streamChat(
        model,
        apiMessages(system, s.messages.slice(0, -1)),
        {
          onToken: (t) => {
            msg.content += t;
            view.text(t);
          },
          onThinking: (t) => {
            msg.thinking += t;
            view.thinking(t);
          },
          onStats: (st) => view.stats(st),
        },
        signal,
        tools,
        { think: s.think === false ? false : undefined },
      );
    } catch (e) {
      if (signal.aborted) {
        msg.content += msg.content ? "\n\n*[interrupted]*" : "*[interrupted]*";
        view.end(msg);
        ui.save();
        return;
      }
      s.messages.pop();
      view.end({ ...msg, content: `**Error:** ${errMsg(e)}` });
      throw e;
    }
    const st = splitThink(msg.content);
    if (st.thinking) {
      msg.thinking = (msg.thinking ? msg.thinking + "\n" : "") + st.thinking;
      msg.content = st.text;
    }
    let calls = result.toolCalls;
    if (!calls.length) {
      const x = extractTextToolCalls(msg.content, allowed);
      if (x.calls.length) {
        calls = x.calls;
        msg.content = x.text;
      }
    }
    if (calls.length) msg.tool_calls = calls;
    msg.stats = { tokens: result.tokens, tps: result.tps, seconds: result.seconds, promptTokens: result.promptTokens };
    view.end(msg);
    ui.save();
    if (!calls.length) {
      if (stopHookRounds < 3) {
        const st = await runHooks("Stop", s.project, {});
        st.warnings.forEach((w) => ui.status(w));
        if (st.blocked && !signal.aborted) {
          stopHookRounds++;
          const note: StoredMessage = { role: "user", content: `[Stop hook] ${st.output}`, at: Date.now(), hook: true };
          s.messages.push(note);
          ui.note(note);
          ui.save();
          continue;
        }
      }
      return;
    }

    let stop = false;
    for (const call of calls) {
      const tmsg: StoredMessage = { role: "tool", content: "", tool_call_id: call.id, tool_name: call.name, at: Date.now() };
      if (stop) {
        tmsg.content = "Not run: the user stopped the previous step.";
        tmsg.meta = { ok: false, denied: true };
        s.messages.push(tmsg);
        ui.tool(call, tmsg).end(tmsg);
        continue;
      }
      if (s.mode === "plan" && !allowed.has(call.name)) {
        tmsg.content = "Plan mode is on: changing files and running commands is not allowed. Finish investigating and present your plan.";
        tmsg.meta = { ok: false, denied: true };
        s.messages.push(tmsg);
        ui.tool(call, tmsg).end(tmsg);
        continue;
      }
      s.messages.push(tmsg);
      const tv = ui.tool(call, tmsg);
      const rule = decide(call.name, call.arguments, s.project);
      if (rule?.decision === "deny") {
        tmsg.content = `Denied by the rule "${rule.rule}" in the settings files. Don't retry it or work around it (for example with a shell command): tell the user it's blocked and ask how to proceed.`;
        tmsg.meta = { ok: false, denied: true };
        tv.end(tmsg);
        continue;
      }
      const pre = await runHooks("PreToolUse", s.project, { tool: call.name, args: call.arguments });
      pre.warnings.forEach((w) => ui.status(w));
      if (pre.blocked) {
        tmsg.content = `Blocked by a PreToolUse hook: ${pre.output}`;
        tmsg.meta = { ok: false, denied: true };
        tv.end(tmsg);
        continue;
      }
      if (rule?.decision !== "allow" && needsApproval(call.name, call.arguments, s.mode, s.allow, s.project)) {
        const a = await ui.approve(call);
        if (signal.aborted) {
          tmsg.content = "Not run: the user interrupted.";
          tmsg.meta = { ok: false, denied: true };
          tv.end(tmsg);
          ui.save();
          return;
        }
        if (!a.allow) {
          tmsg.content = a.feedback
            ? `The user declined this call and said: ${a.feedback}`
            : "The user declined this call. Don't retry it; stop and wait for their instructions.";
          tmsg.meta = { ok: false, denied: true };
          tv.end(tmsg);
          if (!a.feedback) stop = true;
          continue;
        }
        if (a.always) s.allow.push(allowRuleFor(call.name, call.arguments));
      }
      if (call.name === "task") {
        const sub = ui.subagentModel();
        ui.status(`Subagent working on ${sub.name}…`);
        const out = await runSubagent(s.project, sub, String(call.arguments?.prompt ?? ""), signal, (line) => tv.output(line + "\n"));
        tmsg.content = out.report;
        tmsg.meta = { ok: out.ok };
        tv.end(tmsg);
        ui.save();
        if (signal.aborted) return;
        continue;
      }
      ui.status(`Running ${call.name}…`);
      const r = await runTool(call.name, call.arguments ?? {}, {
        root: s.project,
        signal,
        onOutput: (c) => tv.output(c),
        setTodos: (t) => {
          s.todos = t;
          ui.todos(t);
        },
      });
      tmsg.content = r.content;
      tmsg.meta = r.meta;
      const post = await runHooks("PostToolUse", s.project, { tool: call.name, args: call.arguments, result: r.content });
      post.warnings.forEach((w) => ui.status(w));
      if (post.output) tmsg.content += `\n\n[PostToolUse hook${post.blocked ? " reported a problem" : ""}]\n${post.output}`;
      tv.end(tmsg);
      if (r.meta.path && r.meta.after !== undefined) ui.fileChanged(r.meta.path, r.meta);
      ui.save();
      if (signal.aborted) return;
    }
    ui.status("");
    if (stop) return;

    // Keep the conversation inside the model's context.
    if (settings.autoCompact && result.promptTokens && result.promptTokens > model.ctx * 0.8) {
      ui.status("Compacting the conversation…");
      await compact(s, model, "", signal);
      ui.status("");
      ui.save();
      return runAgent(s, model, ui, signal);
    }
  }
  s.messages.push({ role: "assistant", content: `*Stopped after ${settings.maxTurns} steps. Say "continue" to keep going.*`, at: Date.now() });
  ui.save();
}

export async function makeTitle(model: ModelInfo | undefined, prompt: string): Promise<string> {
  const fallback = prompt.replace(/\s+/g, " ").trim().slice(0, 48);
  if (!model) return fallback;
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 20000);
    const t = await complete(
      model,
      [
        { role: "system", content: "Write a 2 to 6 word title for a coding task. Reply with the title only, no quotes or punctuation at the end." },
        { role: "user", content: prompt.slice(0, 2000) },
      ],
      ctl.signal,
    );
    const line = t.split("\n").find((l) => l.trim())?.replace(/^["'#*\s]+|["'.*\s]+$/g, "") ?? "";
    return line && line.length < 70 ? line : fallback;
  } catch {
    return fallback;
  }
}
