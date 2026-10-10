// The Schedules dialog: the list of scheduled runs, and a form to add or change one.
import { describeWhen, type Schedule } from "../schedules";
import { newId, saveSettings, settings, TIERS } from "../store";
import { h } from "./transcript";

export interface ScheduleHooks {
  project: string;
  runNow: (s: Schedule) => void;
  openSession: (id: string) => void;
}

export function openSchedules(dlg: HTMLDialogElement, hooks: ScheduleHooks) {
  dlg.innerHTML = "";
  const box = h("div", "settings-form");
  box.append(h("h2", "", "Scheduled runs"));
  box.append(
    h(
      "p",
      "hint",
      "Agent jobs on a timetable, while Prestige IDE is open. Nobody is there to approve anything, so a run declines what would ask (your settings-file allow rules still apply, e.g. run_command(npm test*)). Each result is saved as a session, and Windows tells you when it's ready.",
    ),
  );
  const list = h("div", "sched-list");
  const draw = () => {
    list.innerHTML = "";
    if (!settings.schedules.length) list.append(h("p", "hint", "No scheduled runs yet."));
    for (const s of settings.schedules) {
      const row = h("div", "sched-row");
      const info = h("div", "sched-info");
      info.append(h("div", "sched-name", s.name), h("div", "row-hint", `${describeWhen(s.when)} · ${s.access === "edit" ? "can edit files" : "read-only"} · ${s.project.split("/").pop()}`));
      if (s.lastRun) info.append(h("div", "row-hint", `Last run ${new Date(s.lastRun).toLocaleString()}`));
      const on = h("input") as HTMLInputElement;
      on.type = "checkbox";
      on.checked = s.enabled;
      on.title = "On";
      on.onchange = () => {
        s.enabled = on.checked;
        void saveSettings();
      };
      const run = h("button", "btn small", "Run now");
      run.onclick = () => {
        dlg.close();
        hooks.runNow(s);
      };
      const edit = h("button", "btn small", "Edit");
      edit.onclick = () => form(s);
      const del = h("button", "btn small danger", "Delete");
      del.onclick = () => {
        if (!confirm(`Delete the scheduled run “${s.name}”?`)) return;
        settings.schedules = settings.schedules.filter((x) => x !== s);
        void saveSettings();
        draw();
      };
      row.append(on, info, run, edit, del);
      list.append(row);
    }
  };
  draw();
  box.append(list);
  const bar = h("div", "dialog-bar");
  const add = h("button", "btn primary", "New scheduled run");
  add.onclick = () => form(null);
  const close = h("button", "btn", "Close");
  close.onclick = () => dlg.close();
  bar.append(close, add);
  box.append(bar);
  dlg.append(box);
  if (!dlg.open) dlg.showModal();

  function form(existing: Schedule | null) {
    const s: Schedule = existing
      ? structuredClone(existing)
      : {
          id: newId(),
          name: "",
          project: hooks.project,
          prompt: "",
          model: "main",
          access: "read",
          when: { kind: "daily", time: "08:00", days: [1, 2, 3, 4, 5] },
          enabled: true,
          catchUp: false,
          created: Date.now(),
        };
    dlg.innerHTML = "";
    const f = h("form", "settings-form");
    f.append(h("h2", "", existing ? "Edit scheduled run" : "New scheduled run"));
    const text = (label: string, value: string, ph = "") => {
      const i = h("input") as HTMLInputElement;
      i.value = value;
      i.placeholder = ph;
      const row = h("label", "row");
      row.append(h("span", "row-label", label), i);
      f.append(row);
      return i;
    };
    const name = text("Name", s.name, "Nightly test run");
    const project = text("Project folder", s.project);
    const prompt = h("textarea", "sched-prompt") as HTMLTextAreaElement;
    prompt.value = s.prompt;
    prompt.placeholder = "Run the tests. If any fail, find the cause and explain it with file references.";
    prompt.rows = 4;
    f.append(h("div", "row-label", "What to do"), prompt);

    const model = h("select") as HTMLSelectElement;
    for (const t of TIERS) model.append(new Option(`${t.label} tier`, t.id));
    model.value = s.model;
    const mrow = h("label", "row");
    mrow.append(h("span", "row-label", "Model"), model);
    f.append(mrow);

    const access = h("select") as HTMLSelectElement;
    access.append(new Option("Read-only (changes nothing)", "read"), new Option("Can edit files (no commands)", "edit"));
    access.value = s.access;
    const arow = h("label", "row");
    arow.append(h("span", "row-label", "Access"), h("span", "row-hint", "edits go straight into the folder: use a worktree if you're working there too"), access);
    f.append(arow);

    const kind = h("select") as HTMLSelectElement;
    kind.append(new Option("Daily at a time", "daily"), new Option("Every few hours", "every"));
    kind.value = s.when.kind;
    const krow = h("label", "row");
    krow.append(h("span", "row-label", "When"), kind);
    f.append(krow);
    const time = h("input") as HTMLInputElement;
    time.type = "time";
    time.value = s.when.kind === "daily" ? s.when.time : "08:00";
    const hours = h("input") as HTMLInputElement;
    hours.type = "number";
    hours.min = "1";
    hours.max = "168";
    hours.value = s.when.kind === "every" ? String(s.when.hours) : "6";
    const days = h("div", "sched-days");
    const dayBoxes = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => {
      const l = h("label", "sched-day");
      const c = h("input") as HTMLInputElement;
      c.type = "checkbox";
      c.checked = s.when.kind === "daily" ? !s.when.days.length || s.when.days.includes(i) : i > 0 && i < 6;
      l.append(c, document.createTextNode(d));
      days.append(l);
      return c;
    });
    const catchUp = h("input") as HTMLInputElement;
    catchUp.type = "checkbox";
    catchUp.checked = s.catchUp;
    const trow = h("label", "row");
    trow.append(h("span", "row-label", "Time"), time);
    const hrow = h("label", "row");
    hrow.append(h("span", "row-label", "Every (hours)"), hours);
    const crow = h("label", "row");
    crow.append(h("span", "row-label", "Catch up"), h("span", "row-hint", "run once at launch if the time passed while the app was closed"), catchUp);
    f.append(trow, days, crow, hrow);
    const showWhen = () => {
      const daily = kind.value === "daily";
      trow.hidden = days.hidden = crow.hidden = !daily;
      hrow.hidden = daily;
    };
    kind.onchange = showWhen;
    showWhen();

    const fbar = h("div", "dialog-bar");
    const cancel = h("button", "btn", "Back") as HTMLButtonElement;
    cancel.type = "button";
    cancel.onclick = () => openSchedules(dlg, hooks);
    const save = h("button", "btn primary", "Save") as HTMLButtonElement;
    save.type = "submit";
    fbar.append(cancel, save);
    f.append(fbar);
    f.onsubmit = (e) => {
      e.preventDefault();
      if (!name.value.trim() || !prompt.value.trim() || !project.value.trim()) {
        alert("Give it a name, a project folder and something to do.");
        return;
      }
      s.name = name.value.trim();
      s.project = project.value.trim().replace(/\\/g, "/").replace(/\/$/, "");
      s.prompt = prompt.value.trim();
      s.model = model.value;
      s.access = access.value as Schedule["access"];
      s.when = kind.value === "daily" ? { kind: "daily", time: time.value || "08:00", days: dayBoxes.flatMap((c, i) => (c.checked ? [i] : [])) } : { kind: "every", hours: Math.max(1, Number(hours.value) || 6) };
      s.catchUp = catchUp.checked;
      if (existing) Object.assign(existing, s);
      else settings.schedules.push(s);
      void saveSettings();
      openSchedules(dlg, hooks);
    };
    dlg.append(f);
  }
}
