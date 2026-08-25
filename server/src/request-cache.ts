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
  "getTeams", "getTeam", "getTeamsForUser", "getMemberRole",
  "getMemberDecisions",
  "getWorldState", "getLatestWorldState",
  "getDecision", "getDecisions",
  "getRoundResult", "getRoundResults",
  "getPublicRound", "getPublicRounds",
  "getFirmRounds", "getAgreements", "getBeliefs", "getTelemetry", "getReflections",
  "getDistinctiveness",
]);

/** Wrap a store so repeated identical reads within one request hit memory. */
export function withRequestCache(store: StorageAdapter): StorageAdapter {
  const cache = new Map<string, Promise<unknown>>();
  return new Proxy(store as unknown as Record<string, unknown>, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const fn = value as (...a: unknown[]) => unknown;
      if (typeof prop !== "string" || !CACHEABLE.has(prop)) return fn.bind(target);
      return (...args: unknown[]) => {
        const key = `${prop}(${JSON.stringify(args)})`;
        const hit = cache.get(key);
        if (hit) return hit;
        const p = Promise.resolve(fn.apply(target, args));
        cache.set(key, p);
        return p;
      };
    },
  }) as unknown as StorageAdapter;
}
