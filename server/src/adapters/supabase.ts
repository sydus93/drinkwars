/**
 * Supabase (Postgres + RLS) StorageAdapter. Counterpart to InMemoryAdapter;
 * the orchestrator runs unchanged on either (server/src/types.ts is the seam).
 *
 * Runs server-side with the SERVICE-ROLE key, which bypasses RLS — the server is
 * the authoritative writer of world_states / results / research rows (§3.2 note
 * at the foot of 0001_init.sql). Students never reach this adapter; they touch
 * Supabase directly with the publishable key, gated by the RLS policies.
 *
 * Three translations vs. the in-memory store:
 *   - time: app records use epoch-ms numbers; Postgres uses timestamptz (ISO).
 *   - teams: TeamRecord.member_user_ids[] <-> the normalized team_members table.
 *   - seed: Postgres bigint comes back as number|string -> coerced with Number().
 *
 * Append-only semantics (world_states, round_results, firm_round, beliefs,
 * telemetry, reflections, distinctiveness) are enforced in the database by the
 * forbid_mutation() triggers — a re-write raises, mirroring the in-memory throw.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AgreementRow, BeliefRow, DecisionRecord, DistinctivenessRow, FirmRoundRow, GameRecord,
  Lifecycle, MemberDecisionRecord, PublicRoundRecord, ReflectionRow, RoundResultRecord, StorageAdapter, TeamRecord, TelemetryRow,
  UserRecord, WorldStateRecord,
} from "../types.js";

// epoch-ms <-> ISO timestamptz
const toTs = (ms: number | null | undefined): string | null => (ms == null ? null : new Date(ms).toISOString());
const fromTs = (s: string | null | undefined): number => (s ? new Date(s).getTime() : 0);
const fromTsN = (s: string | null | undefined): number | null => (s ? new Date(s).getTime() : null);

/** Throw on a Postgrest error, else return the data payload. */
function must<T>(res: { data: T; error: { message?: string } | null }): T {
  if (res.error) throw new Error(`supabase: ${res.error.message ?? JSON.stringify(res.error)}`);
  return res.data;
}

const mapGame = (r: any): GameRecord => ({
  id: r.id, config: r.config, n_rounds: r.n_rounds, current_round: r.current_round,
  lifecycle: r.lifecycle as Lifecycle, join_code: r.join_code ?? null, owner_tag: r.owner_tag ?? null,
  firm_mode: (r.firm_mode ?? "solo") as GameRecord["firm_mode"], title: r.title ?? null, created_at: fromTs(r.created_at),
});
const mapUser = (r: any): UserRecord => ({
  id: r.id, role: r.role, email: r.email, consent: r.consent, deid_code: r.deid_code,
  external_id: r.external_id ?? null, display_name: r.display_name ?? null, cohort: r.cohort ?? null, claim_code: r.claim_code ?? null,
});
const mapMemberDecision = (r: any): MemberDecisionRecord => ({
  game_id: r.game_id, round: r.round, team_id: r.team_id, user_id: r.user_id,
  desk: r.desk ?? null, partial: r.partial ?? {}, submitted: r.submitted, updated_at: fromTs(r.updated_at),
});
const USER_COLS = "id, role, email, consent, deid_code, external_id, display_name, cohort, claim_code";
const mapTeam = (r: any): TeamRecord => ({
  id: r.id, game_id: r.game_id, firm_id: r.firm_id, name: r.name,
  member_user_ids: (r.team_members ?? []).map((m: any) => m.user_id),
});
const mapWorldState = (r: any): WorldStateRecord => ({
  game_id: r.game_id, round: r.round, state: r.state, seed: Number(r.seed), created_at: fromTs(r.created_at),
});
const mapDecision = (r: any): DecisionRecord => ({
  game_id: r.game_id, round: r.round, team_id: r.team_id, firm_id: r.firm_id, decision: r.decision,
  submitted: r.submitted, locked: r.locked, revision_count: r.revision_count,
  submitted_at: fromTsN(r.submitted_at), first_opened_at: fromTsN(r.first_opened_at),
});
const mapRoundResult = (r: any): RoundResultRecord => ({
  game_id: r.game_id, round: r.round, result: r.result, created_at: fromTs(r.created_at),
});
const mapPublicRound = (r: any): PublicRoundRecord => ({
  game_id: r.game_id, round: r.round, events: r.events ?? [], standings: r.standings ?? [], market: r.market ?? [], created_at: fromTs(r.created_at),
});

export class SupabaseAdapter implements StorageAdapter {
  constructor(private db: SupabaseClient) {}

  // ── Game ──────────────────────────────────────────────────────────────────
  async createGame(g: GameRecord): Promise<void> {
    must(await this.db.from("games").insert({
      id: g.id, config: g.config, n_rounds: g.n_rounds, current_round: g.current_round,
      lifecycle: g.lifecycle, join_code: g.join_code, owner_tag: g.owner_tag,
      firm_mode: g.firm_mode ?? "solo", title: g.title ?? null, created_at: toTs(g.created_at),
    }));
  }
  async getGame(id: string): Promise<GameRecord | null> {
    const r = must(await this.db.from("games").select("*").eq("id", id).maybeSingle());
    return r ? mapGame(r) : null;
  }
  async getGameByCode(code: string): Promise<GameRecord | null> {
    const r = must(await this.db.from("games").select("*").eq("join_code", code).maybeSingle());
    return r ? mapGame(r) : null;
  }
  async setGameLifecycle(id: string, lifecycle: Lifecycle, currentRound: number): Promise<void> {
    must(await this.db.from("games").update({ lifecycle, current_round: currentRound }).eq("id", id));
  }

  // ── Users & teams ─────────────────────────────────────────────────────────
  private userRow(u: UserRecord) {
    return {
      id: u.id, role: u.role, email: u.email, consent: u.consent, deid_code: u.deid_code,
      external_id: u.external_id ?? null, display_name: u.display_name ?? null, cohort: u.cohort ?? null, claim_code: u.claim_code ?? null,
    };
  }
  async createUser(u: UserRecord): Promise<void> {
    must(await this.db.from("users").insert(this.userRow(u)));
  }
  async upsertUser(u: UserRecord): Promise<void> {
    must(await this.db.from("users").upsert(this.userRow(u), { onConflict: "id" }));
  }
  async getUser(id: string): Promise<UserRecord | null> {
    const r = must(await this.db.from("users").select(USER_COLS).eq("id", id).maybeSingle());
    return r ? mapUser(r) : null;
  }
  async getUserByExternalId(externalId: string): Promise<UserRecord | null> {
    const r = must(await this.db.from("users").select(USER_COLS).eq("external_id", externalId).maybeSingle());
    return r ? mapUser(r) : null;
  }
  async getUserByClaim(claimCode: string): Promise<UserRecord | null> {
    const r = must(await this.db.from("users").select(USER_COLS).eq("claim_code", claimCode).maybeSingle());
    return r ? mapUser(r) : null;
  }
  async createTeam(t: TeamRecord): Promise<void> {
    must(await this.db.from("teams").insert({ id: t.id, game_id: t.game_id, firm_id: t.firm_id, name: t.name }));
    if (t.member_user_ids.length) {
      must(await this.db.from("team_members").insert(t.member_user_ids.map((uid) => ({ team_id: t.id, user_id: uid }))));
    }
  }
  async getTeams(gameId: string): Promise<TeamRecord[]> {
    const rows = must(await this.db.from("teams").select("id, game_id, firm_id, name, team_members(user_id)").eq("game_id", gameId));
    return (rows ?? []).map(mapTeam);
  }
  async getTeam(id: string): Promise<TeamRecord | null> {
    const r = must(await this.db.from("teams").select("id, game_id, firm_id, name, team_members(user_id)").eq("id", id).maybeSingle());
    return r ? mapTeam(r) : null;
  }
  async addTeamMember(teamId: string, userId: string): Promise<void> {
    must(await this.db.from("team_members").upsert({ team_id: teamId, user_id: userId }, { onConflict: "team_id,user_id", ignoreDuplicates: true }));
  }
  async setTeamName(teamId: string, name: string): Promise<void> {
    must(await this.db.from("teams").update({ name }).eq("id", teamId));
  }
  async setMemberRole(teamId: string, userId: string, role: string | null): Promise<void> {
    must(await this.db.from("team_members").update({ role }).eq("team_id", teamId).eq("user_id", userId));
  }
  async getMemberRole(teamId: string, userId: string): Promise<string | null> {
    const r = must(await this.db.from("team_members").select("role").eq("team_id", teamId).eq("user_id", userId).maybeSingle());
    return r?.role ?? null;
  }
  async getTeamsForUser(userId: string): Promise<TeamRecord[]> {
    // team_members → the teams this user belongs to (each with its full membership).
    const mine = must(await this.db.from("team_members").select("team_id").eq("user_id", userId));
    const ids = (mine ?? []).map((m: any) => m.team_id);
    if (!ids.length) return [];
    const rows = must(await this.db.from("teams").select("id, game_id, firm_id, name, team_members(user_id)").in("id", ids));
    return (rows ?? []).map(mapTeam);
  }

  // ── Member (per-seat) decisions — multi-seat composition (mutable until lock) ──
  async upsertMemberDecision(rec: MemberDecisionRecord): Promise<void> {
    must(await this.db.from("member_decisions").upsert({
      game_id: rec.game_id, round: rec.round, team_id: rec.team_id, user_id: rec.user_id,
      desk: rec.desk, partial: rec.partial, submitted: rec.submitted, updated_at: toTs(rec.updated_at),
    }, { onConflict: "game_id,round,user_id" }));
  }
  async getMemberDecisions(gameId: string, round: number, teamId: string): Promise<MemberDecisionRecord[]> {
    const rows = must(await this.db.from("member_decisions").select("*").eq("game_id", gameId).eq("round", round).eq("team_id", teamId));
    return (rows ?? []).map(mapMemberDecision);
  }

  // ── World states (append-only) ──────────────────────────────────────────────
  async appendWorldState(rec: WorldStateRecord): Promise<void> {
    must(await this.db.from("world_states").insert({
      game_id: rec.game_id, round: rec.round, state: rec.state, seed: rec.seed, created_at: toTs(rec.created_at),
    }));
  }
  async getWorldState(gameId: string, round: number): Promise<WorldStateRecord | null> {
    const r = must(await this.db.from("world_states").select("*").eq("game_id", gameId).eq("round", round).maybeSingle());
    return r ? mapWorldState(r) : null;
  }
  async getLatestWorldState(gameId: string): Promise<WorldStateRecord | null> {
    const rows = must(await this.db.from("world_states").select("*").eq("game_id", gameId).order("round", { ascending: false }).limit(1));
    return rows && rows.length ? mapWorldState(rows[0]) : null;
  }

  // ── Decisions (mutable until locked) ────────────────────────────────────────
  async upsertDecision(rec: DecisionRecord): Promise<void> {
    const existing = await this.getDecision(rec.game_id, rec.round, rec.team_id);
    if (existing?.locked) throw new Error(`decision ${rec.game_id}::${rec.round}::${rec.team_id} is locked`);
    must(await this.db.from("decisions").upsert({
      game_id: rec.game_id, round: rec.round, team_id: rec.team_id, firm_id: rec.firm_id, decision: rec.decision,
      submitted: rec.submitted, locked: rec.locked, revision_count: rec.revision_count,
      submitted_at: toTs(rec.submitted_at), first_opened_at: toTs(rec.first_opened_at),
    }, { onConflict: "game_id,round,team_id" }));
  }
  async getDecision(gameId: string, round: number, teamId: string): Promise<DecisionRecord | null> {
    const r = must(await this.db.from("decisions").select("*").eq("game_id", gameId).eq("round", round).eq("team_id", teamId).maybeSingle());
    return r ? mapDecision(r) : null;
  }
  async getDecisions(gameId: string, round: number): Promise<DecisionRecord[]> {
    const rows = must(await this.db.from("decisions").select("*").eq("game_id", gameId).eq("round", round));
    return (rows ?? []).map(mapDecision);
  }
  async lockDecisions(gameId: string, round: number): Promise<void> {
    must(await this.db.from("decisions").update({ locked: true }).eq("game_id", gameId).eq("round", round));
  }

  // ── Results + research (append-only, except agreements upsert) ──────────────
  async appendRoundResult(rec: RoundResultRecord): Promise<void> {
    must(await this.db.from("round_results").insert({
      game_id: rec.game_id, round: rec.round, result: rec.result, created_at: toTs(rec.created_at),
    }));
  }
  async getRoundResult(gameId: string, round: number): Promise<RoundResultRecord | null> {
    const r = must(await this.db.from("round_results").select("*").eq("game_id", gameId).eq("round", round).maybeSingle());
    return r ? mapRoundResult(r) : null;
  }
  async getRoundResults(gameId: string): Promise<RoundResultRecord[]> {
    const rows = must(await this.db.from("round_results").select("*").eq("game_id", gameId).order("round", { ascending: true }));
    return (rows ?? []).map(mapRoundResult);
  }

  async appendPublicRound(rec: PublicRoundRecord): Promise<void> {
    must(await this.db.from("public_round").insert({
      game_id: rec.game_id, round: rec.round, events: rec.events, standings: rec.standings, market: rec.market, created_at: toTs(rec.created_at),
    }));
  }
  async getPublicRound(gameId: string, round: number): Promise<PublicRoundRecord | null> {
    const r = must(await this.db.from("public_round").select("*").eq("game_id", gameId).eq("round", round).maybeSingle());
    return r ? mapPublicRound(r) : null;
  }
  async getPublicRounds(gameId: string): Promise<PublicRoundRecord[]> {
    const rows = must(await this.db.from("public_round").select("*").eq("game_id", gameId).order("round", { ascending: true }));
    return (rows ?? []).map(mapPublicRound);
  }

  async appendFirmRounds(rows: FirmRoundRow[]): Promise<void> {
    if (!rows.length) return;
    must(await this.db.from("firm_round").insert(rows.map((r) => ({
      game_id: r.game_id, round: r.round, firm_id: r.firm_id, team_id: r.team_id,
      consent: r.consent, deid_code: r.deid_code, data: r.data,
    }))));
  }
  async getFirmRounds(gameId: string): Promise<FirmRoundRow[]> {
    const rows = must(await this.db.from("firm_round").select("*").eq("game_id", gameId));
    return (rows ?? []).map((r: any) => ({
      game_id: r.game_id, round: r.round, firm_id: r.firm_id, team_id: r.team_id,
      consent: r.consent, deid_code: r.deid_code, data: r.data,
    }));
  }

  async upsertAgreements(rows: AgreementRow[]): Promise<void> {
    if (!rows.length) return;
    must(await this.db.from("agreements").upsert(rows.map((r) => ({
      game_id: r.game_id, agreement_id: r.agreement_id, form: r.form, template: r.template,
      signatories: r.signatories, formation_round: r.formation_round,
      dissolution_round: r.dissolution_round, dissolution_type: r.dissolution_type,
    })), { onConflict: "game_id,agreement_id" }));
  }
  async getAgreements(gameId: string): Promise<AgreementRow[]> {
    const rows = must(await this.db.from("agreements").select("*").eq("game_id", gameId));
    return (rows ?? []).map((r: any) => ({
      game_id: r.game_id, agreement_id: r.agreement_id, form: r.form, template: r.template,
      signatories: r.signatories, formation_round: r.formation_round,
      dissolution_round: r.dissolution_round, dissolution_type: r.dissolution_type,
    }));
  }

  async appendBeliefs(rows: BeliefRow[]): Promise<void> {
    if (!rows.length) return;
    must(await this.db.from("beliefs").insert(rows));
  }
  async getBeliefs(gameId: string): Promise<BeliefRow[]> {
    const rows = must(await this.db.from("beliefs").select("*").eq("game_id", gameId));
    return (rows ?? []) as BeliefRow[];
  }

  async appendTelemetry(rows: TelemetryRow[]): Promise<void> {
    if (!rows.length) return;
    must(await this.db.from("telemetry").insert(rows.map((r) => ({
      game_id: r.game_id, round: r.round, team_id: r.team_id, revision_count: r.revision_count,
      info_purchased: r.info_purchased, submitted: r.submitted,
      submitted_at: toTs(r.submitted_at), time_to_decide_s: r.time_to_decide_s,
    }))));
  }
  async getTelemetry(gameId: string): Promise<TelemetryRow[]> {
    const rows = must(await this.db.from("telemetry").select("*").eq("game_id", gameId));
    return (rows ?? []).map((r: any) => ({
      game_id: r.game_id, round: r.round, team_id: r.team_id, revision_count: r.revision_count,
      info_purchased: r.info_purchased, submitted: r.submitted,
      submitted_at: fromTsN(r.submitted_at), time_to_decide_s: r.time_to_decide_s,
    }));
  }

  async appendReflections(rows: ReflectionRow[]): Promise<void> {
    if (!rows.length) return;
    must(await this.db.from("reflections").insert(rows));
  }
  async getReflections(gameId: string): Promise<ReflectionRow[]> {
    const rows = must(await this.db.from("reflections").select("*").eq("game_id", gameId));
    return (rows ?? []) as ReflectionRow[];
  }

  async appendDistinctiveness(rows: DistinctivenessRow[]): Promise<void> {
    if (!rows.length) return;
    must(await this.db.from("distinctiveness").insert(rows));
  }
  async getDistinctiveness(gameId: string): Promise<DistinctivenessRow[]> {
    const rows = must(await this.db.from("distinctiveness").select("*").eq("game_id", gameId));
    return (rows ?? []) as DistinctivenessRow[];
  }
}

/**
 * Build a SupabaseAdapter from SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (server/.env). Server-side only — never ship the service-role key to a client.
 */
export function createSupabaseAdapter(opts?: { url?: string; serviceRoleKey?: string }): SupabaseAdapter {
  const url = opts?.url ?? process.env.SUPABASE_URL;
  const key = opts?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SupabaseAdapter: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see server/.env).");
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return new SupabaseAdapter(db);
}
