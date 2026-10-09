import { test } from "node:test";
import assert from "node:assert/strict";
import { fitWithin } from "../ts/genmath.ts";

test("scales down to the longest side, multiples of 16", () => {
  assert.deepEqual(fitWithin(1920, 1080, 1024), [1024, 576]);
  assert.deepEqual(fitWithin(1080, 1920, 1024), [576, 1024]);
});
test("never scales up, still rounds down", () => assert.deepEqual(fitWithin(800, 600, 1024), [800, 592]));
test("not below one multiple", () => assert.deepEqual(fitWithin(4000, 10, 512), [512, 16]));
test("custom multiple", () => assert.deepEqual(fitWithin(1000, 1000, 1000, 64), [960, 960]));
