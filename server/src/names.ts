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
