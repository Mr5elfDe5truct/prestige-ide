// A stand-in for the Rust side, so the app's real modules run under Node's test runner. Tauri's invoke() calls
// window.__TAURI_INTERNALS__.invoke; this answers those calls from an in-memory file system and scripted commands.
// Loaded before the tests with: node --import tsx --import ./test/fake-tauri.ts --test

export interface CmdResult {
  output: string;
  code: number | null;
  timed_out?: boolean;
  killed?: boolean;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
const key = (p: string) => norm(p).toLowerCase(); // Windows paths are case-insensitive

export const fake = {
  files: new Map<string, { path: string; text: string }>(),
  data: new Map<string, string>(), // the app data folder (settings, sessions)
  calls: [] as { cmd: string; args: any }[],
  /** Answers run_command; tests replace it. */
  run: (_args: { cwd: string; command: string; env?: Record<string, string> }): CmdResult => ({ output: "", code: 0 }),
  home: "C:/Users/test",

  reset() {
    this.files.clear();
    this.data.clear();
    this.calls = [];
    this.run = () => ({ output: "", code: 0 });
  },
  write(path: string, text: string) {
    this.files.set(key(path), { path: norm(path), text });
  },
  read(path: string): string | undefined {
    return this.files.get(key(path))?.text;
  },
  commands(cmd: string) {
    return this.calls.filter((c) => c.cmd === cmd).map((c) => c.args);
  },
};

function isDir(p: string) {
  const k = key(p) + "/";
  return [...fake.files.keys()].some((f) => f.startsWith(k));
}

function globRe(pattern: string) {
  const p = pattern.includes("/") ? pattern : `**/${pattern}`;
  let re = "";
  for (let i = 0; i < p.length; i++) {
    if (p[i] === "*" && p[i + 1] === "*") {
      re += "(?:.*/)?";
      i += p[i + 2] === "/" ? 2 : 1;
    } else if (p[i] === "*") re += "[^/]*";
    else re += p[i].replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

async function handle(cmd: string, a: any): Promise<any> {
  fake.calls.push({ cmd, args: a });
  switch (cmd) {
    case "fs_exists":
      return fake.files.has(key(a.path)) || isDir(a.path);
    case "fs_read": {
      const f = fake.files.get(key(a.path));
      if (!f) throw `${a.path}: The system cannot find the file specified. (os error 2)`;
      return f.text;
    }
    case "fs_write":
      fake.write(a.path, a.content);
      return null;
    case "fs_delete":
      if (!fake.files.delete(key(a.path))) throw `${a.path}: not found`;
      return null;
    case "fs_list": {
      const base = key(a.path) + "/";
      const names = new Map<string, boolean>();
      for (const f of fake.files.values()) {
        if (!f.path.toLowerCase().startsWith(base)) continue;
        const rest = f.path.slice(base.length).split("/");
        names.set(rest[0], rest.length > 1 || names.get(rest[0]) === true);
      }
      return [...names].map(([name, dir]) => ({ name, path: `${norm(a.path)}/${name}`, is_dir: dir, size: 0 }));
    }
    case "fs_glob": {
      const base = key(a.root) + "/";
      const re = globRe(a.pattern);
      return [...fake.files.values()].filter((f) => f.path.toLowerCase().startsWith(base) && re.test(f.path.slice(base.length))).map((f) => f.path);
    }
    case "fs_grep": {
      const re = new RegExp(a.pattern, a.ignoreCase ? "i" : "");
      const hits: any[] = [];
      for (const f of fake.files.values()) {
        if (!f.path.toLowerCase().startsWith(key(a.path))) continue;
        f.text.split(/\r?\n/).forEach((line, i) => re.test(line) && hits.push({ path: f.path, line: i + 1, text: line }));
      }
      return hits.slice(0, a.limit ?? 300);
    }
    case "run_command":
      return { timed_out: false, killed: false, ...fake.run(a) };
    case "kill_command":
      return null;
    case "data_read":
      return fake.data.get(a.rel) ?? null;
    case "data_write":
      fake.data.set(a.rel, a.content);
      return null;
    case "data_list":
      return [];
    case "data_delete":
      fake.data.delete(a.rel);
      return null;
    case "plugin:path|resolve_directory":
      return fake.home;
    case "plugin:event|listen":
      return 1;
    case "plugin:event|unlisten":
      return null;
    default:
      throw new Error(`fake-tauri: no handler for ${cmd}`);
  }
}

const g = globalThis as any;
g.window ??= g;
g.window.__TAURI_INTERNALS__ = {
  invoke: handle,
  transformCallback: () => 0,
  unregisterCallback: () => {},
  convertFileSrc: (p: string) => p,
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
};
