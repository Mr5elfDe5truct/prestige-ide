// Cloud models: limits from a service's model list, and tool calls Gemini didn't sign passed to it as text.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./fake-tauri.ts";
import { cloudLimits, prepareOpenAIMessages, type ChatMessage } from "../src/backends";

test("context and vision come from the model list, with sensible fallbacks", () => {
  assert.deepEqual(cloudLimits({ context_length: 200000, architecture: { input_modalities: ["text"] } }, "some/model"), { ctx: 200000, vision: false });
  assert.deepEqual(cloudLimits({ context_window: 32768 }, "llama-3.3-70b-versatile"), { ctx: 32768, vision: false });
  assert.deepEqual(cloudLimits({}, "gemini-3.5-flash"), { ctx: 1_048_576, vision: true });
  assert.equal(cloudLimits({}, "mystery-model").ctx, 131_072);
});

test("unsigned tool calls become text for Gemini; signed ones stay tool calls", () => {
  const msgs: ChatMessage[] = [
    { role: "user", content: "fix it" },
    { role: "assistant", content: "", tool_calls: [{ id: "a", name: "read_file", arguments: { path: "x.ts" } }] },
    { role: "tool", content: "file text", tool_call_id: "a", tool_name: "read_file" },
    { role: "assistant", content: "", tool_calls: [{ id: "b", name: "grep", arguments: { pattern: "y" }, extra_content: { google: { thought_signature: "sig" } } }] },
    { role: "tool", content: "match", tool_call_id: "b", tool_name: "grep" },
  ];
  const out = prepareOpenAIMessages(msgs, true);
  assert.equal(out[1].tool_calls, undefined);
  assert.match(out[1].content, /\[Called read_file/);
  assert.equal(out[2].role, "user");
  assert.match(out[2].content, /Tool result for read_file/);
  assert.equal(out[3].tool_calls[0].extra_content.google.thought_signature, "sig");
  assert.equal(out[4].role, "tool");
  // Local servers get the messages unchanged.
  assert.equal(prepareOpenAIMessages(msgs, false)[1].tool_calls[0].function.name, "read_file");
});
