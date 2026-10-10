// The agent's tools: file edits, reads and writes against the fake file system, paths, and the approval rules.
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fake } from "./fake-tauri.ts";
import { allowRuleFor, needsApproval, relPath, resolvePath, runTool, type ToolContext } from "../src/tools";

const ROOT = "C:/proj";
const ctx = (): ToolContext => ({ root: ROOT, signal: new AbortController().signal, setTodos: () => {} });
const run = (name: string, args: any) => runTool(name, args, ctx());

beforeEach(() => fake.reset());

describe("edit_file", () => {
  test("replaces a unique match and records before and after", async () => {
    fake.write(`${ROOT}/a.py`, "x = 1\ny = 2\n");
    const r = await run("edit_file", { path: "a.py", old_string: "y = 2", new_string: "y = 3" });
    assert.equal(r.meta.ok, true);
    assert.equal(fake.read(`${ROOT}/a.py`), "x = 1\ny = 3\n");
    assert.equal(r.meta.before, "x = 1\ny = 2\n");
    assert.equal(r.meta.after, "x = 1\ny = 3\n");
  });

  test("text that isn't there is an error, and the file is untouched", async () => {
    fake.write(`${ROOT}/a.py`, "x = 1\n");
    const r = await run("edit_file", { path: "a.py", old_string: "x = 2", new_string: "x = 3" });
    assert.equal(r.meta.ok, false);
    assert.match(r.content, /was not found/);
    assert.equal(fake.read(`${ROOT}/a.py`), "x = 1\n");
  });

  test("an ambiguous match is refused unless replace_all is set", async () => {
    fake.write(`${ROOT}/a.py`, "a()\na()\n");
    const r = await run("edit_file", { path: "a.py", old_string: "a()", new_string: "b()" });
    assert.equal(r.meta.ok, false);
    assert.match(r.content, /appears 2 times/);
    const all = await run("edit_file", { path: "a.py", old_string: "a()", new_string: "b()", replace_all: true });
    assert.equal(all.meta.ok, true);
    assert.equal(fake.read(`${ROOT}/a.py`), "b()\nb()\n");
  });

  test("Windows line endings: an LF old_string still matches and CRLF is kept", async () => {
    fake.write(`${ROOT}/a.ts`, "one\r\ntwo\r\nthree\r\n");
    const r = await run("edit_file", { path: "a.ts", old_string: "one\ntwo", new_string: "one\n2" });
    assert.equal(r.meta.ok, true);
    assert.equal(fake.read(`${ROOT}/a.ts`), "one\r\n2\r\nthree\r\n");
  });

  test("$ patterns in the replacement are inserted literally", async () => {
    fake.write(`${ROOT}/a.js`, "let v = OLD;\n");
    await run("edit_file", { path: "a.js", old_string: "OLD", new_string: "'$&' + `${x}` + '$1'" });
    assert.equal(fake.read(`${ROOT}/a.js`), "let v = '$&' + `${x}` + '$1';\n");
  });

  test("refuses empty, unchanged and missing-file edits", async () => {
    fake.write(`${ROOT}/a.py`, "x\n");
    assert.match((await run("edit_file", { path: "a.py", old_string: "", new_string: "y" })).content, /old_string is empty/);
    assert.match((await run("edit_file", { path: "a.py", old_string: "x", new_string: "x" })).content, /the same/);
    assert.match((await run("edit_file", { path: "nope.py", old_string: "x", new_string: "y" })).content, /does not exist/);
  });
});

describe("write_file and read_file", () => {
  test("a new file records that there was nothing before", async () => {
    const r = await run("write_file", { path: "new/dir/b.md", content: "hi\n" });
    assert.equal(r.meta.ok, true);
    assert.equal(r.meta.before, null);
    assert.equal(fake.read(`${ROOT}/new/dir/b.md`), "hi\n");
    assert.match(r.content, /^Created/);
  });

  test("overwriting keeps the old text for revert", async () => {
    fake.write(`${ROOT}/b.md`, "old");
    const r = await run("write_file", { path: "b.md", content: "new" });
    assert.equal(r.meta.before, "old");
    assert.match(r.content, /^Wrote/);
  });

  test("numbers lines and pages with offset and limit", async () => {
    fake.write(`${ROOT}/c.txt`, ["l1", "l2", "l3", "l4", "l5"].join("\n"));
    const all = await run("read_file", { path: "c.txt" });
    assert.match(all.content, /^\s+1\tl1\n\s+2\tl2/);
    const part = await run("read_file", { path: "c.txt", offset: 2, limit: 2 });
    assert.match(part.content, /^\s+2\tl2\n\s+3\tl3\n… 2 more lines \(use offset 4\)$/);
  });

  test("an empty file says so", async () => {
    fake.write(`${ROOT}/e.txt`, "");
    assert.equal((await run("read_file", { path: "e.txt" })).content, "(empty file)");
  });
});

describe("paths", () => {
  test("resolves relative paths against the project", () => {
    assert.equal(resolvePath(ROOT, "src/a.ts"), "C:/proj/src/a.ts");
    assert.equal(resolvePath(ROOT, "./src/a.ts"), "C:/proj/src/a.ts");
    assert.equal(resolvePath(ROOT, "src\\ui\\b.ts"), "C:/proj/src/ui/b.ts");
    assert.equal(resolvePath(ROOT, "src/../b.ts"), "C:/proj/b.ts");
    assert.equal(resolvePath(ROOT, ""), "C:/proj");
  });
  test("keeps absolute paths", () => {
    assert.equal(resolvePath(ROOT, "D:\\other\\x.ts"), "D:/other/x.ts");
    assert.equal(resolvePath(ROOT, "//server/share/x"), "//server/share/x");
  });
  test("relPath is case-insensitive, like Windows", () => {
    assert.equal(relPath("C:/Proj", "c:/proj/src/a.ts"), "src/a.ts");
    assert.equal(relPath(ROOT, "D:/elsewhere/a.ts"), "D:/elsewhere/a.ts");
  });
});

describe("approvals", () => {
  const cmd = (command: string) => ({ command });

  test("reading never asks; editing asks unless the mode or a rule allows it", () => {
    assert.equal(needsApproval("read_file", {}, "ask", []), false);
    assert.equal(needsApproval("grep", {}, "ask", []), false);
    assert.equal(needsApproval("edit_file", {}, "ask", []), true);
    assert.equal(needsApproval("edit_file", {}, "acceptEdits", []), false);
    assert.equal(needsApproval("edit_file", {}, "ask", ["edit:*"]), false);
    assert.equal(needsApproval("write_file", {}, "bypass", []), false);
  });

  test("commands ask, even in accept-edits mode", () => {
    assert.equal(needsApproval("run_command", cmd("npm test"), "ask", []), true);
    assert.equal(needsApproval("run_command", cmd("npm test"), "acceptEdits", []), true);
    assert.equal(needsApproval("run_command", cmd("npm test"), "bypass", []), false);
  });

  test("don't ask again covers the first two words of the command", () => {
    const rule = allowRuleFor("run_command", cmd("npm test -- --watch"));
    assert.equal(rule, "run_command:npm test");
    assert.equal(needsApproval("run_command", cmd("npm test"), "ask", [rule]), false);
    assert.equal(needsApproval("run_command", cmd("npm test -- --grep x"), "ask", [rule]), false);
    assert.equal(needsApproval("run_command", cmd("npm run build"), "ask", [rule]), true);
  });

  test("an approved prefix only matches whole words", () => {
    assert.equal(needsApproval("run_command", cmd("npm testx"), "ask", ["run_command:npm test"]), true);
  });

  test("chained commands always ask, whatever was approved", () => {
    const allow = ["run_command:npm test"];
    for (const c of ["npm test; Remove-Item -Recurse x", "npm test | Out-File x", "npm test && rm x", "npm test `\nrm x", "npm test $(rm x)"]) {
      assert.equal(needsApproval("run_command", cmd(c), "ask", allow), true, c);
    }
  });

  test("a newline is a command separator too", () => {
    const allow = ["run_command:npm test"];
    assert.equal(needsApproval("run_command", cmd("npm test\nRemove-Item -Recurse C:\\data"), "ask", allow), true);
    assert.equal(needsApproval("run_command", cmd("npm test\r\nRemove-Item x"), "ask", allow), true);
  });
});
