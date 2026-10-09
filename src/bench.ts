// The model bake-off's way in (dev builds only): runs one task through the real agent loop, with no UI, and reports
// what happened. bench/run.mjs drives it over the WebView's debugging port.
import { listModels } from "./backends";
import { runAgent, type AgentUI } from "./agent";
import { loadConfig } from "./config";
import { newId, settings, type PermissionMode, type Session } from "./store";

export interface BenchRun {
  project: string;
  modelKey: string;
  mode: PermissionMode;
  prompt: string;
  think?: boolean;
  timeoutMs?: number;
}

export async function benchRun(r: BenchRun) {
  const { models } = await listModels();
  const model = models.find((m) => m.key === r.modelKey);
  if (!model) return { error: `no model ${r.modelKey}` };
  await loadConfig(r.project);
  const s: Session = {
    id: "bench-" + newId(),
    title: "bench",
    project: r.project.replace(/\\/g, "/"),
    created: Date.now(),
    updated: Date.now(),
    modelKey: model.key,
    mode: r.mode,
    messages: [{ role: "user", content: r.prompt, at: Date.now() }],
    todos: [],
    allow: [],
    think: r.think,
  };
  const ui: AgentUI = {
    assistant: () => ({ text() {}, thinking() {}, stats() {}, end() {} }),
    tool: () => ({ output() {}, end() {} }),
    approve: async () => ({ allow: true }),
    todos() {},
    fileChanged() {},
    status() {},
    save() {},
    subagentModel: () => model,
    note() {},
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), r.timeoutMs ?? 20 * 60000);
  const t0 = performance.now();
  let error = "";
  const maxTurns = settings.maxTurns;
  settings.maxTurns = 40;
  try {
    await runAgent(s, model, ui, ctl.signal);
  } catch (e) {
    error = String(e);
  } finally {
    clearTimeout(timer);
    settings.maxTurns = maxTurns;
  }
  const asst = s.messages.filter((m) => m.role === "assistant");
  const tools = s.messages.filter((m) => m.role === "tool");
  const last = [...asst].reverse().find((m) => m.content && !m.tool_calls?.length) ?? asst[asst.length - 1];
  return {
    model: model.name,
    seconds: Math.round((performance.now() - t0) / 1000),
    timedOut: ctl.signal.aborted,
    error,
    turns: asst.length,
    toolCalls: tools.length,
    toolErrors: tools.filter((m) => m.meta && !m.meta.ok && !m.meta.denied).length,
    tokens: asst.reduce((n, m) => n + (m.stats?.tokens ?? 0), 0),
    maxContext: Math.max(0, ...asst.map((m) => m.stats?.promptTokens ?? 0)),
    final: last?.content ?? "",
    transcript: s.messages.map((m) =>
      m.role === "tool"
        ? `[tool ${m.tool_name}${m.meta?.ok === false ? " FAILED" : ""}] ${m.content.slice(0, 400)}`
        : m.role === "assistant"
          ? `[assistant] ${m.content.slice(0, 1500)}${m.tool_calls?.length ? ` {calls: ${m.tool_calls.map((c) => `${c.name} ${JSON.stringify(c.arguments).slice(0, 200)}`).join("; ")}}` : ""}`
          : `[${m.role}] ${m.content.slice(0, 600)}`,
    ),
  };
}

(window as any).__bench = { run: benchRun };
