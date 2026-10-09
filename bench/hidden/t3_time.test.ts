import { test } from "node:test";
import assert from "node:assert/strict";
import { aboutTime } from "../ts/genmath.ts";

test("minutes are rounded to the half minute under 10 min", () => {
  assert.equal(aboutTime(150), "about 2.5 min");
  assert.equal(aboutTime(90), "about 1.5 min");
  assert.equal(aboutTime(330), "about 5.5 min");
  assert.equal(aboutTime(56), "about 1 min");
});
test("whole minutes from 10 min", () => {
  assert.equal(aboutTime(600), "about 10 min");
  assert.equal(aboutTime(725), "about 12 min");
});
test("seconds", () => assert.equal(aboutTime(54), "about 55 s"));
