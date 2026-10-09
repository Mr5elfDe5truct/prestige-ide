import { test } from "node:test";
import assert from "node:assert/strict";
import { aboutTime, imageDims, ltxFrames } from "./genmath.ts";

test("square standard image", () => assert.deepEqual(imageDims("1:1", "standard"), [1024, 1024]));
test("LTX frames are 8n + 1", () => assert.equal(ltxFrames(5, 24), 121));
test("short times in seconds", () => assert.equal(aboutTime(42), "about 40 s"));
