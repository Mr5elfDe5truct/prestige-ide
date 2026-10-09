// Subagents: the main agent hands a self-contained research job to a helper with a fresh context and read-only
// tools. The helper's searching and reading stay out of the main conversation; only its report comes back.
import { errMsg, extractTextToolCalls, streamChat, type ChatMessage, type ModelInfo } from "./backends";
import { describeCall, runTool, toolSchemas } from "./tools";

// Local models tend to keep reading; a budget and a nudge make them report once they can answer.
const MAX_TURNS = 16;
const NUDGE_AT = 10;


function system(root: string): string {
  return `You are a research subagent inside Prestige IDE, working for another coding agent. You run on the user's own PC.
Your job: answer the task you're given by searching and reading the code (and the web if needed). You can only read; you can't change files or run commands.

- Go straight for the answer: grep for the key names first, then read only the files (or the parts of files, with offset and limit) that the matches point to. Don't list folders or read whole files "for context".
- Stop as soon as you can answer the question with evidence. Most questions need 3 to 8 tool calls; you have at most 15.
- When you're done, stop calling tools and reply with your report: the answer, the evidence (file:line for each claim), and anything uncertain. The agent that asked can't see your tool calls, only this report, so put everything it needs in it.
- Never guess. If you couldn't find something, say so.

OS: Windows. Project root: ${root}. Relative paths are resolved from it.`;
}

export interface SubagentResult {
  report: string;
  steps: number;
  ok: boolean;
}

export async function runSubagent(
  root: string,
  model: ModelInfo,
  prompt: string,
  signal: AbortSignal,
  progress: (line: string) => void,
): Promise<SubagentResult> {
  const tools = (await toolSchemas("plan")).filter((t) => t.function.name !== "task");
  const msgs: ChatMessage[] = [
    { role: "system", content: system(root) },
    { role: "user", content: prompt },
  ];
  let steps = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal.aborted) return { report: "Stopped by the user.", steps, ok: false };
    let text = "";
    let calls;
    try {
      const r = await streamChat(model, msgs, { onToken: (t) => (text += t), onThinking: () => {}, onStats: () => {} }, signal, tools, { think: false });
      calls = r.toolCalls;
    } catch (e) {
      return { report: `The subagent failed: ${errMsg(e)}`, steps, ok: false };
    }
    text = text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, "");
    if (!calls.length) {
      const x = extractTextToolCalls(text);
      calls = x.calls;
      text = x.text;
    }
    if (!calls.length) return { report: text.trim() || "(the subagent returned no report)", steps, ok: true };
    msgs.push({ role: "assistant", content: text, tool_calls: calls });
    if (turn === NUDGE_AT) progress("(asked to wrap up)");
    for (const c of calls) {
      steps++;
      const d = describeCall(root, c.name, c.arguments ?? {});
      progress(`${d.verb} ${d.target}`);
      const allowed = tools.some((t) => t.function.name === c.name);
      const r = allowed
        ? await runTool(c.name, c.arguments ?? {}, { root, signal, setTodos: () => {} })
        : { content: `Error: ${c.name} isn't available to a read-only subagent.`, meta: { ok: false } };
      msgs.push({ role: "tool", content: r.content.slice(0, 30000), tool_call_id: c.id, tool_name: c.name });
    }
    if (turn === NUDGE_AT) {
      msgs.push({ role: "user", content: `You've used ${steps} tool calls. Unless one more lookup is essential, stop and write your report now.` });
    }
  }
  // Out of turns: ask for whatever it has.
  msgs.push({ role: "user", content: "You're out of steps. Write your report now from what you found." });
  let text = "";
  try {
    await streamChat(model, msgs, { onToken: (t) => (text += t), onThinking: () => {}, onStats: () => {} }, signal, undefined, { think: false });
  } catch (e) {
    return { report: `The subagent ran out of steps and then failed: ${errMsg(e)}`, steps, ok: false };
  }
  return { report: text.trim(), steps, ok: true };
}
