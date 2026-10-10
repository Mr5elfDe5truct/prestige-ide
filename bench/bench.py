"""Prestige IDE model bake-off: prepares task folders, grades them, and validates the tests themselves.

  python bench.py prepare TASK_ID DIR        fresh copy of the task's project, with its bug seeded
  python bench.py grade TASK_ID DIR [ANSWER_FILE]   runs the hidden checks (or checks the answer), prints JSON
  python bench.py validate                   each check fails on the unsolved task and passes on a reference fix
"""
import json, os, re, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TASKS = {t["id"]: t for t in json.load(open(os.path.join(HERE, "tasks.json"), encoding="utf-8"))}
# The question tasks read the real repos; set BENCH_REPOS to the folder holding prestige/ and custom-ai-workstation/.
REPOS = os.environ.get("BENCH_REPOS", "")


def project_dir(task, dest):
    if task["project"].startswith("repo:"):
        return os.path.join(REPOS, task["project"][5:])  # read-only questions run on the repo itself, in Plan mode
    return dest


def _rmtree(path):
    """Deletes a folder, including git's read-only object files (Windows won't delete those otherwise)."""
    def unlock(func, p, _exc):
        os.chmod(p, 0o700)
        func(p)
    shutil.rmtree(path, onexc=unlock)


def prepare(task_id, dest):
    task = TASKS[task_id]
    if task["project"].startswith("repo:"):
        return project_dir(task, dest)
    if os.path.exists(dest):
        _rmtree(dest)
    shutil.copytree(os.path.join(HERE, "fixture"), dest)
    for s in task.get("seed", []):
        p = os.path.join(dest, s["file"])
        text = open(p, encoding="utf-8").read()
        assert s["find"] in text, f"{task_id}: seed text not found in {s['file']}"
        open(p, "w", encoding="utf-8", newline="").write(text.replace(s["find"], s["replace"], 1))
    # A git repo, so the model can see what it changed (and the diff is kept for review).
    subprocess.run("git init -q && git add -A && git -c user.name=bench -c user.email=bench@example.invalid commit -qm start",
                   shell=True, cwd=dest, capture_output=True)
    return dest


def grade(task_id, dest, answer=""):
    task = TASKS[task_id]
    if "answer" in task:
        low = answer.lower()
        missing = [g[0] for g in task["answer"] if not any(a.lower() in low for a in g)]
        return {"pass": not missing, "detail": f"missing: {', '.join(missing)}" if missing else "all facts present"}
    bench = os.path.join(dest, ".bench")
    if os.path.exists(bench):
        shutil.rmtree(bench)
    shutil.copytree(os.path.join(HERE, "hidden"), bench)
    out = []
    ok = True
    for cmd in task["check"]:
        r = subprocess.run(cmd, shell=True, cwd=dest, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300)
        ok = ok and r.returncode == 0
        tail = (r.stdout + r.stderr).strip().splitlines()[-6:]
        out.append({"cmd": cmd, "code": r.returncode, "tail": tail})
    shutil.rmtree(bench, ignore_errors=True)
    return {"pass": ok, "detail": out}


# ---------- reference fixes, only for validating the tests

def _edit(dest, file, find, replace):
    p = os.path.join(dest, file)
    t = open(p, encoding="utf-8").read()
    assert find in t, (file, find)
    open(p, "w", encoding="utf-8", newline="").write(t.replace(find, replace, 1))


def _append(dest, file, text):
    with open(os.path.join(dest, file), "a", encoding="utf-8", newline="") as f:
        f.write(text)


def reference(task_id, dest):
    task = TASKS[task_id]
    for s in task.get("seed", []):
        _edit(dest, s["file"], s["replace"], s["find"])
    if task_id == "t05-feat-merge":
        _append(dest, "py/transcribe_clips.py", '''

def merge_segments(segs, gap=0.5):
    out = []
    for s in segs:
        if out and out[-1]["speaker"] == s["speaker"] and s["start"] - out[-1]["end"] < gap:
            out[-1] = {**out[-1], "end": max(out[-1]["end"], s["end"])}
        else:
            out.append(dict(s))
    return out
''')
    elif task_id == "t06-feat-fit":
        _append(dest, "ts/genmath.ts", '''
export function fitWithin(w: number, h: number, maxSide: number, multiple = 16): [number, number] {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const r = (x: number) => Math.max(multiple, Math.floor((x * k) / multiple) * multiple);
  return [r(w), r(h)];
}
''')
    elif task_id == "t07-feat-tinycard":
        _edit(dest, "ps/llamaini.ps1",
              "if ($Plan.LlamaGB -lt 10 -and $l -match '^\\s*(c|ctx-size)\\s*=\\s*(\\d+)' -and [int]$Matches[2] -gt 16384) { $l = \"$($Matches[1]) = 16384\" }",
              "$cap = if ($Plan.LlamaGB -lt 6) { 8192 } else { 16384 }\n"
              "            if ($Plan.LlamaGB -lt 10 -and $l -match '^\\s*(c|ctx-size)\\s*=\\s*(\\d+)' -and [int]$Matches[2] -gt $cap) { $l = \"$($Matches[1]) = $cap\" }")
    elif task_id == "t11-refactor-rename":
        for f in ("ts/emotes.ts", "ts/chat.ts"):
            p = os.path.join(dest, f)
            t = open(p, encoding="utf-8").read()
            open(p, "w", encoding="utf-8", newline="").write(re.sub(r"\breactFilter\b", "createReactFilter", t))
    elif task_id == "t12-feat-cli":
        _append(dest, "py/transcribe_clips.py", '''

if __name__ == "__main__":
    import argparse, json
    ap = argparse.ArgumentParser()
    ap.add_argument("segments")
    ap.add_argument("--total", type=float, required=True)
    ap.add_argument("--cuts", default="")
    a = ap.parse_args()
    segs = json.load(open(a.segments))
    cuts = [float(x) for x in a.cuts.split(",") if x.strip()]
    for s, e, spk in clips(segs, cuts, a.total):
        print(json.dumps({"start": round(s, 2), "end": round(e, 2), "speaker": spk}))
''')


def validate():
    bad = 0
    for tid, task in TASKS.items():
        if "answer" in task:
            continue
        d = tempfile.mkdtemp(prefix="bench-")
        prepare(tid, d)
        before = grade(tid, d)["pass"]
        reference(tid, d)
        after = grade(tid, d)
        status = "ok " if (not before and after["pass"]) else "BAD"
        if status == "BAD":
            bad += 1
        print(f"{status} {tid}: unsolved {'passes' if before else 'fails'}, reference {'passes' if after['pass'] else 'fails'}")
        if not after["pass"]:
            print(json.dumps(after["detail"], indent=1, ensure_ascii=False))
        shutil.rmtree(d, ignore_errors=True)
    return bad


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1]
    if cmd == "prepare":
        print(prepare(sys.argv[2], sys.argv[3]))
    elif cmd == "grade":
        ans = open(sys.argv[4], encoding="utf-8").read() if len(sys.argv) > 4 else ""
        print(json.dumps(grade(sys.argv[2], sys.argv[3], ans), ensure_ascii=False))
    elif cmd == "validate":
        sys.exit(validate())
