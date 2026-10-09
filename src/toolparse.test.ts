import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTextToolCalls as x } from "./toolparse.ts";

const known = new Set(["read_file", "edit_file", "grep", "run_command"]);
test("the format seen in the bake-off", () => {
  const r = x("read_file\n\n<path>py/transcribe_clips.py</path>", known);
  assert.deepEqual(r.calls.map((c) => [c.name, c.arguments]), [["read_file", { path: "py/transcribe_clips.py" }]]);
  assert.equal(r.text, "");
});
test("text before the call is kept", () => {
  const r = x("Let me look at it.\n\nread_file\n<path>a.ts</path>\n<offset>10</offset>", known);
  assert.deepEqual(r.calls[0].arguments, { path: "a.ts", offset: "10" });
  assert.equal(r.text, "Let me look at it.");
});
test("JSON arguments", () => {
  const r = x('grep\n{"pattern": "foo", "glob": "*.py"}', known);
  assert.deepEqual(r.calls[0], { id: "text_0", name: "grep", arguments: { pattern: "foo", glob: "*.py" } });
});
test("multi-line values", () => {
  const r = x("edit_file\n<path>a.py</path>\n<old_string>\nx = 1\ny = 2\n</old_string>\n<new_string>\nx = 3\n</new_string>", known);
  assert.deepEqual(r.calls[0].arguments, { path: "a.py", old_string: "x = 1\ny = 2", new_string: "x = 3" });
});
test("unknown names and ordinary text are left alone", () => {
  assert.equal(x("summary\n<b>bold</b>", known).calls.length, 0);
  assert.equal(x("The fix is done. Run `read_file` to see it.", known).calls.length, 0);
  assert.equal(x("read_file\n<path>a</path>").calls.length, 0, "no known set, no loose parsing");
});
test("existing formats still work", () => {
  assert.equal(x('<tool_call>{"name":"grep","arguments":{"pattern":"a"}}</tool_call>').calls[0].name, "grep");
  assert.deepEqual(x("<function=read_file><parameter=path>b.ts</parameter></function>").calls[0].arguments, { path: "b.ts" });
});
