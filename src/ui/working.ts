// The working readout beside the send button. While the agent runs, the red diamond pulses inside a turning gold ring,
// and next to it are the model doing the work (a subagent's model while one runs), the tool it's calling, what it's
// doing now ("Edit src/main.ts", "Run npm test", "Waiting for your approval") and how long the task has taken. It's
// the same readout as in Prestige, so the two apps show work the same way.
import { h } from "./transcript";

let el: HTMLElement | null = null;
let whoEl: HTMLElement;
let toolEl: HTMLElement;
let stepEl: HTMLElement;
let timeEl: HTMLElement;
let t0 = 0;
let ticker = 0;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Builds the readout in front of `before` (the status line). */
export function initWorking(before: HTMLElement) {
  el = h("span", "working");
  el.hidden = true;
  el.setAttribute("aria-live", "polite");
  const orb = h("span", "wk-orb");
  orb.append(h("span", "wk-ring"), h("span", "wk-mark", "◆"));
  whoEl = h("span", "wk-who");
  toolEl = h("span", "wk-tool");
  stepEl = h("span", "wk-step");
  timeEl = h("span", "wk-time");
  el.append(orb, whoEl, toolEl, stepEl, timeEl);
  before.before(el);
}

export function startWork(who: string) {
  if (!el) return;
  t0 = Date.now();
  el.hidden = false;
  workStep("Starting…", null, who);
  timeEl.textContent = clock(0);
  clearInterval(ticker);
  ticker = window.setInterval(() => (timeEl.textContent = clock(Date.now() - t0)), 1000);
}

/** What the agent is doing now. `tool`: the tool it's calling (null: none; left out: the same one as before). `who`:
 *  the model doing it, when that changes. */
export function workStep(step: string, tool?: string | null, who?: string) {
  if (!el || el.hidden) return;
  if (who !== undefined) whoEl.textContent = who;
  whoEl.hidden = !whoEl.textContent;
  if (tool !== undefined) toolEl.textContent = tool ?? "";
  toolEl.hidden = !toolEl.textContent;
  el.classList.toggle("calling", !toolEl.hidden);
  if (stepEl.textContent === step) return;
  stepEl.textContent = step;
  el.title = [whoEl.textContent, toolEl.textContent, step].filter(Boolean).join(" · ");
  // The new step rises into place.
  stepEl.classList.remove("rise");
  void stepEl.offsetWidth;
  stepEl.classList.add("rise");
}

export function stopWork() {
  if (!el) return;
  el.hidden = true;
  clearInterval(ticker);
}
