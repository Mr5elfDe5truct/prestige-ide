// Scheduled runs: agent jobs on a timetable while the app is open, like Prestige's Missions. Nobody is there to say
// "Allow?", so a run declines anything that would ask (settings-file allow rules still apply), and its result is saved
// as a session and announced with a Windows notification.
import { listModels, type ModelInfo } from "./backends";
import { runAgent, type AgentUI } from "./agent";
import { loadConfig } from "./config";
import { newId, saveSession, saveSettings, settings, type Session, type Tier } from "./store";

export type When = { kind: "daily"; time: string; days: number[] } | { kind: "every"; hours: number };

export interface Schedule {
  id: string;
  name: string;
  project: string;
  prompt: string;
  model: Tier | string; // a tier, or a model key
  access: "read" | "edit"; // read: changes nothing; edit: may edit files (never runs unapproved commands)
  when: When;
  enabled: boolean;
  catchUp: boolean; // run once at launch if a daily time passed while the app was closed
  lastRun?: number;
  created: number;
}

const DAY = 86400000;

/** The most recent scheduled moment at or before `now` (daily), or the next moment after lastRun (every N hours). */
export function dueAt(s: Schedule, now: number): number | null {
  if (s.when.kind === "every") {
    const hours = Math.max(0.25, Number(s.when.hours) || 24);
    return (s.lastRun ?? s.created) + hours * 3600000;
  }
  const [hh, mm] = s.when.time.split(":").map(Number);
  const days = s.when.days.length ? s.when.days : [0, 1, 2, 3, 4, 5, 6];
  // Walk back from today to the latest allowed day whose time has passed.
  for (let back = 0; back < 8; back++) {
    const d = new Date(now - back * DAY);
    d.setHours(hh || 0, mm || 0, 0, 0);
    if (d.getTime() <= now && days.includes(d.getDay())) return d.getTime();
  }
  return null;
}

/** Whether a schedule should run now. `since` is when the app started: a daily run missed while it was closed only
 *  runs (once) if catchUp is on. */
export function isDue(s: Schedule, now: number, since: number): boolean {
  if (!s.enabled) return false;
  const at = dueAt(s, now);
  if (at === null || at > now) return false;
  if (s.when.kind === "every") return true;
  if (s.lastRun !== undefined && s.lastRun >= at) return false;
  if (at < s.created) return false; // created after today's time: wait for the next one
  return at >= since || s.catchUp;
}

/** "Daily at 08:00 (Mon–Fri)", "Every 6 hours". */
export function describeWhen(w: When): string {
  if (w.kind === "every") return `Every ${w.hours} hour${w.hours === 1 ? "" : "s"}`;
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const days = [...w.days].sort();
  const which = days.length === 0 || days.length === 7 ? "" : days.join() === "1,2,3,4,5" ? " (Mon–Fri)" : ` (${days.map((d) => names[d]).join(", ")})`;
  return `Daily at ${w.time}${which}`;
}

export interface RunnerHooks {
  busy: () => boolean; // the user's own task is running
  done: (s: Session, sch: Schedule) => void;
}

let running = false;
const started = Date.now();

async function modelFor(sch: Schedule): Promise<ModelInfo | undefined> {
  const { models } = await listModels();
  const key = (settings.tiers as Record<string, string>)[sch.model] ?? sch.model;
  return models.find((m) => m.key === key) ?? models.find((m) => m.key === settings.tiers.main);
}

export async function runSchedule(sch: Schedule, hooks: RunnerHooks): Promise<Session | null> {
  if (running) return null;
  running = true;
  try {
    const model = await modelFor(sch);
    if (!model) throw new Error("no model available (is the Workstation running?)");
    await loadConfig(sch.project);
    const date = new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const s: Session = {
      id: newId(),
      title: `Scheduled · ${sch.name} · ${date}`,
      project: sch.project,
      created: Date.now(),
      updated: Date.now(),
      modelKey: model.key,
      mode: sch.access === "edit" ? "acceptEdits" : "ask",
      messages: [{ role: "user", content: sch.prompt, at: Date.now() }],
      todos: [],
      allow: [],
      think: settings.think,
      outputStyle: settings.outputStyle,
    };
    const ui: AgentUI = {
      assistant: () => ({ text() {}, thinking() {}, stats() {}, end() {} }),
      tool: () => ({ output() {}, end() {} }),
      // Feedback rather than a plain "no", so the run carries on and reports what it would have done.
      approve: async () => ({
        allow: false,
        feedback:
          "This is an unattended scheduled run, so anything that needs approval is declined. Don't retry it; carry on with what you can do, and say in your final reply what you'd have run or changed.",
      }),
      todos: (t) => (s.todos = t),
      fileChanged() {},
      status() {},
      save: () => void saveSession(s),
      subagentModel: () => model,
      note() {},
    };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45 * 60000);
    try {
      await runAgent(s, model, ui, ctl.signal);
    } catch (e) {
      s.messages.push({ role: "assistant", content: `**The scheduled run failed:** ${e instanceof Error ? e.message : e}`, at: Date.now() });
    } finally {
      clearTimeout(timer);
    }
    await saveSession(s);
    hooks.done(s, sch);
    return s;
  } finally {
    sch.lastRun = Date.now();
    await saveSettings();
    running = false;
  }
}

/** Checks the timetable every 30 seconds and runs what's due, one at a time, never during the user's own task. */
export function startScheduler(hooks: RunnerHooks) {
  const tick = async () => {
    if (running || hooks.busy()) return;
    const now = Date.now();
    for (const sch of settings.schedules) {
      if (!isDue(sch, now, started)) continue;
      await runSchedule(sch, hooks);
      return;
    }
  };
  setInterval(() => void tick(), 30000);
  setTimeout(() => void tick(), 8000);
}
