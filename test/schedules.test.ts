// Scheduled runs: when they're due, catch-up, and how they're described.
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeWhen, dueAt, isDue, type Schedule } from "../src/schedules";

const at = (s: string) => new Date(s).getTime(); // local time
function sch(over: Partial<Schedule>): Schedule {
  return {
    id: "x",
    name: "t",
    project: "C:/p",
    prompt: "p",
    model: "main",
    access: "read",
    when: { kind: "daily", time: "08:00", days: [] },
    enabled: true,
    catchUp: false,
    created: at("2026-10-01T00:00:00"),
    ...over,
  };
}
const START = at("2026-10-09T07:00:00"); // the app opened at 7:00

test("daily: due once the time has passed, then not again that day", () => {
  const s = sch({});
  assert.equal(isDue(s, at("2026-10-09T07:59:00"), START), false);
  assert.equal(isDue(s, at("2026-10-09T08:00:30"), START), true);
  s.lastRun = at("2026-10-09T08:00:40");
  assert.equal(isDue(s, at("2026-10-09T15:00:00"), START), false);
  assert.equal(isDue(s, at("2026-10-10T08:01:00"), START), true, "the next day");
});

test("only on the chosen days", () => {
  const s = sch({ when: { kind: "daily", time: "08:00", days: [1, 2, 3, 4, 5] } });
  // 2026-10-10 is a Saturday, 2026-10-12 a Monday
  assert.equal(isDue(s, at("2026-10-10T09:00:00"), at("2026-10-10T07:00:00")), false);
  assert.equal(isDue(s, at("2026-10-12T09:00:00"), at("2026-10-12T07:00:00")), true);
});

test("a time missed while the app was closed runs only with catch-up", () => {
  const opened = at("2026-10-09T10:00:00");
  assert.equal(isDue(sch({}), at("2026-10-09T10:00:10"), opened), false);
  assert.equal(isDue(sch({ catchUp: true }), at("2026-10-09T10:00:10"), opened), true);
});

test("a schedule made after today's time waits for tomorrow", () => {
  const s = sch({ created: at("2026-10-09T09:00:00") });
  assert.equal(isDue(s, at("2026-10-09T09:01:00"), START), false);
});

test("every N hours counts from the last run (or creation)", () => {
  const s = sch({ when: { kind: "every", hours: 6 }, created: at("2026-10-09T00:00:00") });
  assert.equal(dueAt(s, 0), at("2026-10-09T06:00:00"));
  assert.equal(isDue(s, at("2026-10-09T05:59:00"), START), false);
  assert.equal(isDue(s, at("2026-10-09T06:00:00"), START), true);
  s.lastRun = at("2026-10-09T06:01:00");
  assert.equal(isDue(s, at("2026-10-09T12:00:00"), START), false);
  assert.equal(isDue(s, at("2026-10-09T12:02:00"), START), true);
});

test("disabled schedules never run", () => {
  assert.equal(isDue(sch({ enabled: false }), at("2026-10-09T09:00:00"), START), false);
});

test("descriptions", () => {
  assert.equal(describeWhen({ kind: "daily", time: "08:00", days: [] }), "Daily at 08:00");
  assert.equal(describeWhen({ kind: "daily", time: "21:30", days: [5, 1, 2, 3, 4] }), "Daily at 21:30 (Mon–Fri)");
  assert.equal(describeWhen({ kind: "daily", time: "07:00", days: [0, 6] }), "Daily at 07:00 (Sun, Sat)");
  assert.equal(describeWhen({ kind: "every", hours: 1 }), "Every 1 hour");
});
