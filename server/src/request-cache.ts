/**
 * Read-through cache for the span of ONE read-only request (DW-039).
 *
 * `viewFor` — the endpoint every student's browser polls every 2.5s — is assembled
 * from several orchestrator projections that each re-fetch the same records. Measured
 * on an 8-firm team game with a four-person firm, one GET /view cost 35 storage
 * round-trips: the game 5×, the world state 3×, the team 3×, every round's results
 * twice, and each teammate's user row + seat twice (getTeamSeats and getTeamPlan walk
 * the same roster). A 25-student class polling on that cadence is ~350 queries/sec
 * against Postgres, sustained, for the whole class period.
 *
 * Wrapping the store per request collapses the duplicates without touching a single
 * projection: identical (method, args) inside one request resolve to one promise.
 *
 * SCOPE RULE: read-only, one request, then discard. Writers are deliberately NOT
 * cached, but a cached reader will not see a write made later in the same request —
 * so never wrap a handler that mutates (submit / lock / resolve).
 */
import type { StorageAdapter } from "./types.js";

/** Reads that are safe to serve twice within one request. */
const CACHEABLE: ReadonlySet<string> = new Set([
  "getGame", "getGameByCode",
  "getUser", "getUserByExternalId", "getUserByClaim",
  "getTeams", "getTeam", "getTeamsForUser", "getMemberRole", "getTeamMembers",
  "getMemberDecisions",
  "getWorldState", "getLatestWorldState",
  "getDecision", "getDecisions",
  "getRoundResult", "getRoundResults",
  "getPublicRound", "getPublicRounds",
  "getFirmRounds", "getAgreements", "getBeliefs", "getTelemetry", "getReflections",
  "getDistinctiveness", "getForecasts",
]);

/** Wrap a store so repeated identical reads within one request hit memory. */
export function withRequestCache(store: StorageAdapter): StorageAdapter {
  const cache = new Map<string, Promise<unknown>>();
  const keyOf = (method: string, args: unknown[]) => `${method}(${JSON.stringify(args)})`;
  const set = (method: string, args: unknown[], value: unknown) => { const k = keyOf(method, args); if (!cache.has(k)) cache.set(k, Promise.resolve(value)); };
  // DW-065: one read often carries the answer to reads the projections make next. The same facts
  // the adapter would return are placed under those keys, so the later call costs nothing:
  //   getTeams(game)  → getTeam(id) + getTeamMembers(id) for every team (adapters embed the roster);
  //   getTeam(id)     → getTeamMembers(id);
  //   getLatestWorldState(game) → getWorldState(game, its round).
  // Measured on /view (5-chair team firm): 11 round-trips → 8; instructor /status: 16 → 9.
  const prime = (method: string, args: unknown[], p: Promise<unknown>) => {
    p.then((v) => {
      if (method === "getTeams" && Array.isArray(v)) for (const t of v as { id: string; members?: unknown[] }[]) { set("getTeam", [t.id], t); if (t.members) set("getTeamMembers", [t.id], t.members); }
      else if (method === "getTeam" && v && (v as { members?: unknown[] }).members) set("getTeamMembers", [args[0]], (v as { members: unknown[] }).members);
      else if (method === "getLatestWorldState" && v) set("getWorldState", [args[0], (v as { round: number }).round], v);
    }, () => { /* the original caller sees the rejection */ });
  };
  return new Proxy(store as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value as (...a: unknown[]) => unknown;
      if (typeof prop !== "string" || !CACHEABLE.has(prop)) return fn.bind(target);
      return (...args: unknown[]) => {
        const key = keyOf(prop, args);
        const hit = cache.get(key);
        if (hit) return hit;
        const p = Promise.resolve(fn.apply(target, args));
        cache.set(key, p);
        prime(prop, args, p);
        return p;
      };
    },
  }) as unknown as StorageAdapter;
}
