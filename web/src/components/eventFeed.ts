import type { EventKind, GameEvent } from "./EventModal.js";
import { SEG_LABEL } from "../labels.js";

/** Map a raw segment id (mass/niche/frontier) to its beverage label; tolerate the
 *  engine's "?"/"(unset)" placeholders so no code-style token reaches the player. */
const seg = (id: string): string => {
  const k = id.trim().toLowerCase();
  if (!k || k === "?" || k === "(unset)") return "a fresh focus";
  return SEG_LABEL[k] ?? id;
};

/** Friendly names for shock type ids + their mechanical "kind", so a fired shock
 *  reads as prose instead of "water (cost_spike, mag 0.35, unannounced)". */
const SHOCK_LABEL: Record<string, string> = {
  water: "Water shortage",
  harvest: "Harvest failure",
  co2: "CO₂ & packaging squeeze",
};
const SHOCK_KIND: Record<string, string> = {
  cost_spike: "input costs spike",
  capacity_hit: "brewing capacity is constrained",
  demand_drop: "demand softens",
  demand_boost: "demand surges",
  cash_hit: "an unexpected cash hit lands",
};
const severity = (mag: number): string => (mag >= 0.3 ? "sharply" : mag >= 0.15 ? "moderately" : "mildly");

/** Plain-language gloss for each contingent-clause trigger (MOD-A05). */
const CLAUSE_COND: Record<string, string> = {
  water_shock: "a water shortage hit",
  harvest_shock: "a harvest failure hit",
  capacity_shock: "a capacity squeeze hit",
  partner_distress: "a partner fell into distress",
  segment_emerges: "a new category emerged",
};

const titleCase = (s: string): string => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Turn the engine's terse event strings (e.g. "SHOCK water: +35% unit cost",
 * "PR PLAY: Copper & Cask ran a viral label drop — brand buzz surges") into
 * framed, player-facing dispatches: a category, a headline, and clean prose with
 * the engine's raw "TAG:" prefix stripped. Firm ids were already substituted for
 * brewery names upstream; here we de-code the rest so a dispatch reads like a
 * newspaper line, not a log entry.
 */

interface Rule {
  test: RegExp;
  kind: EventKind;
  /** Static headline, or one derived from the match (e.g. shock type). */
  title: string | ((m: RegExpMatchArray) => string);
  /** Rewrite the raw string into prose. Default: strip a leading "TAG:" prefix. */
  body?: (raw: string, m: RegExpMatchArray) => string;
}

const stripPrefix = (raw: string): string => {
  const i = raw.indexOf(":");
  if (i < 0) return raw;
  const body = raw.slice(i + 1).trim();
  return body.charAt(0).toUpperCase() + body.slice(1);
};

/** Ordered most-specific first; the first match wins. */
const RULES: Rule[] = [
  {
    test: /^ACQUIRED:\s*(.+?)\s+buys distressed\s+(.+?)\s+for \$(\d+)/i,
    kind: "market", title: "A rival is bought out",
    body: (_r, m) => `${m[1]} bought out the distressed ${m[2]} for $${m[3]}, taking on its debt.`,
  },
  {
    test: /^ACQUISITION:\s*(.+?)\s+buys\s+(.+?)\s*\(online in (\d+) rounds?\)/i,
    kind: "opportunity", title: "Vertical move",
    body: (_r, m) => `${m[1]} acquired a ${m[2]} — it comes online in ${m[3]} round${m[3] === "1" ? "" : "s"}.`,
  },
  {
    test: /^EXPANSION:\s*(.+?)\s+enters\s+(.+)$/i,
    kind: "opportunity", title: "New market entered",
    body: (_r, m) => `${m[1]} expanded into ${m[2]}.`,
  },
  {
    test: /^HIRE:\s*(.+?)\s+brings on a\s+(.+)$/i,
    kind: "opportunity", title: "Key hire",
    body: (_r, m) => `${m[1]} brought on a ${m[2]}.`,
  },
  {
    test: /^POACHED:\s*(.+?)\s+loses its\s+(.+?)\s+to a rival offer/i,
    kind: "shock", title: "Talent poached",
    body: (_r, m) => `${m[1]} lost its ${m[2]} to a rival's offer.`,
  },
  {
    test: /^DILUTION:\s*(.+?)'s convertible note converts to equity/i,
    kind: "regulatory", title: "Note converts to equity",
    body: (_r, m) => `${m[1]}'s convertible note matured and converted into equity — existing owners are diluted.`,
  },
  {
    test: /^FINANCING:\s*(.+?)\s+pays off its revenue-based financing/i,
    kind: "info", title: "Financing paid off",
    body: (_r, m) => `${m[1]} fully repaid its revenue-based financing.`,
  },
  {
    test: /^FINANCING:\s*(.+?)\s+repays its convertible note/i,
    kind: "info", title: "Note repaid",
    body: (_r, m) => `${m[1]} repaid its convertible note at maturity — no dilution.`,
  },
  {
    test: /^GUILD:\s*the industry "(.+?)" fund reaches its threshold/i,
    kind: "opportunity", title: "Industry fund activates",
    body: (_r, m) => `The industry ${titleCase(m[1].replace(/_/g, " "))} fund cleared its threshold — the shared benefit is now live for everyone.`,
  },
  {
    test: /^PR PLAY:\s*(.+?)\s+ran\s+(.+?)\s*—/i,
    kind: "opportunity", title: "PR splash",
    body: (_r, m) => `${m[1]} ran ${m[2]} — brand buzz surged.`,
  },
  {
    test: /^NEGATIVE PR:\s*(.+?)\s+caught in a controversy\s*\(brand\s*(−?-?[\d.]+)(.*?)\)/i,
    kind: "shock", title: "PR backlash",
    body: (_r, m) => `${m[1]} got caught in a controversy — brand took a ${m[2].replace(/^-/, "−")} hit${/soften/i.test(m[3]) ? ", softened by loyal regulars" : ""}.`,
  },
  {
    test: /^MARKET SHIFT:/i,
    kind: "market", title: "Tastes are shifting",
    body: () => "Consumer tastes are evolving — quality is gaining ground in the mainstream.",
  },
  {
    test: /^NEW CATEGORY:\s*(.+?)\s+opens\s+"(.+?)"\s+early through R&D/i,
    kind: "market", title: "A new category opens",
    body: (_r, m) => `${m[1]} broke open the "${m[2]}" category early through R&D — a first-mover head start.`,
  },
  {
    test: /^NEW CATEGORY:\s*segment\s*"(.+?)"\s+emerges/i,
    kind: "market", title: "A new category opens",
    body: (_r, m) => `A new category — ${seg(m[1])} — has emerged in the market.`,
  },
  {
    test: /ANTITRUST investigation triggered.*?;\s*(\d+) firms? fined,\s*(\d+) pacts?\s+constrained/i,
    kind: "regulatory", title: "Antitrust action",
    body: (_r, m) => {
      const fined = +m[1], pacts = +m[2];
      if (fined === 0 && pacts === 0) return "Regulators opened an antitrust investigation into coordinated behavior — no firms were fined this round.";
      return `Antitrust regulators acted: ${fined} firm${fined === 1 ? " was" : "s were"} fined and ${pacts} pact${pacts === 1 ? " was" : "s were"} constrained.`;
    },
  },
  {
    test: /^MARKET CONDUCT:\s*(.+?)\s+drew a consumer-protection penalty\s*—\s*(.+)$/i,
    kind: "regulatory", title: "Stakeholder backlash",
    body: (_r, m) => `${m[1]} drew a consumer-protection penalty for ${m[2]} — a regulatory fine landed and the brand took a public hit. Goodwill (regulator trust + reputation) softens this.`,
  },
  {
    test: /^DISTRESS DUMPING:\s*(.+?)'s collapse depresses\s+(\w+)/i,
    kind: "shock", title: "Distress dumping",
    body: (_r, m) => `${m[1]}'s collapse is flooding the ${seg(m[2])} category with cut-price product, depressing prices.`,
  },
  {
    test: /^FORCED EXIT \(bankruptcy\):\s*(.+?)\s*\(/i,
    kind: "shock", title: "A brewery goes under",
    body: (_r, m) => `${m[1]} ran out of road and was forced out of the market (bankruptcy).`,
  },
  {
    test: /^CLEAN EXIT \(bank\):\s*(.+?)\s+recovers\s+([\d.]+)/i,
    kind: "info", title: "A brewery cashes out",
    body: (_r, m) => `${m[1]} exited cleanly, recovering $${Math.round(+m[2])}.`,
  },
  {
    test: /^RE-ENTRY:\s*(.+?)\s+re-activates\s*\(repositioned to\s+(.+?)\)/i,
    kind: "opportunity", title: "A rival rebuilds",
    body: (_r, m) => `${m[1]} is back in the game, repositioned toward ${seg(m[2])}.`,
  },
  {
    test: /^EXIT→REBUILD:\s*(.+?)\s+repositions to\s+(.+?),\s*pays\s*([\d.]+)\s*\(cooldown to r(\d+)\)/i,
    kind: "opportunity", title: "A brewery rebuilds",
    body: (_r, m) => `${m[1]} is rebuilding — repositioning toward ${seg(m[2])} for $${Math.round(+m[3])}, back in round ${m[4]}.`,
  },
  // Lobbying (MOD-A09)
  {
    test: /^LOBBYING SCRUTINY:\s*(.+?)\s+is fined/i,
    kind: "regulatory", title: "Lobbying scrutiny",
    body: (_r, m) => `${m[1]} was fined after regulators scrutinized its lobbying.`,
  },
  {
    test: /^LOBBYING:\s*a\s*"(.+?)"\s*regulation passes/i,
    kind: "regulatory", title: "A regulation passes",
    body: (_r, m) => `A new "${m[1]}" regulation passed — it reshapes the market for a few rounds.`,
  },
  // Contingent clauses (MOD-A05)
  {
    test: /^CLAUSE:.*?\b(auto-suspends|auto-terminates|opens for renegotiation)\b.*?\(([a-z_]+)\)\s*$/i,
    kind: "regulatory", title: "A contract clause fires",
    body: (_r, m) => {
      const verb = m[1].toLowerCase();
      const cond = CLAUSE_COND[m[2].toLowerCase()] ?? m[2].replace(/_/g, " ");
      const what = verb.includes("suspend") ? "auto-suspended an alliance" : verb.includes("terminate") ? "dissolved an alliance" : "opened an alliance for renegotiation";
      return `A contingent clause fired — ${cond}, so it ${what}.`;
    },
  },
  // Renegotiation (MOD-A06)
  {
    test: /^(.+?)\s+calls to renegotiate\s+/i,
    kind: "opportunity", title: "Renegotiation called",
    body: (_r, m) => `${m[1]} called to renegotiate an alliance.`,
  },
  {
    test: /^(.+?)\s+accepts new terms on\s+/i,
    kind: "info", title: "Alliance terms updated",
    body: (_r, m) => `${m[1]} accepted new alliance terms.`,
  },
  {
    test: /^(.+?)\s+exits\s+.+?\s+via renegotiation/i,
    kind: "shock", title: "An alliance dissolves",
    body: (_r, m) => `${m[1]} exited an alliance through renegotiation.`,
  },
  {
    test: /^(.+?)\s+rejects renegotiation of\s+/i,
    kind: "info", title: "Renegotiation rejected",
    body: (_r, m) => `${m[1]} rejected a renegotiation — the alliance continues unchanged.`,
  },
  {
    test: /^(.+?)\s+formed\s+(.+)$/i,
    kind: "opportunity", title: "An alliance forms",
    body: (_r, m) => `${m[1]} formed a ${m[2]}.`,
  },
  {
    test: /^(.+?)\s+defected from\s+(.+?)\s*\(/i,
    kind: "shock", title: "An alliance breaks",
    body: (_r, m) => `${m[1]} walked away from its ${m[2]} agreement.`,
  },
  // Shocks (no firm named). Parse the structured "SHOCK fired: <type> (<kind>, mag
  // <m>, <signaling>)" / "SHOCK live-triggered: <type>" forms into prose; the raw
  // type/kind/magnitude ids must never reach the player.
  {
    test: /^SHOCK (?:fired|live-triggered):\s*([a-z0-9_]+)(?:\(live\))?\s*(?:\(([a-z_]+),\s*mag\s*([\d.]+)[^)]*\))?(?:\s+in\s+(.+?))?\s*$/i,
    kind: "shock",
    title: (m) => SHOCK_LABEL[m[1].toLowerCase()] ?? "Market disruption",
    body: (_r, m) => {
      const label = SHOCK_LABEL[m[1].toLowerCase()] ?? "A supply shock";
      const where = m[4] ? ` in ${m[4]}` : "";
      if (!m[2]) return `${label} just hit${where ? where : " the market"}.`;
      return `${label}${where}: ${SHOCK_KIND[m[2]] ?? "the market is disrupted"} ${severity(+m[3])} this round${where ? " for producers there" : ""}.`;
    },
  },
  { test: /SHOCK/i, kind: "shock", title: "Market disruption", body: (r) => stripPrefix(r) },
];

function classify(raw: string): { kind: EventKind; title: string; body: string } {
  for (const r of RULES) {
    const m = raw.match(r.test);
    if (m) {
      const title = typeof r.title === "function" ? r.title(m) : r.title;
      return { kind: r.kind, title, body: r.body ? r.body(raw, m) : stripPrefix(raw) };
    }
  }
  return { kind: "info", title: "Dispatch", body: stripPrefix(raw) };
}

/** Whole-word/phrase match so a short brewery name ("ya") doesn't false-match
 *  inside another word ("loYAl"). Bounded by non-letter chars or string ends. */
function mentionsName(text: string, name: string): boolean {
  if (!name) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${esc}([^\\p{L}]|$)`, "u").test(text);
}

/**
 * Parse engine event strings into framed dispatches. `youName` (the player's
 * brewery name, already substituted into the strings upstream) flags which
 * dispatches actually involve the player and rewrites a leading self-reference
 * to "You" so the player's own moves read in first person.
 */
export function parseEvents(events: string[], youName = ""): GameEvent[] {
  return events.map((raw, i) => {
    const { kind, title, body } = classify(raw);
    const mine = mentionsName(raw, youName);
    // "Copper & Cask ran …" → "You ran …" when it's the player's own dispatch.
    const text = mine && youName && body.startsWith(youName + " ")
      ? "You" + body.slice(youName.length)
      : body;
    return { id: `${i}:${raw}`, kind, title, body: text, mine };
  });
}
