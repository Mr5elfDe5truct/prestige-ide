// The Changes pane: every file this session's agent touched, its diff from before the session (Monaco's diff
// editor, side by side or inline) and Revert.
import { invoke } from "@tauri-apps/api/core";
import { monaco } from "./monaco";
import { langFor } from "./lang";
import { h } from "./transcript";
import { relPath } from "../tools";
import type { Session } from "../store";

interface Change {
  path: string;
  before: string | null; // before the session's first change (null: the agent created it)
}

export function sessionChanges(s: Session | null): Change[] {
  const map = new Map<string, Change>();
  for (const m of s?.messages ?? []) {
    const meta = m.meta;
    if (!meta?.path || meta.after === undefined) continue;
    const key = meta.path.toLowerCase();
    if (!map.has(key)) map.set(key, { path: meta.path, before: meta.before ?? null });
  }
  return [...map.values()];
}

export class ChangesPane {
  el = h("div", "changes-pane");
  private list = h("div", "changes-list");
  private head = h("div", "changes-head");
  private host = h("div", "diff-host");
  private empty = h("div", "editor-empty");
  private diff: monaco.editor.IStandaloneDiffEditor;
  private session: Session | null = null;
  private current: Change | null = null;
  private inline = false;

  constructor(private hooks: { open: (path: string) => void; changed: (path: string) => void; status: (t: string) => void }) {
    this.empty.innerHTML = `<div class="empty-title">No changes yet</div><div class="empty-sub">Files the agent edits in this session show here, with a diff and Revert.</div>`;
    const right = h("div", "changes-main");
    right.append(this.head, this.host, this.empty);
    this.el.append(this.list, right);
    this.diff = monaco.editor.createDiffEditor(this.host, {
      theme: "prestige",
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 12.5,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      hideUnchangedRegions: { enabled: true },
    });
    this.host.hidden = true;
  }

  setSession(s: Session | null) {
    if (s !== this.session) this.current = null;
    this.session = s;
    if (this.el.offsetParent) void this.render();
  }

  async render() {
    const changes = sessionChanges(this.session);
    this.list.innerHTML = "";
    this.empty.hidden = changes.length > 0;
    this.host.hidden = !changes.length;
    this.head.hidden = !changes.length;
    const root = this.session?.project ?? "";
    for (const c of changes) {
      const row = h("div", "change-row");
      const name = h("span", "change-name", c.path.split(/[\\/]/).pop()!);
      const dir = h("span", "change-dir", relPath(root, c.path).split("/").slice(0, -1).join("/"));
      const badge = h("span", `change-badge ${c.before === null ? "new" : "mod"}`, c.before === null ? "A" : "M");
      row.append(badge, name, dir);
      row.onclick = () => void this.show(c);
      if (this.current && this.current.path === c.path) row.classList.add("active");
      this.list.append(row);
    }
    if (!this.current && changes.length) await this.show(changes[changes.length - 1]);
    else if (this.current) await this.show(this.current);
  }

  private async show(c: Change) {
    this.current = c;
    [...this.list.children].forEach((r, i) => r.classList.toggle("active", sessionChanges(this.session)[i]?.path === c.path));
    let now = "";
    let gone = false;
    try {
      now = await invoke<string>("fs_read", { path: c.path });
    } catch {
      gone = true;
    }
    const lang = langFor(c.path);
    const old = this.diff.getModel();
    this.diff.setModel({ original: monaco.editor.createModel(c.before ?? "", lang), modified: monaco.editor.createModel(now, lang) });
    old?.original.dispose();
    old?.modified.dispose();

    this.head.innerHTML = "";
    const title = h("span", "changes-title", relPath(this.session?.project ?? "", c.path) + (gone ? " (deleted)" : ""));
    const mode = h("button", "btn small", this.inline ? "Side by side" : "Inline");
    mode.onclick = () => {
      this.inline = !this.inline;
      this.diff.updateOptions({ renderSideBySide: !this.inline });
      mode.textContent = this.inline ? "Side by side" : "Inline";
    };
    const open = h("button", "btn small", "Open");
    open.onclick = () => this.hooks.open(c.path);
    const revert = h("button", "btn small danger", "Revert");
    revert.title = c.before === null ? "Delete this file the agent created" : "Put back the file as it was before this session";
    revert.onclick = async () => {
      if (!confirm(c.before === null ? `Delete ${c.path}? The agent created it in this session.` : `Revert ${c.path} to how it was before this session?`)) return;
      try {
        if (c.before === null) await invoke("fs_delete", { path: c.path });
        else await invoke("fs_write", { path: c.path, content: c.before });
        this.hooks.changed(c.path);
        this.hooks.status(`Reverted ${relPath(this.session?.project ?? "", c.path)}`);
        await this.show(c);
      } catch (e) {
        this.hooks.status(`Couldn't revert: ${e}`);
      }
    };
    this.head.append(title, mode, open, revert);
  }
}
