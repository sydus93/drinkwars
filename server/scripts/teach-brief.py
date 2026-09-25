#!/usr/bin/env python3
"""Board-meeting brief — turns a Drink Wars JSON export into between-round talking
points for the instructor's debrief (runbook §0c). Stdlib only.

  python3 scripts/teach-brief.py <export.json> [round]

Defaults to the latest resolved round. Print it, glance at it, ask the room the
questions at the bottom — the numbers are the case, the students supply the theory.
"""
import json, sys

if len(sys.argv) < 2:
    sys.exit(__doc__)
j = json.load(open(sys.argv[1]))
names = {t["firmId"]: t["name"] for t in j["teams"]}
rounds = sorted({p["round"] for p in j["panel"]})
r = int(sys.argv[2]) if len(sys.argv) > 2 else rounds[-1]
cur = {p["firmId"]: p for p in j["panel"] if p["round"] == r}
prev = {p["firmId"]: p for p in j["panel"] if p["round"] == r - 1}
mkt = {m["segment"]: m for m in j["market"] if m["round"] == r and m.get("active", True)}
mkt_prev = {m["segment"]: m for m in j["market"] if m["round"] == r - 1}
eng = {e["firmId"]: e for e in j["engagement"] if e["round"] == r}
events = next((e["events"] for e in j["events"] if e["round"] == r), [])

k = lambda x: f"{x/1000:,.0f}k" if abs(x) >= 10000 else f"{x:,.0f}"
pct = lambda x: f"{100*x:.0f}%"

print(f"\n═══ ROUND {r + 1} of {j['meta']['nRounds']} (wire round {r}) — board-meeting brief ═══")
print("Demand:  " + "   ".join(
    f"{s} {k(m['D'])}" + (f" ({'+' if m['D'] >= mkt_prev[s]['D'] else ''}{pct(m['D']/mkt_prev[s]['D'] - 1)})" if s in mkt_prev and mkt_prev[s]["D"] else "")
    for s, m in mkt.items()))
if events:
    print("Events:  " + "\n         ".join(events))

hdr = f"{'firm':<10}{'rank':>5}{'score':>7}" + "".join(f"{s[:5]+' $/sh':>12}" for s in mkt) + f"{'rev':>8}{'gm%':>6}{'NI':>8}{'cash':>8}{'cover':>7}  flags"
print("\n" + hdr)
for fid, p in sorted(cur.items(), key=lambda kv: kv[1]["rank"]):
    segcell = ""
    for s in mkt:
        seg = (p.get("segments") or {}).get(s)
        d = ""
        pseg = (prev.get(fid, {}).get("segments") or {}).get(s)
        if seg and pseg:
            d = f"{'+' if seg['share'] >= pseg['share'] else ''}{100*(seg['share']-pseg['share']):.0f}"
        segcell += f"{(f'{seg['price']:.2f}/{pct(seg['share'])}{d}' if seg else '—'):>12}"
    gm = p["gross"] / p["revenue"] if p["revenue"] else 0
    flags = " ".join(f for f, on in [("BELOW-SAFETY", p["belowSafety"]), ("RATIONED", p["creditRationed"]),
                                     ("info", (eng.get(fid) or {}).get("infoPurchased"))] if on)
    print(f"{names.get(fid, fid):<10}{p['rank']:>5}{p['scoreCumulative']:>7.2f}{segcell}{k(p['revenue']):>8}{pct(gm):>6}{k(p['netIncome']):>8}{k(p['cash']):>8}{p['coverage']:>7.1f}  {flags}")

# Who leads each scoring dimension this round (weights in meta) — rarely the same firm.
w = j["meta"]["weights"]
dims = {d: max(cur.values(), key=lambda p: (p.get("scoreNorm") or {}).get(d, -9)) for d in w}
print("\nDimension leaders:  " + "   ".join(f"{d} ({pct(wt)}): {names.get(dims[d]['firmId'])}" for d, wt in w.items()))
dist = {fid: (p.get("distinctiveness") or {}).get("mahalanobis") for fid, p in cur.items()}
if any(v is not None for v in dist.values()):
    ranked = sorted((v, names.get(f)) for f, v in dist.items() if v is not None)
    print(f"Distinctiveness:    most {ranked[-1][1]} ({ranked[-1][0]:.1f}) · least {ranked[0][1]} ({ranked[0][0]:.1f})")

print("\nProcess:")
for fid, e in eng.items():
    cal = f"predicted #{e['predictedRank']} → realized #{e['realizedRank']}" if e.get("predictedRank") else f"realized #{e.get('realizedRank')}, no prediction"
    refl = (e.get("reflection") or "").strip()
    t = f"{e['timeToDecideS']:.0f}s to decide, " if e.get("timeToDecideS") is not None else ""
    print(f"  {names.get(fid, fid):<10} {'submitted' if e['submitted'] else 'NO SUBMIT':<10} {e['revisionCount']} revisions, {t}{cal}" + (f'\n{'':13}“{refl[:110]}”' if refl else ""))

# ── ask the room ──
qs = []
for s, m in mkt.items():
    priced = [(p["segments"][s]["price"], p["segments"][s]["share"], names.get(f)) for f, p in cur.items() if (p.get("segments") or {}).get(s)]
    if len(priced) >= 2:
        lo, hi = min(priced), max(priced)
        if hi[0] > lo[0] * 1.03:
            qs.append((hi[0] / lo[0], f"{s}: {hi[2]} priced {hi[0]:.2f} vs {lo[2]} at {lo[0]:.2f} — {hi[2]} kept {pct(hi[1])} share. What does that say about willingness to pay here?"))
qs.sort(reverse=True)
ask = [q for _, q in qs[:1]]
gm_lead = max(cur.values(), key=lambda p: p["gross"] / p["revenue"] if p["revenue"] else -9)
vol_lead = max(cur.values(), key=lambda p: p["totalQSold"])
if gm_lead["firmId"] != vol_lead["firmId"]:
    ask.append(f"{names.get(gm_lead['firmId'])} wins on margin, {names.get(vol_lead['firmId'])} on volume — which position is more defensible, and what would it take to attack each?")
for fid, p in cur.items():
    if p["belowSafety"] or p["creditRationed"]:
        ask.append(f"{names.get(fid)} is {'below its cash safety line' if p['belowSafety'] else 'credit-rationed'} — what strategic options just disappeared for them?")
        break
misses = [(abs(e["predictedRank"] - e["realizedRank"]), fid) for fid, e in eng.items() if e.get("predictedRank") and e.get("realizedRank")]
if misses and max(misses)[0] >= 2:
    _, fid = max(misses)
    ask.append(f"{names.get(fid)} predicted #{eng[fid]['predictedRank']} and landed #{eng[fid]['realizedRank']} — what did they not know, and could they have bought or inferred it?")
if len({p["rank"] for p in dims.values()}) > 1:
    ask.append("The overall leader doesn't lead every dimension — is that a balanced strategy or an unfocused one?")
print("\nASK THE ROOM:")
for i, q in enumerate(ask[:3], 1):
    print(f"  {i}. {q}")
print()
