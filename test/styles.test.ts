// Output styles: built-ins, custom files from the project and the user's folder, and the fallback.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fake } from "./fake-tauri.ts";
import { BUILT_IN, listStyles, stylePrompt } from "../src/styles-output";

const ROOT = "C:/proj";
beforeEach(() => fake.reset());

test("unknown or unset styles fall back to the default", async () => {
  assert.equal(await stylePrompt(undefined, ROOT), BUILT_IN[0].prompt);
  assert.equal(await stylePrompt("nope", ROOT), BUILT_IN[0].prompt);
  assert.match(await stylePrompt("terse", ROOT), /as few words as possible/);
});

test("custom styles come from the user's and the project's folders", async () => {
  fake.write(`${fake.home}/.prestige/output-styles/pirate.md`, "Answer like a pirate.");
  fake.write(`${ROOT}/.prestige/output-styles/bullets.md`, "Answer in bullet points.\n");
  const styles = await listStyles(ROOT);
  assert.deepEqual(styles.slice(BUILT_IN.length).map((s) => [s.id, s.hint]), [["pirate", "your style"], ["bullets", "project style"]]);
  assert.equal(await stylePrompt("bullets", ROOT), "Answer in bullet points.");
});

test("a custom file named like a built-in replaces it; empty files are ignored", async () => {
  fake.write(`${ROOT}/.prestige/output-styles/terse.md`, "Our terse.");
  fake.write(`${ROOT}/.prestige/output-styles/empty.md`, "  \n");
  const styles = await listStyles(ROOT);
  assert.equal(styles.filter((s) => s.id === "terse").length, 1);
  assert.equal(await stylePrompt("terse", ROOT), "Our terse.");
  assert.ok(!styles.some((s) => s.id === "empty"));
});
