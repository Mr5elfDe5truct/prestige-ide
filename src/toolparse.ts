// Tool calls some models (or chat templates) write into their reply text instead of the tool_calls field.
// No imports, so it can be tested on its own with Node.

export interface ParsedCall {
  id: string;
  name: string;
  arguments: any;
}

function parseArgs(a: any) {
  if (typeof a !== "string") return a ?? {};
  try {
    return JSON.parse(a || "{}");
  } catch {
    return { _raw: a };
  }
}

/** Pulls tool calls out of reply text. `known` (the session's tool names) enables the looser formats, which are only
 *  trusted when the name is a real tool, so ordinary text is never mistaken for a call. */
export function extractTextToolCalls(text: string, known?: Set<string>): { text: string; calls: ParsedCall[] } {
  const calls: ParsedCall[] = [];
  const add = (name: string, args: any) => calls.push({ id: `text_${calls.length}`, name, arguments: args });
  const grab = (json: string) => {
    try {
      const j = JSON.parse(json.trim());
      const name = j.name ?? j.function?.name ?? j.tool;
      if (typeof name !== "string") return false;
      add(name, parseArgs(j.arguments ?? j.parameters ?? j.function?.arguments ?? j.args ?? {}));
      return true;
    } catch {
      return false;
    }
  };
  // Hermes / Qwen: <tool_call>{"name": …, "arguments": …}</tool_call>
  let out = text.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (all, body) => (grab(body) ? "" : all));
  // Qwen3-Coder: <function=name><parameter=x>value</parameter></function>
  out = out.replace(/<function=([\w.-]+)>([\s\S]*?)<\/function>/g, (_all, name, body) => {
    const args: any = {};
    for (const m of String(body).matchAll(/<parameter=([\w.-]+)>\n?([\s\S]*?)\n?<\/parameter>/g)) args[m[1]] = m[2];
    add(name, args);
    return "";
  });
  if (calls.length || !known?.size) return { text: out.trim(), calls };

  // A bare tool name on its own line, then its arguments as <param>value</param> tags or a JSON object, at the end of
  // the reply. Seen from Qwen3.6 with thinking off:  read_file\n\n<path>py/x.py</path>
  const tail = out.match(/(^|\n)[ \t]*`?([\w.-]+)`?[ \t]*\n+((?:[ \t]*<([\w.-]+)>[\s\S]*?<\/\4>\s*)+|\s*\{[\s\S]*\})\s*$/);
  if (tail && known.has(tail[2])) {
    const body = tail[3].trim();
    let args: any = {};
    if (body.startsWith("{")) args = parseArgs(body);
    else for (const m of body.matchAll(/<([\w.-]+)>\n?([\s\S]*?)\n?<\/\1>/g)) args[m[1]] = m[2];
    add(tail[2], args);
    out = out.slice(0, tail.index! + tail[1].length);
  }
  return { text: out.trim(), calls };
}
