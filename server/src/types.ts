/**
 * Orchestration + persistence types (application-spec §3, §5). The engine
 * (`drinkwars-engine`) owns the economic substance; this layer owns the records
 * around it and the round lifecycle. The StorageAdapter is the seam: the same
 * orchestration runs on the in-memory adapter (tests/local) and on Supabase
 * (Postgres + RLS), per the chosen local-first approach.
 */
import type { Config, FirmDecision, FirmId, FirmRoundResult, RoundResult, SegmentId, WorldState } from "drinkwars-engine";

export type Role = "student" | "instructor";
export type TeamStatus = "active" | "bankrupt" | "exited_banked" | "exited_invested" | "exited_rebuilt";

/** Round lifecycle (§5): a simple instructor-advanced state machine. */
export type Lifecycle = "open" | "locked" | "resolving" | "published" | "complete";

export interface UserRecord {
  id: string;
  role: Role;
  email: string | null;
  consent: boolean; // §18 — research-use consent; off by default
  deid_code: string; // de-identification mapping for export
}

export interface TeamRecord {
  id: string;
  game_id: string;
  firm_id: FirmId; // v1: one team per firm
  name: string;
  member_user_ids: string[];
}

export interface GameRecord {
  id: string;
  config: Config;
  n_rounds: number;
  current_round: number; // the round currently open / just resolved
  lifecycle: Lifecycle;
  join_code: string | null; // multiplayer: code a student enters to join (server-validated)
  owner_tag: string | null; // instructor passcode tier that created it ("primary"|"test"); null = legacy/primary-owned
  created_at: number;
}

/** Append-only per-round world snapshot (§3.1, §3.3). Stored before resolution:
 *  world_state[r] is the pre-resolution state of round r; resolving r writes [r+1]. */
export interface WorldStateRecord {
  game_id: string;
  round: number;
  state: WorldState;
  seed: number;
  created_at: number;
}

export interface DecisionRecord {
  game_id: string;
  round: number;
  team_id: string;
  firm_id: FirmId;
  decision: FirmDecision;
  submitted: boolean;
  locked: boolean;
  revision_count: number; // telemetry §15.3
  submitted_at: number | null;
  first_opened_at: number | null; // for time-to-decide
}

export interface RoundResultRecord {
  game_id: string;
  round: number;
  result: RoundResult;
  created_at: number;
}

/** Student-facing published projection (§3.2): standings / events / market only —
 *  never a rival's private diagnostics. Append-only; read by game members via RLS. */
export interface PublicRoundRecord {
  game_id: string;
  round: number;
  events: string[];
  standings: { firm_id: FirmId; rank: number; score: number; status: string }[];
  market: { segment: SegmentId; D: number; total_q: number; active: boolean }[];
  created_at: number;
}

// --- Research tables (§15) -----------------------------------------------------

export interface FirmRoundRow {
  game_id: string;
  round: number;
  firm_id: FirmId;
  team_id: string;
  consent: boolean;
  deid_code: string;
  data: FirmRoundResult; // full structured record; export flattens to columns
}

export interface AgreementRow {
  game_id: string;
  agreement_id: string;
  form: string;
  template: string;
  signatories: FirmId[];
  formation_round: number;
  dissolution_round: number | null;
  dissolution_type: string | null;
}

export interface BeliefRow {
  game_id: string;
  round: number;
  team_id: string;
  pred_own_rank: number | null;
  pred_market_size: number | null;
  pred_rival_move: string | null;
  real_own_rank: number | null;
  real_market_size: number | null;
  score: number | null; // proper-scoring accuracy bonus
}

export interface TelemetryRow {
  game_id: string;
  round: number;
  team_id: string;
  revision_count: number;
  info_purchased: boolean;
  submitted: boolean;
  submitted_at: number | null;
  time_to_decide_s: number | null;
}

export interface ReflectionRow {
  game_id: string;
  round: number;
  team_id: string;
  text: string;
}

export interface DistinctivenessRow {
  game_id: string;
  round: number;
  firm_id: FirmId;
  mahalanobis: number;
  nearest_neighbor: number;
}

/**
 * Persistence contract. Append-only tables (world_states, round_results,
 * firm_round, beliefs, telemetry, reflections, distinctiveness) are never
 * updated after write — the engine guarantees replayability from
 * (state, decisions, config, seed) (§3.3), and the SQL layer enforces it via RLS
 * + revoked UPDATE/DELETE. `decisions` is mutable until locked; `agreements`
 * upserts as a pact dissolves.
 */
export interface StorageAdapter {
  // Game
  createGame(g: GameRecord): Promise<void>;
  getGame(id: string): Promise<GameRecord | null>;
  getGameByCode(code: string): Promise<GameRecord | null>;
  setGameLifecycle(id: string, lifecycle: Lifecycle, currentRound: number): Promise<void>;

  // Users & teams
  createUser(u: UserRecord): Promise<void>;
  getUser(id: string): Promise<UserRecord | null>;
  createTeam(t: TeamRecord): Promise<void>;
  getTeams(gameId: string): Promise<TeamRecord[]>;
  getTeam(id: string): Promise<TeamRecord | null>;
  addTeamMember(teamId: string, userId: string): Promise<void>;
  setTeamName(teamId: string, name: string): Promise<void>;

  // World states (append-only)
  appendWorldState(rec: WorldStateRecord): Promise<void>;
  getWorldState(gameId: string, round: number): Promise<WorldStateRecord | null>;
  getLatestWorldState(gameId: string): Promise<WorldStateRecord | null>;

  // Decisions (mutable until locked)
  upsertDecision(rec: DecisionRecord): Promise<void>;
  getDecision(gameId: string, round: number, teamId: string): Promise<DecisionRecord | null>;
  getDecisions(gameId: string, round: number): Promise<DecisionRecord[]>;
  lockDecisions(gameId: string, round: number): Promise<void>;

  // Results + research (append-only, except agreements upsert)
  appendRoundResult(rec: RoundResultRecord): Promise<void>;
  getRoundResult(gameId: string, round: number): Promise<RoundResultRecord | null>;
  getRoundResults(gameId: string): Promise<RoundResultRecord[]>;
  appendPublicRound(rec: PublicRoundRecord): Promise<void>;
  getPublicRound(gameId: string, round: number): Promise<PublicRoundRecord | null>;
  getPublicRounds(gameId: string): Promise<PublicRoundRecord[]>;
  appendFirmRounds(rows: FirmRoundRow[]): Promise<void>;
  getFirmRounds(gameId: string): Promise<FirmRoundRow[]>;
  upsertAgreements(rows: AgreementRow[]): Promise<void>;
  getAgreements(gameId: string): Promise<AgreementRow[]>;
  appendBeliefs(rows: BeliefRow[]): Promise<void>;
  getBeliefs(gameId: string): Promise<BeliefRow[]>;
  appendTelemetry(rows: TelemetryRow[]): Promise<void>;
  getTelemetry(gameId: string): Promise<TelemetryRow[]>;
  appendReflections(rows: ReflectionRow[]): Promise<void>;
  getReflections(gameId: string): Promise<ReflectionRow[]>;
  appendDistinctiveness(rows: DistinctivenessRow[]): Promise<void>;
  getDistinctiveness(gameId: string): Promise<DistinctivenessRow[]>;
}
