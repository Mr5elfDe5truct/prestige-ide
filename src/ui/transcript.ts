// Drawing the conversation: user turns, streamed replies (Markdown, thinking), tool cards with diffs and output,
// and the approval prompt on a tool card.
import DOMPurify from "dompurify";
import { marked } from "marked";
import { structuredPatch } from "diff";
import { monaco } from "./monaco";
import type { StreamStats, ToolCall } from "../backends";
import type { Approval, AssistantView, ToolView } from "../agent";
import type { StoredMessage } from "../store";
import { describeCall, kindOf, relPath, resolvePath } from "../tools";
import { invoke } from "@tauri-apps/api/core";
import { langFor } from "./lang";

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

marked.setOptions({ gfm: true, breaks: false });

/** Markdown to safe HTML, with code blocks coloured by Monaco and a copy button. */
export function renderMarkdown(el: HTMLElement, md: string, onPath?: (path: string, line?: number) => void) {
  el.innerHTML = DOMPurify.sanitize(marked.parse(md, { async: false }) as string);
  el.querySelectorAll("pre > code").forEach((code) => {
    const pre = code.parentElement!;
    const lang = (code.className.match(/language-([\w+#-]+)/)?.[1] ?? "").toLowerCase();
    const text = code.textContent ?? "";
    const bar = h("div", "code-bar");
    bar.append(h("span", "code-lang", lang || "text"));
    const copy = h("button", "code-copy", "Copy");
    copy.onclick = () => {
      void navigator.clipboard.writeText(text);
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy"), 1200);
    };
    bar.append(copy);
    pre.before(bar);
    pre.classList.add("has-bar");
    if (lang) {
      void monaco.editor.colorize(text, langFor(`x.${lang}`, lang), { tabSize: 2 }).then((html) => {
        code.innerHTML = DOMPurify.sanitize(html);
      });
    }
  });
  // `path/to/file.ts:12` in inline code opens the file.
  if (onPath) {
    el.querySelectorAll(":not(pre) > code").forEach((c) => {
      const m = (c.textContent ?? "").match(/^([\w./\\-]+\.[\w]+)(?::(\d+))?$/);
      if (!m) return;
      c.classList.add("path-link");
      (c as HTMLElement).onclick = () => onPath(m[1], m[2] ? Number(m[2]) : undefined);
    });
  }
  el.querySelectorAll("a[href]").forEach((a) => a.setAttribute("target", "_blank"));
}

function fmtStats(s?: StreamStats, model?: string): string {
  if (!s) return model ?? "";
  const parts = [model, `${s.tokens} tok`, s.tps ? `${s.tps.toFixed(1)} tok/s` : "", `${s.seconds.toFixed(1)} s`];
  if (s.promptTokens) parts.push(`${(s.promptTokens / 1000).toFixed(1)}k context`);
  return parts.filter(Boolean).join(" · ");
}

export function userBubble(m: StoredMessage, onRewind?: () => void): HTMLElement {
  const row = h("div", m.summary ? "turn summary" : "turn user");
  if (m.summary) {
    const d = h("details", "summary-box");
    d.append(h("summary", "", "Conversation compacted · summary"));
    const body = h("div", "md");
    renderMarkdown(body, m.content.replace(/^This session was compacted\. Summary of the conversation so far:\s*/, ""));
    d.append(body);
    row.append(d);
    return row;
  }
  const b = h("div", "bubble");
  b.textContent = m.content.replace(/\n\n<attached-files>[\s\S]*<\/attached-files>$/, "");
  const files = m.content.match(/<file path="([^"]+)"/g);
  if (files) {
    const chips = h("div", "chips");
    for (const f of files) chips.append(h("span", "chip", "@" + f.slice(12, -1)));
    b.append(chips);
  }
  if (m.images?.length) {
    const pics = h("div", "pics");
    for (const img of m.images) {
      const el = h("img", "pic") as HTMLImageElement;
      el.src = `data:image/jpeg;base64,${img}`;
      pics.append(el);
    }
    b.prepend(pics);
  }
  if (onRewind && !m.archived) {
    const rw = h("button", "rewind-btn", "↺ Rewind");
    rw.title = "Rewind to here: undo the agent's file changes since this message and edit it";
    rw.onclick = onRewind;
    row.append(rw);
  }
  row.append(b);
  return row;
}

export function assistantBlock(
  m: StoredMessage,
  onPath: (p: string, line?: number) => void,
  onScroll: () => void,
): { el: HTMLElement; view: AssistantView } {
  const row = h("div", "turn assistant");
  const think = h("details", "thinking");
  const thinkSum = h("summary", "", "Thinking");
  const thinkBody = h("div", "think-body");
  think.append(thinkSum, thinkBody);
  const body = h("div", "md");
  const meta = h("div", "msg-meta");
  row.append(think, body, meta);
  think.hidden = !m.thinking;
  thinkBody.textContent = m.thinking ?? "";
  if (m.content) renderMarkdown(body, m.content, onPath);
  meta.textContent = fmtStats(m.stats, m.modelName);

  let pending = false;
  let streaming = "";
  let thinkStart = 0;
  const flush = () => {
    pending = false;
    renderMarkdown(body, streaming);
    onScroll();
  };
  const view: AssistantView = {
    text(t) {
      streaming += t;
      if (!pending) {
        pending = true;
        requestAnimationFrame(flush);
      }
      if (thinkStart) {
        thinkSum.textContent = `Thought for ${((performance.now() - thinkStart) / 1000).toFixed(0)} s`;
        thinkStart = 0;
        think.classList.remove("live");
      }
    },
    thinking(t) {
      if (think.hidden) {
        think.hidden = false;
        think.classList.add("live");
        thinkStart = performance.now();
        thinkSum.textContent = "Thinking…";
      }
      thinkBody.textContent += t;
      thinkBody.scrollTop = thinkBody.scrollHeight;
      onScroll();
    },
    stats(s) {
      meta.textContent = fmtStats(s, m.modelName);
    },
    end(final) {
      think.classList.remove("live");
      if (thinkStart) thinkSum.textContent = `Thought for ${((performance.now() - thinkStart) / 1000).toFixed(0)} s`;
      else if (!think.hidden && thinkSum.textContent === "Thinking") thinkSum.textContent = "Thoughts";
      thinkBody.textContent = final.thinking ?? thinkBody.textContent;
      think.hidden = !final.thinking;
      if (final.content) renderMarkdown(body, final.content, onPath);
      else body.innerHTML = "";
      body.hidden = !final.content;
      meta.textContent = fmtStats(final.stats, final.modelName);
      onScroll();
    },
  };
  body.hidden = !m.content;
  return { el: row, view };
}

/** A unified diff of a file change, with old and new line numbers. */
export function diffView(path: string, before: string | null, after: string): { el: HTMLElement; added: number; removed: number } {
  const el = h("div", "diff");
  const p = structuredPatch(path, path, before ?? "", after, "", "", { context: 3 });
  let added = 0;
  let removed = 0;
  for (const hunk of p.hunks) {
    el.append(h("div", "diff-hunk", `@@ −${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`));
    let o = hunk.oldStart;
    let n = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) continue;
      const kind = line[0];
      const row = h("div", `diff-line ${kind === "+" ? "add" : kind === "-" ? "del" : "ctx"}`);
      row.append(h("span", "ln", kind === "+" ? "" : String(o)), h("span", "ln", kind === "-" ? "" : String(n)), h("span", "sign", kind === " " ? " " : kind), h("span", "code", line.slice(1)));
      el.append(row);
      if (kind === "+") {
        added++;
        n++;
      } else if (kind === "-") {
        removed++;
        o++;
      } else {
        o++;
        n++;
      }
    }
  }
  if (!p.hunks.length) el.append(h("div", "diff-hunk", "No changes"));
  return { el, added, removed };
}

export interface ToolCardHooks {
  root: string;
  onOpen: (path: string) => void;
  onScroll: () => void;
}

export function toolCard(call: ToolCall, m: StoredMessage, hooks: ToolCardHooks): { el: HTMLElement; view: ToolView; ask: () => Promise<Approval> } {
  const kind = kindOf(call.name) ?? "read";
  const card = h("div", `tool kind-${kind}`);
  const head = h("div", "tool-head");
  const dot = h("span", "tool-dot");
  const { verb, target } = describeCall(hooks.root, call.name, call.arguments ?? {});
  const verbEl = h("span", "tool-verb", verb);
  const targetEl = h("span", "tool-target", target);
  const info = h("span", "tool-info");
  const chev = h("span", "tool-chev", "›");
  head.append(dot, verbEl, targetEl, info, chev);
  const body = h("div", "tool-body");
  card.append(head, body);
  head.onclick = () => card.classList.toggle("open");
  if (call.name === "edit_file" || call.name === "write_file" || call.name === "read_file") {
    targetEl.classList.add("path-link");
    targetEl.onclick = (e) => {
      e.stopPropagation();
      hooks.onOpen(call.arguments?.path);
    };
  }

  let live: HTMLPreElement | null = null;
  const draw = (msg: StoredMessage) => {
    body.innerHTML = "";
    card.classList.remove("running", "ok", "err", "denied", "asking");
    if (!msg.meta) {
      card.classList.add("running");
      if (call.name === "run_command") {
        card.classList.add("open");
        const cmd = h("pre", "tool-cmd", "> " + String(call.arguments?.command ?? ""));
        live = h("pre", "tool-out");
        body.append(cmd, live);
      } else if (call.name === "edit_file" || call.name === "write_file") {
        // Show what's about to change while it waits for approval.
        const a = call.arguments ?? {};
        card.classList.add("open");
        // Diff against the real file so line numbers and context are right; fall back to the bare snippet.
        const path = resolvePath(hooks.root, a.path);
        void (async () => {
          let before: string | null = null;
          try {
            before = await invoke<string>("fs_read", { path });
          } catch {
            // new file
          }
          let after = call.name === "write_file" ? String(a.content ?? "") : null;
          if (after === null && before !== null) {
            const o = String(a.old_string ?? "");
            const fix = (x: string) => (before!.includes(o) || !before!.includes("\r\n") ? x : x.replace(/\r?\n/g, "\r\n"));
            const oo = fix(o);
            if (oo && before.includes(oo)) after = a.replace_all ? before.split(oo).join(fix(String(a.new_string ?? ""))) : before.replace(oo, () => fix(String(a.new_string ?? "")));
          }
          const d = after === null ? diffView(a.path, String(a.old_string ?? ""), String(a.new_string ?? "")) : diffView(a.path, before, after);
          if (!msg.meta && !body.querySelector(".diff")) body.prepend(d.el);
          hooks.onScroll();
        })();
      }
      return;
    }
    const meta = msg.meta;
    card.classList.add(meta.denied ? "denied" : meta.ok ? "ok" : "err");
    info.textContent = meta.denied ? "declined" : meta.ms !== undefined && meta.ms > 900 ? `${(meta.ms / 1000).toFixed(1)} s` : "";
    if (meta.path && meta.after !== undefined) {
      const d = diffView(relPath(hooks.root, meta.path), meta.before ?? null, meta.after);
      info.innerHTML = "";
      const stat = h("span", "diffstat");
      stat.append(h("span", "add", `+${d.added}`), h("span", "del", ` −${d.removed}`));
      info.append(stat);
      body.append(d.el);
      card.classList.add("open");
      return;
    }
    if (call.name === "run_command") {
      body.append(h("pre", "tool-cmd", "> " + String(call.arguments?.command ?? "")));
    }
    if (call.name === "todo_write") {
      card.classList.add("compact");
    }
    const out = h("pre", "tool-out");
    const text = msg.content;
    out.textContent = text.length > 20000 ? text.slice(0, 20000) + `\n… (${text.length - 20000} more characters)` : text;
    body.append(out);
    if (!meta.ok && !meta.denied) card.classList.add("open");
    else if (call.name !== "run_command") card.classList.remove("open");
  };
  draw(m);

  const view: ToolView = {
    output(chunk) {
      if (!live) return;
      live.textContent = (live.textContent + chunk).slice(-30000);
      live.scrollTop = live.scrollHeight;
      hooks.onScroll();
    },
    end(msg) {
      live = null;
      draw(msg);
      hooks.onScroll();
    },
  };

  const ask = () =>
    new Promise<Approval>((resolve) => {
      card.classList.add("asking", "open");
      const box = h("div", "approve");
      const q = h("div", "approve-q", call.name === "run_command" ? "Run this command?" : kind === "edit" ? `Make this change to ${target}?` : `Allow ${verb}?`);
      const btns = h("div", "approve-btns");
      const yes = h("button", "btn primary", "Yes");
      const always = h(
        "button",
        "btn",
        call.name === "run_command"
          ? `Yes, and don't ask again for \`${String(call.arguments?.command ?? "").trim().split(/\s+/).slice(0, 2).join(" ")}\``
          : kind === "edit"
            ? "Yes, allow all edits this session"
            : `Yes, and don't ask again for ${verb}`,
      );
      const no = h("button", "btn", "No");
      const fb = h("input", "approve-fb") as HTMLInputElement;
      fb.placeholder = "Or tell it what to do instead, then press Enter";
      btns.append(yes, always, no);
      box.append(q, btns, fb);
      card.append(box);
      hooks.onScroll();
      yes.focus();
      const finish = (a: Approval) => {
        box.remove();
        card.classList.remove("asking");
        document.removeEventListener("keydown", keys, true);
        resolve(a);
      };
      const keys = (e: KeyboardEvent) => {
        if (document.activeElement === fb) return;
        if (e.key === "1") finish({ allow: true });
        else if (e.key === "2") finish({ allow: true, always: true });
        else if (e.key === "3" || e.key === "Escape") finish({ allow: false });
        else return;
        e.preventDefault();
      };
      document.addEventListener("keydown", keys, true);
      yes.onclick = () => finish({ allow: true });
      always.onclick = () => finish({ allow: true, always: true });
      no.onclick = () => finish({ allow: false });
      fb.onkeydown = (e) => {
        if (e.key === "Enter" && fb.value.trim()) finish({ allow: false, feedback: fb.value.trim() });
      };
      (card as any)._cancel = () => finish({ allow: false });
    });

  return { el: card, view, ask };
}
