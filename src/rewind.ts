// Checkpoints: every user message is one. Rewinding to it puts back the files the agent changed after it, as they
// were at that moment, and drops the conversation from there on. Commands' side effects can't be undone.
import { invoke } from "@tauri-apps/api/core";
import type { Session, StoredMessage, Todo } from "./store";

export interface RewindPlan {
  index: number; // the user message to rewind to (it is removed too, and its text goes back in the box)
  files: { path: string; before: string | null }[]; // state at the checkpoint; null: the file didn't exist
  commands: number; // run_command calls after the checkpoint, which rewinding can't undo
}

/** User messages you can rewind to (not compaction summaries), newest first. */
export function checkpoints(s: Session): { index: number; msg: StoredMessage }[] {
  return s.messages
    .map((msg, index) => ({ msg, index }))
    .filter(({ msg }) => msg.role === "user" && !msg.summary && !msg.archived)
    .reverse();
}

export function planRewind(s: Session, index: number): RewindPlan {
  const files = new Map<string, { path: string; before: string | null }>();
  let commands = 0;
  for (const m of s.messages.slice(index)) {
    if (m.role === "tool" && m.tool_name === "run_command" && m.meta && !m.meta.denied) commands++;
    const meta = m.meta;
    if (!meta?.path || meta.after === undefined) continue;
    const key = meta.path.toLowerCase();
    // The first change after the checkpoint holds the file as it was at the checkpoint.
    if (!files.has(key)) files.set(key, { path: meta.path, before: meta.before ?? null });
  }
  return { index, files: [...files.values()], commands };
}

/** Applies a rewind: restores the files and trims the session. Returns the text of the removed user message. */
export async function applyRewind(s: Session, plan: RewindPlan): Promise<{ text: string; images?: string[]; failed: string[] }> {
  const failed: string[] = [];
  for (const f of plan.files) {
    try {
      if (f.before === null) {
        if (await invoke<boolean>("fs_exists", { path: f.path })) await invoke("fs_delete", { path: f.path });
      } else await invoke("fs_write", { path: f.path, content: f.before });
    } catch (e) {
      failed.push(`${f.path}: ${e}`);
    }
  }
  const removed = s.messages.splice(plan.index);
  // Rewinding past a compaction brings back the messages it summarised.
  for (const r of removed) if (r.summary && r.at) for (const m of s.messages) if (m.archived === r.at) delete m.archived;
  s.todos = lastTodos(s.messages);
  const user = removed[0];
  return { text: (user?.content ?? "").replace(/\n\n<attached-files>[\s\S]*$/, ""), images: user?.images, failed };
}

/** The task list as the last todo_write before this point left it. */
function lastTodos(msgs: StoredMessage[]): Todo[] {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const c = [...(msgs[i].tool_calls ?? [])].reverse().find((c) => c.name === "todo_write");
    if (c && Array.isArray(c.arguments?.todos)) return c.arguments.todos;
  }
  return [];
}
