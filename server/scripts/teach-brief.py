#!/usr/bin/env python3
"""Board-meeting brief — turns a Drink Wars JSON export into between-round talking
points for the instructor's debrief (runbook §0c). Stdlib only.

  python3 scripts/teach-brief.py <export.json> [round]
  python3 scripts/teach-brief.py "$(ls -t ~/Downloads/*.json | head -1)"      # newest export

Defaults to the latest resolved round. Reads top to bottom as the debrief runs:
  THE STORY          what each category did (flat out? slack?) and how full everyone's tanks were
  WHAT MOVED         who changed price / tanks / quality, and what it bought them
  POSITIONS          margin/can × cans = gross profit, then running costs → operating profit
  WHY SHOPPERS CHOSE the pull behind shopper shares (DW-067 exports only; skipped otherwise)
  TROUBLE            firms under the safety line: why, and the clock they are on
  ASK THE ROOM       three questions, each with → SHOW (the dashboard card to project)
                     and NAME IT (the concept to land after two student answers)

Every → SHOW names a card on the instructor dashboard as deployed today.

Vocabulary, as the engine means it (use these words with students):
  shoppers  share of a category's drinkers who picked your beer (price, quality, brand, focus)
  sold      cans you actually poured — capped by your tanks
  flat out  sold ≥ 97% of tank capacity: more shoppers would not have sold another can, so a
            price cut buys nothing and a price rise costs no sales
  pull      (DW-067 exports) why shoppers chose you. A pull gap of g = e^g times the shoppers.
"""
import json, math, re, sys

if len(sys.argv) < 2:
    sys.exit(__doc__)
j = json.load(open(sys.argv[1]))
names = {t["firmId"]: (t["name"] if t.get("joined", True) else re.sub(r"^Open slot", "NPC", t["name"], flags=re.I)) for t in j["teams"]}  # = dashboard shortName
SEG = {"mass": "Lagers & Light", "niche": "Craft Premium", "frontier": "Non-Alc / Functional"}  # = web/src/labels.ts SEG_LABEL
L = lambda s: SEG.get(s, s)
nm = lambda fid: names.get(fid, fid)
both = lambda xs: " and ".join(xs) if len(xs) < 3 else ", ".join(xs[:-1]) + " and " + xs[-1]
rounds = sorted({p["round"] for p in j["panel"]})
r = int(sys.argv[2]) if len(sys.argv) > 2 else rounds[-1]
cur = {p["firmId"]: p for p in j["panel"] if p["round"] == r and p.get("status", "active") == "active"}
prev = {p["firmId"]: p for p in j["panel"] if p["round"] == r - 1}
mkt = {m["segment"]: m for m in j["market"] if m["round"] == r and m.get("active", True) and m["D"] > 0}
mkt_prev = {m["segment"]: m for m in j["market"] if m["round"] == r - 1}
eng = {e["firmId"]: e for e in j["engagement"] if e["round"] == r}
events = next((e["events"] for e in j["events"] if e["round"] == r), [])
rich = any("q_desired" in s for p in cur.values() for s in (p.get("segments") or {}).values())  # DW-067 export
RUNWAY, ACQUIRABLE = 5, 3  # engine defaults: solvency_runway_rounds, ma.min_distress_rounds

k = lambda x: f"{x/1000:,.0f}k" if abs(x) >= 10000 else f"{x/1000:.1f}k" if abs(x) >= 1000 else f"{x:,.0f}"
pct = lambda x: f"{100*x:.0f}%"
pts = lambda x: f"{100*x:.0f} pts"
sgn = lambda x, f: ("+" if x >= 0 else "−") + f(abs(x))
money = lambda x: sgn(x, lambda v: f"${v/1000:,.0f}k" if v >= 10000 else f"${v:,.0f}")
usd = lambda x: ("−" if x < 0 else "") + (f"${abs(x)/1000:,.0f}k" if abs(x) >= 10000 else f"${abs(x):,.0f}")

# Dashboard cards as deployed today (DW-066). A DW-067 deploy adds the two Market cards.
C_UNITS = "Market tab › “Who holds each segment” (cans sold, by firm)"
C_TEAM = "Team drill-down › pick the team › “Last round · category economics”"
C_MAP_VOL = "Strategy map › x: Avg price · y: Market share"
C_MAP_COST = "Strategy map › x: Unit cost · y: Avg price"
C_MAP_Q = "Strategy map › x: Avg price · y: Recipe quality"
C_RATIOS = "Finance & health › “Financial ratios” (Gross margin, Operating margin rows)"
C_CANARY = "Finance & health › “Solvency canaries” (Coverage column) + “Distress watch”"
C_SCORE = "Score anatomy"
C_TANKS = "Market tab › “Price, shoppers & tanks”" if rich else C_TEAM
C_PULL = "Market tab › “Why shoppers chose”"
if rich:  # the DW-067 deploy also added the Positions card and the safety-line rule on Solvency canaries
    C_MAP_COST = "Market tab › “Positions · margin × volume”"
    C_MAP_VOL = "its scatter (cans →, margin per can ↑)"

def seg(p, s):
    return (p or {}).get("segments", {}).get(s)

def serving(s):
    return [(f, seg(p, s)) for f, p in cur.items() if seg(p, s) and (seg(p, s)["price"] > 0 or seg(p, s)["q_sold"] > 0)]

def util(p):
    return p["totalQSold"] / p["cap"] if p.get("cap") else 0

def status(fid, x):
    """sold out · caught overflow · spare tanks. Per category from sold vs wanted when the export has
    it (DW-067); otherwise per firm from tank use (a firm splits one set of tanks across categories)."""
    w = x.get("q_desired")
    if w:
        if x["q_sold"] < 0.97 * w: return "sold out"
        if x["q_sold"] > 1.03 * w: return "caught overflow"
        return "spare tanks"
    return "sold out" if util(cur[fid]) >= 0.97 else "spare tanks"

def rename(line):
    for fid, n in sorted(names.items(), key=lambda kv: -len(kv[0])):
        line = line.replace(fid, n)
    return line

print(f"\n═══ ROUND {r + 1} of {j['meta']['nRounds']} (wire round {r}) — board-meeting brief ═══")
if events:
    print("Events:  " + "\n         ".join(rename(e) for e in events))

# ── THE STORY ────────────────────────────────────────────────────────────────
print("\nTHE STORY")
story = {}
for s, m in mkt.items():
    rows = serving(s)
    if not rows:
        continue
    dD = f" ({sgn(m['D']/mkt_prev[s]['D'] - 1, pct)})" if s in mkt_prev and mkt_prev[s]["D"] else ""
    sold = sum(x["q_sold"] for _, x in rows)
    out = [f for f, x in rows if status(f, x) == "sold out"]
    spare = [f for f, x in rows if status(f, x) != "sold out"]
    wanted = sum(x.get("q_desired", 0) for _, x in rows) if rich else None
    away = max(0.0, wanted - sold) if rich else None
    if len(out) == len(rows):
        kind = "FLAT OUT"
        tail = (f"every brewery turned drinkers away ({k(away)})." if rich else "every brewery ran its tanks full.") + " Tanks, not price, set sales."
    elif out:
        kind, tail = "MIXED", f"tanks full: {both([nm(f) for f in out])} · tanks to spare: {both([nm(f) for f in spare])}."
    else:
        kind, tail = "SLACK", "everyone had tanks to spare — price and pull decide who sells."
    story[s] = dict(kind=kind, away=away, out=out, spare=spare)
    mid = f"{k(wanted)} wanted one of you · " if rich else ""
    print(f"  {L(s):<16}{kind:<9}{k(m['D'])} drinkers{dD} · {mid}{k(sold)} served — {tail}")
print("  Tanks used:  " + " · ".join(f"{nm(f)} {pct(util(p))} of {k(p['cap'])}" for f, p in sorted(cur.items(), key=lambda kv: -util(kv[1]))))
print(f"  → SHOW  {C_TANKS if rich else C_UNITS}")

# ── WHAT MOVED ───────────────────────────────────────────────────────────────
print("\nWHAT MOVED")
moves = []  # (weight, line, kind, detail)
for fid, p in cur.items():
    q = prev.get(fid)
    if not q:
        continue
    for s in mkt:
        a, b = seg(q, s), seg(p, s)
        if not a or not b or not a["price"] or not b["price"]:
            continue
        dp = b["price"] / a["price"] - 1
        if abs(dp) < 0.03:
            continue
        drev = b["revenue"] - a["revenue"]
        st = status(fid, b)
        dq = b["q_sold"] / a["q_sold"] - 1 if a["q_sold"] else 0
        sold = f"sold {k(b['q_sold'])}" + (f" of {k(b['q_desired'])} wanted" if rich else "") + (" (tanks full)" if st == "sold out" else "")
        if st == "sold out" and abs(dq) < 0.05:
            verdict = f"same cans, {'more' if drev >= 0 else 'less'} money ({money(drev)})"
            if dp < 0:
                verdict += " — the cut won shoppers it had no beer for"
        else:
            verdict = f"cans {sgn(dq, pct)}, revenue {money(drev)}"
        moves.append((abs(dp), f"  {nm(fid):<9}{L(s):<16}${a['price']:.2f}→${b['price']:.2f} ({sgn(dp, pct)}): shoppers {pct(a['share'])}→{pct(b['share'])}, {sold} — {verdict}",
                      "cut" if dp < 0 else "raise", dict(fid=fid, s=s, dp=dp, st=st, drev=drev, ds=b["share"] - a["share"], dq=dq)))
    if q.get("cap") and abs(p["cap"] / q["cap"] - 1) >= 0.10:
        dc = p["cap"] / q["cap"] - 1
        caught = [s for s in mkt if seg(p, s) and status(fid, seg(p, s)) == "caught overflow"]
        idle = 1 - util(p)
        why = f" — caught drinkers rivals turned away ({', '.join(map(L, caught))})" if caught else (f" — {pct(idle)} of tanks sat idle" if idle > 0.1 else "")
        moves.append((abs(dc), f"  {nm(fid):<9}{'tanks':<16}{k(q['cap'])}→{k(p['cap'])} ({sgn(dc, pct)}): sold {k(p['totalQSold'])} ({sgn(p['totalQSold'] - q['totalQSold'], k)}){why}",
                      "tanks", dict(fid=fid, dc=dc, caught=caught, idle=idle)))
    for stock, label in (("Q", "quality"), ("B", "brand")):
        if q.get(stock) and abs(p[stock] / q[stock] - 1) >= 0.25:
            d = p[stock] / q[stock] - 1
            moves.append((abs(d) * 0.5, f"  {nm(fid):<9}{label:<16}{q[stock]:.0f}→{p[stock]:.0f} ({sgn(d, pct)})" + (" — invested" if d > 0 else " — fades without investment"),
                          "stock", dict(fid=fid, stock=label, d=d)))
moves.sort(key=lambda m: -m[0])
for _, line, _, _ in moves[:5]:
    print(line)
if not prev:
    print("  First round — every firm started identical; this is the baseline.")
elif not moves:
    print("  Nobody changed price ±3%, tanks ±10%, or quality/brand ±25% — the market moved on its own.")
print(f"  → SHOW  {C_TANKS}")

# ── POSITIONS: margin × volume = gross profit, then where it went ─────────────
print("\nPOSITIONS   margin/can × cans = gross profit;  gross − running costs = operating profit")
print(f"  {'firm':<10}{'rank':>4}{'price':>7}{'cost':>6}{'margin':>8}{'cans':>7}{'gross':>8}{'running':>9}{'operating':>10}{'NI':>8}{'cash':>8}")
for fid, p in sorted(cur.items(), key=lambda kv: kv[1]["rank"]):
    cans = p["totalQSold"]
    avg = p["revenue"] / cans if cans else 0
    mc = p["gross"] / cans if cans else 0
    print(f"  {nm(fid):<10}{p['rank']:>4}{avg:>7.2f}{p['unitCost']:>6.2f}{mc:>8.2f}{k(cans):>7}{usd(p['gross']):>8}{usd(p['ebit'] - p['gross']):>9}{usd(p['ebit']):>10}{usd(p['netIncome']):>8}{usd(p['cash']):>8}")
by_m = max(cur.values(), key=lambda p: p["gross"] / p["totalQSold"] if p["totalQSold"] else -9)
by_v = max(cur.values(), key=lambda p: p["totalQSold"])
by_g = max(cur.values(), key=lambda p: p["gross"])
if by_m["firmId"] != by_v["firmId"]:
    print(f"  Most per can: {nm(by_m['firmId'])} · most cans: {nm(by_v['firmId'])} · most gross profit: {nm(by_g['firmId'])}.")
print(f"  → SHOW  {C_MAP_COST}  ·  then {C_MAP_VOL}  ·  {C_RATIOS}")

# ── WHY SHOPPERS CHOSE (DW-067 exports only) ─────────────────────────────────
pair = None
if rich:
    print("\nWHY SHOPPERS CHOSE")
    best = None
    for s in mkt:
        rows = [(f, x) for f, x in serving(s) if x.get("pull")]
        for fa, xa in rows:
            for fb, xb in rows:
                if xa["share"] <= xb["share"]:
                    continue
                gap = sum(xa["pull"].values()) - sum(xb["pull"].values())
                score = gap + (2 if xa["price"] > xb["price"] * 1.02 else 0)
                if best is None or score > best[0]:
                    best = (score, s, fa, xa, fb, xb, gap)
    if best:
        _, s, fa, xa, fb, xb, gap = best
        pair = dict(s=s, a=fa, b=fb, gap=gap, prem=xa["price"] - xb["price"], ratio=xa["share"] / xb["share"] if xb["share"] else math.inf)
        d = {t: xa["pull"][t] - xb["pull"][t] for t in ("price", "quality", "brand", "fit", "other")}
        prem = f"despite charging ${pair['prem']:.2f} more" if pair["prem"] > 0.01 else f"charging ${-pair['prem']:.2f} less"
        only_price = all(abs(d[t]) < 0.01 for t in ("quality", "brand", "fit", "other"))
        print(f"  {L(s)}: {nm(fa)} drew {pair['ratio']:.1f}x {nm(fb)}'s shoppers {prem}.")
        print("         pull gap  " + " · ".join(f"{t} {d[t]:+.2f}" for t in ("price", "quality", "brand", "fit", "other") if abs(d[t]) >= 0.01 or t == "price")
              + f"  = {gap:+.2f}  (e^{gap:.2f} ≈ {math.exp(gap):.1f}x)" + ("  — pure price: nothing else separates them" if only_price else ""))
    sens = []
    for s in mkt:
        xs = [x for _, x in serving(s) if x.get("pull") and x["price"] > 0]
        if xs:
            sens.append(f"{L(s)} ≈ {pct(1 - math.exp(xs[0]['pull']['price'] / xs[0]['price']))}")
    if sens:
        print("  Each +$1 of price costs this share of your shoppers vs rivals:  " + " · ".join(sens) + "   (no sales lost if your tanks are full)")
    print(f"  → SHOW  {C_PULL}  ·  {C_MAP_Q}")

# ── TROUBLE ──────────────────────────────────────────────────────────────────
trouble = [(fid, p) for fid, p in cur.items() if p["belowSafety"] or p["creditRationed"]]
if trouble:
    thr = trouble[0][1].get("cashSafetyThreshold") or 120000
    print(f"\nTROUBLE   Safety line: cash under {usd(thr)}, OR coverage under 1x (operating profit ÷ interest).")
    print(f"          Under it, lenders stop new loans. After {ACQUIRABLE} quarters a rival can buy you; after {RUNWAY}, forced exit.")
    for fid, p in trouble:
        why = []
        if p["cash"] < thr:
            why.append(f"cash {usd(p['cash'])}")
        if p["coverage"] < 1:
            why.append(f"coverage {p['coverage']:.1f}x (operating {usd(p['ebit'])} vs interest {usd(p['interest'])})")
        n = p.get("roundsBelowSafety") or (1 if p["belowSafety"] else 0)
        clock = (f"quarter {n} of {RUNWAY}" + (" — acquirable now" if n >= ACQUIRABLE else "")) if p["belowSafety"] else "credit-rationed only"
        print(f"  {nm(fid):<9} {'; '.join(why) or 'credit-rationed'} · {clock}")
        if p["ebit"] < 0:
            print(f"{'':12}why: gross profit {usd(p['gross'])} didn't cover {usd(p['gross'] - p['ebit'])} of running costs")
    print(f"  → SHOW  {C_CANARY}")

# ── footer ───────────────────────────────────────────────────────────────────
w = j["meta"]["weights"]
dims = {d: max(cur.values(), key=lambda p: (p.get("scoreNorm") or {}).get(d, -9)) for d in w}
print("\nLeaders:  " + "   ".join(f"{d} ({pct(wt)}) {nm(dims[d]['firmId'])}" for d, wt in w.items()) + f"   → SHOW  {C_SCORE}")
proc = []
for fid, e in eng.items():
    bits = [f"{e['revisionCount']} rev"] if e["submitted"] else ["NO SUBMIT"]
    if e.get("predictedRank"):
        bits.append(f"called #{e['predictedRank']}, got #{e['realizedRank']}")
    proc.append(f"{nm(fid)} {', '.join(bits)}")
print("Process:  " + " · ".join(proc))
for f, e in eng.items():
    t = (e.get("reflection") or "").strip()
    if t:
        print(f"  {nm(f)}: “{t[:110]}”")

# ── ASK THE ROOM ─────────────────────────────────────────────────────────────
ask = []  # (priority, question, show, name_it)
N_FULL = "With full tanks, price is free money: raise it until you'd just sell out. Tanks are the real limit, and they take a round to build."
for s, st in story.items():
    rows = serving(s)
    hi = max(rows, key=lambda fx: fx[1]["price"])
    lo = min(rows, key=lambda fx: fx[1]["price"])
    if st["kind"] == "FLAT OUT":
        top = [nm(f) for f, x in rows if x["price"] >= hi[1]["price"] * 0.99]
        who = (f"{both(top)} charged the most (${hi[1]['price']:.2f}) and still sold every can" if hi[1]["price"] > lo[1]["price"] * 1.02
               else f"every brewery charged ${hi[1]['price']:.2f} and sold every can")
        gone = f", and {k(st['away'])} drinkers went without" if st["away"] else ""
        ask.append((9, f"Every brewery's tanks ran full in {L(s)}{gone}; {who}. If you can't pour more, what should the price be? And who is building tanks?", C_TANKS, N_FULL))
    elif st["kind"] == "MIXED" and hi[0] in st["spare"]:
        ask.append((7, f"In {L(s)}, {both([nm(f) for f in st['out']])} ran their tanks full while {nm(hi[0])}, the priciest at ${hi[1]['price']:.2f}, had tanks to spare. Too high a price, or the right one?", C_TANKS,
                    "Idle tanks still cost money. The right price is the highest one that still fills them."))
for _, _, kind, dt in moves:
    if kind == "raise" and dt["st"] == "sold out" and dt["drev"] > 0:
        ask.append((8, f"{nm(dt['fid'])} raised {L(dt['s'])} {pct(dt['dp'])} and lost {pts(-dt['ds'])} of shopper share, but not a single sale. Why didn't it hurt?", C_TANKS, N_FULL))
    elif kind == "cut" and dt["st"] == "sold out":
        ask.append((8.5, f"{nm(dt['fid'])} cut {L(dt['s'])} {pct(-dt['dp'])} and sold the same cans for {money(dt['drev'])} revenue. What did that cut buy, and what should they have done instead?", C_TANKS,
                    "A price cut only wins sales you can pour. With full tanks it just hands margin to customers."))
    elif kind == "cut" and dt["drev"] > 0:
        ask.append((7, f"{nm(dt['fid'])}'s {L(dt['s'])} price cut paid for itself. How will rivals answer, and who wins a price war at these unit costs?", C_MAP_COST,
                    "Price wars are won on unit cost. Check who can go lowest before starting one."))
    elif kind == "raise" and dt["dq"] < -0.05:
        ask.append((7, f"{nm(dt['fid'])} raised {L(dt['s'])} {pct(dt['dp'])} and sold {pct(-dt['dq'])} fewer cans. Was the margin worth the lost cans?", C_TANKS,
                    "Gross profit = margin/can × cans. A raise pays only if the margin gained beats the cans lost."))
    elif kind == "tanks" and dt["caught"]:
        ask.append((7, f"{nm(dt['fid'])} built tanks and caught the drinkers its rivals turned away. Foresight or luck, and what does carrying that capacity cost?", C_TANKS,
                    "Capacity is a bet on next round's demand: too little leaves drinkers on the table, too much bleeds fixed cost."))
    elif kind == "tanks" and dt["dc"] > 0 and dt["idle"] > 0.15:
        ask.append((7.8, f"{nm(dt['fid'])} built {pct(dt['dc'])} more tanks and left {pct(dt['idle'])} of them idle. What would have filled them: a lower price, more quality and brand, or patience?", C_TANKS,
                    "Tanks pay only when shoppers want more than you can pour. Build pull first, then capacity."))
if pair and pair["prem"] > 0.01 and pair["ratio"] > 1.2:
    ask.append((8, f"{nm(pair['a'])} charged ${pair['prem']:.2f} more than {nm(pair['b'])} in {L(pair['s'])} and drew {pair['ratio']:.1f}x the shoppers. Where did that pull come from, and how long does it last without investment?", f"{C_PULL} · {C_MAP_Q}",
                "Quality and brand let you charge more and still win shoppers, but they fade every round you stop investing."))
if trouble:
    fid, p = min(trouble, key=lambda fp: fp[1]["coverage"])
    ask.append((8.2, f"{nm(fid)} is under the safety line{' with an operating loss' if p['ebit'] < 0 else ''}. What options just disappeared, and what should they do first?", C_CANARY,
                "Distress closes doors: no new loans, and the clock to a forced sale or exit starts. Fix coverage first: cut programs and capex, stop expanding, then repay."))
if by_m["firmId"] != by_v["firmId"]:
    ask.append((6, f"{nm(by_m['firmId'])} earns the most per can and {nm(by_v['firmId'])} sells the most cans; {nm(by_g['firmId'])} made the most gross profit. Which position is easier to defend, and how would you attack it?", f"{C_MAP_COST} · then {C_MAP_VOL}",
                "Gross profit = margin/can × cans. Either road can win; stuck in the middle on both is the trap."))
misses = [(abs(e["predictedRank"] - e["realizedRank"]), fid) for fid, e in eng.items() if e.get("predictedRank") and e.get("realizedRank")]
if misses and max(misses)[0] >= 2:
    _, fid = max(misses)
    ask.append((5, f"{nm(fid)} predicted #{eng[fid]['predictedRank']} and landed #{eng[fid]['realizedRank']}. What didn't they know, and could they have bought or inferred it?", C_TEAM,
                "Market research is a lever too. Anticipating rivals is part of the decision."))
seen, picked = set(), []
for _, q, show, lesson in sorted(ask, key=lambda a: -a[0]):
    if lesson in seen:
        continue
    seen.add(lesson)
    picked.append((q, show, lesson))
print("\nASK THE ROOM   (take two answers, then name it)")
for i, (q, show, lesson) in enumerate(picked[:3], 1):
    print(f"  {i}. {q}\n     → SHOW   {show}\n     NAME IT  {lesson}")
if not rich:
    print("\n(Pre-DW-067 export: 'tanks full' is judged per firm from tank use; WHY SHOPPERS CHOSE needs the DW-067 deploy.)")
print()
