// Output styles: how the agent writes its replies. Built-ins, plus your own from .prestige/output-styles/*.md in the
// project or %USERPROFILE%\.prestige\output-styles\*.md (the file's text is the instruction; its name is the style's).
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";

export interface OutputStyle {
  id: string;
  label: string;
  hint: string;
  prompt: string; // replaces the "Replies" part of the system prompt
}

export const BUILT_IN: OutputStyle[] = [
  {
    id: "default",
    label: "Default",
    hint: "concise, says what changed and how it was checked",
    prompt: `- Be concise and direct. Use GitHub-flavored Markdown. Refer to code as path:line.
- When you finish a task, say in a few lines what you changed and how you checked it.`,
  },
  {
    id: "terse",
    label: "Terse",
    hint: "as few words as possible",
    prompt: `- Use as few words as possible: no preamble, no recap of the question, no closing offers. Fragments are fine.
- When you finish, one line: what changed (path:line) and whether it was verified.`,
  },
  {
    id: "explanatory",
    label: "Explanatory",
    hint: "explains the why behind changes and the codebase",
    prompt: `- Explain your reasoning as you work: why this approach, what you ruled out, and anything surprising about the codebase.
- Use GitHub-flavored Markdown and refer to code as path:line.
- When you finish, summarise what changed, why, how you checked it, and any trade-offs the user should know about.`,
  },
  {
    id: "learning",
    label: "Learning",
    hint: "teaches as it goes; leaves small parts for you to write",
    prompt: `- The user wants to learn while you work. Explain concepts as they come up, briefly, in plain language.
- For small, self-contained pieces (a few lines of logic), don't write them yourself: describe what's needed, mark the spot with a TODO(you) comment, and let the user write it. Do the rest of the task normally.
- Use GitHub-flavored Markdown and refer to code as path:line. When you finish, list what the user should try writing and how to check it.`,
  },
];

/** Built-ins plus custom styles from the user's and the project's output-styles folders. */
export async function listStyles(project: string): Promise<OutputStyle[]> {
  const out = [...BUILT_IN];
  const home = (await homeDir().catch(() => "")).replace(/\\/g, "/").replace(/\/$/, "");
  for (const dir of [home && `${home}/.prestige/output-styles`, project && `${project}/.prestige/output-styles`]) {
    if (!dir) continue;
    const files = await invoke<string[]>("fs_glob", { root: dir, pattern: "*.md", limit: 50 }).catch(() => [] as string[]);
    for (const f of files) {
      const id = f.split("/").pop()!.replace(/\.md$/, "");
      const text = await invoke<string>("fs_read", { path: f }).catch(() => "");
      if (!text.trim()) continue;
      const style = { id, label: id, hint: f.includes("/.prestige/output-styles/") && f.startsWith(project) ? "project style" : "your style", prompt: text.trim() };
      const i = out.findIndex((s) => s.id === id);
      if (i >= 0) out[i] = style; // a custom style with a built-in's name replaces it
      else out.push(style);
    }
  }
  return out;
}

export async function stylePrompt(id: string | undefined, project: string): Promise<string> {
  const styles = await listStyles(project);
  return (styles.find((s) => s.id === (id || "default")) ?? BUILT_IN[0]).prompt;
}
