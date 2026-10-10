// Notebooks: reading as cells, and edits that keep the file valid.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { fake } from "./fake-tauri.ts";
import { editNotebook, renderNotebook } from "../src/notebook";
import { runTool } from "../src/tools";

const NB = JSON.stringify(
  {
    cells: [
      { cell_type: "markdown", id: "a1", metadata: {}, source: ["# Title\n", "Some text"] },
      {
        cell_type: "code",
        id: "b2",
        execution_count: 3,
        metadata: {},
        outputs: [
          { output_type: "stream", name: "stdout", text: ["hello\n"] },
          { output_type: "display_data", data: { "image/png": "iVBOR…" }, metadata: {} },
        ],
        source: ["x = 1\n", "print('hello')"],
      },
      { cell_type: "code", id: "c3", execution_count: 4, metadata: {}, outputs: [{ output_type: "error", ename: "ZeroDivisionError", evalue: "division by zero", traceback: [] }], source: "1/0" },
    ],
    metadata: { kernelspec: { language: "python", name: "python3" } },
    nbformat: 4,
    nbformat_minor: 5,
  },
  null,
  1,
);

test("reads as numbered cells with their outputs", () => {
  const t = renderNotebook(NB);
  assert.match(t, /3 cells, python/);
  assert.match(t, /--- cell 0 · markdown ---\n# Title\nSome text/);
  assert.match(t, /--- cell 1 · code \(ran as \[3\]\) ---\nx = 1\nprint\('hello'\)\n--- output ---\nhello\n\n?\[image\/png output\]/);
  assert.match(t, /ZeroDivisionError: division by zero/);
});

test("replacing a code cell's source clears its stale outputs", () => {
  const nb = JSON.parse(editNotebook(NB, { cell: 1, source: "y = 2\nprint(y)\n" }));
  assert.deepEqual(nb.cells[1].source, ["y = 2\n", "print(y)\n"]);
  assert.deepEqual(nb.cells[1].outputs, []);
  assert.equal(nb.cells[1].execution_count, null);
  assert.equal(nb.cells[1].id, "b2");
  assert.equal(nb.cells.length, 3);
});

test("insert and delete", () => {
  const ins = JSON.parse(editNotebook(NB, { cell: 1, mode: "insert", source: "## Setup", cell_type: "markdown" }));
  assert.equal(ins.cells.length, 4);
  assert.equal(ins.cells[1].cell_type, "markdown");
  assert.match(ins.cells[1].id, /^[0-9a-f]{8}$/);
  assert.equal(ins.cells[1].outputs, undefined);
  const end = JSON.parse(editNotebook(NB, { cell: 3, mode: "insert", source: "z" }));
  assert.deepEqual([end.cells[3].cell_type, end.cells[3].outputs], ["code", []]);
  const del = JSON.parse(editNotebook(NB, { cell: 0, mode: "delete" }));
  assert.deepEqual(del.cells.map((c: any) => c.id), ["b2", "c3"]);
});

test("changing a code cell to markdown drops its outputs", () => {
  const nb = JSON.parse(editNotebook(NB, { cell: 2, cell_type: "markdown" }));
  assert.equal(nb.cells[2].cell_type, "markdown");
  assert.equal("outputs" in nb.cells[2], false);
});

test("bad cell numbers are clear errors", () => {
  assert.throws(() => editNotebook(NB, { cell: 3, source: "x" }), /cell 3 doesn't exist \(the notebook has 3 cells/);
  assert.throws(() => editNotebook(NB, { cell: -1, mode: "delete" }), /doesn't exist/);
  assert.throws(() => editNotebook(NB, { cell: 0 }), /nothing to change/);
});

test("keeps Jupyter's layout", () => {
  const out = editNotebook(NB, { cell: 0, source: "# New" });
  assert.ok(out.endsWith("}\n"));
  assert.match(out, /^\{\n "cells": \[\n  \{/);
});

beforeEach(() => fake.reset());

test("read_file and notebook_edit through the agent's tools", async () => {
  const ctx = { root: "C:/p", signal: new AbortController().signal, setTodos: () => {} };
  fake.write("C:/p/a.ipynb", NB);
  assert.match((await runTool("read_file", { path: "a.ipynb" }, ctx)).content, /--- cell 1 · code/);
  const r = await runTool("notebook_edit", { path: "a.ipynb", cell: 0, source: "# Renamed" }, ctx);
  assert.equal(r.meta.ok, true, r.content);
  assert.equal(r.meta.before, NB);
  assert.deepEqual(JSON.parse(fake.read("C:/p/a.ipynb")!).cells[0].source, ["# Renamed"]);
  const bad = await runTool("notebook_edit", { path: "a.ipynb", cell: 9, source: "x" }, ctx);
  assert.equal(bad.meta.ok, false);
  assert.match(bad.content, /doesn't exist/);
});
