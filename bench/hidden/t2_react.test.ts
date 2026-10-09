import { test } from "node:test";
import assert from "node:assert/strict";
import { collectReply } from "../ts/chat.ts";

test("a tag split across small chunks is still a reaction", () => {
  assert.deepEqual(collectReply(["[re", "act: 😂", "] Hi"]), { text: "Hi", reaction: "😂" });
  // The original filter keeps a space that arrives after the tag in a later chunk, so compare the trimmed text.
  const r = collectReply(["[", "r", "e", "a", "c", "t", ":", " ", "🔥", "]", " ok"]);
  assert.deepEqual({ text: r.text.trim(), reaction: r.reaction }, { text: "ok", reaction: "🔥" });
});
test("text that only starts like a tag passes through", () => {
  assert.deepEqual(collectReply(["[ref] see", " above"]), { text: "[ref] see above" });
});
test("no tag", () => assert.deepEqual(collectReply(["Plain", " reply"]), { text: "Plain reply" }));
