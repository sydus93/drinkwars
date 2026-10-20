/**
 * Debrief tab (DW-068 phase 2) — the board-meeting debrief, live from the dashboard payload
 * already in the browser. No export step: every number and sentence comes from the server
 * package's `analyzeDebrief` (the canonical rules; `scripts/teach-brief.py` is the offline
 * fallback and a parity test holds the two together).
 *
 * Two surfaces, kept apart on purpose:
 *  - THE DECK — projectable slides on a fixed 1440×810 stage (scaled to fit; F = fullscreen).
 *    It is rendered from `DebriefDeck`, a type with the team-private pages removed, so nothing
 *    private can reach it.
 *  - TEAM PAGES — one firm's numbers vs the field + ≤3 chair-routed questions. Competitive
 *    information: it lives OUTSIDE the element that goes fullscreen, opens only after a two-step
 *    "this screen is not projected" confirmation, shows one firm at a time, and closes itself
 *    whenever the deck goes fullscreen, the round changes, or the window loses focus.
 *
 * Keys (while this tab is open and you are not typing in a field):
 *   → / space / PgDn / Enter  next (on a question: first reveals NAME IT)     ← / PgUp  back
 *   Home / End   first / last slide      F  fullscreen      D  dark ↔ light
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { analyzeDebrief, debriefDeck, debriefFmt, debriefName, debriefRounds, DEBRIEF_ACQUIRABLE, DEBRIEF_RUNWAY, type DebriefDeck, type DebriefFocus, type DebriefPosition, type InstructorDashboard as DashData } from "drinkwars-server";
import { Button, Card, Eyebrow } from "./ui.js";
import { Emblem, EMBLEM_IDS } from "./FacilityGlyph.js";
import { FIRM_COLORS } from "../lib/teamColors.js";
import { parseEvents } from "./eventFeed.js";

const { k, pct, usd, sgn } = debriefFmt;
const STAGE_W = 1440, STAGE_H = 810;

// ── house marks: the colour + emblem a team picked at founding; unpicked teams take the next
// unused house colour / emblem in team order (the app's own palette); NPCs are grey with a dot.
interface Mark { color: string; emblem: string | null; ink: string }
const NPC_MARK: Mark = { color: "#6f6a64", emblem: null, ink: "#ffffff" };
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const ch = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function houseMarks(teams: DashData["teams"]): Map<string, Mark> {
  const pickedC = new Set(teams.map((t) => (t.color ?? "").toLowerCase()).filter(Boolean));
  const pickedE = new Set(teams.map((t) => t.emblem).filter(Boolean));
  const allC = FIRM_COLORS.map((c) => c.hex as string);
  const freeC = allC.filter((c) => !pickedC.has(c)), freeE = EMBLEM_IDS.filter((e) => !pickedE.has(e));
  const colors = freeC.length ? freeC : allC, emblems: readonly string[] = freeE.length ? freeE : EMBLEM_IDS;
  const out = new Map<string, Mark>();
  let i = 0;
  for (const t of teams) {
    if (!t.joined) { out.set(debriefName(t), NPC_MARK); continue; }
    let color = t.color ?? null, emblem = t.emblem ?? null;
    if (!color || !emblem) { color = color || colors[i % colors.length]; emblem = emblem || emblems[i % emblems.length]; i++; }
    out.set(debriefName(t), { color, emblem, ink: luminance(color) > 0.3 ? "#1a1209" : "#ffffff" });
  }
  return out;
}

// ── scoped styles. Colours are the app's own tokens: the deck wrapper carries data-mode="night"
// (the app's dark rule) by default; "light" re-pins the Foolscap values so the toggle also works
// when the app itself is in night mode. Sizes are stage pixels (the stage scales as one piece).
const CSS = `
.dbf-wrap{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--color-paper);border:1px solid var(--color-line2);border-radius:10px;cursor:pointer;outline:none}
.dbf-wrap:fullscreen{aspect-ratio:auto;border:0;border-radius:0;width:100vw;height:100vh}
.dbf-wrap[data-dbf="light"]{--color-paper:#ece0c4;--color-panel:#fcf5e7;--color-panel2:#e9d7b4;--color-ink:#2c1d11;--color-inksoft:#6b513a;--color-faint:#9a7a52;--color-copper:#c0703a;--color-copperdeep:#9a5024;--color-gold:#e3a52f;--color-hop:#456a22;--color-aero:#1f8c93;--color-plum:#7c4f86;--color-brick:#a83f2c;--color-line:#d8c39c;--color-line2:#c2a877}
.dbf-stage{position:absolute;left:50%;top:50%;width:${STAGE_W}px;height:${STAGE_H}px;background:var(--color-panel);color:var(--color-ink);transform-origin:center center}
.dbf-slide{position:absolute;inset:0;padding:48px 72px 64px;display:flex;flex-direction:column;gap:22px;font:500 30px/1.35 var(--font-mono)}
.dbf-num{font-variant-numeric:lining-nums tabular-nums}
.dbf-eyebrow{font:600 22px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-inksoft)}
.dbf-h1{font:700 112px/1 var(--font-display);letter-spacing:-.015em;margin:0}
.dbf-h2{font:600 50px/1.12 var(--font-display);letter-spacing:-.01em;margin:0}
.dbf-big{font:600 76px/1 var(--font-display)}
.dbf-soft{color:var(--color-inksoft)} .dbf-faint{color:var(--color-faint)}
.dbf-lab{font:600 22px/1.2 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--color-inksoft)}
.dbf-chip{display:inline-block;font:700 21px/1 var(--font-mono);letter-spacing:.12em;text-transform:uppercase;padding:9px 14px;border-radius:999px;color:#15100a}
.dbf-k-FLAT{background:var(--color-copper)} .dbf-k-MIXED{background:var(--color-gold)} .dbf-k-SLACK{background:var(--color-aero)}
.dbf-foot{position:absolute;left:72px;right:72px;bottom:22px;display:flex;justify-content:space-between;font:600 20px/1 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--color-faint)}
.dbf-bdg{display:inline-grid;place-items:center;width:1.05em;height:1.05em;border-radius:28%;box-shadow:0 0 0 2px var(--color-ink);vertical-align:-.16em;margin:0 .32em 0 .06em}
.dbf-fn{font-weight:700;white-space:nowrap}
.dbf-neg{color:var(--color-brick);font-weight:700}
.dbf-events{margin:6px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px}
.dbf-events li{padding-left:30px;position:relative;line-height:1.3}
.dbf-events li:before{content:"";position:absolute;left:0;top:.5em;width:13px;height:13px;background:var(--color-copper)}
.dbf-agenda{margin-top:auto;display:flex;gap:12px 26px;flex-wrap:wrap;font:600 21px/1 var(--font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--color-inksoft)}
.dbf-tiles{display:grid;gap:28px}
.dbf-tile{border-top:8px solid var(--color-line2);padding-top:14px;display:flex;flex-direction:column;gap:10px}
.dbf-tile.FLAT{border-color:var(--color-copper)} .dbf-tile.MIXED{border-color:var(--color-gold)} .dbf-tile.SLACK{border-color:var(--color-aero)}
.dbf-cat{font:600 34px/1.1 var(--font-display);display:flex;align-items:center;gap:16px}
.dbf-flow{display:flex;align-items:baseline;gap:18px}
.dbf-arrow{font:400 48px/1 var(--font-display);color:var(--color-faint)}
.dbf-con{display:flex;flex-direction:column;gap:12px}
.dbf-con .dbf-lab{margin-bottom:8px} .dbf-con .dbf-lab i{font:italic 500 28px/1 var(--font-display);letter-spacing:0;text-transform:none;margin-left:12px;color:var(--color-ink)}
.dbf-fc{display:inline-block;padding:5px 16px 5px 10px;margin:0 10px 8px 0;border:2px solid var(--color-line2);border-left:8px solid var(--color-aero);font-size:29px}
.dbf-fc.full{border-left-color:var(--color-copper)} .dbf-none{color:var(--color-faint);font-style:italic}
.dbf-moves{display:flex;flex-direction:column;gap:16px}
.dbf-mv{display:grid;grid-template-columns:330px 1fr;gap:4px 24px;padding-bottom:14px;border-bottom:2px solid var(--color-line)}
.dbf-mv .who{font-size:30px;line-height:1.2}
.dbf-mv .what{font:700 30px/1.2 var(--font-mono)}
.dbf-mv .verdict{grid-column:2;font:italic 500 32px/1.25 var(--font-display)}
.dbf-mv .detail{grid-column:2;font-size:28px;color:var(--color-inksoft)}
.dbf-pos{display:grid;grid-template-columns:580px minmax(0,1fr);gap:28px;align-items:start}
.dbf-pos>div>svg{width:580px;height:auto}
.dbf-table{border-collapse:collapse;width:100%;font:500 28px/1.2 var(--font-mono)}
.dbf-table th{font:700 20px/1 var(--font-mono);letter-spacing:.02em;text-transform:uppercase;color:var(--color-inksoft);text-align:right;padding:0 0 10px 10px;border-bottom:2px solid var(--color-line2)}
.dbf-table td{padding:7px 0 7px 10px;text-align:right;border-bottom:1px solid var(--color-line);white-space:nowrap}
.dbf-table th:first-child,.dbf-table td:first-child{text-align:left;padding-left:0}
.dbf-table td.nm{max-width:250px;overflow:hidden;text-overflow:ellipsis}
.dbf-stage svg text{font-family:var(--font-mono)}
.dbf-pull{display:grid;grid-template-columns:1fr 430px;gap:40px;align-items:start}
.dbf-sens{display:flex;flex-direction:column;gap:22px}
.dbf-sens .cat{font:600 32px/1.1 var(--font-display)}
.dbf-tr{display:grid;grid-template-columns:320px 1fr 330px;gap:24px;align-items:center;padding:6px 0;border-bottom:2px solid var(--color-line)}
.dbf-tr .loss{font:italic 500 28px/1.25 var(--font-display);color:var(--color-inksoft)}
.dbf-q{font:600 58px/1.16 var(--font-display);letter-spacing:-.005em;margin:36px 0 0;max-width:1260px}
.dbf-nameit{margin-top:28px;border-left:12px solid var(--color-copper);padding:24px 32px;background:var(--color-panel2)}
.dbf-nameit .tag{font:700 22px/1 var(--font-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--color-copper);margin-bottom:14px}
.dbf-nameit .lesson{font:600 48px/1.22 var(--font-display)}
.dbf-hint{margin-top:28px;font:600 22px/1 var(--font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--color-faint)}
.dbf-private{border:3px solid var(--color-brick);border-radius:10px;overflow:hidden;background:var(--color-panel)}
.dbf-private-bar{background:repeating-linear-gradient(135deg,var(--color-brick) 0 18px,color-mix(in srgb,var(--color-brick) 78%,#000) 18px 36px);color:#fff;padding:10px 16px;font:700 0.95rem/1.3 var(--font-mono);letter-spacing:.1em;text-transform:uppercase;display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.dbf-card{border-left:6px solid var(--color-copper);background:var(--color-panel2);padding:14px 16px;margin:0 0 12px}
.dbf-chair{display:inline-block;font:600 0.8rem/1 var(--font-mono);letter-spacing:.14em;background:var(--color-ink);color:var(--color-panel);padding:6px 9px;border-radius:999px}
`;

// ── little pieces ────────────────────────────────────────────────────────────────
function Badge({ mark }: { mark: Mark }) {
  return (
    <span className="dbf-bdg" style={{ background: mark.color }}>
      {mark.emblem ? <Emblem id={mark.emblem} size={"74%" as unknown as number} color={mark.ink} /> : <svg viewBox="0 0 24 24" width="74%" height="74%" aria-hidden="true"><circle cx="12" cy="12" r="5" fill={mark.ink} /></svg>}
    </span>
  );
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** DW-078: an event as the students read it in their feed ("Water shortage in Cedar Falls: input
 *  costs spike…"), not the engine's log line ("SHOCK fired: water (cost_spike, mag 0.35, …)") — the
 *  title slide is projected. A collapsed repeat keeps its "×n". */
export const deckEvent = (raw: string): string => {
  const [, line, times = ""] = raw.match(/^(.*?)(\s+×\d+)?$/) ?? [raw, raw];
  const ev = parseEvents([line], "")[0];
  if (!ev) return raw;
  const body = typeof ev.body === "string" ? ev.body : "";
  const text = ev.id.startsWith("house:") && body ? `${ev.title} ${body.charAt(0).toLowerCase()}${body.slice(1)}` : body || ev.title || line;
  return text + times;
};

/** Slide renderer. Takes the DECK type: the team-private pages are not in it. */
function useSlides(D: DebriefDeck, marks: Map<string, Mark>) {
  return useMemo(() => {
    const markOf = (n: string): Mark => marks.get(n) ?? NPC_MARK;
    const firm = (n: string, key?: string | number): ReactNode => <span key={key}><Badge mark={markOf(n)} /><span className="dbf-fn">{n}</span></span>;
    // every firm name inside running text gets its mark, so teams find themselves at a glance
    const names = [...marks.keys()].sort((a, b) => b.length - a.length);
    const re = names.length ? new RegExp(`(${names.map(escapeRe).join("|")})`, "g") : null;
    const deco = (t: string): ReactNode => (re ? t.split(re).map((part, i) => (i % 2 ? firm(part, i) : part)) : t);
    const slides: { eyebrow: string; body: ReactNode; question?: number; show?: string }[] = [];

    // title
    const agenda = ["The story", "What moved", "Positions", ...(D.pull ? ["Why shoppers chose"] : []), ...(D.trouble.length || D.exits.length ? ["Trouble"] : []), "Questions"];
    slides.push({ eyebrow: "Drink Wars · Board meeting", body: (<>
      <h1 className="dbf-h1">{D.label}</h1>
      {D.top_events.length > 0 && <ul className="dbf-events">{D.top_events.map((e, i) => <li key={i}>{deco(deckEvent(e))}</li>)}</ul>}
      <div className="dbf-agenda">{agenda.map((a, i) => <span key={a}>{String(i + 1).padStart(2, "0")} · {a}</span>)}</div>
    </>) });

    // the story
    const kindOf = (st: DebriefDeck["story"][number]) => st.kind.split(" ")[0];
    const group = (full: boolean, label: string, why: string) => {
      const fs = D.tanks.filter((t) => t.full === full);
      return (
        <div>
          <div className="dbf-lab">{label}{D.teach && fs.length > 0 && <i>{why}</i>}</div>
          <div>{fs.length ? fs.map((t) => <span key={t.name} className={`dbf-fc ${full ? "full" : ""}`}>{firm(t.name)}</span>) : <span className="dbf-none">none</span>}</div>
        </div>
      );
    };
    slides.push({ eyebrow: "01 · The story", show: D.rich ? D.cards.TANKS : D.cards.UNITS, body: (<>
      <h2 className="dbf-h2">{deco(D.story_head)}</h2>
      <div className="dbf-tiles" style={{ gridTemplateColumns: `repeat(${Math.max(1, D.story.length)},1fr)` }}>
        {D.story.map((st) => (
          <div key={st.seg} className={`dbf-tile ${kindOf(st)}`}>
            <div className="dbf-cat"><span className={`dbf-chip dbf-k-${kindOf(st)}`}>{st.kind}</span>{st.label}</div>
            <div className="dbf-flow">
              <div><div className="dbf-big dbf-num">{k(st.D)}</div><div className="dbf-lab">drinkers{st.dD != null ? ` · ${sgn(st.dD, pct)}` : ""}</div></div>
              <div className="dbf-arrow">→</div>
              <div><div className="dbf-big dbf-num">{k(st.sold)}</div><div className="dbf-lab">served</div></div>
            </div>
            <div>
              {st.away != null && st.wanted != null && <><span className="dbf-soft">{k(st.wanted)} wanted one of you ·</span> <b>{k(st.away)} turned away</b><br /></>}
              {st.kind === "MIXED" ? `${st.out.length} of ${st.n} ran their tanks full` : st.kind === "FLAT OUT" ? `All ${st.n} ran their tanks full` : "Everyone had tanks to spare"}
            </div>
          </div>
        ))}
      </div>
      <div className="dbf-con">
        {group(true, "Supply-constrained · sold out", "more shoppers would not have sold another can")}
        {group(false, "Demand-constrained · tanks to spare", "price and pull decided their sales")}
      </div>
    </>) });

    // what moved
    slides.push({ eyebrow: "02 · What moved", show: D.cards.TANKS, body: D.moves.length ? (
      <div className="dbf-moves">
        {D.moves.slice(0, 4).map((m, i) => (
          <div key={i} className="dbf-mv">
            <div className="who">{firm(m.name)}</div>
            <div className="what dbf-num">{m.what} &nbsp;{m.change}</div>
            {m.verdict && <div className="verdict">{deco(m.verdict)}</div>}
            {m.detail && <div className="detail dbf-num">{m.detail}</div>}
          </div>
        ))}
      </div>
    ) : <h2 className="dbf-h2">{D.moved_note}</h2> });

    // positions
    slides.push({ eyebrow: "03 · Positions", show: `${D.cards.MAP_COST} · then ${D.cards.MAP_VOL}`, body: (<>
      <h2 className="dbf-h2">Margin per can × cans = gross profit</h2>
      <div className="dbf-pos">
        <div>{D.positions.length > 0 && <PositionsScatter rows={D.positions} markOf={markOf} />}</div>
        <div>
          <table className="dbf-table dbf-num">
            <thead><tr><th>Firm</th><th>$ / can</th><th>Cans</th><th>Gross</th><th>Operating</th></tr></thead>
            <tbody>{D.positions.map((x) => (
              <tr key={x.fid}><td className="nm">{firm(x.name)}</td><td>${x.margin.toFixed(2)}</td><td>{k(x.cans)}</td><td>{usd(x.gross)}</td><td className={x.operating < 0 ? "dbf-neg" : ""}>{usd(x.operating)}</td></tr>
            ))}</tbody>
          </table>
          {D.leaders_line && <p className="dbf-soft" style={{ margin: "16px 0 0", fontSize: 28 }}>{deco(D.leaders_line)}</p>}
        </div>
      </div>
    </>) });

    // why shoppers chose (DW-067 payloads only)
    if (D.pull) {
      const pr = D.pull.pair;
      slides.push({ eyebrow: "04 · Why shoppers chose", show: D.cards.PULL, body: (<>
        <h2 className="dbf-h2">{pr ? deco(pr.sentence) : "What pulled shoppers"}</h2>
        <div className="dbf-pull">
          <div>{pr && (<>
            <div className="dbf-lab" style={{ marginBottom: 10 }}>Bars right: why shoppers picked {firm(pr.a)}{Object.values(pr.terms).some((v) => v < 0) && <> · left: why they picked {firm(pr.b)}</>}</div>
            <PullBars pair={pr} />
            <p style={{ margin: "14px 0 0" }}><span className="dbf-big dbf-num">{pr.ratio.toFixed(1)}×</span> <span className="dbf-soft">the shoppers{pr.only_price ? " · price alone" : ""}{pr.exact ? "" : " · markets on: read the bars, not e^gap"}</span></p>
          </>)}</div>
          <div className="dbf-sens">
            <div className="dbf-lab">Each +$1 of price costs you this share of shoppers</div>
            {D.pull.sens.map((x) => <div key={x.label}><div className="dbf-big dbf-num">{pct(x.cost)}</div><div className="cat">{x.label}</div></div>)}
            <p className="dbf-soft" style={{ margin: 0, fontSize: 28 }}>No sales lost if your tanks are full.</p>
          </div>
        </div>
      </>) });
    }

    // trouble
    if (D.trouble.length || D.exits.length) {
      const shown = D.trouble.slice(0, D.exits.length ? 3 : 4); // longest clock first, teams before NPCs
      slides.push({ eyebrow: `0${D.pull ? 5 : 4} · Trouble`, show: D.cards.CANARY, body: (<>
        <h2 className="dbf-h2">Under the safety line: cash under {usd(D.threshold)}, or coverage under 1×</h2>
        <div className="dbf-soft" style={{ marginTop: -8, fontSize: 28 }}>Lenders stop new loans. From quarter {DEBRIEF_ACQUIRABLE} a rival can buy you; at quarter {DEBRIEF_RUNWAY}, forced exit.</div>
        <div>{shown.map((t) => (
          <div key={t.name} className="dbf-tr">
            <div>{firm(t.name)}{t.npc && <span className="dbf-faint" style={{ fontSize: 20 }}> NPC</span>}</div>
            <div><div>{t.short}</div>{t.loss && <div className="loss">{t.loss}</div>}</div>
            <div>{t.n ? <Pips n={t.n} /> : <span className="dbf-soft">credit-rationed only</span>}</div>
          </div>
        ))}</div>
        {D.trouble.length > shown.length && <div className="dbf-soft" style={{ fontSize: 28 }}>+ {D.trouble.length - shown.length} more under the line</div>}
        {D.exits.length > 0 && <div><b>Out this round:</b> {D.exits.map((x, i) => <span key={x.name}>{i > 0 && "; "}{firm(x.name)} {x.word}</span>)}.</div>}
      </>) });
    }

    // questions: posed alone; the next click adds NAME IT
    D.ask.forEach((a, i) => slides.push({ eyebrow: `Ask the room · ${i + 1} of ${D.ask.length}`, question: i, show: a.show, body: <p className="dbf-q">{deco(a.q)}</p> }));
    return slides;
  }, [D, marks]);
}

// positions: margin/can × cans scatter with iso-gross-profit curves (port of the offline deck's)
function nice(v: number, steps = [1, 2, 2.5, 5, 10]): number { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-9)))); return steps.map((m) => m * p).find((x) => x >= v - 1e-9) ?? 10 * p; }
const fine = (v: number) => nice(v, [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]);
function ticks(a: number, b: number, n: number): number[] { const st = nice((b - a) / n); const out: number[] = []; for (let v = Math.ceil(a / st) * st; v <= b + 1e-9; v += st) out.push(+v.toFixed(6)); return out; }
const kfmt = (v: number) => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : String(Math.round(v)));
interface Box { x: number; y: number; w: number; h: number }
function PositionsScatter({ rows, markOf }: { rows: DebriefPosition[]; markOf: (n: string) => Mark }) {
  const W = 640, H = 560, m = { l: 96, r: 22, t: 18, b: 80 };
  const x1 = fine(Math.max(1, ...rows.map((r) => r.cans)) * 1.1), yl = Math.min(0, ...rows.map((r) => r.margin)), y1 = fine(Math.max(0.01, ...rows.map((r) => r.margin)) * 1.15);
  const X = (v: number) => m.l + (v / x1) * (W - m.l - m.r), Y = (v: number) => H - m.b - ((v - yl) / (y1 - yl)) * (H - m.t - m.b);
  const gmax = Math.max(...rows.map((r) => r.gross));
  const isos = gmax > 0 ? [...new Set([fine(gmax / 2.5), fine(gmax)])].filter((g) => g > 0) : [];
  const isoBoxes: Box[] = isos.map((g) => ({ x: W - m.r - 130, y: Y(g / x1) - 34, w: 130, h: 28 }));
  // labels only where they sit unambiguously beside their own mark; a crowded mark keeps just its emblem (keyed by the table)
  const R0 = 15, h = 26;
  const dots: Box[] = rows.map((r) => ({ x: X(r.cans) - R0, y: Y(r.margin) - R0, w: 2 * R0, h: 2 * R0 }));
  const pts = rows.map((r) => [X(r.cans), Y(r.margin)] as const);
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const gap = (b: Box, [x, y]: readonly [number, number]) => Math.hypot(Math.max(b.x - x, 0, x - b.x - b.w), Math.max(b.y - y, 0, y - b.y - b.h));
  const mine = (b: Box, px: number, py: number) => pts.every(([x, y]) => (x === px && y === py) || gap(b, [x, y]) > gap(b, [px, py]) + 14);
  const boxes = [...isoBoxes];
  const placed = [...rows].sort((a, b) => b.cans - a.cans).map((r) => {
    const px = X(r.cans), py = Y(r.margin), w = r.name.length * 13 + 6;
    let box: Box | null = null;
    for (const rad of [R0 + 4, R0 + 14, R0 + 26]) {
      for (const ang of [0, 180, -90, 90, -30, 30, -150, 150, -60, 60, -120, 120]) {
        const c = Math.cos((ang * Math.PI) / 180), sn = Math.sin((ang * Math.PI) / 180), ax = px + c * rad, ay = py + sn * rad;
        const b: Box = { x: c > 0.3 ? ax : c < -0.3 ? ax - w : ax - w / 2, y: sn > 0.3 ? ay : sn < -0.3 ? ay - h : ay - h / 2, w, h };
        if (b.x >= m.l - 4 && b.x + w <= W && b.y >= 0 && b.y + h <= H - m.b && !boxes.some((o) => hit(b, o)) && !dots.some((o) => hit(b, o)) && mine(b, px, py)) { box = b; break; }
      }
      if (box) break;
    }
    if (box) boxes.push(box);
    return { r, px, py, box, st: markOf(r.name) };
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Margin per can against cans sold">
      {ticks(yl, y1, 4).map((t) => <g key={`y${t}`}><line x1={m.l} x2={W - m.r} y1={Y(t)} y2={Y(t)} stroke="var(--color-line)" strokeWidth={1.5} /><text x={m.l - 12} y={Y(t) + 8} textAnchor="end" fontSize={22} fontWeight={600} fill="var(--color-inksoft)">${t.toFixed(t % 1 ? 1 : 0)}</text></g>)}
      {ticks(0, x1, 4).map((t) => <text key={`x${t}`} x={Math.min(X(t), W - 2)} y={H - m.b + 32} textAnchor={X(t) > W - 40 ? "end" : "middle"} fontSize={22} fontWeight={600} fill="var(--color-inksoft)">{kfmt(t)}</text>)}
      <line x1={m.l} x2={W - m.r} y1={Y(Math.max(yl, 0))} y2={Y(Math.max(yl, 0))} stroke="var(--color-line2)" strokeWidth={2} />
      {isos.map((g) => { // iso-gross-profit: margin × cans = g
        const p: string[] = [];
        for (let i = 0; i <= 60; i++) { const c = g / y1 + ((x1 - g / y1) * i) / 60; p.push(`${X(c).toFixed(1)},${Y(g / c).toFixed(1)}`); }
        return <g key={g}><polyline points={p.join(" ")} fill="none" stroke="var(--color-gold)" strokeWidth={2.5} strokeDasharray="8 7" /><text x={W - m.r - 4} y={Y(g / x1) - 12} textAnchor="end" fontSize={21} fontWeight={700} fill="var(--color-gold)" paintOrder="stroke" stroke="var(--color-panel)" strokeWidth={7}>${kfmt(g)} gross</text></g>;
      })}
      <text x={(m.l + W - m.r) / 2} y={H - 12} textAnchor="middle" fontSize={21} fontWeight={700} fill="var(--color-inksoft)" letterSpacing={1.5}>CANS SOLD →</text>
      <text transform={`translate(24 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={21} fontWeight={700} fill="var(--color-inksoft)" letterSpacing={1.5}>MARGIN PER CAN →</text>
      {placed.map(({ r, px, py, st }) => (
        <g key={r.fid}>
          <circle cx={px} cy={py} r={R0} fill={st.color} stroke="var(--color-ink)" strokeWidth={2.5} />
          <g transform={`translate(${px - 10} ${py - 10})`}>{st.emblem ? <Emblem id={st.emblem} size={20} color={st.ink} /> : <circle cx={10} cy={10} r={4} fill={st.ink} />}</g>
        </g>
      ))}
      {placed.map(({ r, box }) => box && <text key={r.fid} x={box.x} y={box.y + h - 5} fontSize={23} fontWeight={700} fill="var(--color-ink)" paintOrder="stroke" stroke="var(--color-panel)" strokeWidth={6}>{r.name}</text>)}
    </svg>
  );
}

function PullBars({ pair }: { pair: NonNullable<NonNullable<DebriefDeck["pull"]>["pair"]> }) {
  const terms = (["price", "quality", "brand", "fit", "other"] as const).filter((t) => t === "price" || Math.abs(pair.terms[t]) >= 0.01);
  const neg = terms.some((t) => pair.terms[t] < 0) || pair.gap < 0, W = 800, lab = 170, room = W - lab - 30 - 100, half = neg ? room / 2 : room, cx = lab + 30 + (neg ? half : 0), rowh = 60;
  const mx = Math.max(0.1, ...terms.map((t) => Math.abs(pair.terms[t])), Math.abs(pair.gap));
  const rows: [string, number][] = [...terms.map((t) => [t, pair.terms[t]] as [string, number]), ["total", pair.gap]];
  const Hh = rows.length * rowh + 10;
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} width={W} height={Hh} role="img" aria-label="Why shoppers picked one firm over the other">
      {rows.map(([t, v], i) => {
        const y = i * rowh + 8, w = (Math.abs(v) / mx) * half, tot = t === "total";
        return (
          <g key={t}>
            <text x={lab} y={y + 34} textAnchor="end" fontSize={28} fontWeight={tot ? 700 : 500} fill="var(--color-ink)">{t}</text>
            <rect x={v >= 0 ? cx : cx - w} y={y + 8} width={Math.max(w, 3)} height={38} fill={tot ? "var(--color-ink)" : v >= 0 ? "var(--color-aero)" : "var(--color-copper)"} />
            <text x={v >= 0 ? cx + w + 12 : cx - w - 12} y={y + 36} textAnchor={v >= 0 ? "start" : "end"} fontSize={26} fontWeight={700} fill="var(--color-ink)">{v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(2)}</text>
          </g>
        );
      })}
      <line x1={cx} x2={cx} y1={0} y2={Hh} stroke="var(--color-line2)" strokeWidth={2} />
    </svg>
  );
}

function Pips({ n }: { n: number }) {
  return (
    <svg width={330} height={60} viewBox="0 0 330 62" role="img" aria-label={`Quarter ${n} of ${DEBRIEF_RUNWAY} under the safety line`}>
      {Array.from({ length: DEBRIEF_RUNWAY }, (_, j) => j + 1).map((i) => {
        const x = 22 + (i - 1) * 68, late = i >= DEBRIEF_ACQUIRABLE;
        return (
          <g key={i}>
            <circle cx={x} cy={22} r={16} fill={i <= n ? (late ? "var(--color-brick)" : "var(--color-copper)") : "none"} stroke={late ? "var(--color-brick)" : "var(--color-line2)"} strokeWidth={3.5} />
            {i === DEBRIEF_ACQUIRABLE && <text x={x} y={59} textAnchor="middle" fontSize={18} fontWeight={600} fill="var(--color-inksoft)">can be bought</text>}
            {i === DEBRIEF_RUNWAY && <text x={x} y={59} textAnchor="middle" fontSize={18} fontWeight={600} fill="var(--color-inksoft)">exit</text>}
          </g>
        );
      })}
    </svg>
  );
}

// ── team page (PRIVATE) ──────────────────────────────────────────────────────────
function TeamPage({ t, label, rich }: { t: DebriefFocus; label: string; rich: boolean }) {
  return (
    <div className="px-5 pb-6 pt-4" data-dbf-private-page={t.fid}>
      <div className="eyebrow">{label} · private to this team</div>
      <h2 className="display text-4xl">{t.name}</h2>
      <p className="mb-4 text-lg italic text-inksoft">#{t.rank} of {t.n} on the season scorecard{t.called ? ` · called #${t.called}` : ""}{t.trouble ? ` · under the safety line, ${t.trouble}` : ""}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <table className="tnum w-full self-start text-lg">
          <thead><tr className="border-b border-line2 text-right font-mono text-xs uppercase tracking-[0.08em] text-inksoft"><th className="py-1 text-left">This round</th><th>You</th><th>Rivals (median)</th><th>Last round</th></tr></thead>
          <tbody>{t.metrics.map((m) => <tr key={m.label} className="border-b border-line text-right"><td className="py-1 text-left">{m.label}</td><td className="font-semibold">{m.you}</td><td>{m.field}</td><td>{m.last}</td></tr>)}</tbody>
        </table>
        <div>
          {t.moves.length > 0 && (<>
            <div className="mb-1 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-inksoft">What you changed</div>
            <ul className="mb-4 list-disc pl-5 text-base text-inksoft">{t.moves.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </>)}
          <div className="mb-2 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-inksoft">For the board · {t.prompts.length || "no"} question{t.prompts.length === 1 ? "" : "s"}</div>
          {t.prompts.length ? t.prompts.map((p) => (
            <div key={p.chair} className="dbf-card">
              <span className="dbf-chair">{p.chair}</span>
              <p className="display my-2 text-2xl font-medium leading-tight">{p.q}</p>
              <p className="font-mono text-sm text-inksoft"><b className="text-ink">Evidence.</b> {p.evidence}</p>
              <p className="mt-1 font-mono text-sm text-inksoft"><b className="text-ink">Where to look.</b> {p.where}</p>
            </div>
          )) : <p className="italic text-inksoft">Nothing tripped a rule this round. Which number above surprised you, and why did it move?</p>}
          <p className="mt-3 font-mono text-xs text-faint">Questions, not answers. Each chair brings one sentence to the next board meeting.{rich ? "" : " (Older round data: tank use is judged per firm.)"}</p>
        </div>
      </div>
    </div>
  );
}

// ── the tab ──────────────────────────────────────────────────────────────────────
export function DebriefPanel({ data }: { data: DashData }) {
  const rounds = useMemo(() => debriefRounds(data), [data]);
  const latest = rounds.length ? rounds[rounds.length - 1] : null;
  const [picked, setPicked] = useState<number | null>(null); // null = follow the latest resolved round
  const round = picked != null && rounds.includes(picked) ? picked : latest;
  const analysis = useMemo(() => (round == null ? null : analyzeDebrief(data, round)), [data, round]);
  const marks = useMemo(() => houseMarks(data.teams), [data.teams]);
  if (!analysis) {
    return <Card><Eyebrow>No rounds resolved yet</Eyebrow><div className="text-base text-inksoft">Lock and resolve the first round; the debrief builds itself from that round's results.</div></Card>;
  }
  return <DebriefDeckView key={round} deck={debriefDeck(analysis)} focus={analysis.focus} marks={marks} rounds={rounds} round={round!} onRound={(r) => setPicked(r === latest ? null : r)} />;
}

type Privacy = "closed" | "armed" | "open";

function DebriefDeckView({ deck, focus, marks, rounds, round, onRound }: { deck: DebriefDeck; focus: DebriefFocus[]; marks: Map<string, Mark>; rounds: number[]; round: number; onRound: (r: number) => void }) {
  const slides = useSlides(deck, marks);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState<Set<number>>(() => new Set());
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [privacy, setPrivacy] = useState<Privacy>("closed"); // remounts closed on a round change (keyed by round)
  const [firmId, setFirmId] = useState<string>(focus[0]?.fid ?? "");
  const [isFs, setIsFs] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const cur = Math.min(idx, slides.length - 1);
  const slide = slides[cur];

  // The stage is one fixed 1440×810 piece, scaled to whatever box it sits in (tab or fullscreen).
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / STAGE_W, el.clientHeight / STAGE_H) || 0.5);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const next = useCallback(() => {
    const s = slides[cur];
    if (s?.question != null && !revealed.has(s.question)) { setRevealed((r) => new Set(r).add(s.question!)); return; }
    setIdx(Math.min(slides.length - 1, cur + 1));
  }, [slides, cur, revealed]);
  const back = useCallback(() => {
    const s = slides[cur];
    if (s?.question != null && revealed.has(s.question)) { setRevealed((r) => { const n = new Set(r); n.delete(s.question!); return n; }); return; }
    setIdx(Math.max(0, cur - 1));
  }, [slides, cur, revealed]);
  const fullscreen = useCallback(() => {
    if (document.fullscreenElement) { void document.exitFullscreen(); return; }
    setPrivacy("closed"); // never carry a team page into a projected view
    void wrap.current?.requestFullscreen?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return; // typing in a field
      if (t && t.tagName === "BUTTON" && (e.key === " " || e.key === "Enter")) return; // the button's own activation
      if (["ArrowRight", " ", "PageDown", "Enter"].includes(e.key)) { e.preventDefault(); next(); }
      else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); back(); }
      else if (e.key === "Home") setIdx(0);
      else if (e.key === "End") setIdx(slides.length - 1);
      else if (e.key === "f" || e.key === "F") fullscreen();
      else if (e.key === "d" || e.key === "D") setTheme((x) => (x === "dark" ? "light" : "dark"));
    };
    // Team pages are competitive information: going fullscreen, or leaving the window (dragging
    // it to the projector, switching apps), closes them. Re-opening takes the two steps again.
    const onFs = () => { setIsFs(!!document.fullscreenElement); if (document.fullscreenElement) setPrivacy("closed"); };
    const onAway = () => setPrivacy("closed");
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("blur", onAway);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("fullscreenchange", onFs); window.removeEventListener("blur", onAway); };
  }, [next, back, fullscreen, slides.length]);

  const team = focus.find((f) => f.fid === firmId) ?? focus[0];
  const stageStyle: CSSProperties = { transform: `translate(-50%,-50%) scale(${scale})` };

  return (
    <div className="grid gap-3">
      <style>{CSS}</style>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-base text-inksoft">Round
          <select value={round} onChange={(e) => onRound(Number(e.target.value))} className="rounded-md border border-line2 bg-panel px-2 py-1 text-base text-ink">
            {rounds.map((r) => <option key={r} value={r}>Round {r + 1}{r === rounds[rounds.length - 1] ? " · latest" : ""}</option>)}
          </select>
        </label>
        <Button variant="ghost" onClick={back} disabled={cur === 0 && !(slide.question != null && revealed.has(slide.question))}>← Back</Button>
        <span className="tnum text-base text-inksoft">{cur + 1} / {slides.length}</span>
        <Button variant="ghost" onClick={next}>Next →</Button>
        <Button variant="go" onClick={fullscreen}>Present (F)</Button>
        <Button variant="ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Light slides (D)" : "Dark slides (D)"}</Button>
        <span className="flex-1" />
        <span className="text-sm text-inksoft">← → or space · F fullscreen · D light/dark</span>
      </div>

      {/* THE DECK — the only element that ever goes fullscreen. Nothing team-private is rendered inside it. */}
      <div ref={wrap} className="dbf-wrap" data-mode={theme === "dark" ? "night" : undefined} data-dbf={theme} data-dbf-deck tabIndex={0} onClick={next}>
        <div className="dbf-stage" style={stageStyle}>
          <section className="dbf-slide" data-dbf-slide={cur}>
            {slide.eyebrow && <div className="dbf-eyebrow">{slide.eyebrow}</div>}
            {slide.body}
            {slide.question != null && (revealed.has(slide.question)
              ? <div className="dbf-nameit"><div className="tag">Name it</div><div className="lesson">{deck.ask[slide.question].lesson}</div></div>
              : <div className="dbf-hint">Take two answers · then → to name it</div>)}
            <div className="dbf-foot"><span>{deck.label}</span><span>{cur + 1} / {slides.length}</span></div>
          </section>
        </div>
      </div>

      {/* Instructor crib for the slide on screen — sits outside the deck, so it is never projected in fullscreen. */}
      {!isFs && (
        <Card>
          <Eyebrow>Your notes · not on the slide</Eyebrow>
          <div className="grid gap-1 text-base text-ink">
            {slide.show && <div><b>Show next:</b> {slide.show}</div>}
            {slide.question != null && <div><b>Name it:</b> {deck.ask[slide.question].lesson}</div>}
            {cur === 0 && deck.ranked_events.length > 5 && <div className="text-inksoft">{deck.ranked_events.length - 5} more events this round: {deck.ranked_events.slice(5).map(deckEvent).join(" · ")}</div>}
            <details>
              <summary className="cursor-pointer text-inksoft">After the deck · leaders, process, reflections</summary>
              <div className="mt-1 grid gap-1 text-inksoft">
                {deck.leaders.length > 0 && <div><b className="text-ink">Leaders:</b> {deck.leaders.map((x) => `${x.dim} ${x.name}`).join(" · ")} → {deck.cards.SCORE}</div>}
                {deck.process.length > 0 && <div><b className="text-ink">Process:</b> {deck.process.join(" · ")}</div>}
                {deck.reflections.map((x) => <div key={x.name}><b className="text-ink">{x.name}:</b> “{x.text}”</div>)}
              </div>
            </details>
          </div>
        </Card>
      )}

      {/* TEAM PAGES — private. Outside the fullscreen element; two deliberate steps to open; one firm at a time. */}
      {focus.length > 0 && (privacy === "closed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" onClick={() => setPrivacy("armed")}>Team pages (private)…</Button>
          <span className="text-sm text-inksoft">One page per team: its own numbers and up to three questions for its chairs. Never for the projector.</span>
        </div>
      ) : (
        <div className="dbf-private" data-dbf-private={privacy}>
          <div className="dbf-private-bar">
            <span>Private — do not project</span>
            <button onClick={() => setPrivacy("closed")} className="rounded-md border border-white/70 px-3 py-1 text-white">Close</button>
          </div>
          <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
            <label className="flex items-center gap-2 text-base text-inksoft">Team
              <select value={team.fid} onChange={(e) => { setFirmId(e.target.value); }} className="rounded-md border border-line2 bg-panel px-2 py-1 text-base text-ink">
                {focus.map((f) => <option key={f.fid} value={f.fid}>{f.name}</option>)}
              </select>
            </label>
            {privacy === "armed" && <Button variant="go" onClick={() => setPrivacy("open")}>This screen is not on the projector — show {team.name}</Button>}
          </div>
          {privacy === "armed" ? (
            <p className="px-5 pb-5 pt-3 text-base text-inksoft">This page shows one team's margins, cash and the questions written for its chairs. Rivals should not see it. Check that this window is on your own screen (or the team's laptop), then confirm. It closes by itself when you present, change round, or switch windows.</p>
          ) : <TeamPage t={team} label={deck.label} rich={deck.rich} />}
        </div>
      ))}
    </div>
  );
}
