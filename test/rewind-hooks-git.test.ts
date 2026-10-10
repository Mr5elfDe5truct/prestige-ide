// Rewind (puts files back), hooks (their exit codes decide what's blocked) and the git chip's status parsing.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fake } from "./fake-tauri.ts";
import { applyRewind, checkpoints, planRewind } from "../src/rewind";
import { runHooks } from "../src/hooks";
import { loadConfig } from "../src/config";
import { status as gitStatus } from "../src/git";
import type { Session, StoredMessage } from "../src/store";

const ROOT = "C:/proj";
beforeEach(() => fake.reset());

function session(messages: StoredMessage[]): Session {
  return { id: "s", title: "", project: ROOT, created: 0, updated: 0, modelKey: "", mode: "ask", messages, todos: [], allow: [] };
}
const user = (content: string): StoredMessage => ({ role: "user", content });
const edit = (path: string, before: string | null, after: string): StoredMessage => ({
  role: "tool",
  tool_name: "edit_file",
  content: "Edited",
  meta: { ok: true, path, before, after },
});

describe("rewind", () => {
  test("puts every file back as it was at the checkpoint, and drops the later turns", async () => {
    fake.write(`${ROOT}/a.py`, "v3");
    fake.write(`${ROOT}/new.py`, "made later");
    const s = session([
      user("first"),
      edit(`${ROOT}/a.py`, "v0", "v1"),
      user("second"),
      edit(`${ROOT}/a.py`, "v1", "v2"),
      edit(`${ROOT}/new.py`, null, "made later"),
      edit(`${ROOT}/a.py`, "v2", "v3"),
    ]);
    const plan = planRewind(s, 2);
    assert.deepEqual(plan.files.map((f) => [f.path, f.before]), [[`${ROOT}/a.py`, "v1"], [`${ROOT}/new.py`, null]]);
    const r = await applyRewind(s, plan);
    assert.equal(fake.read(`${ROOT}/a.py`), "v1");
    assert.equal(fake.read(`${ROOT}/new.py`), undefined, "a file the agent created after the checkpoint is deleted");
    assert.equal(s.messages.length, 2);
    assert.equal(r.text, "second");
    assert.deepEqual(r.failed, []);
  });

  test("counts the commands it can't undo", () => {
    const s = session([
      user("go"),
      { role: "tool", tool_name: "run_command", content: "ok", meta: { ok: true } },
      { role: "tool", tool_name: "run_command", content: "no", meta: { ok: false, denied: true } },
    ]);
    assert.equal(planRewind(s, 0).commands, 1);
  });

  test("rewinding past a compaction brings back the messages it summarised", async () => {
    const s = session([
      { role: "user", content: "old", archived: 111 },
      { role: "assistant", content: "old reply", archived: 111 },
      { role: "user", content: "summary", summary: true, at: 111 },
      user("next"),
    ]);
    await applyRewind(s, planRewind(s, 2));
    assert.equal(s.messages.length, 2);
    assert.ok(s.messages.every((m) => !m.archived));
  });

  test("hook notes, summaries and archived messages aren't checkpoints", () => {
    const s = session([user("a"), { role: "user", content: "[Stop hook] x", hook: true }, { role: "user", content: "s", summary: true }, user("b")]);
    assert.deepEqual(checkpoints(s).map((c) => c.index), [3, 0]);
  });

  test("the message's attached files are left out of the text that goes back in the box", async () => {
    const s = session([user('look\n\n<attached-files>\n<file path="a">x</file>\n</attached-files>')]);
    assert.equal((await applyRewind(s, planRewind(s, 0))).text, "look");
  });
});

describe("hooks", () => {
  async function hooks(h: any) {
    fake.write(`${fake.home}/.prestige/settings.json`, JSON.stringify({ hooks: h }));
    await loadConfig(ROOT);
  }

  test("exit code 2 blocks, and its output is the reason", async () => {
    await hooks({ PreToolUse: [{ matcher: "run_command", command: "check" }] });
    fake.run = () => ({ output: "No deleting here.", code: 2 });
    const r = await runHooks("PreToolUse", ROOT, { tool: "run_command", args: { command: "Remove-Item x" } });
    assert.deepEqual(r, { blocked: true, output: "No deleting here.", warnings: [] });
  });

  test("exit code 0 passes its output along; other codes warn and carry on", async () => {
    await hooks({ PostToolUse: [{ command: "a" }, { command: "b" }] });
    fake.run = (a) => (a.command === "a" ? { output: "syntax OK", code: 0 } : { output: "oops", code: 1 });
    const r = await runHooks("PostToolUse", ROOT, { tool: "edit_file", args: { path: "x.py" } });
    assert.equal(r.blocked, false);
    assert.equal(r.output, "syntax OK");
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /exited 1/);
  });

  test("the matcher is a regex on the tool name", async () => {
    await hooks({ PostToolUse: [{ matcher: "edit_file|write_file", command: "fmt" }] });
    await runHooks("PostToolUse", ROOT, { tool: "read_file", args: {} });
    assert.equal(fake.commands("run_command").length, 0);
    await runHooks("PostToolUse", ROOT, { tool: "write_file", args: { path: "a.py" } });
    assert.equal(fake.commands("run_command").length, 1);
  });

  test("hooks get the event, tool, file and command in their environment", async () => {
    await hooks({ PreToolUse: [{ command: "env" }] });
    await runHooks("PreToolUse", ROOT, { tool: "edit_file", args: { path: "src/a.ts" } });
    const env = fake.commands("run_command")[0].env;
    assert.equal(env.PRESTIGE_EVENT, "PreToolUse");
    assert.equal(env.PRESTIGE_TOOL, "edit_file");
    assert.equal(env.PRESTIGE_FILE, "C:/proj/src/a.ts");
    assert.equal(env.PRESTIGE_PROJECT, ROOT);
    assert.equal(JSON.parse(env.PRESTIGE_HOOK_INPUT).args.path, "src/a.ts");
  });

  test("a block stops the hooks after it", async () => {
    await hooks({ Stop: [{ command: "first" }, { command: "second" }] });
    fake.run = () => ({ output: "not yet", code: 2 });
    await runHooks("Stop", ROOT, {});
    assert.equal(fake.commands("run_command").length, 1);
  });

  test("no hooks, no commands", async () => {
    await loadConfig(ROOT);
    assert.deepEqual(await runHooks("Stop", ROOT, {}), { blocked: false, output: "", warnings: [] });
    assert.equal(fake.commands("run_command").length, 0);
  });
});

describe("git status", () => {
  const porcelain = (lines: string[]) => (a: any) =>
    a.command.includes("status --porcelain") ? { output: lines.join("\n"), code: 0 } : a.command.includes("remote get-url") ? { output: "https://github.com/x/y.git", code: 0 } : { output: "", code: 0 };

  test("branch, changed files and ahead/behind", async () => {
    fake.run = porcelain(["# branch.oid abc", "# branch.head feature/x", "# branch.upstream origin/feature/x", "# branch.ab +2 -1", "1 .M N... 100644 100644 100644 a b src/a.ts", "? new.txt"]);
    assert.deepEqual(await gitStatus(ROOT), { repo: true, branch: "feature/x", changed: 2, ahead: 2, behind: 1, upstream: true, remote: "https://github.com/x/y.git" });
  });

  test("a clean branch with no upstream", async () => {
    fake.run = porcelain(["# branch.oid abc", "# branch.head main"]);
    const st = await gitStatus(ROOT);
    assert.equal(st.changed, 0);
    assert.equal(st.upstream, false);
  });

  test("detached HEAD", async () => {
    fake.run = porcelain(["# branch.oid abc", "# branch.head (detached)"]);
    assert.equal((await gitStatus(ROOT)).branch, "detached HEAD");
  });

  test("not a repository", async () => {
    fake.run = () => ({ output: "fatal: not a git repository", code: 128 });
    assert.equal((await gitStatus(ROOT)).repo, false);
  });
});
