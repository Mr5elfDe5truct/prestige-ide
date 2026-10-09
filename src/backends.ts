// The local model servers: model lists and streaming chat with tool calls, for Ollama and the llama.cpp router.
// Adapted from Prestige's backends.ts so both apps see the Workstation's models the same way.
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { settings } from "./store";

export const OLLAMA = "http://127.0.0.1:11434";
export const LLAMA = "http://127.0.0.1:8081/v1";

const inTauri = "__TAURI_INTERNALS__" in window;
// Requests go through Rust so CORS doesn't apply; Ollama rejects the app's own origin, so present the local one.
const tauriHttp: typeof fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("Origin", "http://127.0.0.1");
  return (tauriFetch as typeof fetch)(input, { ...init, headers });
};
export const http: typeof fetch = inTauri ? tauriHttp : window.fetch.bind(window);

export function errMsg(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  if (/refused|actively refused|error sending request|10061|Failed to fetch|NetworkError/i.test(raw ?? "")) return "not reachable";
  return raw || "unknown error";
}

export type Backend = "ollama" | "llama";

export interface ModelInfo {
  key: string; // backend:id
  id: string;
  backend: Backend;
  name: string;
  detail: string;
  ctx: number;
  vision: boolean;
  uncensored: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
}

export interface StreamStats {
  tokens: number;
  tps: number;
  seconds: number;
  promptTokens?: number;
}

// Friendly names for the Workstation's models. Unknown models still show by their raw id.
const KNOWN: { match: RegExp; name: string; hide?: boolean }[] = [
  { match: /qwen3\.6-35b/i, name: "Qwen3.6 35B Heretic" },
  { match: /qwen3\.8-27b.*2gpu/i, name: "Qwen3.8 27B Uncensored · 2 GPUs" },
  { match: /qwen3\.8-27b/i, name: "Qwen3.8 27B Uncensored" },
  { match: /qwen3\.5-9b/i, name: "Qwen3.5 9B Uncensored" },
  { match: /glm-4\.7-flash/i, name: "GLM-4.7 Flash" },
  { match: /nex-n2\.5/i, name: "Nex-N2.5 mini" },
  { match: /qwen3-vl-30b/i, name: "Qwen3-VL 30B" },
  { match: /^qwen2\.5-coder:7b/i, name: "Qwen2.5 Coder 7B" },
  { match: /^qwen2\.5-coder:1\.5b/i, name: "Qwen2.5 Coder 1.5B" },
  { match: /^gemma4:12b/i, name: "Gemma 4 12B" },
  { match: /^gemma4:e4b/i, name: "Gemma 4 E4B" },
  { match: /^gemma4:e2b/i, name: "Gemma 4 E2B" },
  { match: /^qwen3\.5:4b/i, name: "Qwen3.5 4B" },
  { match: /^qwen3\.5:2b/i, name: "Qwen3.5 2B" },
  { match: /^llama3\.1/i, name: "Llama 3.1 8B" },
  { match: /^llama3\.2/i, name: "Llama 3.2 3B" },
  { match: /ui-tars/i, name: "UI-TARS", hide: true },
  { match: /embed|^bge-|minilm|^e5-|^gte-/i, name: "Embedding", hide: true },
];
const UNCENSORED = /uncensored|abliterat|heretic|hauhau|dolphin|hermes|lexi|josiefied|huihui/i;

async function getJson(url: string, timeoutMs = 2500): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await http(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export async function listModels(): Promise<{ models: ModelInfo[]; ollama: boolean; llama: boolean }> {
  const models: ModelInfo[] = [];
  let ollama = false;
  let llama = false;
  const add = (id: string, backend: Backend, detail: string, ctx: number, vision: boolean) => {
    const k = KNOWN.find((m) => m.match.test(id));
    if (k?.hide) return;
    models.push({ key: `${backend}:${id}`, id, backend, name: k?.name ?? id, detail, ctx, vision, uncensored: UNCENSORED.test(id) });
  };
  const [o, l] = await Promise.allSettled([getJson(`${OLLAMA}/api/tags`), getJson(`${LLAMA}/models`)]);
  if (o.status === "fulfilled") {
    ollama = true;
    for (const m of o.value.models ?? []) {
      const gb = m.size ? `${(m.size / 1e9).toFixed(1)} GB` : "";
      add(m.name, "ollama", ["Ollama", gb, m.details?.quantization_level].filter(Boolean).join(" · "), settings.ollamaCtx, /vl|gemma4|qwen3\.5:/i.test(m.name));
    }
  }
  if (l.status === "fulfilled") {
    llama = true;
    for (const m of l.value.data ?? []) {
      const a: string[] = m.status?.args ?? [];
      const ci = a.indexOf("--ctx-size");
      const ctx = (ci >= 0 && Number(a[ci + 1])) || 32768;
      const state = m.status?.value === "loaded" ? "loaded" : "loads on first use";
      add(m.id, "llama", `llama.cpp · ${Math.round(ctx / 1024)}k ctx · ${state}`, ctx, (m.architecture?.input_modalities ?? []).includes("image"));
    }
  }
  return { models, ollama, llama };
}

/** On a single card, Ollama and a big llama.cpp model can't share VRAM: free the other side first. */
async function freeOther(backend: Backend) {
  if (!settings.swapBackends) return;
  try {
    if (backend === "llama") {
      const ps = await getJson(`${OLLAMA}/api/ps`);
      await Promise.all(
        (ps.models ?? []).map((m: any) =>
          http(`${OLLAMA}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: m.name, keep_alive: 0 }) }),
        ),
      );
    } else {
      const list = (await getJson(`${LLAMA}/models`)).data ?? [];
      await Promise.all(
        list
          .filter((m: any) => m.status?.value === "loaded" || m.status?.value === "loading")
          .map((m: any) =>
            http(`${LLAMA.replace(/\/v1$/, "")}/models/unload`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: m.id }) }),
          ),
      );
    }
  } catch {
    // The other server may be down; this one can still try.
  }
}

function toOpenAI(m: ChatMessage) {
  if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
  if (m.tool_calls?.length) {
    return {
      role: m.role,
      content: m.content || null,
      tool_calls: m.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.arguments ?? {}) } })),
    };
  }
  if (!m.images?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [{ type: "text", text: m.content }, ...m.images.map((b64) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }))],
  };
}

function toOllama(m: ChatMessage) {
  if (m.role === "tool") return { role: "tool", content: m.content, tool_name: m.tool_name };
  const out: any = { role: m.role, content: m.content };
  if (m.images?.length) out.images = m.images;
  if (m.tool_calls?.length) out.tool_calls = m.tool_calls.map((c) => ({ function: { name: c.name, arguments: c.arguments ?? {} } }));
  return out;
}

function parseArgs(a: any) {
  if (typeof a !== "string") return a ?? {};
  try {
    return JSON.parse(a || "{}");
  } catch {
    return { _raw: a };
  }
}

async function readLines(body: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  }
  if (buf.trim()) onLine(buf.trim());
}

/** Some models (or templates) write tool calls into the text instead of the tool_calls field. Pull them out. */
export function extractTextToolCalls(text: string): { text: string; calls: ToolCall[] } {
  const calls: ToolCall[] = [];
  const grab = (json: string) => {
    try {
      const j = JSON.parse(json.trim());
      const name = j.name ?? j.function?.name ?? j.tool;
      if (typeof name === "string") calls.push({ id: `text_${calls.length}`, name, arguments: parseArgs(j.arguments ?? j.parameters ?? j.function?.arguments ?? j.args ?? {}) });
      return true;
    } catch {
      return false;
    }
  };
  let out = text.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (all, body) => (grab(body) ? "" : all));
  // Qwen3-Coder style: <function=name><parameter=x>value</parameter></function>
  out = out.replace(/<function=([\w.-]+)>([\s\S]*?)<\/function>/g, (_all, name, body) => {
    const args: any = {};
    for (const m of String(body).matchAll(/<parameter=([\w.-]+)>\n?([\s\S]*?)\n?<\/parameter>/g)) args[m[1]] = m[2];
    calls.push({ id: `text_${calls.length}`, name, arguments: args });
    return "";
  });
  return { text: out.trim(), calls };
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onThinking: (text: string) => void;
  onStats: (s: StreamStats) => void;
}

export async function streamChat(
  model: ModelInfo,
  messages: ChatMessage[],
  h: StreamHandlers,
  signal: AbortSignal,
  tools?: any[],
  opts: { think?: boolean; temperature?: number } = {},
): Promise<StreamStats & { toolCalls: ToolCall[] }> {
  const toolCalls: ToolCall[] = [];
  const withTools = tools?.length ? { tools } : {};
  const start = performance.now();
  let first = 0;
  let chunks = 0;
  let final: StreamStats | null = null;
  const live = () => {
    chunks++;
    if (!first) first = performance.now();
    const secs = (performance.now() - first) / 1000;
    h.onStats({ tokens: chunks, tps: secs > 0.25 ? chunks / secs : 0, seconds: (performance.now() - start) / 1000 });
  };
  await freeOther(model.backend);

  if (model.backend === "ollama") {
    const r = await http(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: messages.map(toOllama),
        stream: true,
        options: { num_ctx: settings.ollamaCtx, ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}) },
        ...(opts.think !== undefined ? { think: opts.think } : {}),
        ...withTools,
      }),
      signal,
    });
    if (!r.ok || !r.body) throw new Error(`Ollama answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
    await readLines(r.body, (line) => {
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error);
      if (j.message?.thinking) {
        h.onThinking(j.message.thinking);
        live();
      }
      if (j.message?.content) {
        h.onToken(j.message.content);
        live();
      }
      for (const c of j.message?.tool_calls ?? []) {
        toolCalls.push({ id: `call_${toolCalls.length}`, name: c.function?.name, arguments: parseArgs(c.function?.arguments) });
      }
      if (j.done && j.eval_count) {
        const secs = (j.eval_duration ?? 0) / 1e9;
        final = { tokens: j.eval_count, tps: secs ? j.eval_count / secs : 0, seconds: (performance.now() - start) / 1000, promptTokens: j.prompt_eval_count };
      }
    });
  } else {
    const r = await http(`${LLAMA}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        messages: messages.map(toOpenAI),
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.think === false ? { chat_template_kwargs: { enable_thinking: false, reasoning_effort: "none" } } : {}),
        ...withTools,
      }),
      signal,
    });
    if (!r.ok || !r.body) throw new Error(`llama.cpp answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const partial: { id: string; name: string; args: string }[] = [];
    await readLines(r.body, (line) => {
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      const j = JSON.parse(data);
      if (j.error) throw new Error(j.error.message ?? String(j.error));
      const d = j.choices?.[0]?.delta;
      if (d?.reasoning_content) {
        h.onThinking(d.reasoning_content);
        live();
      }
      if (d?.content) {
        h.onToken(d.content);
        live();
      }
      for (const tc of d?.tool_calls ?? []) {
        const i = tc.index ?? 0;
        partial[i] ??= { id: tc.id ?? `call_${i}`, name: "", args: "" };
        if (tc.id) partial[i].id = tc.id;
        if (tc.function?.name) partial[i].name += tc.function.name;
        if (tc.function?.arguments) partial[i].args += tc.function.arguments;
      }
      const t = j.timings;
      if (t?.predicted_n) {
        final = { tokens: t.predicted_n, tps: t.predicted_per_second ?? 0, seconds: (performance.now() - start) / 1000, promptTokens: (t.prompt_n ?? 0) + (t.cache_n ?? 0) };
      } else if (j.usage?.completion_tokens && !final) {
        const secs = first ? (performance.now() - first) / 1000 : 0;
        final = { tokens: j.usage.completion_tokens, tps: secs ? j.usage.completion_tokens / secs : 0, seconds: (performance.now() - start) / 1000, promptTokens: j.usage.prompt_tokens };
      }
    });
    for (const p of partial) if (p?.name) toolCalls.push({ id: p.id, name: p.name, arguments: parseArgs(p.args) });
  }
  const secs = first ? (performance.now() - first) / 1000 : 0;
  let stats: StreamStats = final ?? { tokens: chunks, tps: secs ? chunks / secs : 0, seconds: (performance.now() - start) / 1000 };
  // Some servers leave thinking out of their token count; count what actually streamed (one chunk ≈ one token).
  if (chunks > stats.tokens) stats = { ...stats, tokens: chunks, tps: secs ? chunks / secs : stats.tps };
  return { ...stats, toolCalls };
}

/** One-shot completion without tools, for titles and compaction. */
export async function complete(model: ModelInfo, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  let out = "";
  await streamChat(model, messages, { onToken: (t) => (out += t), onThinking: () => {}, onStats: () => {} }, signal ?? new AbortController().signal, undefined, { think: false });
  return out.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
