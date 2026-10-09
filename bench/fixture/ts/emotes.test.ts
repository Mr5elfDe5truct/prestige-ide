import { test } from "node:test";
import assert from "node:assert/strict";
import { collectReply } from "./chat.ts";

test("a reaction tag at the start becomes the reaction", () => {
  assert.deepEqual(collectReply(["[react: 😂] That's funny"]), { text: "That's funny", reaction: "😂" });
});

test("a reply without a tag passes through", () => {
  assert.deepEqual(collectReply(["Hello", " there"]), { text: "Hello there" });
});
