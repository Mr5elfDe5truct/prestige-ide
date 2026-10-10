// The Preview pane: the app being built, live from its dev server. "Start dev server" guesses the command from the
// project (npm run dev, …), runs it in a terminal tab and picks up the address it prints.
import { invoke } from "@tauri-apps/api/core";
import { h } from "./transcript";
import type { TerminalPane } from "./terminal";

const LOCAL = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\]|[\w.-]+\.localhost)(:\d+)?(\/|$)/i;
const URL_IN_OUTPUT = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|[\w.-]+\.localhost)(?::\d+)?[^\s"'<>]*/i;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

export class PreviewPane {
  el = h("div", "preview-pane");
  private url = h("input", "preview-url") as HTMLInputElement;
  private frame = h("iframe", "preview-frame") as HTMLIFrameElement;
  private empty = h("div", "editor-empty");
  private status = h("span", "preview-status");
  private project = "";
  private watching = false;

  constructor(private terminal: TerminalPane, private hooks: { status: (t: string) => void }) {
    const bar = h("div", "preview-bar");
    this.url.placeholder = "http://localhost:5173";
    this.url.spellcheck = false;
    this.url.onkeydown = (e) => e.key === "Enter" && this.go(this.url.value);
    const reload = h("button", "icon-btn", "⟳");
    reload.title = "Reload";
    reload.onclick = () => this.go(this.url.value);
    const out = h("button", "icon-btn", "↗");
    out.title = "Open in your browser";
    out.onclick = () => this.url.value && void invoke("reveal", { path: this.url.value });
    const start = h("button", "btn small", "▶ Start dev server");
    start.onclick = () => void this.startServer();
    bar.append(this.url, reload, out, start, this.status);
    this.frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-modals");
    this.empty.innerHTML = `<div class="empty-title">Nothing to preview yet</div><div class="empty-sub">Start your project's dev server, or type its address (http://localhost:…). The agent can look too, with its preview_page tool.</div>`;
    const body = h("div", "preview-body");
    body.append(this.frame, this.empty);
    this.el.append(bar, body);
    this.frame.hidden = true;
  }

  setProject(p: string) {
    if (p === this.project) return;
    this.project = p;
    this.watching = false;
    let saved = "";
    try {
      saved = localStorage.getItem(`preview:${p}`) ?? "";
    } catch {
      // storage unavailable
    }
    this.url.value = saved;
    this.frame.hidden = true;
    this.empty.hidden = false;
    this.frame.removeAttribute("src");
  }

  /** Loads the page when the pane is shown, if there's an address. */
  shown() {
    if (this.url.value && this.frame.hidden) this.go(this.url.value);
  }

  go(raw: string) {
    let u = raw.trim();
    if (!u) return;
    if (/^\d+$/.test(u)) u = `http://localhost:${u}`;
    if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
    if (!LOCAL.test(u)) {
      this.status.textContent = "Only local addresses (localhost)";
      return;
    }
    this.url.value = u;
    try {
      localStorage.setItem(`preview:${this.project}`, u);
    } catch {
      // storage unavailable
    }
    this.status.textContent = "";
    this.frame.hidden = false;
    this.empty.hidden = true;
    // Setting the same address again doesn't reload an iframe, so blank it first.
    if (this.frame.getAttribute("src") === u) {
      this.frame.src = "about:blank";
      requestAnimationFrame(() => (this.frame.src = u));
    } else this.frame.src = u;
  }

  /** The likely dev-server command for this project. */
  private async guessCommand(): Promise<string> {
    const read = (f: string) => invoke<string>("fs_read", { path: `${this.project}/${f}` }).catch(() => "");
    const pkg = await read("package.json");
    if (pkg) {
      try {
        const scripts = JSON.parse(pkg).scripts ?? {};
        const run = (await invoke<boolean>("fs_exists", { path: `${this.project}/pnpm-lock.yaml` })) ? "pnpm" : (await invoke<boolean>("fs_exists", { path: `${this.project}/yarn.lock` })) ? "yarn" : "npm run";
        for (const s of ["dev", "start", "serve", "preview"]) if (scripts[s]) return `${run} ${s}`;
      } catch {
        // not valid JSON: fall through
      }
    }
    if (await read("manage.py")) return "python manage.py runserver";
    if (await read("index.html")) return "python -m http.server 8000 --bind 127.0.0.1";
    return "";
  }

  private async startServer() {
    if (!this.project) return;
    const guess = await this.guessCommand();
    const cmd = prompt("Command that starts the dev server", guess)?.trim();
    if (!cmd) return;
    this.status.textContent = "Starting…";
    this.watching = true;
    let buf = "";
    await this.terminal.start(cmd, "Dev server", (chunk) => {
      if (!this.watching) return;
      buf = (buf + chunk.replace(ANSI, "")).slice(-4000);
      const m = buf.match(URL_IN_OUTPUT);
      if (m) {
        this.watching = false;
        const u = m[0].replace(/[.,;)]+$/, "");
        this.status.textContent = "";
        this.hooks.status(`Dev server at ${u}`);
        setTimeout(() => this.go(u), 600);
      }
    });
    // Servers that never print an address: fall back to the one typed in, if any.
    setTimeout(() => {
      if (this.watching) {
        this.watching = false;
        this.status.textContent = this.url.value ? "" : "Started. Type its address above.";
        if (this.url.value) this.go(this.url.value);
      }
    }, 30000);
  }
}
