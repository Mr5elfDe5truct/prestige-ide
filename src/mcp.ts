// MCP tools through an mcpo server (the Workstation's runs on :8200): each MCP server is an OpenAPI app there, and
// each of its operations becomes a function tool named server__operation. Read-only ones run freely; the rest ask.
import { errMsg, http } from "./backends";
import { settings } from "./store";

export interface McpTool {
  name: string; // what the model calls: server__op
  server: string;
  op: string;
  description: string;
  parameters: any;
  readOnly: boolean;
}

export interface McpServer {
  id: string;
  tools: number;
  error?: string;
}

// Read-only by name. Everything else (writes, clicks, processes, renders, the webcam) asks first.
const SAFE =
  /^(read_|list_|get_(?!config)|search_|directory_tree|reddit_|hf_models|github_search|scout_report|job_status|video_status|fetch$|convert_time$|browser_(snapshot|take_screenshot|tabs|console_messages|network_requests|network_request|find)$)/;
const ALWAYS_ASK = /^(webcam_snapshot|set_config_value|get_config|read_media_file)$/;

/** Inlines $ref schemas and drops OpenAPI-only fields so small models get plain JSON schema. */
function clean(schema: any, components: any, depth = 0): any {
  if (!schema || typeof schema !== "object" || depth > 8) return schema;
  if (Array.isArray(schema)) return schema.map((s) => clean(s, components, depth + 1));
  if (schema.$ref) return clean(components?.[String(schema.$ref).split("/").pop()!] ?? {}, components, depth + 1);
  const out: any = {};
  for (const [k, v] of Object.entries(schema)) if (k !== "title") out[k] = clean(v, components, depth + 1);
  return out;
}

async function getJson(url: string, ms = 4000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await http(url, { signal: c.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

let cache: { at: number; url: string; servers: McpServer[]; tools: McpTool[] } | null = null;

/** Every server and tool the mcpo endpoint offers (cached for a minute). */
export async function discover(force = false): Promise<{ servers: McpServer[]; tools: McpTool[] }> {
  const base = settings.mcpUrl.replace(/\/$/, "");
  if (!force && cache && cache.url === base && Date.now() - cache.at < 60000) return cache;
  const servers: McpServer[] = [];
  const tools: McpTool[] = [];
  let ids: string[] = [];
  try {
    const root = await getJson(`${base}/openapi.json`);
    ids = [...String(root.info?.description ?? "").matchAll(/\[([\w.-]+)\]\(\/\1\/docs\)/g)].map((m) => m[1]);
  } catch (e) {
    cache = { at: Date.now(), url: base, servers: [], tools: [] };
    return { servers: [{ id: "(tool server)", tools: 0, error: errMsg(e) }], tools };
  }
  await Promise.all(
    ids.map(async (id) => {
      try {
        const spec = await getJson(`${base}/${id}/openapi.json`);
        const comps = spec.components?.schemas ?? {};
        let n = 0;
        for (const [path, item] of Object.entries<any>(spec.paths ?? {})) {
          const post = item.post;
          if (!post) continue;
          const op = path.replace(/^\//, "");
          const ref = post.requestBody?.content?.["application/json"]?.schema;
          const params = ref ? clean(ref, comps) : { type: "object", properties: {} };
          if (params.type !== "object") continue;
          tools.push({
            name: `${id}__${op}`.slice(0, 64),
            server: id,
            op,
            description: String(post.description ?? post.summary ?? op).slice(0, 1000),
            parameters: { type: "object", properties: params.properties ?? {}, required: params.required ?? [] },
            readOnly: SAFE.test(op) && !ALWAYS_ASK.test(op),
          });
          n++;
        }
        servers.push({ id, tools: n });
      } catch (e) {
        servers.push({ id, tools: 0, error: errMsg(e) });
      }
    }),
  );
  servers.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  cache = { at: Date.now(), url: base, servers, tools };
  return cache;
}

/** The tools of the servers switched on in Settings. */
export async function enabledTools(): Promise<McpTool[]> {
  if (!settings.mcpEnabled.length) return [];
  try {
    return (await discover()).tools.filter((t) => settings.mcpEnabled.includes(t.server));
  } catch {
    return [];
  }
}

export function findTool(name: string): McpTool | undefined {
  return cache?.tools.find((t) => t.name === name);
}

export async function callTool(t: McpTool, args: any, signal: AbortSignal): Promise<{ text: string; ok: boolean }> {
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 180000);
  const stop = () => c.abort();
  signal.addEventListener("abort", stop);
  try {
    const r = await http(`${settings.mcpUrl.replace(/\/$/, "")}/${t.server}/${t.op}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args ?? {}),
      signal: c.signal,
    });
    const body = await r.text();
    let text = body;
    try {
      const j = JSON.parse(body);
      text = typeof j === "string" ? j : Array.isArray(j) ? j.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n") : JSON.stringify(j, null, 1);
    } catch {
      // not JSON: keep the text
    }
    // Images (screenshots) come back as base64; the model can't read them as text, so say what it was.
    text = text.replace(/"?(data:image\/\w+;base64,)?[A-Za-z0-9+/=]{4000,}"?/g, "[binary data omitted]");
    if (text.length > 40000) text = text.slice(0, 40000) + `\n… [${text.length - 40000} characters cut]`;
    return { text: r.ok ? text : `tool server answered ${r.status}: ${text.slice(0, 2000)}`, ok: r.ok };
  } catch (e) {
    return { text: signal.aborted ? "stopped by the user" : errMsg(e), ok: false };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}
