// Jupyter notebooks (.ipynb) for the agent: readable cells instead of raw JSON, and cell-by-cell edits that keep the
// file valid. No imports, so it can be tested on its own.

interface Cell {
  cell_type: "code" | "markdown" | "raw";
  id?: string;
  source: string | string[];
  metadata?: any;
  outputs?: any[];
  execution_count?: number | null;
}

const text = (s: string | string[] | undefined) => (Array.isArray(s) ? s.join("") : s ?? "");

/** Source as Jupyter stores it: one string per line, each but the last ending in \n. */
function toLines(src: string): string[] {
  if (!src) return [];
  const parts = src.split("\n");
  return parts.map((l, i) => (i < parts.length - 1 ? l + "\n" : l)).filter((l, i, a) => !(i === a.length - 1 && l === ""));
}

function outputSummary(o: any): string {
  if (o.output_type === "stream") return text(o.text);
  if (o.output_type === "error") return `${o.ename}: ${o.evalue}`;
  const data = o.data ?? {};
  if (data["text/plain"]) return text(data["text/plain"]);
  const kind = Object.keys(data)[0];
  return kind ? `[${kind} output]` : "";
}

/** The notebook as numbered cells, for read_file. */
export function renderNotebook(json: string): string {
  const nb = JSON.parse(json);
  const cells: Cell[] = nb.cells ?? [];
  const lang = nb.metadata?.kernelspec?.language ?? nb.metadata?.language_info?.name ?? "";
  const out: string[] = [`Jupyter notebook: ${cells.length} cells${lang ? `, ${lang}` : ""}. Edit cells with notebook_edit (cells are numbered from 0).`];
  cells.forEach((c, i) => {
    const run = c.cell_type === "code" && c.execution_count != null ? ` (ran as [${c.execution_count}])` : "";
    out.push(`\n--- cell ${i} · ${c.cell_type}${run} ---\n${text(c.source)}`);
    const outputs = (c.outputs ?? []).map(outputSummary).filter(Boolean).join("\n").trim();
    if (outputs) out.push(`--- output ---\n${outputs.length > 2000 ? outputs.slice(0, 2000) + "\n… (output cut)" : outputs}`);
  });
  return out.join("\n");
}

export interface NotebookEdit {
  cell: number;
  mode?: "replace" | "insert" | "delete";
  source?: string;
  cell_type?: "code" | "markdown";
}

function newId() {
  return Array.from({ length: 8 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
}

/** Applies one edit and returns the new file text, in Jupyter's own layout (1-space indent, trailing newline). */
export function editNotebook(json: string, e: NotebookEdit): string {
  const nb = JSON.parse(json);
  const cells: Cell[] = (nb.cells ??= []);
  const mode = e.mode ?? "replace";
  const i = Number(e.cell);
  if (!Number.isInteger(i) || i < 0 || i > cells.length || (mode !== "insert" && i === cells.length)) {
    throw new Error(`cell ${e.cell} doesn't exist (the notebook has ${cells.length} cells, numbered from 0${mode === "insert" ? `; insert at ${cells.length} to add at the end` : ""})`);
  }
  if (mode === "delete") cells.splice(i, 1);
  else if (mode === "insert") {
    const type = e.cell_type ?? "code";
    const cell: Cell = { cell_type: type, metadata: {}, source: toLines(e.source ?? "") };
    if (nb.nbformat > 4 || (nb.nbformat === 4 && (nb.nbformat_minor ?? 0) >= 5)) cell.id = newId();
    if (type === "code") Object.assign(cell, { execution_count: null, outputs: [] });
    // Keep Jupyter's key order (cell_type, execution_count, id, metadata, outputs, source) loosely: id after type.
    cells.splice(i, 0, cell);
  } else {
    const c = cells[i];
    if (e.source === undefined && !e.cell_type) throw new Error("nothing to change: give source and/or cell_type");
    if (e.source !== undefined) c.source = toLines(e.source);
    if (e.cell_type && e.cell_type !== c.cell_type) {
      c.cell_type = e.cell_type;
      if (e.cell_type === "markdown") {
        delete c.outputs;
        delete c.execution_count;
      }
    }
    // The old outputs belong to the old code.
    if (c.cell_type === "code") Object.assign(c, { execution_count: null, outputs: [] });
  }
  return JSON.stringify(nb, null, 1) + "\n";
}
