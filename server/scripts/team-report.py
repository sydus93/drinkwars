#!/usr/bin/env python3
"""End-of-game feedback report, one private page per team (DW-072 #7; the "FOCUS" handout teach-brief
parked). Stdlib only. Reads the same instructor JSON export as teach-brief.py and reuses its analysis,
so the questions and vocabulary match the debrief deck word for word.

  python3 scripts/team-report.py <export.json>                       # every human team → ./team-reports/
  python3 scripts/team-report.py <export.json> firm_1 firm_3 --out ~/Desktop/reports
  python3 scripts/team-report.py <export.json> --notes notes/ --decisions decisions.json

Each page, top to bottom:
  YOUR FEEDBACK      notes/<firm_id>.md if you wrote one (first line = subtitle; ## headings, - lists,
                     | tables |, **bold**). Skipped when there is no note.
  FOR THE BOARD      at most three questions, each routed to a chair, from teach-brief's DW-068 rules
                     on the team's last operating round. Questions plus where to look; never answers.
  YOUR SEASON        the team's numbers against the FIELD MEDIAN (never a named rival's internals).
  APPENDIX           every round in numbers. With --decisions, also what the team decided (as the game
                     ran it after the seats merged) and "Entered but not used": values a chair submitted
                     that the merged plan did not run.

--decisions takes a read-only pull of the game's decision rows (not in the export, and student data:
keep it out of the repo):  {"teams": [{id, firm_id}], "decisions": [{round, firm_id, decision}],
"member_decisions": [{round, team_id, desk, partial}]}.
"""
import argparse, html, importlib.util, json, re, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("teach_brief", HERE / "teach-brief.py")
tb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tb)

SEG = tb.SEG
LEVERS = [("invest_cap", "Tanks (capacity)"), ("invest_Q", "Quality"), ("invest_B", "Brand"), ("invest_process", "Process"),
          ("invest_T_emp", "Taproom community"), ("invest_T_inv", "Investors & lenders"), ("invest_T_gov", "Distributors & regulators"),
          ("invest_water_efficiency", "Water efficiency")]
FIN = [("debt_draw", "Borrowed"), ("debt_repay", "Repaid debt"), ("equity_raise", "Equity raised"), ("dividend", "Dividend paid")]
DESK_CHAIR = {"all": "CEO", "strategy": "CEO", "commercial": "CMO", "operations": "COO", "finance": "CFO", "people": "CHRO"}  # = engine seats.ts ROLE_DESK, inverted

usd = lambda x: "—" if x is None else ("−" if x < 0 else "") + f"${abs(x):,.0f}"
num = lambda x: "—" if x is None else f"{x:,.0f}"
dec = lambda x: "—" if x is None else f"{x:.1f}"
price = lambda x: "—" if not x else f"${x:.2f}"
esc = html.escape


def md(text):
    """Tiny markdown: ## headings, paragraphs, - lists, | tables |, **bold**."""
    inline = lambda s: re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", esc(s))
    out = []
    for b in re.split(r"\n\s*\n", text.strip()):
        lines = b.strip().splitlines()
        if not lines:
            continue
        if lines[0].startswith("## "):
            out.append(f"<h2>{inline(lines[0][3:])}</h2>")
            lines = lines[1:]
            if not lines:
                continue
        if lines[0].startswith("|"):
            rows = [[c.strip() for c in l.strip().strip("|").split("|")] for l in lines if not re.match(r"^\|\s*-", l)]
            head = "".join(f"<th>{inline(c)}</th>" for c in rows[0])
            body = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows[1:])
            out.append(f"<table class='story'><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>")
        elif lines[0].startswith("- "):
            out.append("<ul>" + "".join(f"<li>{inline(l[2:])}</li>" for l in lines) + "</ul>")
        else:
            out.append(f"<p>{inline(' '.join(lines))}</p>")
    return "\n".join(out)


def appendix(j, fid, D=None):
    panel = sorted((p for p in j["panel"] if p["firmId"] == fid), key=lambda p: p["round"])
    rounds = [p["round"] for p in panel]
    rows = []  # (section, label, cells)
    if D:
        # A pull can hold more than one game: keep only rows of THIS game where the pull says which.
        gid = (j.get("meta") or {}).get("gameId")
        mine = lambda x: not gid or not x.get("game_id") or x["game_id"] == gid
        merged = {x["round"]: x["decision"] for x in D.get("decisions", []) if x["firm_id"] == fid and mine(x)}
        team_id = next((t["id"] for t in D.get("teams", []) if t["firm_id"] == fid and mine(t)), None)
        segs = [s for s in SEG if any((merged.get(r, {}).get("price") or {}).get(s) for r in rounds)]
        for s in segs:
            rows.append(("What your team decided", f"Price · {SEG[s]}", [price((merged.get(r, {}).get("price") or {}).get(s)) for r in rounds]))
        for key, lab in LEVERS + FIN:
            vals = [merged.get(r, {}).get(key) or 0 for r in rounds]
            if any(vals):
                rows.append(("What your team decided", lab, [usd(v) for v in vals]))
        hires = [", ".join(x.replace("_", " ") for x in merged.get(r, {}).get("hire_roles") or []) or "—" for r in rounds]
        if any(h != "—" for h in hires):
            rows.append(("What your team decided", "Hires requested", hires))
        # A chair's submitted value that is not what ran (another chair's value or the standing plan won).
        over = {}
        for m in D.get("member_decisions", []):
            if team_id is None or m.get("team_id") != team_id or not mine(m):  # no team match → attribute nothing
                continue
            chair = DESK_CHAIR.get(m.get("desk") or "all", "CEO")
            for key, lab in LEVERS + FIN:
                v, used = (m.get("partial") or {}).get(key), merged.get(m["round"], {}).get(key)
                touched = (m.get("partial") or {}).get("_touched")  # DW-074: only what the chair actually changed
                if touched is not None and key not in touched:
                    continue
                if isinstance(v, (int, float)) and v != (used or 0):
                    over.setdefault((chair, lab), {})[m["round"]] = v
        for (chair, lab), byr in sorted(over.items()):
            rows.append(("Entered but not used", f"{lab} ({chair})", [usd(byr[r]) if r in byr else "" for r in rounds]))
    want = lambda p: sum((v.get("q_desired") or 0) for v in p["segments"].values())
    for lab, f in [("Capacity (cans)", lambda p: num(p["cap"])), ("Shoppers wanted (cans)", lambda p: num(want(p)) if want(p) else "—"),
                   ("Cans sold", lambda p: num(p["totalQSold"])), ("Revenue", lambda p: usd(p["revenue"])),
                   ("Gross profit", lambda p: usd(p["gross"])), ("Running costs", lambda p: usd(p["gross"] - p["ebit"])),
                   ("Net income", lambda p: usd(p["netIncome"])), ("Cash (end of round)", lambda p: usd(p["cash"])),
                   ("Debt", lambda p: usd(p["debt"])), ("Equity", lambda p: usd(p["equity"])),
                   ("Cost per can", lambda p: f"${p['unitCost']:.2f}"), ("Quality", lambda p: dec(p["Q"])), ("Brand", lambda p: dec(p["B"])),
                   ("Score (running)", lambda p: f"{p['scoreCumulative']:+.2f}"), ("Rank", lambda p: f"{p['rank']}" + (f" · {p['status']}" if p["status"] != "active" else ""))]:
        rows.append(("What happened", lab, [f(p) for p in panel]))
    head = "<tr><th></th>" + "".join(f"<th>R{r + 1}</th>" for r in rounds) + "</tr>"
    body, cur = [], None
    for sec, lab, cells in rows:
        if sec != cur:
            body.append(f"<tr class='sec'><td colspan='{len(rounds) + 1}'>{esc(sec)}</td></tr>")
            cur = sec
        body.append(f"<tr><th>{esc(lab)}</th>" + "".join(f"<td>{c}</td>" for c in cells) + "</tr>")
    return f"<table class='app'><thead>{head}</thead><tbody>{''.join(body)}</tbody></table>"


CSS = """
:root{--paper:#fcf5e7;--ink:#2c1d11;--soft:#6b513a;--line:#d8c39c;--accent:#9a5024;--neg:#a83f2c}
@media (prefers-color-scheme:dark){:root{--paper:#1c130a;--ink:#f4e6c8;--soft:#bda079;--line:#503b22;--accent:#f0b94e;--neg:#d86a52}}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 "IBM Plex Sans",system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 16px 64px}
h1{font:600 34px/1.1 "EB Garamond",Georgia,serif;margin:0 0 4px} h2{font:600 22px/1.2 "EB Garamond",Georgia,serif;margin:28px 0 6px;color:var(--accent)}
.sub{color:var(--soft);margin:0 0 20px} p{margin:0 0 10px} ul{margin:0 0 10px;padding-left:20px}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums} th,td{padding:5px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
.story td:first-child{white-space:nowrap;font-weight:600} .vs td:not(:first-child),.vs th:not(:first-child){text-align:right}
.q{border:1px solid var(--line);border-left:4px solid var(--accent);padding:10px 14px;margin:0 0 10px}
.q .chair{font:700 12px/1 "IBM Plex Sans",sans-serif;letter-spacing:.1em;color:var(--accent)} .q p{margin:6px 0 4px;font-weight:600}
.q .ev,.q .where{font-size:14px;color:var(--soft);margin:0}
.wrap{overflow-x:auto} .app{font-size:13px} .app td{text-align:right;white-space:nowrap} .app tbody th{font-weight:500;white-space:nowrap}
.app tr.sec td{text-align:left;font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:var(--soft);padding-top:14px}
.note{font-size:13px;color:var(--soft)}
@media print{body{background:#fff;color:#000} main{padding:0} .app{font-size:10px} h2{break-after:avoid} .appx{break-before:page}}
"""


def page(j, fid, focus, final_round, note=None, D=None):
    names = {t["firmId"]: tb.show_name(t) for t in j["teams"]}
    name = names.get(fid, fid)
    last = max(p["round"] for p in j["panel"] if p["firmId"] == fid)
    end = next(p for p in j["panel"] if p["firmId"] == fid and p["round"] == last)
    n = len(j["teams"])  # every brewery that started, not only those still on the final panel
    OUT = {"bankrupt": "Bankrupt — out of contention", "acquired": "Acquired — out of contention"}
    status = f"Finished #{end['rank']} of {n}" if end["status"] == "active" else OUT.get(end["status"], "Left the market — out of contention")
    sub = f"{status} · {j['meta']['nRounds']}-round season"
    parts = []
    if note:
        title, _, rest = note.partition("\n")
        sub = title.lstrip("# ").strip() or sub
        parts.append(md(rest))
    if focus and focus["prompts"]:
        parts.append(f"<h2>For the board</h2><p class='note'>From round {focus['round'] + 1}, your last operating round. Questions, not answers: each names the chair it is for and where to look in the app.</p>")
        for q in focus["prompts"]:
            parts.append(f"<div class='q'><span class='chair'>{esc(q['chair'])}</span><p>{esc(q['q'])}</p><p class='ev'>{esc(q['evidence'])}</p><p class='where'>Look: {esc(q['where'])}</p></div>")
    if focus:
        # With one or two rivals left, a "field median" IS a rival's books (or the mean of two).
        rivals = len({p["firmId"] for p in j["panel"] if p["round"] == focus["round"] and p["firmId"] != fid and p.get("status", "active") == "active"})
        if rivals < 3:
            focus = dict(focus, metrics=[dict(m, field="—") for m in focus["metrics"]])
        rows = "".join(f"<tr><td>{esc(m['label'])}</td><td><b>{esc(str(m['you']))}</b></td><td>{esc(str(m['field']))}</td><td>{esc(str(m['last']))}</td></tr>" for m in focus["metrics"])
        parts.append(f"<h2>Your round {focus['round'] + 1} against the field</h2><p class='note'>{'Field = the median of every other brewery that round, not any one rival.' if rivals >= 3 else 'Too few breweries were still operating to show a field figure without showing one rival.'}</p>"
                     f"<div class='wrap'><table class='vs'><thead><tr><th></th><th>You</th><th>Field median</th><th>You, round before</th></tr></thead><tbody>{rows}</tbody></table></div>")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(name)} feedback</title><link href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"><style>{CSS}</style></head>
<body><main><h1>{esc(name)}</h1><p class="sub">{esc(sub)}</p>
{''.join(parts)}
<section class="appx"><h2>Appendix: every round, in numbers</h2>
<p class="note">{"Decisions are what the game ran after your team's seats merged. “Entered but not used” is a value a chair submitted that the merged plan did not run. " if D else ""}Rounds you weren't operating are blank. Money in dollars; volumes in cans per round.</p>
<div class="wrap">{appendix(j, fid, D)}</div></section></main></body></html>"""


def main():
    ap = argparse.ArgumentParser(description="End-of-game feedback pages, one private HTML file per team.")
    ap.add_argument("export", help="instructor JSON export (Dashboard › Export JSON)")
    ap.add_argument("firms", nargs="*", help="firm ids (default: every human team)")
    ap.add_argument("--notes", help="directory of <firm_id>.md written feedback")
    ap.add_argument("--decisions", help="read-only pull of decisions / member_decisions / teams (see the docstring)")
    ap.add_argument("--out", default="team-reports", help="output directory (default ./team-reports)")
    a = ap.parse_args()
    j = json.load(open(a.export))
    D = json.load(open(a.decisions)) if a.decisions else None
    humans = [t["firmId"] for t in j["teams"] if t.get("joined", True)]
    firms = a.firms or humans
    rounds = sorted({p["round"] for p in j["panel"]})
    if not rounds:
        sys.exit("No resolved rounds in this export yet.")
    cache = {}
    def focus_for(fid):
        live = [p["round"] for p in j["panel"] if p["firmId"] == fid and p.get("status", "active") == "active"]
        if not live:
            return None
        r = max(live)
        if r not in cache:
            cache[r] = tb.analyze(j, r)
        f = next((x for x in cache[r]["focus"] if x["fid"] == fid), None)
        return dict(f, round=r) if f else None
    out = Path(a.out).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    names = {t["firmId"]: tb.show_name(t) for t in j["teams"]}
    written = set()
    for fid in firms:
        if fid not in names:
            print(f"skip {fid}: not in this export", file=sys.stderr)
            continue
        note_path = Path(a.notes).expanduser() / f"{fid}.md" if a.notes else None
        note = note_path.read_text(encoding="utf-8") if note_path and note_path.exists() else None
        if not any(p["firmId"] == fid for p in j["panel"]):
            print(f"skip {fid} ({names[fid]}): no resolved rounds for this firm", file=sys.stderr)
            continue
        stem = re.sub(r'[^A-Za-z0-9]+', '_', names[fid]).strip('_') or fid
        path = out / f"{stem}.html"
        if path in written:  # two teams with the same display name must not overwrite each other
            path = out / f"{stem}_{fid}.html"
        written.add(path)
        path.write_text(page(j, fid, focus_for(fid), rounds[-1], note, D), encoding="utf-8")
        print(path)


if __name__ == "__main__":
    main()
