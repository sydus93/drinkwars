/**
 * MOD-B05 · Within-team roles. Each round, a firm receives four role-tagged intel
 * briefings — the CFO, CMO, COO, and CEO each see a different slice of the truth,
 * with role-specific noise. The team has to integrate conflicting partial reads
 * into one locked decision. Deterministic per (seed, round, firm) so replays and
 * refreshes show the same briefs.
 *
 * (The spec's per-member privacy + individual-recommendation logging is the
 * research-instrument half and is deferred; this delivers the decision-making half.)
 */
import type { Config, FirmId, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";

export interface RoleBriefing {
  role: "cfo" | "cmo" | "coo" | "ceo";
  title: string;
  lines: string[];
}

const firmIndex = (id: FirmId): number => Number(id.replace(/[^0-9]/g, "")) || 0;

export function roleBriefings(world: WorldState, c: Config, firmId: FirmId): RoleBriefing[] {
  const cfg = c.modules?.teamRoles;
  if (!cfg?.enabled) return [];
  const me = world.firms.find((f) => f.id === firmId);
  if (!me || me.status !== "active") return [];
  const rng = new RNG(deriveSeed(world.seed, world.round, 500 + firmIndex(firmId)));
  const rivals = world.firms.filter((f) => f.status === "active" && f.id !== firmId);
  const noisy = (x: number, sd: number) => x * (1 + rng.normal(0, sd));

  // CFO — capital-markets read: rival leverage + your borrowing posture.
  const avgLev = rivals.length
    ? rivals.reduce((a, f) => a + f.debt / Math.max(1e-6, f.paid_in_capital + f.retained_earnings), 0) / rivals.length
    : 0;
  const myLev = me.debt / Math.max(1e-6, me.paid_in_capital + me.retained_earnings);
  const cfo: RoleBriefing = {
    role: "cfo",
    title: "CFO briefing — capital",
    lines: [
      `Rivals carry roughly ${noisy(avgLev, cfg.noise.cfo).toFixed(2)}× leverage on average; you sit at ${myLev.toFixed(2)}×.`,
      myLev > avgLev * 1.2 ? "Lenders see you as the stretched one at the table — borrowing gets pricier from here." : "Your balance sheet reads stronger than the field's — you have borrowing headroom.",
    ],
  };

  // CMO — demand read: where the market is heading next round.
  const segs = world.segments.filter((s) => s.active);
  const grow = segs.map((s) => {
    const sc = c.segments.find((x) => x.id === s.id)!;
    return { id: s.id, next: noisy(s.D * sc.growth, cfg.noise.cmo) };
  });
  const biggest = [...grow].sort((a, b) => b.next - a.next)[0];
  const cmo: RoleBriefing = {
    role: "cmo",
    title: "CMO briefing — demand",
    lines: [
      ...grow.map((g) => `${g.id}: next-round demand near ${Math.round(g.next)} units.`),
      biggest ? `Largest pool of buyers next round: ${biggest.id}.` : "",
      c.modules?.consumerDrift?.enabled ? "Field reports: mainstream drinkers are getting steadily more quality-conscious." : "",
    ].filter(Boolean),
  };

  // COO — operations read: your true cost position.
  const coo: RoleBriefing = {
    role: "coo",
    title: "COO briefing — operations",
    lines: [
      `Brewhouse cost runs about $${noisy(Math.max(0.5, me.unit_cost || c.costs.c_base), cfg.noise.coo).toFixed(2)} a unit right now.`,
      me.process > 25 ? "Process maturity is paying off — yields are well above the field's baseline." : "There's still easy yield on the table — process investment buys cost down fastest.",
    ],
  };

  // CEO — competitive read: the strongest rival and their posture.
  const strongest = [...rivals].sort((a, b) => b.Q + b.B - (a.Q + a.B))[0];
  const posture = strongest ? (strongest.Q > strongest.B * 1.2 ? "quality-led" : strongest.B > strongest.Q * 1.2 ? "brand-led" : "balanced") : "—";
  const ceo: RoleBriefing = {
    role: "ceo",
    title: "CEO briefing — the field",
    lines: strongest
      ? [
          `The one to watch is ${strongest.id} — they look ${posture}${rng.bool(cfg.noise.ceo * 2) ? ", though the read is murky this round" : ""}.`,
          strongest.cap > me.cap * 1.3 ? "They out-scale you; fighting them head-on in volume is uphill." : "You match their scale — position, don't out-spend.",
        ]
      : ["The field has thinned out. The market is yours to lose."],
  };

  return [cfo, cmo, coo, ceo];
}
