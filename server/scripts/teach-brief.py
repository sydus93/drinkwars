#!/usr/bin/env python3
"""Board-meeting brief — turns a Drink Wars JSON export into between-round talking
points for the instructor's debrief (runbook §0c), and with --html a projectable deck plus a
slide-by-slide talk sheet for the instructor (DW-068). Stdlib only.

  python3 scripts/teach-brief.py <export.json> [round]              # text brief
  python3 scripts/teach-brief.py --html <export.json> [round]       # deck (opens) + talk sheet (.md)
  python3 scripts/teach-brief.py --html "$(ls -t ~/Downloads/drinkwars-*.json | head -1)"

Defaults to the latest resolved round. Reads top to bottom as the debrief runs:
  THE STORY          what each category did (flat out? slack?) and which firms were supply- vs
                     demand-constrained (taught in rounds 1–2, a side note after)
  WHAT MOVED         who changed price / tanks / quality, and what it bought them
  POSITIONS          margin/can × cans = gross profit, then running costs → operating profit
  WHY SHOPPERS CHOSE the pull behind shopper shares (DW-067 exports only; skipped otherwise)
  TROUBLE            firms under the safety line: why, and the clock they are on
  ASK THE ROOM       three questions, each with → SHOW (the dashboard card to project)
                     and NAME IT (the concept to land after two student answers)
  FOCUS (--teams)    PARKED: private per-team handout (numbers vs the field + ≤3 chair-routed
                     questions). Planned form = an end-of-game personalized report per team, then
                     per-round once it has a home in the app. Never in the deck or this text.

One analysis (analyze) feeds every renderer, so the brief, the deck, the talk sheet and the
handouts cannot disagree. The deck is one self-contained HTML file with nothing on it for the
instructor's eyes only. Dark by default for a projector (D = light); ←/→/space/PgDn or click, F
fullscreen. Each question gets two slides: posed alone, then with NAME IT. Every firm name carries
its house colour + emblem: by default assigned by team order (NPCs grey); `--styles` reads the colours
and emblems students actually picked, read-only, from the game's database (server/.env). The talk
sheet (.md) is the instructor's slide-by-slide crib.

Every → SHOW names a card on the instructor dashboard as deployed today.

Vocabulary, as the engine means it (use these words with students):
  shoppers  share of a category's drinkers who picked your beer (price, quality, brand, focus)
  sold      cans you actually poured — capped by your tanks
  flat out  sold ≥ 97% of tank capacity: more shoppers would not have sold another can, so a
            price cut buys nothing and a price rise costs no sales
  pull      (DW-067 exports) why shoppers chose you. A pull gap of g = e^g times the shoppers.

Tanks: the export's `cap` is the generic tank stock only. Facilities (on in the class preset)
add tanks it does not count, so tank use is shown only where sold ≤ cap; "tanks full" comes
from sold vs wanted (DW-067 exports) and "idle" is a floor, never an overstatement.
"""
import argparse, json, math, os, re, statistics, sys, urllib.request, webbrowser
from pathlib import Path

SEG = {"mass": "Lagers & Light", "niche": "Craft Premium", "frontier": "Non-Alc / Functional"}  # = web/src/labels.ts SEG_LABEL
L = lambda s: SEG.get(s, s)
RUNWAY, ACQUIRABLE = 5, 3  # engine defaults: solvency_runway_rounds, ma.min_distress_rounds
FULL, IDLE, FADE = 0.97, 0.85, 0.75  # tanks full · idle after building · pull fading (vs the last 3 rounds' peak)
TEACH_ROUNDS = 2  # rounds that teach supply vs demand constraint up front; after that it is a side note

k = lambda x: f"{x/1000:,.0f}k" if abs(x) >= 10000 else f"{x/1000:.1f}k" if abs(x) >= 1000 else f"{x:,.0f}"
pct = lambda x: f"{100*x:.0f}%"
pts = lambda x: f"{100*x:.0f} pts"
sgn = lambda x, f: ("+" if x >= 0 else "−") + f(abs(x))
money = lambda x: sgn(x, lambda v: f"${v/1000:,.0f}k" if v >= 10000 else f"${v:,.0f}")
usd = lambda x: ("−" if x < 0 else "") + (f"${abs(x)/1000:,.0f}k" if abs(x) >= 10000 else f"${abs(x):,.0f}")
both = lambda xs: " and ".join(xs) if len(xs) < 3 else ", ".join(xs[:-1]) + " and " + xs[-1]
DEBT = 500  # interest below this is "no real debt": coverage is then a meaningless ratio, say "operating loss"

# Title-slide order for the events feed; unknown kinds sit in the middle.
EVENT_ORDER = ("FORCED EXIT", "ACQUI", "MERGER", "SHOCK", "MARKET SHIFT", "DISTRESS", "GUILD", "REGULAT", "FACILITY", "EXPANSION",
               "", "FINANCING", "EQUITY", "PR PLAY", "POACHED", "DEPARTURE", "LAYOFF", "HIRE FAILED", "HIRE", "PARCEL", "CANDIDATE")  # DW-071 events
EXIT_WORD = {"bankrupt": "went bankrupt", "acquired": "was acquired"}
CHAIRS = ("CEO", "CMO", "COO", "CFO", "CHRO")
# Where each chair looks in the student app (web/src/screens/Play.tsx tabs; desks = engine seats.ts DESK_LEVERS).
WHERE = {
    "COO": "Decide › Operations desk (tanks, facilities, quality) · Review › Operations & Demand",
    "CMO": "Decide › Marketing desk (price, brand) · Review › Operations & Demand",
    "CFO": "Decide › Finance desk (loans, repayments, dividends) · Review › Statements & Ratios",
    "CEO": "Review › Statements & Ratios · Review › Field & Intel · Map",
    "CHRO": "Decide › People desk (hires, raises, morale)",
}


def cards(rich):
    """Dashboard cards as deployed today (DW-067). Pre-067 exports point at the older cards."""
    c = dict(
        UNITS="Market tab › “Who holds each segment” (cans sold, by firm)",
        TEAM="Team drill-down › pick the team › “Last round · category economics”",
        MAP_VOL="Strategy map › x: Avg price · y: Market share",
        MAP_COST="Strategy map › x: Unit cost · y: Avg price",
        MAP_Q="Strategy map › x: Avg price · y: Recipe quality",
        RATIOS="Finance & health › “Financial ratios” (Gross margin, Operating margin rows)",
        CANARY="Finance & health › “Solvency canaries” (Coverage column) + “Distress watch”",
        SCORE="Score anatomy",
        PULL="Market tab › “Why shoppers chose”",
    )
    c["TANKS"] = "Market tab › “Price, shoppers & tanks”" if rich else c["TEAM"]
    if rich:  # the DW-067 deploy also added the Positions card and the safety-line rule on Solvency canaries
        c["MAP_COST"] = "Market tab › “Positions · margin × volume”"
        c["MAP_VOL"] = "its scatter (cans →, margin per can ↑)"
    return c


show_name = lambda t: t["name"] if t.get("joined", True) else re.sub(r"^Open slot", "NPC", t["name"], flags=re.I)  # = dashboard shortName
FIRM_COLORS = ["#c0703a", "#1f8c93", "#d99b2b", "#7c4f86", "#5a8a2a", "#b0533f", "#4f5a9a", "#5a6b72"]  # = web/src/lib/teamColors.ts FIRM_COLORS
EMBLEMS = ["e-hops", "e-mtn", "e-anchor", "e-wheat", "e-star", "e-flame", "e-crown", "e-bolt"]  # = FacilityGlyph.tsx EMBLEM_IDS


def picked_styles(game_id):
    """The colour + emblem each team chose at founding (DW-051). Read-only GET on the teams table with
    the keys in server/.env (or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment)."""
    env = dict(os.environ)
    path = Path(__file__).resolve().parent.parent / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, val = line.split("=", 1)
                env.setdefault(key.strip(), val.strip())
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_ANON_KEY")
    if not (url and key):
        raise RuntimeError("no SUPABASE_URL / key in server/.env")
    req = urllib.request.Request(f"{url.rstrip('/')}/rest/v1/teams?game_id=eq.{game_id}&select=firm_id,color,emblem", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    rows = json.loads(urllib.request.urlopen(req, timeout=8).read())
    return {x["firm_id"]: x for x in rows}


def house_styles(j, picked=None):
    """name → {color, emblem, ink}. A team's own pick when known, else the next unused house colour and
    emblem in team order; NPCs grey with a plain dot. `ink` = the emblem colour that reads on the fill."""
    picked = picked or {}
    free_c = [c for c in FIRM_COLORS if c not in {(p.get("color") or "").lower() for p in picked.values()}] or FIRM_COLORS
    free_e = [e for e in EMBLEMS if e not in {p.get("emblem") for p in picked.values()}] or EMBLEMS
    lum = lambda h: sum(w * ((c / 255) / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4) for w, c in zip((0.2126, 0.7152, 0.0722), bytes.fromhex(h[1:])))
    out, i = {}, 0
    for t in j["teams"]:
        if not t.get("joined", True):
            color, emblem = "#6f6a64", None
        else:
            p = picked.get(t["firmId"], {})
            color, emblem = p.get("color"), p.get("emblem")
            if not color or not emblem:  # only unpicked teams draw from what is left
                color, emblem, i = color or free_c[i % len(free_c)], emblem or free_e[i % len(free_e)], i + 1
        out[show_name(t)] = dict(color=color, emblem=emblem, ink="#1a1209" if lum(color) > 0.3 else "#ffffff")
    return out


def analyze(j, r=None):
    """Every number and sentence the renderers show, as one JSON-able dict."""
    names = {t["firmId"]: show_name(t) for t in j["teams"]}
    npc = {t["firmId"] for t in j["teams"] if not t.get("joined", True)}
    nm = lambda fid: names.get(fid, fid)
    rounds = sorted({p["round"] for p in j["panel"]})
    if not rounds:
        sys.exit("No resolved rounds in this export yet — resolve a round, then export again.")
    r = rounds[-1] if r is None else r
    if r not in rounds:
        sys.exit(f"Round {r} is not in this export (resolved wire rounds: {', '.join(map(str, rounds))}).")
    at = lambda rr: {p["firmId"]: p for p in j["panel"] if p["round"] == rr}
    here, prev = at(r), at(r - 1)
    cur = {f: p for f, p in here.items() if p.get("status", "active") == "active"}
    back = [at(rr) for rr in range(max(0, r - 3), r)]  # up to three prior rounds, for the "falling" rules
    mkt = {m["segment"]: m for m in j["market"] if m["round"] == r and m.get("active", True) and m["D"] > 0}
    mkt_prev = {m["segment"]: m for m in j["market"] if m["round"] == r - 1}
    eng = {e["firmId"]: e for e in j["engagement"] if e["round"] == r}
    rich = any("q_desired" in s for p in cur.values() for s in (p.get("segments") or {}).values())  # DW-067 export
    modules = set(j["meta"].get("setup", {}).get("modules", []))
    C = cards(rich)

    def rename(line):
        for fid, n in sorted(names.items(), key=lambda kv: -len(kv[0])):
            line = re.sub(rf"\b{re.escape(fid)}\b", n, line)
        return line

    seg = lambda p, s: (p or {}).get("segments", {}).get(s)
    serving = lambda s: [(f, seg(p, s)) for f, p in cur.items() if seg(p, s) and (seg(p, s)["price"] > 0 or seg(p, s)["q_sold"] > 0)]
    wanted = lambda p: sum((x.get("q_desired") or 0) for x in (p.get("segments") or {}).values())

    def util(p):  # tank use, or None when sold > cap (facilities add tanks the export's cap leaves out)
        c = p.get("cap") or 0
        return p["totalQSold"] / c if c and p["totalQSold"] <= 1.03 * c else None

    def full(p):  # the firm had fewer cans than shoppers wanted
        if rich:
            return wanted(p) > 0 and p["totalQSold"] < FULL * wanted(p)
        return bool(p.get("cap")) and p["totalQSold"] >= FULL * p["cap"]

    def status(fid, x):
        """sold out · caught overflow · spare tanks. Per category from sold vs wanted when the export has
        it (DW-067); otherwise per firm from tank use (a firm splits one set of tanks across categories)."""
        w = x.get("q_desired")
        if w:
            if x["q_sold"] < FULL * w: return "sold out"
            if x["q_sold"] > 1.03 * w: return "caught overflow"
            return "spare tanks"
        return "sold out" if full(cur[fid]) else "spare tanks"

    # ── events: dedupe the feed (a hiring round repeats CANDIDATE LOST ×8) ──────
    counts, events = {}, []
    for e in next((e["events"] for e in j["events"] if e["round"] == r), []):
        e = rename(e)
        if e not in counts:
            events.append(e)
        counts[e] = counts.get(e, 0) + 1
    events = [e + (f"  ×{counts[e]}" if counts[e] > 1 else "") for e in events]
    rank_ev = lambda e: next((i for i, t in enumerate(EVENT_ORDER) if t and e.startswith(t)), EVENT_ORDER.index(""))
    ranked_events = sorted(events, key=rank_ev)  # the title slide shows the first five

    # ── THE STORY ────────────────────────────────────────────────────────────
    story = []
    for s, m in mkt.items():
        rows = serving(s)
        if not rows:
            continue
        sold = sum(x["q_sold"] for _, x in rows)
        out = [f for f, x in rows if status(f, x) == "sold out"]
        spare = [f for f, x in rows if status(f, x) != "sold out"]
        want = sum(x.get("q_desired", 0) for _, x in rows) if rich else None
        away = max(0.0, want - sold) if rich else None
        if len(out) == len(rows):
            kind = "FLAT OUT"
            tail = (f"every brewery turned drinkers away ({k(away)})." if rich else "every brewery ran its tanks full.") + " Tanks, not price, set sales."
        elif out:
            kind, tail = "MIXED", f"tanks full: {both([nm(f) for f in out])} · tanks to spare: {both([nm(f) for f in spare])}."
        else:
            kind, tail = "SLACK", "everyone had tanks to spare — price and pull decide who sells."
        dD = m["D"] / mkt_prev[s]["D"] - 1 if s in mkt_prev and mkt_prev[s]["D"] else None
        story.append(dict(seg=s, label=L(s), kind=kind, D=m["D"], dD=dD, wanted=want, sold=sold, away=away,
                          out=[nm(f) for f in out], spare=[nm(f) for f in spare], n=len(rows), tail=tail))
    kinds, teach = {st["kind"] for st in story}, r < TEACH_ROUNDS
    trend = lambda st: (f"grew {pct(st['dD'])}" if st["dD"] >= 0.02 else f"shrank {pct(-st['dD'])}" if st["dD"] <= -0.02 else "held steady") if st["dD"] is not None else "opened"
    story_head = (("Tanks, not price, set sales in " + both([st["label"] for st in story if st["kind"] == "FLAT OUT"]) + "." if "FLAT OUT" in kinds
                   else "Some breweries sold out; others had tanks to spare." if "MIXED" in kinds
                   else "Everyone had tanks to spare: price and pull decided who sold.") if teach
                  else f"Demand {trend(story[0])} in {both([st['label'] for st in story])}." if len({trend(st) for st in story}) == 1
                  else "; ".join(f"{st['label']} {trend(st)}" for st in story) + ".")
    tanks = [dict(name=nm(f), sold=p["totalQSold"], wanted=wanted(p) if rich else None, cap=p["cap"], util=util(p), full=full(p)) for f, p in cur.items()]
    tanks.sort(key=(lambda t: t["sold"] / t["wanted"] if t["wanted"] else 9) if rich else (lambda t: -(t["util"] if t["util"] is not None else 9)))

    # ── WHAT MOVED ───────────────────────────────────────────────────────────
    moves = []
    for fid, p in cur.items():
        q = prev.get(fid)
        if not q:
            continue
        for s in mkt:
            a, b = seg(q, s), seg(p, s)
            if not a or not b or not a["price"] or not b["price"] or max(a["share"], b["share"]) < 0.01:
                continue  # under 1% of shoppers both rounds: noise, not a move
            dp = b["price"] / a["price"] - 1
            if abs(dp) < 0.03:
                continue
            drev = b["revenue"] - a["revenue"]
            st = status(fid, b)
            dq = b["q_sold"] / a["q_sold"] - 1 if a["q_sold"] else 0
            detail = f"shoppers {pct(a['share'])}→{pct(b['share'])}, sold {k(b['q_sold'])}" + (f" of {k(b['q_desired'])} wanted" if rich else "") + (" (tanks full)" if st == "sold out" else "")
            if st == "sold out" and abs(dq) < 0.05:
                verdict = f"same cans, {'more' if drev >= 0 else 'less'} money ({money(drev)})"
                if dp < 0:
                    verdict += " — the cut won shoppers it had no beer for"
            else:
                verdict = f"cans {sgn(dq, pct)}, revenue {money(drev)}"
            moves.append(dict(w=abs(dp), kind="cut" if dp < 0 else "raise", fid=fid, name=nm(fid), what=L(s), change=f"${a['price']:.2f}→${b['price']:.2f} ({sgn(dp, pct)})",
                              detail=detail, verdict=verdict, s=s, dp=dp, st=st, drev=drev, ds=b["share"] - a["share"], dq=dq))
        if q.get("cap") and abs(p["cap"] / q["cap"] - 1) >= 0.10:
            dc = p["cap"] / q["cap"] - 1
            caught = [s for s in mkt if seg(p, s) and status(fid, seg(p, s)) == "caught overflow"]
            u = util(p)
            idle = None if u is None else 1 - u
            why = f"caught drinkers rivals turned away ({', '.join(map(L, caught))})" if caught else (f"{pct(idle)} of tanks sat idle" if idle is not None and idle > 0.1 else "")
            moves.append(dict(w=abs(dc), kind="tanks", fid=fid, name=nm(fid), what="tanks", change=f"{k(q['cap'])}→{k(p['cap'])} ({sgn(dc, pct)})",
                              detail=f"sold {k(p['totalQSold'])} ({sgn(p['totalQSold'] - q['totalQSold'], k)})", verdict=why, dc=dc, caught=caught, idle=idle))
        for stock, label in (("Q", "quality"), ("B", "brand")):
            if q.get(stock) and abs(p[stock] / q[stock] - 1) >= 0.25:
                d = p[stock] / q[stock] - 1
                moves.append(dict(w=abs(d) * 0.5, kind="stock", fid=fid, name=nm(fid), what=label, change=f"{q[stock]:.{0 if q[stock] >= 10 else 1}f}→{p[stock]:.{0 if p[stock] >= 10 else 1}f} ({sgn(d, pct)})",
                                  detail="", verdict="invested" if d > 0 else "fades without investment", stock=label, d=d))
    moves.sort(key=lambda m: -m["w"])
    moved_note = ("First round — every firm started identical; this is the baseline." if not prev
                  else "Nobody changed price ±3%, tanks ±10%, or quality/brand ±25% — the market moved on its own." if not moves else None)

    # ── POSITIONS ────────────────────────────────────────────────────────────
    per_can = lambda p, v: v / p["totalQSold"] if p["totalQSold"] else 0
    positions = [dict(fid=f, name=nm(f), npc=f in npc, rank=p["rank"], price=per_can(p, p["revenue"]), cost=p["unitCost"], margin=per_can(p, p["gross"]),
                      cans=p["totalQSold"], gross=p["gross"], running=p["gross"] - p["ebit"], operating=p["ebit"], ni=p["netIncome"], cash=p["cash"])
                 for f, p in sorted(cur.items(), key=lambda kv: kv[1]["rank"])]
    by_m = max(cur.values(), key=lambda p: p["gross"] / p["totalQSold"] if p["totalQSold"] else -9)["firmId"]
    by_v = max(cur.values(), key=lambda p: p["totalQSold"])["firmId"]
    by_g = max(cur.values(), key=lambda p: p["gross"])["firmId"]
    leaders_line = f"Most per can: {nm(by_m)} · most cans: {nm(by_v)} · most gross profit: {nm(by_g)}." if by_m != by_v else None

    # ── WHY SHOPPERS CHOSE (DW-067 exports only) ─────────────────────────────
    pull = None
    if rich:
        best = None
        for s in mkt:
            rows = [(f, x) for f, x in serving(s) if x.get("pull") and x["share"] >= 0.03]  # a near-zero rival makes e^gap absurd
            for fa, xa in rows:
                for fb, xb in rows:
                    if xa["share"] <= xb["share"]:
                        continue
                    gap = sum(xa["pull"].values()) - sum(xb["pull"].values())
                    score = gap + (2 if xa["price"] > xb["price"] * 1.02 else 0)
                    if best is None or score > best[0]:
                        best = (score, s, fa, xa, fb, xb, gap)
        sens = []
        for s in mkt:
            xs = [x for _, x in serving(s) if x.get("pull") and x["price"] > 0]
            if xs:
                sens.append(dict(label=L(s), cost=1 - math.exp(xs[0]["pull"]["price"] / xs[0]["price"])))
        pull = dict(sens=sens, pair=None)
        if best:
            _, s, fa, xa, fb, xb, gap = best
            prem = xa["price"] - xb["price"]
            terms = {t: xa["pull"][t] - xb["pull"][t] for t in ("price", "quality", "brand", "fit", "other")}
            ratio = xa["share"] / xb["share"] if xb["share"] else math.inf
            pull["pair"] = dict(seg=L(s), a=nm(fa), b=nm(fb), gap=gap, mult=math.exp(gap), prem=prem, ratio=ratio, terms=terms, exact="geography" not in modules,
                                only_price=all(abs(terms[t]) < 0.01 for t in ("quality", "brand", "fit", "other")),
                                sentence=f"{L(s)}: {nm(fa)} drew {ratio:.1f}x {nm(fb)}'s shoppers " + (f"despite charging ${prem:.2f} more." if prem > 0.01 else f"charging ${-prem:.2f} less."))

    # ── TROUBLE ──────────────────────────────────────────────────────────────
    trouble = []
    rows = [(fid, p) for fid, p in cur.items() if p["belowSafety"] or p["creditRationed"]]
    thr = (rows[0][1].get("cashSafetyThreshold") if rows else None) or 120000
    for fid, p in rows:
        why = []
        if p["cash"] < thr:
            why.append(f"cash {usd(p['cash'])}")
        if p["coverage"] < 1:
            why.append(f"operating loss {usd(p['ebit'])}" + (f" on {usd(p['interest'])} of interest" if p["interest"] >= DEBT else "") if p["ebit"] < 0
                       else f"coverage {p['coverage']:.1f}x (operating {usd(p['ebit'])} vs interest {usd(p['interest'])})")
        n = p.get("roundsBelowSafety") or (1 if p["belowSafety"] else 0)
        short = [f"cash {usd(p['cash'])}"] if p["cash"] < thr else []
        short += [f"operating loss {usd(p['ebit'])}"] if p["ebit"] < 0 else [f"coverage {p['coverage']:.1f}×"] if p["coverage"] < 1 else []
        trouble.append(dict(name=nm(fid), npc=fid in npc, why="; ".join(why) or "credit-rationed", short=" · ".join(short) or "credit-rationed", n=n if p["belowSafety"] else 0, acquirable=p["belowSafety"] and n >= ACQUIRABLE,
                            clock=(f"quarter {n} of {RUNWAY}" + (" — acquirable now" if n >= ACQUIRABLE else "")) if p["belowSafety"] else "credit-rationed only",
                            loss=f"gross profit {usd(p['gross'])} didn't cover {usd(p['gross'] - p['ebit'])} of running costs" if p["ebit"] < 0 else None,
                            coverage=p["coverage"], interest=p["interest"]))
    trouble.sort(key=lambda t: (-t["n"], t["npc"], t["name"]))  # longest clock first; teams before NPCs
    exits = [dict(name=nm(f), word=EXIT_WORD.get(p["status"], "exited")) for f, p in here.items()
             if p.get("status", "active") != "active" and prev.get(f, {}).get("status", "active") == "active" and f in prev]

    # ── footer: leaders, process, reflections ────────────────────────────────
    w = j["meta"]["weights"]
    dims = {d: max(cur.values(), key=lambda p: (p.get("scoreNorm") or {}).get(d, -9)) for d in w}
    leaders = [dict(dim=d, weight=wt, name=nm(dims[d]["firmId"])) for d, wt in w.items()]
    process = []
    for fid, e in eng.items():
        if fid in npc:
            process.append(f"{nm(fid)} NPC")
            continue
        bits = [f"{e['revisionCount']} rev"] if e["submitted"] else ["NO SUBMIT"]
        if e.get("predictedRank"):
            bits.append(f"called #{e['predictedRank']}" + (f", got #{e['realizedRank']}" if e.get("realizedRank") else ""))
        process.append(f"{nm(fid)} {', '.join(bits)}")
    reflections = [dict(name=nm(f), text=(e.get("reflection") or "").strip()[:110]) for f, e in eng.items() if (e.get("reflection") or "").strip()]

    # ── ASK THE ROOM ─────────────────────────────────────────────────────────
    ask = []  # (priority, question, show, name_it)
    N_FULL = "With full tanks, price is free money: raise it until you'd just sell out. Tanks are the real limit, and they take a round to build."
    for st in story:
        rows = serving(st["seg"])
        hi = max(rows, key=lambda fx: fx[1]["price"])
        lo = min(rows, key=lambda fx: fx[1]["price"])
        if st["kind"] == "FLAT OUT":
            top = [nm(f) for f, x in rows if x["price"] >= hi[1]["price"] * 0.99]
            who = (f"{both(top)} charged the most (${hi[1]['price']:.2f}) and still sold every can" if hi[1]["price"] > lo[1]["price"] * 1.02
                   else f"every brewery charged ${hi[1]['price']:.2f} and sold every can")
            gone = f", and {k(st['away'])} drinkers went without" if st["away"] else ""
            ask.append((9 if teach else 5, f"Every brewery's tanks ran full in {st['label']}{gone}; {who}. If you can't pour more, what should the price be? And who is building tanks?", C["TANKS"], N_FULL))
        elif st["kind"] == "MIXED" and nm(hi[0]) in st["spare"]:
            ask.append((7, f"In {st['label']}, {both(st['out'])} ran their tanks full while {nm(hi[0])}, the priciest at ${hi[1]['price']:.2f}, had tanks to spare. Too high a price, or the right one?", C["TANKS"],
                        "Idle tanks still cost money. The right price is the highest one that still fills them."))
    for m in moves:
        who, what = m["name"], m["what"]
        if m["kind"] == "raise" and m["st"] == "sold out" and m["drev"] > 0 and m["ds"] < 0 and abs(m["dq"]) < 0.05:
            ask.append((8 if teach else 5, f"{who} raised {what} {pct(m['dp'])} and lost {pts(-m['ds'])} of shopper share, but not a single sale. Why didn't it hurt?", C["TANKS"], N_FULL))
        elif m["kind"] == "cut" and m["st"] == "sold out":
            ask.append((8.5, f"{who} cut {what} {pct(-m['dp'])} and sold the same cans for {usd(abs(m['drev']))} {'more' if m['drev'] >= 0 else 'less'} revenue. What did that cut buy, and what should they have done instead?", C["TANKS"],
                        "A price cut only wins sales you can pour. With full tanks it just hands margin to customers."))
        elif m["kind"] == "cut" and m["drev"] > 0:
            ask.append((7, f"{who}'s {what} price cut paid for itself. How will rivals answer, and who wins a price war at these unit costs?", C["MAP_COST"],
                        "Price wars are won on unit cost. Check who can go lowest before starting one."))
        elif m["kind"] == "raise" and m["dq"] < -0.05:
            ask.append((7, f"{who} raised {what} {pct(m['dp'])} and sold {pct(-m['dq'])} fewer cans. Was the margin worth the lost cans?", C["TANKS"],
                        "Gross profit = margin/can × cans. A raise pays only if the margin gained beats the cans lost."))
        elif m["kind"] == "tanks" and m["caught"]:
            ask.append((7, f"{who} built tanks and caught the drinkers its rivals turned away. Foresight or luck, and what does carrying that capacity cost?", C["TANKS"],
                        "Capacity is a bet on next round's demand: too little leaves drinkers on the table, too much bleeds fixed cost."))
        elif m["kind"] == "tanks" and m["dc"] > 0 and m["idle"] is not None and m["idle"] > 0.15:
            ask.append((7.8, f"{who} built {pct(m['dc'])} more tanks and left {pct(m['idle'])} of them idle. What would have filled them: a lower price, more quality and brand, or patience?", C["TANKS"],
                        "Tanks pay only when shoppers want more than you can pour. Build pull first, then capacity."))
    pair = pull and pull["pair"]
    if pair and pair["prem"] > 0.01 and pair["ratio"] > 1.2:
        ask.append((8, f"{pair['a']} charged ${pair['prem']:.2f} more than {pair['b']} in {pair['seg']} and drew {pair['ratio']:.1f}x the shoppers. Where did that pull come from, and how long does it last without investment?", f"{C['PULL']} · {C['MAP_Q']}",
                    "Quality and brand let you charge more and still win shoppers, but they fade every round you stop investing."))
    if rows := [(fid, p) for fid, p in cur.items() if p["belowSafety"] or p["creditRationed"]]:
        fid, p = min(rows, key=lambda fp: fp[1]["coverage"])
        ask.append((8.2, f"{nm(fid)} is under the safety line{' with an operating loss' if p['ebit'] < 0 else ''}. What options just disappeared, and what should they do first?", C["CANARY"],
                    "Distress closes doors: no new loans, and the clock to a forced sale or exit starts. Fix coverage first: cut programs and capex, stop expanding, then repay."))
    if leaders_line:
        ask.append((6, f"{nm(by_m)} earns the most per can and {nm(by_v)} sells the most cans; {nm(by_g)} made the most gross profit. Which position is easier to defend, and how would you attack it?", f"{C['MAP_COST']} · then {C['MAP_VOL']}",
                    "Gross profit = margin/can × cans. Either road can win; stuck in the middle on both is the trap."))
    misses = [(abs(e["predictedRank"] - e["realizedRank"]), fid) for fid, e in eng.items() if e.get("predictedRank") and e.get("realizedRank")]
    if misses and max(misses)[0] >= 2:
        _, fid = max(misses)
        ask.append((5, f"{nm(fid)} predicted #{eng[fid]['predictedRank']} and landed #{eng[fid]['realizedRank']}. What didn't they know, and could they have bought or inferred it?", C["TEAM"],
                    "Market research is a lever too. Anticipating rivals is part of the decision."))
    seen, picked = set(), []
    for _, q, show, lesson in sorted(ask, key=lambda a: -a[0]):
        if lesson not in seen:
            seen.add(lesson)
            picked.append(dict(q=q, show=show, lesson=lesson))

    # ── FOCUS: private per-team handouts (never projected) ───────────────────
    n = len(cur)
    rivals = lambda fid, get: statistics.median([get(p) for f, p in cur.items() if f != fid] or [0])
    m_rank = {x["fid"]: i + 1 for i, x in enumerate(sorted(positions, key=lambda x: -x["margin"]))}
    v_rank = {x["fid"]: i + 1 for i, x in enumerate(sorted(positions, key=lambda x: -x["cans"]))}
    people_on = bool(modules & {"employees", "laborMarket"})

    def prompts(fid, p):
        cands = []  # (chairs in preference order, question, evidence) — in the §DW-068 rule order
        sold = p["totalQSold"]
        if full(p):
            cands.append((["COO"], "Your tanks ran full; shoppers wanted more. What's your capacity plan, and what should price be meanwhile?",
                          f"Shoppers wanted {k(wanted(p))} cans of yours; you poured {k(sold)}." if rich else f"You sold {k(sold)} cans on {k(p['cap'])} of tanks."))
        u, caps = util(p), [h[fid]["cap"] for h in back if fid in h]
        if u is not None and u <= IDLE and caps and p["cap"] >= 1.10 * min(caps):
            cands.append((["COO", "CMO"], "You built tanks that sat idle. What fills them: price, quality/brand, or patience?",
                          f"Tanks went {k(min(caps))} → {k(p['cap'])}; at least {pct(1 - u)} sat idle this round."))
        cut = next((m for m in moves if m["fid"] == fid and m["kind"] == "cut" and m["st"] == "sold out"), None)
        if cut:
            cands.append((["CMO"], "Your cut won shoppers you had no beer for. What did it cost you?", f"{cut['what']} {cut['change']}: {cut['detail']}; revenue {money(cut['drev'])}."))
        if p["belowSafety"] or (p["coverage"] < 1 and p["interest"] >= DEBT):
            head = (f"Coverage is {p['coverage']:.1f}×." if p["interest"] >= DEBT and 0 <= p["coverage"] < 1 else
                    f"Operating profit was {usd(p['ebit'])} against {usd(p['interest'])} of interest." if p["interest"] >= DEBT and p["coverage"] < 0 else
                    f"Cash is {usd(p['cash'])}, under the {usd(thr)} safety line." if p["cash"] < thr else
                    f"Operating profit was {usd(p['ebit'])}, so lenders read coverage as under 1×.")
            nq = p.get("roundsBelowSafety") or 1
            cands.append((["CFO"], f"{head} What closes the gap before lenders' clock runs?",
                          f"Quarter {nq} of {RUNWAY} under the safety line: no new loans now; from quarter {ACQUIRABLE} a rival can buy you, at {RUNWAY} you are forced out."))
        fades = []
        for stock, label in (("Q", "Quality"), ("B", "Brand")):
            peak = max((h[fid][stock] for h in back if fid in h), default=0)
            if peak and p[stock] <= FADE * peak:
                fades.append(f"{label} {peak:.0f} → {p[stock]:.0f} ({sgn(p[stock] / peak - 1, pct)})")
        if fades:
            cands.append((["CMO", "CEO"], "Your pull is fading. What does it cost to hold it?", " · ".join(fades) + f" over the last {len(back)} rounds."))
        band = n // 3
        if n >= 5 and band < m_rank[fid] <= n - band and band < v_rank[fid] <= n - band:
            cands.append((["CEO"], "You're neither the cheapest nor the most premium. Which lane?",
                          f"Margin per can #{m_rank[fid]} of {n} (${per_can(p, p['gross']):.2f}) · cans #{v_rank[fid]} of {n} ({k(sold)})."))
        if p["ebit"] < 0 and p["gross"] > 0:
            cands.append((["CEO", "CFO"], "Gross profit didn't cover running costs. Which programs earn their keep?",
                          f"Gross profit {usd(p['gross'])} − running costs {usd(p['gross'] - p['ebit'])} = operating {usd(p['ebit'])}."))
        if people_on:
            peak = max((h[fid]["T_emp"] for h in back if fid in h), default=0)
            med = rivals(fid, lambda x: x["T_emp"])
            if peak and p["T_emp"] <= 0.85 * peak and p["T_emp"] <= med:
                cands.append((["CHRO"], "Your people are cooling on you while rivals hold theirs. What is it costing you, and what would win them back?",
                              f"Employee trust {peak:.1f} → {p['T_emp']:.1f} ({sgn(p['T_emp'] / peak - 1, pct)}); rivals' median {med:.1f}."))
        used, out = set(), []
        for chairs, q, ev in cands:
            chair = next((c for c in chairs if c not in used), None)
            if chair and len(out) < 3:
                used.add(chair)
                out.append(dict(chair=chair, q=q, evidence=ev, where=WHERE[chair]))
        return out

    def metrics(fid, p):
        q = prev.get(fid)
        cov = lambda x: "no debt" if x["interest"] < DEBT else f"{x['coverage']:.1f}×"
        rows = [("Avg price / can", lambda x: per_can(x, x["revenue"]), lambda v: f"${v:.2f}"),
                ("Unit cost / can", lambda x: x["unitCost"], lambda v: f"${v:.2f}"),
                ("Margin / can", lambda x: per_can(x, x["gross"]), lambda v: f"${v:.2f}"),
                ("Cans sold", lambda x: x["totalQSold"], k)]
        if rich:
            rows.append(("Shoppers wanted", wanted, k))
        rows += [("Gross profit", lambda x: x["gross"], usd), ("Running costs", lambda x: x["gross"] - x["ebit"], usd),
                 ("Operating profit", lambda x: x["ebit"], usd), ("Cash", lambda x: x["cash"], usd),
                 ("Quality", lambda x: x["Q"], lambda v: f"{v:.0f}"), ("Brand", lambda x: x["B"], lambda v: f"{v:.0f}")]
        if people_on:
            rows.append(("Employee trust", lambda x: x["T_emp"], lambda v: f"{v:.1f}"))
        out = [dict(label="Season rank", you=f"#{p['rank']} of {n}", field="", last=f"#{q['rank']}" if q else "")]
        out += [dict(label=lab, you=f(get(p)), field=f(rivals(fid, get)), last=f(get(q)) if q else "") for lab, get, f in rows]
        out.insert(-2 if not people_on else -3, dict(label="Interest coverage", you=cov(p), field="", last=cov(q) if q else ""))
        return out

    focus = []
    for fid, p in sorted(cur.items(), key=lambda kv: nm(kv[0]).lower()):
        if fid in npc:
            continue
        e = eng.get(fid, {})
        focus.append(dict(fid=fid, name=nm(fid), rank=p["rank"], n=n, called=e.get("predictedRank"), metrics=metrics(fid, p),
                          moves=[f"{m['what']} {m['change']}" + (f": {m['detail']}" if m["detail"] else "") + (f" — {m['verdict']}" if m["verdict"] else "") for m in moves if m["fid"] == fid],
                          trouble=next((t["clock"] for t in trouble if t["name"] == nm(fid)), None), prompts=prompts(fid, p)))

    return dict(round=r, label=f"Round {r + 1} of {j['meta']['nRounds']}", n_rounds=j["meta"]["nRounds"], rich=rich, cards=C, teach=teach,
                width=max([9] + [len(nm(f)) + 1 for f in cur]), events=events, ranked_events=ranked_events, top_events=ranked_events[:5],
                story=story, story_head=story_head, tanks=tanks, moves=moves, moved_note=moved_note,
                positions=positions, leaders_line=leaders_line, pull=pull, trouble=trouble, threshold=thr, exits=exits,
                leaders=leaders, process=process, reflections=reflections, ask=picked[:3], focus=focus)


# ── text renderer ─────────────────────────────────────────────────────────────
def sections(b):
    """The text brief, section by section."""
    C, W = b["cards"], b["width"]
    s = {"head": ["", f"═══ ROUND {b['round'] + 1} of {b['n_rounds']} (wire round {b['round']}) — board-meeting brief ═══"]}
    if b["events"]:
        s["head"].append("Events:  " + "\n         ".join(b["events"]))
    s["story"] = ["", "THE STORY"]
    for st in b["story"]:
        dD = f" ({sgn(st['dD'], pct)})" if st["dD"] is not None else ""
        mid = f"{k(st['wanted'])} wanted one of you · " if b["rich"] else ""
        s["story"].append(f"  {st['label']:<16}{st['kind']:<9}{k(st['D'])} drinkers{dD} · {mid}{k(st['sold'])} served — {st['tail']}")
    sup, dem = constraint_lines(b)
    s["story"] += [f"  Supply-constrained (sold out):      {sup}", f"  Demand-constrained (tanks to spare): {dem}"]
    s["story"].append(f"  → SHOW  {C['TANKS'] if b['rich'] else C['UNITS']}")
    s["moved"] = ["", "WHAT MOVED"] + [f"  {m['name']:<{W}}{m['what']:<16}{m['change']}" + (f": {m['detail']}" if m["detail"] else "") + (f" — {m['verdict']}" if m["verdict"] else "") for m in b["moves"][:5]]
    if b["moved_note"]:
        s["moved"].append("  " + b["moved_note"])
    s["moved"].append(f"  → SHOW  {C['TANKS']}")
    s["positions"] = ["", "POSITIONS   margin/can × cans = gross profit;  gross − running costs = operating profit",
                      f"  {'firm':<{W}}{'rank':>4}{'price':>7}{'cost':>6}{'margin':>8}{'cans':>7}{'gross':>8}{'running':>9}{'operating':>10}{'NI':>8}{'cash':>8}"]
    s["positions"] += [f"  {x['name']:<{W}}{x['rank']:>4}{x['price']:>7.2f}{x['cost']:>6.2f}{x['margin']:>8.2f}{k(x['cans']):>7}{usd(x['gross']):>8}{usd(-x['running']):>9}{usd(x['operating']):>10}{usd(x['ni']):>8}{usd(x['cash']):>8}" for x in b["positions"]]
    if b["leaders_line"]:
        s["positions"].append("  " + b["leaders_line"])
    s["positions"].append(f"  → SHOW  {C['MAP_COST']}  ·  then {C['MAP_VOL']}  ·  {C['RATIOS']}")
    if b["pull"]:
        s["pull"] = ["", "WHY SHOPPERS CHOSE"]
        pr = b["pull"]["pair"]
        if pr:
            t = pr["terms"]
            s["pull"] += [f"  {pr['sentence']}",
                          "         pull gap  " + " · ".join(f"{x} {t[x]:+.2f}" for x in ("price", "quality", "brand", "fit", "other") if abs(t[x]) >= 0.01 or x == "price")
                          + f"  = {pr['gap']:+.2f}" + (f"  (e^{pr['gap']:.2f} ≈ {pr['mult']:.1f}x)" if pr["exact"] else "  (markets on: shares blend several cities, so read the terms, not e^gap)") + ("  — pure price: nothing else separates them" if pr["only_price"] else "")]
        if b["pull"]["sens"]:
            s["pull"].append("  Each +$1 of price costs this share of your shoppers vs rivals:  " + " · ".join(f"{x['label']} ≈ {pct(x['cost'])}" for x in b["pull"]["sens"]) + "   (no sales lost if your tanks are full)")
        s["pull"].append(f"  → SHOW  {C['PULL']}  ·  {C['MAP_Q']}")
    if b["trouble"] or b["exits"]:
        s["trouble"] = ["", f"TROUBLE   Safety line: cash under {usd(b['threshold'])}, OR coverage under 1x (operating profit ÷ interest).",
                        f"          Under it, lenders stop new loans. After {ACQUIRABLE} quarters a rival can buy you; after {RUNWAY}, forced exit."]
        for t in b["trouble"]:
            s["trouble"].append(f"  {t['name']:<{W}} {t['why']} · {t['clock']}")
            if t["loss"]:
                s["trouble"].append(f"{'':{W + 3}}why: {t['loss']}")
        if b["exits"]:
            s["trouble"].append("  Out this round: " + "; ".join(f"{x['name']} {x['word']}" for x in b["exits"]) + ".")
        s["trouble"].append(f"  → SHOW  {C['CANARY']}")
    s["footer"] = ["", "Leaders:  " + "   ".join(f"{x['dim']} ({pct(x['weight'])}) {x['name']}" for x in b["leaders"]) + f"   → SHOW  {C['SCORE']}",
                   "Process:  " + " · ".join(b["process"])] + [f"  {x['name']}: “{x['text']}”" for x in b["reflections"]]
    s["ask"] = ["", "ASK THE ROOM   (take two answers, then name it)"]
    for i, a in enumerate(b["ask"], 1):
        s["ask"].append(f"  {i}. {a['q']}\n     → SHOW   {a['show']}\n     NAME IT  {a['lesson']}")
    if not b["rich"]:
        s["ask"].append("\n(Pre-DW-067 export: 'tanks full' is judged per firm from tank use; WHY SHOPPERS CHOSE needs the DW-067 deploy.)")
    s["ask"].append("")
    return s


def constraint_lines(b):
    """Who was held back by tanks (supply) vs by shoppers (demand), with the evidence."""
    ev = lambda t: (f"{k(t['sold'])} of {k(t['wanted'])} wanted" if b["rich"] else f"{pct(t['util'])} of tanks" if t["util"] is not None else "past base tanks")
    sup = ", ".join(f"{t['name']} ({ev(t)})" for t in b["tanks"] if t["full"]) or "none"
    dem = ", ".join(t["name"] for t in b["tanks"] if not t["full"]) or "none"
    return sup, dem


def render_talk(b):
    """The instructor's crib: one short heading per slide (same numbering as the deck), then bullets
    to go deeper on or skip. Nothing here is projected."""
    C, out, n = b["cards"], [f"# {b['label']} · talk sheet", ""], 0

    def slide(title, *lines, span=1):
        nonlocal n
        out.extend([f"## {n + 1}{f'–{n + span}' if span > 1 else ''} · {title}", *[x for x in lines if x], ""])
        n += span

    slide("Title", "- Events" if b["events"] else "- No events this round", *[f"  - {e}" for e in b["ranked_events"]])
    _, dem = constraint_lines(b)
    story = []
    for st in b["story"]:
        story += [f"- {st['label']} · {st['kind']}", f"  - {k(st['D'])} drinkers" + (f" ({sgn(st['dD'], pct)})" if st["dD"] is not None else "") + f" → {k(st['sold'])} served",
                  f"  - {k(st['wanted'])} wanted one of you · {k(st['away'])} turned away" if b["rich"] else ""]
    full = [t for t in b["tanks"] if t["full"]]
    story += [f"- Supply-constrained: {', '.join(t['name'] for t in full) or 'none'}",
              "  - sold/wanted: " + " · ".join(f"{t['name']} {k(t['sold'])}/{k(t['wanted'])}" for t in full) if b["rich"] and full else "",
              "  - more shoppers would not have sold another can → price was free money" if b["teach"] and full else "",
              f"- Demand-constrained: {dem}", "  - price and pull decided their sales" if b["teach"] and dem != "none" else "", f"- Show: {C['TANKS'] if b['rich'] else C['UNITS']}"]
    slide("The story", *story)
    moved = [f"- {b['moved_note']}"] if b["moved_note"] else []
    for m in b["moves"][:5]:
        moved += [f"- {m['name']} · {m['what']} {m['change']}", f"  - {m['verdict']}" if m["verdict"] else "", f"  - {m['detail']}" if m["detail"] else ""]
    slide("What moved", *moved)
    losses = [x for x in b["positions"] if x["operating"] < 0]
    slide("Positions", f"- Season leader: {b['positions'][0]['name']}", f"- {b['leaders_line']}" if b["leaders_line"] else "",
          "- Operating loss: " + ", ".join(f"{x['name']} ({usd(x['operating'])})" for x in losses) if losses else "- Everyone made an operating profit",
          "  - gross profit didn't cover running costs" if losses else "", f"- Show: {C['MAP_COST']} · then {C['MAP_VOL']}")
    if b["pull"]:
        pr, lines = b["pull"]["pair"], []
        if pr:
            terms = sorted(((t, v) for t, v in pr["terms"].items() if abs(v) >= 0.01), key=lambda tv: -abs(tv[1]))
            lines += [f"- {pr['sentence']}", "  - gap from: " + " · ".join(f"{t} {v:+.2f}" for t, v in terms),
                      f"  - e^gap ≈ {pr['mult']:.1f}× (single market: exact)" if pr["exact"] else "  - markets on: shares blend cities — read the terms, not e^gap"]
        if b["pull"]["sens"]:
            lines += ["- +$1 of price costs: " + " · ".join(f"{x['label']} {pct(x['cost'])}" for x in b["pull"]["sens"]) + " of shoppers", "  - no sales lost if tanks are full"]
        slide("Why shoppers chose", *lines, f"- Show: {C['PULL']}")
    if b["trouble"] or b["exits"]:
        tr = [f"- Rule: cash < {usd(b['threshold'])} or coverage < 1× → no new loans · buyable from Q{ACQUIRABLE} · forced exit at Q{RUNWAY}"]
        for t in b["trouble"]:
            tr += [f"- {t['name']}{' (NPC)' if t['npc'] else ''}: {t['clock']}", f"  - {t['why']}", f"  - {t['loss']}" if t["loss"] else ""]
        slide("Trouble", *tr, "- Out this round: " + "; ".join(f"{x['name']} {x['word']}" for x in b["exits"]) if b["exits"] else "", f"- Show: {C['CANARY']}")
    for i, a in enumerate(b["ask"], 1):
        slide(f"Question {i} (posed, then Name it)", f"- Q: {a['q']}", "  - take two answers first", f"- Show: {a['show']}", f"- Name it: {a['lesson']}", span=2)
    out += ["## After the deck", "- Leaders: " + " · ".join(f"{x['dim']} {x['name']}" for x in b["leaders"]), "- Process", *[f"  - {x}" for x in b["process"]]]
    if b["reflections"]:
        out += ["- Reflections to read aloud", *[f"  - {x['name']}: “{x['text']}”" for x in b["reflections"]]]
    return "\n".join(out) + "\n"


def render_text(b):
    return "\n".join(line for sec in sections(b).values() for line in sec)


# ── HTML renderers: the data goes in as JSON, the page draws itself (offline; fonts fall back) ──
def _page(template, data):
    return template.replace("__DATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))


def render_deck(b):
    """Projectable slides. Carries NOTHING team-private: `focus` stays out of this file."""
    deck = {key: v for key, v in b.items() if key != "focus"}
    deck["fmt"] = dict(
        story=[dict(D=k(x["D"]), sold=k(x["sold"]), wanted=k(x["wanted"]) if x["wanted"] is not None else None, away=k(x["away"]) if x["away"] is not None else None,
                    dD=sgn(x["dD"], pct) if x["dD"] is not None else None) for x in b["story"]],
        positions=[dict(margin=f"${x['margin']:.2f}", cans=k(x["cans"]), gross=usd(x["gross"]), operating=usd(x["operating"])) for x in b["positions"]],
        threshold=usd(b["threshold"]), sens=[pct(x["cost"]) for x in (b["pull"] or {}).get("sens", [])])
    deck["runway"], deck["acquirable"] = RUNWAY, ACQUIRABLE
    deck["styles"] = b.get("styles") or {}
    return _page(DECK, deck)


def render_handouts(b):
    return _page(TEAMS, dict(label=b["label"], rich=b["rich"], teams=b["focus"]))


FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">'
TOKENS = """
:root{--paper:#ece0c4;--panel:#fcf5e7;--panel2:#e9d7b4;--ink:#2c1d11;--inksoft:#6b513a;--faint:#9a7a52;--copper:#c0703a;--copperdeep:#9a5024;--gold:#b98217;--hop:#456a22;--aero:#1f8c93;--plum:#7c4f86;--brick:#a83f2c;--line:#d8c39c;--line2:#c2a877;
  --serif:"EB Garamond",Georgia,"Times New Roman",serif;--sans:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,sans-serif}
:root[data-theme=dark]{--paper:#1c130a;--panel:#2f2114;--panel2:#160f08;--ink:#f4e6c8;--inksoft:#bda079;--faint:#a98a5f;--copper:#e0903f;--copperdeep:#f0b94e;--gold:#f0b94e;--hop:#8fc24f;--aero:#34c2c9;--plum:#a888b0;--brick:#d86a52;--line:#3a2a18;--line2:#503b22}
*{box-sizing:border-box}
.num{font-variant-numeric:lining-nums tabular-nums}
.eyebrow{font:600 20px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--inksoft)}
"""

DECK = """<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Board meeting debrief</title>""" + FONTS + """<style>
/* Projector-first: dark by default (D toggles light). Every text/ground pair ≥ 7:1 in dark, ≥ 4.5:1 in light;
   meaning never rides on colour alone (signs, labels, emblems carry it too). */
:root,:root[data-theme=dark]{--paper:#0b0805;--panel:#15100a;--panel2:#261c12;--ink:#fbf2de;--inksoft:#e0cba8;--faint:#bda37c;--line:#3a2c1e;--line2:#5e4833;
  --copper:#f59d55;--gold:#f7c948;--aero:#56d8e0;--hop:#a8dd6c;--brick:#ff8f75;--plum:#d6aee6;--ring:#fbf2de}
:root[data-theme=light]{--paper:#e6d8b8;--panel:#fcf6ea;--panel2:#efe2c6;--ink:#1f140a;--inksoft:#55402c;--faint:#6f5638;--line:#d8c39c;--line2:#b39668;
  --copper:#a4531f;--gold:#8a5f00;--aero:#0d6c73;--hop:#3b5d19;--brick:#a1321f;--plum:#6a3f75;--ring:#1f140a}
:root{--serif:"EB Garamond",Georgia,"Times New Roman",serif;--sans:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:var(--paper);color:var(--ink)}
#stage{position:absolute;left:50%;top:50%;width:1440px;height:810px;background:var(--panel);transform-origin:center center}
.slide{position:absolute;inset:0;padding:48px 72px 64px;display:none;flex-direction:column;gap:22px;font:500 30px/1.35 var(--sans)}
.slide.on{display:flex}
.num{font-variant-numeric:lining-nums tabular-nums}
.eyebrow{font:600 22px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--inksoft)}
h1{font:700 112px/1 var(--serif);letter-spacing:-.015em;margin:0}
h2{font:600 50px/1.12 var(--serif);letter-spacing:-.01em;margin:0}
.big{font:600 76px/1 var(--serif)}
.soft{color:var(--inksoft)} .faint{color:var(--faint)}
.lab{font:600 22px/1.2 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--inksoft)}
.chip{display:inline-block;font:700 21px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;padding:9px 14px;border-radius:999px;color:#15100a}
.k-FLAT{background:var(--copper)} .k-MIXED{background:var(--gold)} .k-SLACK{background:var(--aero)}
.foot{position:absolute;left:72px;right:72px;bottom:22px;display:flex;justify-content:space-between;font:600 20px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
/* team marks: house colour + emblem, ringed so dark colours still read on the dark ground */
.bdg{display:inline-grid;place-items:center;width:1.05em;height:1.05em;border-radius:28%;background:var(--c);box-shadow:0 0 0 2px var(--ring);vertical-align:-.16em;margin:0 .32em 0 .06em}
.bdg svg{width:74%;height:74%}
.fn{font-weight:700;white-space:nowrap}
.neg{color:var(--brick);font-weight:700}
/* title */
.events{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px}
.events li{padding-left:30px;position:relative;line-height:1.3}
.events li:before{content:"";position:absolute;left:0;top:.5em;width:13px;height:13px;background:var(--copper)}
.agenda{margin-top:auto;display:flex;gap:26px;flex-wrap:wrap;font:600 21px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--inksoft)}
/* story */
.tiles{display:grid;gap:28px}
.tile{border-top:8px solid var(--line2);padding-top:14px;display:flex;flex-direction:column;gap:10px}
.tile.FLAT{border-color:var(--copper)} .tile.MIXED{border-color:var(--gold)} .tile.SLACK{border-color:var(--aero)}
.tile .cat{font:600 34px/1.1 var(--serif);display:flex;align-items:center;gap:16px}
.flow{display:flex;align-items:baseline;gap:18px}
.flow .arrow{font:400 48px/1 var(--serif);color:var(--faint)}
.con{display:flex;flex-direction:column;gap:12px}
.con .lab{margin-bottom:8px} .con .lab i{font:italic 500 26px/1 var(--serif);letter-spacing:0;text-transform:none;margin-left:12px;color:var(--ink)}
.fc{display:inline-block;padding:5px 16px 5px 10px;margin:0 10px 8px 0;border:2px solid var(--line2);border-left:8px solid var(--aero);font-size:29px}
.fc.full{border-left-color:var(--copper)} .none{color:var(--faint);font-style:italic}
/* moves */
.moves{display:flex;flex-direction:column;gap:16px}
.mv{display:grid;grid-template-columns:330px 1fr;gap:4px 24px;padding-bottom:14px;border-bottom:2px solid var(--line)}
.mv .who{font-size:30px;line-height:1.2}
.mv .what{font:700 30px/1.2 var(--sans)}
.mv .verdict{grid-column:2;font:italic 500 32px/1.25 var(--serif)}
.mv .detail{grid-column:2;font-size:26px;color:var(--inksoft)}
/* positions */
.pos{display:grid;grid-template-columns:640px 1fr;gap:36px;align-items:start}
table{border-collapse:collapse;width:100%;font:500 28px/1.2 var(--sans)}
th{font:700 18px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--inksoft);text-align:right;padding:0 0 10px 10px;border-bottom:2px solid var(--line2)}
td{padding:7px 0 7px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left;padding-left:0}
td.nm{max-width:270px;overflow:hidden;text-overflow:ellipsis}
svg text{font-family:var(--sans)}
/* pull */
.pull{display:grid;grid-template-columns:1fr 430px;gap:40px;align-items:start}
.sens{display:flex;flex-direction:column;gap:22px}
.sens .cat{font:600 32px/1.1 var(--serif)}
/* trouble */
.tr{display:grid;grid-template-columns:320px 1fr 330px;gap:24px;align-items:center;padding:6px 0;border-bottom:2px solid var(--line)}
.tr .loss{font:italic 500 27px/1.25 var(--serif);color:var(--inksoft)}
/* questions: one slide poses it, the next adds the lesson */
.q{font:600 58px/1.16 var(--serif);letter-spacing:-.005em;margin:36px 0 0;max-width:1260px}
.nameit{margin-top:28px;border-left:12px solid var(--copper);padding:24px 32px;background:var(--panel2)}
.nameit .tag{font:700 22px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--copper);margin-bottom:14px}
.nameit .lesson{font:600 48px/1.22 var(--serif)}
</style></head><body><div id="stage"></div>
<script id="data" type="application/json">__DATA__</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent), F = D.fmt, ST = D.styles || {};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// house emblems = web/src/components/FacilityGlyph.tsx emblemMark()
const EMB = {
  'e-hops': '<path d="M12 3c2 2 2 4 0 6-2-2-2-4 0-6ZM8 8c2.5 1 3.5 2.7 3 5.5C8.5 12.5 7.5 10.8 8 8ZM16 8c-2.5 1-3.5 2.7-3 5.5 2.5-1 3.5-2.7 3-5.5ZM7 14c2.5 1 3.5 2.7 3 5.5C7.5 18.5 6.5 16.8 7 14ZM17 14c-2.5 1-3.5 2.7-3 5.5 2.5-1 3.5-2.7 3-5.5Z" fill="currentColor"/>',
  'e-mtn': '<path d="M3 20 10 7l4 7 2-3 5 9Z" fill="currentColor"/>',
  'e-anchor': '<circle cx="12" cy="5" r="2.2" fill="currentColor"/><path d="M12 7v12M6 12a6 6 0 0 0 12 0M8 11H5M16 11h3" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>',
  'e-wheat': '<path d="M12 3v18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M12 8c2-1 3.5-.5 4 1-2 1-3.5.5-4-1ZM12 8c-2-1-3.5-.5-4 1 2 1 3.5.5 4-1ZM12 13c2-1 3.5-.5 4 1-2 1-3.5.5-4-1ZM12 13c-2-1-3.5-.5-4 1 2 1 3.5.5 4-1Z" fill="currentColor"/>',
  'e-star': '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.1 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7Z" fill="currentColor"/>',
  'e-flame': '<path d="M12 3c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 1.5 1.5 2 2.5 1.5C12.5 8 11 6 12 3Z" fill="currentColor"/>',
  'e-crown': '<path d="M3 8l3.5 9h11L21 8l-4.5 4L12 5 7.5 12Z" fill="currentColor"/>',
  'e-bolt': '<path d="M13 2 4 14h7l-1 8 9-12h-7Z" fill="currentColor"/>',
};
const mark = (n) => EMB[(ST[n] || {}).emblem] || '<circle cx="12" cy="12" r="5" fill="currentColor"/>';
const badge = (n) => { const s = ST[n] || { color: '#6f6a64', ink: '#fff' }; return `<span class="bdg" style="--c:${s.color}"><svg viewBox="0 0 24 24" style="color:${s.ink}" aria-hidden="true">${mark(n)}</svg></span>`; };
const firm = (n) => `${badge(n)}<span class="fn">${esc(n)}</span>`;
// every firm name inside running text gets its mark, so teams find themselves at a glance
const NAMES = Object.keys(ST).sort((a, b) => b.length - a.length);
const NRE = NAMES.length ? new RegExp(NAMES.map((n) => esc(n).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|'), 'g') : null;
const byEsc = Object.fromEntries(NAMES.map((n) => [esc(n), n]));
const deco = (t) => NRE ? esc(t).replace(NRE, (m) => firm(byEsc[m])) : esc(t);
const slides = [];
const add = (eyebrow, html) => slides.push({ eyebrow, html });

// title
const agenda = ['The story', 'What moved', 'Positions'].concat(D.pull ? ['Why shoppers chose'] : [], D.trouble.length || D.exits.length ? ['Trouble'] : [], ['Questions']);
add('Drink Wars · Board meeting', `<h1>${esc(D.label)}</h1>
  ${D.top_events.length ? `<ul class="events">${D.top_events.map((e) => `<li>${deco(e)}</li>`).join('')}</ul>` : ''}
  <div class="agenda">${agenda.map((a, i) => `<span>${String(i + 1).padStart(2, '0')} · ${esc(a)}</span>`).join('')}</div>`);

// the story
const kind = (st) => st.kind.split(' ')[0];
const tiles = D.story.map((st, i) => { const f = F.story[i]; return `<div class="tile ${kind(st)}">
    <div class="cat"><span class="chip k-${kind(st)}">${esc(st.kind)}</span>${esc(st.label)}</div>
    <div class="flow"><div><div class="big num">${f.D}</div><div class="lab">drinkers${f.dD ? ' · ' + esc(f.dD) : ''}</div></div><div class="arrow">→</div><div><div class="big num">${f.sold}</div><div class="lab">served</div></div></div>
    <div>${f.away != null ? `<span class="soft">${f.wanted} wanted one of you ·</span> <b>${f.away} turned away</b><br>` : ''}${st.kind === 'MIXED' ? `${st.out.length} of ${st.n} ran their tanks full` : st.kind === 'FLAT OUT' ? `All ${st.n} ran their tanks full` : 'Everyone had tanks to spare'}</div></div>`; }).join('');
const group = (full, label, why) => { const fs = D.tanks.filter((t) => t.full === full);
  return `<div><div class="lab">${label}${D.teach && fs.length ? `<i>${why}</i>` : ''}</div><div>${fs.length ? fs.map((t) => `<span class="fc ${full ? 'full' : ''}">${firm(t.name)}</span>`).join('') : '<span class="none">none</span>'}</div></div>`; };
add('01 · The story', `<h2>${deco(D.story_head)}</h2>
  <div class="tiles" style="grid-template-columns:repeat(${Math.max(1, D.story.length)},1fr)">${tiles}</div>
  <div class="con">${group(true, 'Supply-constrained · sold out', 'more shoppers would not have sold another can')}${group(false, 'Demand-constrained · tanks to spare', 'price and pull decided their sales')}</div>`);

// what moved
const mv = D.moves.slice(0, 4).map((m) => `<div class="mv"><div class="who">${firm(m.name)}</div><div class="what num">${esc(m.what)} &nbsp;${esc(m.change)}</div>
  ${m.verdict ? `<div class="verdict">${deco(m.verdict)}</div>` : ''}${m.detail ? `<div class="detail num">${esc(m.detail)}</div>` : ''}</div>`).join('');
add('02 · What moved', D.moves.length ? `<div class="moves">${mv}</div>` : `<h2>${esc(D.moved_note)}</h2>`);

// positions: margin/can × cans scatter with iso-gross-profit curves + table
function nice(v, steps = [1, 2, 2.5, 5, 10]) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-9)))); return steps.map((m) => m * p).find((x) => x >= v - 1e-9); }
const fine = (v) => nice(v, [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]);
function ticks(a, b, n) { const st = nice((b - a) / n); const out = []; for (let v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) out.push(+v.toFixed(6)); return out; }
const kfmt = (v) => Math.abs(v) >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.round(v));
function scatter(rows) {
  const W = 640, H = 560, m = { l: 96, r: 22, t: 18, b: 80 };
  const x1 = fine(Math.max(...rows.map((r) => r.cans)) * 1.1), yl = Math.min(0, ...rows.map((r) => r.margin)), y1 = fine(Math.max(...rows.map((r) => r.margin)) * 1.15);
  const X = (v) => m.l + v / x1 * (W - m.l - m.r), Y = (v) => H - m.b - (v - yl) / (y1 - yl) * (H - m.t - m.b);
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Margin per can against cans sold">`;
  for (const t of ticks(yl, y1, 4)) s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)" stroke-width="1.5"/><text x="${m.l - 12}" y="${Y(t) + 8}" text-anchor="end" font-size="22" font-weight="600" fill="var(--inksoft)">$${t.toFixed(t % 1 ? 1 : 0)}</text>`;
  for (const t of ticks(0, x1, 4)) s += `<text x="${X(t)}" y="${H - m.b + 32}" text-anchor="middle" font-size="22" font-weight="600" fill="var(--inksoft)">${kfmt(t)}</text>`;
  s += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(Math.max(yl, 0))}" y2="${Y(Math.max(yl, 0))}" stroke="var(--line2)" stroke-width="2"/>`;
  const gmax = Math.max(...rows.map((r) => r.gross)), isoBoxes = [];
  for (const g of [...new Set([fine(gmax / 2.5), fine(gmax)])].filter((g) => g > 0)) {   // iso-gross-profit: margin × cans = g
    const pts = []; for (let i = 0; i <= 60; i++) { const c = g / y1 + (x1 - g / y1) * i / 60; pts.push(`${X(c).toFixed(1)},${Y(g / c).toFixed(1)}`); }
    s += `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--gold)" stroke-width="2.5" stroke-dasharray="8 7"/><text x="${(isoBoxes.push({ x: W - m.r - 130, y: Y(g / x1) - 34, w: 130, h: 28 }), W - m.r - 4)}" y="${Y(g / x1) - 12}" text-anchor="end" font-size="21" font-weight="700" fill="var(--gold)" paint-order="stroke" stroke="var(--panel)" stroke-width="7">$${kfmt(g)} gross</text>`;
  }
  s += `<text x="${(m.l + W - m.r) / 2}" y="${H - 12}" text-anchor="middle" font-size="21" font-weight="700" fill="var(--inksoft)" letter-spacing="1.5">CANS SOLD →</text>`;
  s += `<text transform="translate(24 ${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle" font-size="21" font-weight="700" fill="var(--inksoft)" letter-spacing="1.5">MARGIN PER CAN →</text>`;
  // labels only where they sit unambiguously beside their own mark; a crowded mark keeps just its emblem (keyed by the table)
  const R0 = 15, dots = rows.map((r) => ({ x: X(r.cans) - R0, y: Y(r.margin) - R0, w: 2 * R0, h: 2 * R0 }));
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const boxes = [...isoBoxes], h = 26, pts = rows.map((r) => [X(r.cans), Y(r.margin)]);
  const gap = (b, [x, y]) => Math.hypot(Math.max(b.x - x, 0, x - b.x - b.w), Math.max(b.y - y, 0, y - b.y - b.h));
  const mine = (b, px, py) => pts.every(([x, y]) => (x === px && y === py) || gap(b, [x, y]) > gap(b, [px, py]) + 14);
  let marks = '', labels = '';
  for (const r of [...rows].sort((a, b) => b.cans - a.cans)) {
    const px = X(r.cans), py = Y(r.margin), w = r.name.length * 13 + 6, st = ST[r.name] || { color: '#6f6a64', ink: '#fff' };
    let box = null;
    for (const rad of [R0 + 4, R0 + 14, R0 + 26]) {
      for (const ang of [0, 180, -90, 90, -30, 30, -150, 150, -60, 60, -120, 120]) {
        const c = Math.cos(ang * Math.PI / 180), sn = Math.sin(ang * Math.PI / 180), ax = px + c * rad, ay = py + sn * rad;
        const b = { x: c > 0.3 ? ax : c < -0.3 ? ax - w : ax - w / 2, y: sn > 0.3 ? ay : sn < -0.3 ? ay - h : ay - h / 2, w, h };
        if (b.x >= m.l - 4 && b.x + w <= W && b.y >= 0 && b.y + h <= H - m.b && !boxes.some((o) => hit(b, o)) && !dots.some((o) => hit(b, o)) && mine(b, px, py)) { box = b; break; }
      }
      if (box) break;
    }
    if (box) boxes.push(box);
    marks += `<circle cx="${px}" cy="${py}" r="${R0}" fill="${st.color}" stroke="var(--ring)" stroke-width="2.5"/><g transform="translate(${px - 10} ${py - 10}) scale(${20 / 24})" style="color:${st.ink}">${mark(r.name)}</g>`;
    if (box) labels += `<text x="${box.x}" y="${box.y + h - 5}" font-size="23" font-weight="700" fill="var(--ink)" paint-order="stroke" stroke="var(--panel)" stroke-width="6">${esc(r.name)}</text>`;
  }
  return s + marks + labels + '</svg>';
}
const ptable = `<table class="num"><thead><tr><th>Firm</th><th>$ / can</th><th>Cans</th><th>Gross</th><th>Operating</th></tr></thead><tbody>${
  D.positions.map((x, i) => `<tr><td class="nm">${firm(x.name)}</td><td>${F.positions[i].margin}</td><td>${F.positions[i].cans}</td><td>${F.positions[i].gross}</td><td class="${x.operating < 0 ? 'neg' : ''}">${F.positions[i].operating}</td></tr>`).join('')}</tbody></table>`;
add('03 · Positions', `<h2>Margin per can × cans = gross profit</h2>
  <div class="pos"><div>${scatter(D.positions)}</div><div>${ptable}${D.leaders_line ? `<p class="soft" style="margin:16px 0 0;font-size:26px">${esc(D.leaders_line)}</p>` : ''}</div></div>`);

// why shoppers chose (DW-067 exports only)
if (D.pull) {
  const pr = D.pull.pair; let chart = '';
  if (pr) {
    const terms = ['price', 'quality', 'brand', 'fit', 'other'].filter((t) => t === 'price' || Math.abs(pr.terms[t]) >= 0.01);
    const neg = terms.some((t) => pr.terms[t] < 0) || pr.gap < 0, W = 800, lab = 170, room = W - lab - 30 - 100, half = neg ? room / 2 : room, cx = lab + 30 + (neg ? half : 0), rowh = 60;
    const mx = Math.max(0.1, ...terms.map((t) => Math.abs(pr.terms[t])), Math.abs(pr.gap));
    const rowsv = terms.map((t) => [t, pr.terms[t]]).concat([['total', pr.gap]]);
    chart = `<svg viewBox="0 0 ${W} ${rowsv.length * rowh + 10}" width="${W}" height="${rowsv.length * rowh + 10}" role="img" aria-label="Why shoppers picked one firm over the other">` +
      rowsv.map(([t, v], i) => { const y = i * rowh + 8, w = Math.abs(v) / mx * half, tot = t === 'total';
        return `<text x="${lab}" y="${y + 34}" text-anchor="end" font-size="28" font-weight="${tot ? 700 : 500}" fill="var(--ink)">${t}</text>
          <rect x="${v >= 0 ? cx : cx - w}" y="${y + 8}" width="${Math.max(w, 3)}" height="38" fill="${tot ? 'var(--ink)' : v >= 0 ? 'var(--aero)' : 'var(--copper)'}"/>
          <text x="${v >= 0 ? cx + w + 12 : cx - w - 12}" y="${y + 36}" text-anchor="${v >= 0 ? 'start' : 'end'}" font-size="26" font-weight="700" fill="var(--ink)">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}</text>`; }).join('') +
      `<line x1="${cx}" x2="${cx}" y1="0" y2="${rowsv.length * rowh + 10}" stroke="var(--line2)" stroke-width="2"/></svg>`;
  }
  const sens = `<div class="lab">Each +$1 of price costs you this share of shoppers</div>` + D.pull.sens.map((x, i) => `<div><div class="big num">${F.sens[i]}</div><div class="cat">${esc(x.label)}</div></div>`).join('');
  add('04 · Why shoppers chose', `<h2>${pr ? deco(pr.sentence) : 'What pulled shoppers'}</h2>
    <div class="pull"><div>${pr ? `<div class="lab" style="margin-bottom:10px">Bars right: why shoppers picked ${firm(pr.a)}${Object.values(pr.terms).some((v) => v < 0) ? ` · left: why they picked ${firm(pr.b)}` : ''}</div>${chart}
      <p style="margin:14px 0 0"><span class="big num">${pr.ratio.toFixed(1)}×</span> <span class="soft">the shoppers${pr.only_price ? ' · price alone' : ''}</span></p>` : ''}</div>
    <div class="sens">${sens}<p class="soft" style="margin:0;font-size:26px">No sales lost if your tanks are full.</p></div></div>`);
}

// trouble
if (D.trouble.length || D.exits.length) {
  const pips = (n) => { let s = '<svg width="330" height="60" viewBox="0 0 330 62">'; for (let i = 1; i <= D.runway; i++) { const x = 22 + (i - 1) * 68, late = i >= D.acquirable;
      s += `<circle cx="${x}" cy="22" r="16" fill="${i <= n ? (late ? 'var(--brick)' : 'var(--copper)') : 'none'}" stroke="${late ? 'var(--brick)' : 'var(--line2)'}" stroke-width="3.5"/>`;
      if (i === D.acquirable) s += `<text x="${x}" y="59" text-anchor="middle" font-size="18" font-weight="600" fill="var(--inksoft)">can be bought</text>`;
      if (i === D.runway) s += `<text x="${x}" y="59" text-anchor="middle" font-size="18" font-weight="600" fill="var(--inksoft)">exit</text>`; }
    return s + '</svg>'; };
  const shown = D.trouble.slice(0, D.exits.length ? 3 : 4);  // longest clock first, teams before NPCs; the talk sheet has every firm
  add('05 · Trouble', `<h2>Under the safety line: cash under ${F.threshold}, or coverage under 1×</h2>
    <div class="soft" style="margin-top:-8px;font-size:28px">Lenders stop new loans. From quarter ${D.acquirable} a rival can buy you; at quarter ${D.runway}, forced exit.</div>
    <div>${shown.map((t) => `<div class="tr"><div>${firm(t.name)}${t.npc ? ' <span class="faint" style="font-size:20px">NPC</span>' : ''}</div>
      <div><div>${esc(t.short)}</div>${t.loss ? `<div class="loss">${esc(t.loss)}</div>` : ''}</div><div>${t.n ? pips(t.n) : '<span class="soft">credit-rationed only</span>'}</div></div>`).join('')}</div>
    ${D.exits.length ? `<div><b>Out this round:</b> ${D.exits.map((x) => `${firm(x.name)} ${esc(x.word)}`).join('; ')}.</div>` : ''}`);
}

// questions: pose it, then the same question with the lesson
D.ask.forEach((a) => {
  add('', `<p class="q">${deco(a.q)}</p>`);
  add('', `<p class="q">${deco(a.q)}</p><div class="nameit"><div class="tag">Name it</div><div class="lesson">${esc(a.lesson)}</div></div>`);
});

// ── mount + keys ──────────────────────────────────────────────────────────
const stage = document.getElementById('stage');
stage.innerHTML = slides.map((s, i) => `<section class="slide" data-i="${i}">${s.eyebrow ? `<div class="eyebrow">${esc(s.eyebrow)}</div>` : ''}${s.html}
  <div class="foot"><span>${esc(D.label)}</span><span>${i + 1} / ${slides.length}</span></div></section>`).join('');
const els = [...stage.querySelectorAll('.slide')];
let cur = 0;
const hash = () => { const m = location.hash.match(/^#(\\d+)(l?)$/); return m ? { i: Math.min(slides.length - 1, Math.max(0, +m[1] - 1)), light: !!m[2] } : { i: 0, light: false }; };
function fit() { const s = Math.min(innerWidth / 1440, innerHeight / 810); stage.style.transform = `translate(-50%,-50%) scale(${s})`; }
function show(i) { cur = Math.max(0, Math.min(slides.length - 1, i)); els.forEach((e, j) => e.classList.toggle('on', j === cur)); history.replaceState(null, '', '#' + (cur + 1)); }
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key;
  if (['ArrowRight', ' ', 'PageDown', 'Enter'].includes(key)) { e.preventDefault(); show(cur + 1); }
  else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(key)) { e.preventDefault(); show(cur - 1); }
  else if (key === 'Home') show(0); else if (key === 'End') show(slides.length - 1);
  else if (key === 'f' || key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
  else if (key === 'd' || key === 'D') { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'; }
});
stage.addEventListener('click', () => show(cur + 1));
addEventListener('resize', fit);
const h0 = hash();
if (h0.light) document.documentElement.dataset.theme = 'light';
fit(); show(h0.i);
document.title = `${D.label} · Board meeting`;
// ?check (verification only): mark slides whose content runs into the footer
if (/[?&]check/.test(location.search)) document.fonts.ready.then(() => {
  const was = cur;
  els.forEach((el) => { els.forEach((e) => e.classList.toggle('on', e === el));
    const limit = el.querySelector('.foot').getBoundingClientRect().top, sc = stage.getBoundingClientRect().width / 1440;
    const over = Math.max(0, ...[...el.children].filter((c) => !c.classList.contains('foot')).map((c) => c.getBoundingClientRect().bottom - limit)) / sc;
    if (over > 1) el.dataset.overflow = Math.round(over); });
  document.body.dataset.checked = '1'; show(was); });
</script></body></html>"""

TEAMS = """<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Team focus cards</title>""" + FONTS + """<style>""" + TOKENS + """
body{margin:0;background:var(--paper);color:var(--ink);font:400 19px/1.45 var(--serif)}
.bar{position:sticky;top:0;z-index:2;background:var(--ink);color:var(--panel);padding:10px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;font:500 14px/1.3 var(--sans)}
.bar select{font:500 15px var(--sans);padding:4px 6px}
.bar b{color:var(--gold);letter-spacing:.08em;text-transform:uppercase}
main{max-width:760px;margin:0 auto;padding:16px}
.firm{background:var(--panel);border:1px solid var(--line2);padding:22px 20px 26px;margin:0 0 24px}
h1{font:700 38px/1.05 var(--serif);margin:6px 0 4px;letter-spacing:-.01em}
.sub{color:var(--inksoft);font-style:italic;margin:0 0 16px}
table{border-collapse:collapse;width:100%;table-layout:fixed;font:400 17px/1.25 var(--serif)}
col.l{width:38%}
th{font:600 11px/1.2 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--inksoft);text-align:right;padding:0 0 8px 6px;border-bottom:1px solid var(--line2);vertical-align:bottom}
td{padding:6px 0 6px 6px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left;padding-left:0;white-space:normal}
td.you{font-weight:600}
h2{font:600 13px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;color:var(--inksoft);margin:22px 0 10px}
.moves{margin:0;padding-left:18px;color:var(--inksoft);font-size:17px}
.card{border-left:6px solid var(--copper);background:var(--panel2);padding:14px 16px;margin:0 0 14px}
.chair{display:inline-block;font:600 12px/1 var(--sans);letter-spacing:.14em;background:var(--ink);color:var(--panel);padding:6px 9px;border-radius:999px}
.card .q{font:500 23px/1.25 var(--serif);margin:10px 0 8px}
.card .ev,.card .where{font:400 15px/1.4 var(--sans);color:var(--inksoft);margin:4px 0 0}
.card .ev b,.card .where b{color:var(--ink);font-weight:600}
.none{color:var(--inksoft);font-style:italic}
.fine{font:400 13px/1.4 var(--sans);color:var(--faint);margin-top:18px}
@media print{.bar{display:none}.firm{break-after:page;border:0}body{background:#fff}}
</style></head><body>
<div class="bar"><b>Private · one team each</b><span>Not for the projector.</span><label>Firm <select id="pick"><option value="">All teams</option></select></label></div>
<main id="main"></main>
<script id="data" type="application/json">__DATA__</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const main = document.getElementById('main'), pick = document.getElementById('pick');
main.innerHTML = D.teams.map((t) => `<section class="firm" data-fid="${esc(t.fid)}">
  <div class="eyebrow">${esc(D.label)} · private to your team</div>
  <h1>${esc(t.name)}</h1>
  <p class="sub">#${t.rank} of ${t.n} on the season scorecard${t.called ? ` · you called #${t.called}` : ''}${t.trouble ? ` · under the safety line, ${esc(t.trouble)}` : ''}</p>
  <table class="num"><colgroup><col class="l"><col><col><col></colgroup><thead><tr><th>This round</th><th>You</th><th>Rivals (median)</th><th>Last round</th></tr></thead><tbody>
  ${t.metrics.map((m) => `<tr><td>${esc(m.label)}</td><td class="you">${esc(m.you)}</td><td>${esc(m.field)}</td><td>${esc(m.last)}</td></tr>`).join('')}</tbody></table>
  ${t.moves.length ? `<h2>What you changed</h2><ul class="moves">${t.moves.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
  <h2>For the board · ${t.prompts.length || 'no'} question${t.prompts.length === 1 ? '' : 's'}</h2>
  ${t.prompts.length ? t.prompts.map((p) => `<div class="card"><span class="chair">${esc(p.chair)}</span><p class="q">${esc(p.q)}</p>
    <p class="ev"><b>Evidence.</b> ${esc(p.evidence)}</p><p class="where"><b>Where to look.</b> ${esc(p.where)}</p></div>`).join('')
    : `<p class="none">Nothing tripped a rule this round. Which number above surprised you, and why did it move?</p>`}
  <p class="fine">Questions, not answers. Each chair brings one sentence to the next board meeting.</p></section>`).join('');
pick.innerHTML += D.teams.map((t) => `<option value="${esc(t.fid)}">${esc(t.name)}</option>`).join('');
function apply() { const id = location.hash.slice(1); pick.value = id; document.querySelectorAll('.firm').forEach((s) => { s.style.display = !id || s.dataset.fid === id ? '' : 'none'; }); scrollTo(0, 0); }
pick.addEventListener('change', () => { location.hash = pick.value; if (!pick.value) apply(); });
addEventListener('hashchange', apply); apply();
document.title = `${D.label} · Team focus cards`;
</script></body></html>"""


def main():
    ap = argparse.ArgumentParser(description="Board-meeting brief (text); with --html a projectable deck + an instructor talk sheet.")
    ap.add_argument("export", help="instructor JSON export (Dashboard › Export JSON)")
    ap.add_argument("round", nargs="?", type=int, help="wire round (0 = round 1); default = latest resolved")
    ap.add_argument("--html", action="store_true", help="write <export>-rNN-deck.html (opened) + <export>-rNN-talk.md instead of printing the brief")
    ap.add_argument("--styles", action="store_true", help="read each team's chosen colour + emblem from the game database (read-only; needs server/.env)")
    ap.add_argument("--teams", action="store_true", help="PARKED: also write <export>-rNN-teams.html, the private per-team handouts")
    ap.add_argument("--out", help="directory for the files (default: next to the export)")
    ap.add_argument("--no-open", action="store_true", help="write the HTML without opening the deck")
    a = ap.parse_args()
    j = json.load(open(a.export))
    b = analyze(j, a.round)
    picked = None
    if a.styles:
        try:
            picked = picked_styles(j["meta"]["gameId"])
            print(f"Team colours: {sum(1 for p in picked.values() if p.get('color') or p.get('emblem'))} picked in the game, the rest assigned.")
        except Exception as e:  # never block the debrief on a network hiccup
            print(f"Team colours: couldn't read the game's picks ({e}); using house colours.", file=sys.stderr)
    b["styles"] = house_styles(j, picked)
    if not (a.html or a.teams):
        return print(render_text(b))
    src = Path(a.export).expanduser().resolve()
    out = Path(a.out).expanduser() if a.out else src.parent
    out.mkdir(parents=True, exist_ok=True)
    base = out / f"{re.sub(r'[^\w.-]+', '-', src.stem).strip('-')}-r{b['round'] + 1:02d}"
    if a.html:
        deck, talk = Path(f"{base}-deck.html"), Path(f"{base}-talk.md")
        deck.write_text(render_deck(b), encoding="utf-8")
        talk.write_text(render_talk(b), encoding="utf-8")
        print(f"Deck (projector):  {deck}\nTalk sheet (you):  {talk}")
        if not a.no_open:
            webbrowser.open(deck.as_uri())
    if a.teams:
        teams = Path(f"{base}-teams.html")
        teams.write_text(render_handouts(b), encoding="utf-8")
        print(f"Team handouts (private — never project):  {teams}")


if __name__ == "__main__":
    main()
