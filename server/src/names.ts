/**
 * Brewery name pool + helpers. Every surface that mints firms (solo NPCs, the
 * transport's open multiplayer slots) draws from here so no player ever sees a
 * raw `firm_3`. Engine internals and the research export keep firm ids — names
 * are presentation only, substituted in at the view layer.
 */

const BREWERY_NAMES = [
  "Old Ledger Brewing", "Hop Theory", "Copper & Cask", "Tributary Brewing",
  "North Fork Beerworks", "Sediment Co.", "Wild Current", "Keystone Cellars",
  "Foglift Brewing", "Quietwater Ales", "Granary & Vine", "Switchback Brewing",
  "Cinder Peak Beer Co.", "Low Meadow Brewing", "Stillgrove Fermentary", "Ledgerline Lagers",
  "Harvest Moon Brewing", "Bramblewood Ales", "Iron Kettle Brewing", "Crooked Flume",
  "Last Light Brewing", "Pale Harbor Beer Co.", "Junction & Rye", "Bellwether Brewing",
  "Slow Creek Cellars", "Highline Hops", "Vagrant Star Brewing", "Millrace Ales",
  "Cobblestone Brewing", "Faultline Fermentation", "Drover's Rest Beer Co.", "Larkspur Brewing",
];

/** Draw `n` distinct names, shuffled. Falls back to numbered names past the pool. */
export function randomBreweryNames(n: number): string[] {
  const pool = [...BREWERY_NAMES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out = pool.slice(0, n);
  for (let i = pool.length; i < n; i++) out.push(`Brewery ${i + 1}`);
  return out;
}

/** Substitute firm ids in display text with brewery names ("firm_3 enters …" →
 *  "Copper & Cask enters …"). Longest-id-first so firm_12 isn't eaten by firm_1. */
export function renameFirms(text: string, names: Record<string, string>): string {
  return text.replace(/firm_\d+/g, (id) => names[id] ?? id);
}

/** DW-071: news that is one firm's private business — the size of an equity raise investors
 *  refused or trimmed, a hire it couldn't pay for. It reveals a valuation at or below zero and
 *  cash below a known line, which rivals otherwise only learn by buying research. Only the firm
 *  it names sees it; the instructor dashboard reads the full event list and keeps it all. */
const OWN_ONLY = /^(EQUITY|EQUITY MARKET CLOSED|HIRE FAILED):/;
/** DW-080: what a firm LOST with a person — the loyalty / tenure tail on a POACHED or DEPARTURE line
 *  ("— took 4 quarters of built-up loyalty (+16% contribution)") — is that firm's private read on
 *  its own people (DW-075). Rivals, the poacher included, see the move; only the firm it left sees
 *  the cost. */
const PRIVATE_TAIL = /(?:\s+[—-]|;)\s+took \d+ quarters? of built-up (?:loyalty|tenure) \(\+\d+% (?:contribution|bonus)\)$/;
const victimOf = (e: string): string | null => (e.match(/away from (firm_\d+)/) ?? e.match(/quits (firm_\d+)/) ?? e.match(/^DEPARTURE: (firm_\d+)'s/))?.[1] ?? null;
export function visibleEvents(events: string[], ownFirmId: string | null | undefined): string[] {
  return events
    .filter((e) => !OWN_ONLY.test(e) || (!!ownFirmId && new RegExp(`\\b${ownFirmId}\\b`).test(e)))
    .map((e) => (/^(POACHED|DEPARTURE):/.test(e) && victimOf(e) !== ownFirmId ? e.replace(PRIVATE_TAIL, "") : e));
}
