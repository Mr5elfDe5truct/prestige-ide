// The Terminal pane: real PowerShell terminals (ConPTY) in xterm.js tabs, opened in the project folder.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { h } from "./transcript";

interface Tab {
  id: string;
  term: Terminal;
  fit: FitAddon;
  el: HTMLElement;
  tab: HTMLElement;
  un: UnlistenFn[];
}

export class TerminalPane {
  el = h("div", "term-pane");
  private bar = h("div", "term-tabs");
  private body = h("div", "term-body");
  private tabs: Tab[] = [];
  private active: Tab | null = null;
  private n = 0;
  cwd = "";

  constructor() {
    const add = h("button", "icon-btn", "+");
    add.title = "New terminal";
    add.onclick = () => void this.add();
    this.bar.append(add);
    this.el.append(this.bar, this.body);
    new ResizeObserver(() => this.fitActive()).observe(this.body);
  }

  /** Opens the first terminal the first time the pane is shown. */
  ensure() {
    if (!this.tabs.length) void this.add();
    else this.fitActive();
  }

  async add(label?: string): Promise<string> {
    const id = `t${Date.now().toString(36)}${this.n}`;
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: {
        background: "#120f0d",
        foreground: "#e8e0d6",
        cursor: "#d9a441",
        selectionBackground: "#5a2a2688",
        red: "#e0605a",
        green: "#8fc27a",
        yellow: "#d9b46a",
        blue: "#7aa7d9",
        magenta: "#c99be0",
        cyan: "#7fc4b8",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const el = h("div", "term-host");
    this.body.append(el);
    const tab = h("div", "term-tab");
    const tabLabel = h("span", "", label ?? `PowerShell ${++this.n}`);
    const x = h("button", "tab-x", "×");
    tab.append(tabLabel, x);
    this.bar.insertBefore(tab, this.bar.lastChild);
    const t: Tab = { id, term, fit, el, tab, un: [] };
    this.tabs.push(t);
    tab.onclick = () => this.activate(t);
    x.onclick = (e) => {
      e.stopPropagation();
      this.close(t);
    };
    this.activate(t);
    term.open(el);
    fit.fit();
    t.un.push(await listen<{ data: string }>(`pty-out-${id}`, (e) => term.write(e.payload.data)));
    t.un.push(await listen(`pty-exit-${id}`, () => term.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n")));
    term.onData((d) => void invoke("pty_write", { id, data: d }));
    term.onResize(({ cols, rows }) => void invoke("pty_resize", { id, cols, rows }).catch(() => {}));
    // Ctrl+C copies when there's a selection; Ctrl+V pastes.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      if (e.ctrlKey && e.key === "c" && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if (e.ctrlKey && e.key === "v") {
        void navigator.clipboard.readText().then((s) => invoke("pty_write", { id, data: s }));
        return false;
      }
      return true;
    });
    try {
      await invoke("pty_spawn", { id, cwd: this.cwd || "C:\\", cols: term.cols, rows: term.rows });
    } catch (e) {
      term.write(`\x1b[31mCouldn't start PowerShell: ${e}\x1b[0m\r\n`);
    }
    term.focus();
    return id;
  }

  /** Starts a long-running command (a dev server) in a terminal tab of its own and passes its output on, so the
   *  Preview pane can pick up the address it prints. */
  async start(cmd: string, label: string, onOutput: (text: string) => void): Promise<void> {
    const id = await this.add(label);
    const t = this.tabs.find((x) => x.id === id);
    t?.un.push(await listen<{ data: string }>(`pty-out-${id}`, (e) => onOutput(e.payload.data)));
    await invoke("pty_write", { id, data: cmd + "\r" });
  }

  /** Types a command into the active terminal (from "Run in terminal" buttons). */
  async run(cmd: string) {
    if (!this.active) await this.add();
    await invoke("pty_write", { id: this.active!.id, data: cmd + "\r" });
    this.active!.term.focus();
  }

  private activate(t: Tab) {
    this.active = t;
    for (const x of this.tabs) {
      x.el.hidden = x !== t;
      x.tab.classList.toggle("active", x === t);
    }
    requestAnimationFrame(() => {
      t.fit.fit();
      t.term.focus();
    });
  }

  private fitActive() {
    if (this.active && this.el.offsetParent) {
      try {
        this.active.fit.fit();
      } catch {
        // not laid out yet
      }
    }
  }

  private close(t: Tab) {
    void invoke("pty_kill", { id: t.id });
    t.un.forEach((u) => u());
    t.term.dispose();
    t.el.remove();
    t.tab.remove();
    this.tabs = this.tabs.filter((x) => x !== t);
    if (this.active === t) {
      this.active = null;
      if (this.tabs.length) this.activate(this.tabs[this.tabs.length - 1]);
    }
  }
}
