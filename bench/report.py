"""Turns a bake-off's results.jsonl into a Markdown report.

  python bench/report.py RESULTS_DIR > report.md
"""
import json, os, statistics, sys
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
# --untested CONFIG="why": leave a configuration out of the scores (e.g. it never loaded) and say so instead.
untested = {}
args = sys.argv[2:]
while args:
    a = args.pop(0)
    if a == "--untested":
        k, _, why = args.pop(0).partition("=")
        untested[k] = why
rows = [json.loads(l) for l in open(os.path.join(sys.argv[1], "results.jsonl"), encoding="utf-8") if l.strip()]
untested_labels = {r["config"]: r["label"] for r in rows if r["config"] in untested}
rows = [r for r in rows if r["config"] not in untested]
by_cfg = defaultdict(list)
for r in rows:
    by_cfg[r["config"]].append(r)
tasks = sorted({r["task"] for r in rows})
kinds = sorted({r["kind"].split(" ·")[0] for r in rows})


def fmt_s(s):
    return f"{s / 60:.1f} min" if s >= 90 else f"{s:.0f} s"


print("# Prestige IDE model bake-off\n")
print(f"{len(tasks)} tasks from the Prestige and Custom AI Workstation code, each graded by hidden tests or exact facts. "
      "Every run used the real agent loop (same prompt, tools and settings as the app) in a fresh copy of the project.\n")
print("## Scoreboard\n")
print("| Model | Passed | Median time | Total time | Median turns | Tool errors | Timeouts |")
print("|---|---|---|---|---|---|---|")
order = sorted(by_cfg, key=lambda c: (-sum(r["pass"] for r in by_cfg[c]), sum(r.get("seconds", 0) for r in by_cfg[c])))
for c in order:
    rs = by_cfg[c]
    secs = [r.get("seconds", 0) for r in rs]
    print(f"| {rs[0]['label']} | **{sum(r['pass'] for r in rs)}/{len(rs)}** | {fmt_s(statistics.median(secs))} | {fmt_s(sum(secs))} | "
          f"{statistics.median([r.get('turns', 0) for r in rs]):.0f} | {sum(r.get('toolErrors', 0) for r in rs)} | {sum(1 for r in rs if r.get('timedOut'))} |")

for k, why in untested.items():
    print(f"| {untested_labels.get(k, k)} | not tested: {why} | | | | | |")

print("\n## By kind of task\n")
print("| Model | " + " | ".join(kinds) + " |")
print("|---|" + "---|" * len(kinds))
for c in order:
    cells = []
    for k in kinds:
        rs = [r for r in by_cfg[c] if r["kind"].startswith(k)]
        cells.append(f"{sum(r['pass'] for r in rs)}/{len(rs)}")
    print(f"| {by_cfg[c][0]['label']} | " + " | ".join(cells) + " |")

print("\n## Every run\n")
SHORT = {"main-think": "35B Main", "main-fast": "35B Main, no think", "hauhau-27b": "27B HauhauCS", "neocoder-27b": "27B NEO-CODER", "huihui-27b": "27B Huihui"}
print("| Task | " + " | ".join(SHORT.get(c, c) for c in order) + " |")
print("|---|" + "---|" * len(order))
for t in tasks:
    cells = []
    for c in order:
        r = next((x for x in by_cfg[c] if x["task"] == t), None)
        cells.append("—" if not r else f"{'✅' if r['pass'] else '❌'} {fmt_s(r.get('seconds', 0))}")
    print(f"| {t} | " + " | ".join(cells) + " |")

print("\n## Failures\n")
for c in order:
    for r in by_cfg[c]:
        if r["pass"]:
            continue
        why = r["grade"] if isinstance(r["grade"], str) else "; ".join(
            f"`{d['cmd'].split()[0]} …` exit {d['code']}: {' '.join(d['tail'][-2:])[:220]}" for d in r["grade"] if d["code"]
        )
        extra = " (timed out)" if r.get("timedOut") else f" (error: {r['error'][:120]})" if r.get("error") else ""
        print(f"- **{r['label']}**, {r['task']}{extra}: {why}")
