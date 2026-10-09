// Runs the bake-off through a running dev build of Prestige IDE (npm run tauri dev with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333).
//   node bench/run.mjs RESULTS_DIR [config ...] [--tasks t01,t02]
// Results go to RESULTS_DIR/results.jsonl, one line per run; finished runs are skipped, so it can be restarted.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIGS = {
  "main-think": { model: "llama:qwen3.6-35b-uncensored", label: "Qwen3.6 35B Heretic (Main), thinking" },
  "main-fast": { model: "llama:qwen3.6-35b-uncensored", think: false, label: "Qwen3.6 35B Heretic (Main), no thinking" },
  "hauhau-27b": { model: "llama:qwen3.8-27b-uncensored-2gpu", label: "Qwen3.8 27B HauhauCS Q3 (2 GPUs)" },
  "neocoder-27b": { model: "llama:qwen3.8-27b-neo-coder-2gpu", label: "Qwen3.8 27B NEO-CODER IQ3_M (2 GPUs)" },
  "huihui-27b": { model: "llama:qwen3.8-27b-huihui-2gpu", label: "Qwen3.8 27B Huihui abliterated IQ3_S (2 GPUs)" },
};

const args = process.argv.slice(2);
const out = args.shift();
const taskArg = args.indexOf("--tasks");
const onlyTasks = taskArg >= 0 ? args.splice(taskArg, 2)[1].split(",") : null;
const configs = args.length ? args : Object.keys(CONFIGS);
const tasks = JSON.parse(fs.readFileSync(path.join(HERE, "tasks.json"), "utf8")).filter((t) => !onlyTasks || onlyTasks.some((p) => t.id.startsWith(p)));
fs.mkdirSync(out, { recursive: true });
const resultsFile = path.join(out, "results.jsonl");
const done = new Set(
  fs.existsSync(resultsFile)
    ? fs.readFileSync(resultsFile, "utf8").split("\n").filter(Boolean).map((l) => {
        const j = JSON.parse(l);
        return `${j.config}|${j.task}`;
      })
    : [],
);

async function page() {
  const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
  const t = targets.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:1430"));
  if (!t) throw new Error("no Prestige IDE dev window on port 9333");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  return {
    eval(expr) {
      return new Promise((r) => {
        const i = ++id;
        pending.set(i, r);
        ws.send(JSON.stringify({ id: i, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
      }).then((m) => m.result?.result?.value ?? { error: JSON.stringify(m.result?.exceptionDetails ?? m).slice(0, 500) });
    },
    close: () => ws.close(),
  };
}

const py = (...a) => execFileSync("python", ["-I", path.join(HERE, "bench.py"), ...a], { encoding: "utf8", env: { ...process.env } }).trim();

for (const c of configs) {
  const cfg = CONFIGS[c];
  for (const t of tasks) {
    const key = `${c}|${t.id}`;
    if (done.has(key)) continue;
    const dir = path.join(out, "work", c, t.id);
    const project = py("prepare", t.id, dir).split("\n").pop();
    const p = await page();
    const started = new Date().toISOString();
    process.stdout.write(`${c} ${t.id} … `);
    const r = await p.eval(
      `window.__bench.run(${JSON.stringify({ project, modelKey: cfg.model, mode: t.mode, prompt: t.prompt, think: cfg.think, timeoutMs: 20 * 60000 })})`,
    );
    p.close();
    const ansFile = path.join(out, "work", `${c}-${t.id}.answer.txt`);
    fs.mkdirSync(path.dirname(ansFile), { recursive: true });
    fs.writeFileSync(ansFile, r.final ?? "");
    let g;
    try {
      g = JSON.parse(py("grade", t.id, project, ansFile));
    } catch (e) {
      g = { pass: false, detail: `grader failed: ${e}` };
    }
    let diff = "";
    if (!t.project.startsWith("repo:")) {
      try {
        diff = execFileSync("git", ["diff", "--stat"], { cwd: project, encoding: "utf8" }).trim();
      } catch {}
    }
    const row = { config: c, label: cfg.label, task: t.id, kind: t.kind, started, pass: g.pass, grade: g.detail, diff, ...r };
    fs.appendFileSync(resultsFile, JSON.stringify(row) + "\n");
    console.log(`${g.pass ? "PASS" : "fail"} · ${r.seconds}s · ${r.turns} turns · ${r.toolCalls} tools${r.timedOut ? " · TIMED OUT" : ""}${r.error ? " · " + r.error.slice(0, 80) : ""}`);
  }
}
console.log("done");
