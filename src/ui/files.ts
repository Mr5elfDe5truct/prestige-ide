// The Files pane: a lazy folder tree beside Monaco editor tabs. Ctrl+S saves; files the agent changes reload
// unless they have unsaved edits.
import { invoke } from "@tauri-apps/api/core";
import { monaco } from "./monaco";
import { langFor } from "./lang";
import { h } from "./transcript";
import { relPath } from "../tools";

interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

interface Open {
  path: string;
  model: monaco.editor.ITextModel;
  saved: number; // alternative version id at last save
  tab: HTMLElement;
  view?: monaco.editor.ICodeEditorViewState | null;
}

export class FilesPane {
  el = h("div", "files-pane");
  private tree = h("div", "tree");
  private treeHead = h("div", "tree-head");
  private treeBody = h("div", "tree-body");
  private tabs = h("div", "editor-tabs");
  private host = h("div", "editor-host");
  private empty = h("div", "editor-empty");
  private editor: monaco.editor.IStandaloneCodeEditor;
  private open: Open[] = [];
  private active: Open | null = null;
  private root = "";
  private expanded = new Set<string>();

  constructor(private hooks: { mention: (rel: string) => void; status: (t: string) => void }) {
    const main = h("div", "editor-main");
    this.empty.innerHTML = `<div class="empty-title">No file open</div><div class="empty-sub">Pick a file in the tree, or click a path in the chat.</div>`;
    main.append(this.tabs, this.host, this.empty);
    this.tree.append(this.treeHead, this.treeBody);
    this.el.append(this.tree, main);
    this.editor = monaco.editor.create(this.host, {
      theme: "prestige",
      automaticLayout: true,
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      fontLigatures: true,
      minimap: { enabled: true, scale: 1, renderCharacters: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: "smooth",
      renderWhitespace: "selection",
      bracketPairColorization: { enabled: true },
      padding: { top: 8 },
    });
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void this.save());
    this.editor.addAction({
      id: "prestige.mention",
      label: "Mention selection in chat",
      contextMenuGroupId: "navigation",
      run: () => {
        if (!this.active) return;
        const sel = this.editor.getSelection();
        const rel = relPath(this.root, this.active.path);
        this.hooks.mention(sel && !sel.isEmpty() ? `${rel}:${sel.startLineNumber}-${sel.endLineNumber}` : rel);
      },
    });
    this.host.hidden = true;
  }

  async setProject(root: string) {
    if (root === this.root) return;
    this.root = root;
    this.expanded.clear();
    for (const o of [...this.open]) this.close(o, true);
    this.treeHead.innerHTML = "";
    const name = h("span", "tree-root", root.split(/[\\/]/).filter(Boolean).pop() ?? root);
    name.title = root;
    const refresh = h("button", "icon-btn", "⟳");
    refresh.title = "Refresh";
    refresh.onclick = () => void this.refresh();
    const reveal = h("button", "icon-btn", "↗");
    reveal.title = "Open in Explorer";
    reveal.onclick = () => void invoke("reveal", { path: root });
    this.treeHead.append(name, refresh, reveal);
    await this.refresh();
  }

  async refresh() {
    this.treeBody.innerHTML = "";
    if (this.root) await this.renderDir(this.root, this.treeBody, 0);
  }

  private async renderDir(path: string, into: HTMLElement, depth: number) {
    let list: Entry[] = [];
    try {
      list = await invoke<Entry[]>("fs_list", { path });
    } catch (e) {
      into.append(h("div", "tree-err", String(e)));
      return;
    }
    for (const e of list) {
      const row = h("div", `tree-row ${e.is_dir ? "dir" : "file"}`);
      row.style.paddingLeft = `${8 + depth * 12}px`;
      const icon = h("span", "tree-icon", e.is_dir ? (this.expanded.has(e.path) ? "▾" : "▸") : "");
      const label = h("span", "tree-name", e.name);
      if (!e.is_dir) label.dataset.ext = e.name.split(".").pop()?.toLowerCase() ?? "";
      if (/^(node_modules|target|dist|\.venv|__pycache__)$/.test(e.name)) row.classList.add("dim");
      row.append(icon, label);
      row.title = e.path;
      into.append(row);
      const kids = h("div", "tree-kids");
      into.append(kids);
      if (e.is_dir) {
        const toggle = async () => {
          if (this.expanded.has(e.path)) {
            this.expanded.delete(e.path);
            kids.innerHTML = "";
            icon.textContent = "▸";
          } else {
            this.expanded.add(e.path);
            icon.textContent = "▾";
            await this.renderDir(e.path, kids, depth + 1);
          }
        };
        row.onclick = () => void toggle();
        if (this.expanded.has(e.path)) void this.renderDir(e.path, kids, depth + 1);
      } else {
        row.onclick = () => void this.openFile(e.path);
      }
      row.oncontextmenu = (ev) => {
        ev.preventDefault();
        this.hooks.mention(relPath(this.root, e.path) + (e.is_dir ? "/" : ""));
      };
    }
  }

  isOpen(path: string) {
    return this.open.some((o) => same(o.path, path));
  }

  async openFile(path: string, line?: number) {
    path = path.replace(/\\/g, "/");
    let o = this.open.find((x) => same(x.path, path));
    if (!o) {
      let text: string;
      try {
        text = await invoke<string>("fs_read", { path });
      } catch (e) {
        this.hooks.status(String(e));
        return;
      }
      const uri = monaco.Uri.file(path);
      const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(text, langFor(path), uri);
      model.setValue(text);
      const tab = h("div", "editor-tab");
      const name = h("span", "", path.split("/").pop()!);
      tab.title = path;
      const x = h("button", "tab-x", "×");
      tab.append(name, x);
      this.tabs.append(tab);
      const entry: Open = { path, model, saved: model.getAlternativeVersionId(), tab };
      model.onDidChangeContent(() => tab.classList.toggle("dirty", model.getAlternativeVersionId() !== entry.saved));
      tab.onclick = () => this.activate(entry);
      tab.onauxclick = (e) => e.button === 1 && this.close(entry);
      x.onclick = (e) => {
        e.stopPropagation();
        this.close(entry);
      };
      this.open.push(entry);
      o = entry;
    }
    this.activate(o);
    if (line) {
      this.editor.revealLineInCenter(line);
      this.editor.setPosition({ lineNumber: line, column: 1 });
      this.editor.setSelection(new monaco.Selection(line, 1, line, o.model.getLineMaxColumn(line)));
    }
    this.editor.focus();
  }

  private activate(o: Open) {
    if (this.active) this.active.view = this.editor.saveViewState();
    this.active = o;
    this.editor.setModel(o.model);
    if (o.view) this.editor.restoreViewState(o.view);
    for (const x of this.open) x.tab.classList.toggle("active", x === o);
    o.tab.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.host.hidden = false;
    this.empty.hidden = true;
  }

  private close(o: Open, force = false) {
    if (!force && o.model.getAlternativeVersionId() !== o.saved && !confirm(`${o.path.split("/").pop()} has unsaved changes. Close it anyway?`)) return;
    const i = this.open.indexOf(o);
    this.open.splice(i, 1);
    o.tab.remove();
    o.model.dispose();
    if (this.active === o) {
      this.active = null;
      const next = this.open[Math.min(i, this.open.length - 1)];
      if (next) this.activate(next);
      else {
        this.editor.setModel(null);
        this.host.hidden = true;
        this.empty.hidden = false;
      }
    }
  }

  async save() {
    const o = this.active;
    if (!o) return;
    try {
      await invoke("fs_write", { path: o.path, content: o.model.getValue() });
      o.saved = o.model.getAlternativeVersionId();
      o.tab.classList.remove("dirty");
      this.hooks.status(`Saved ${relPath(this.root, o.path)}`);
    } catch (e) {
      this.hooks.status(`Couldn't save: ${e}`);
    }
  }

  /** The agent changed a file: show the new text unless the user has unsaved edits there. */
  async fileChanged(path: string) {
    const o = this.open.find((x) => same(x.path, path));
    if (o && o.model.getAlternativeVersionId() === o.saved) {
      try {
        const text = await invoke<string>("fs_read", { path: o.path });
        if (text !== o.model.getValue()) {
          o.model.pushEditOperations([], [{ range: o.model.getFullModelRange(), text }], () => null);
          o.saved = o.model.getAlternativeVersionId();
        }
      } catch {
        // deleted or unreadable: leave the tab as it is
      }
    }
  }

  layout() {
    this.editor.layout();
  }
}

const same = (a: string, b: string) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
