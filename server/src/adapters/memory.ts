/**
 * In-memory StorageAdapter for tests and local dev. Mirrors the Supabase schema's
 * semantics: append-only tables reject re-writes (so a double-resolution surfaces
 * immediately), `decisions` upsert until locked, `agreements` upsert by id.
 */
import type {
  AgreementRow, BeliefRow, DecisionRecord, DistinctivenessRow, FirmRoundRow, GameRecord,
  Lifecycle, ReflectionRow, RoundResultRecord, StorageAdapter, TeamRecord, TelemetryRow,
  UserRecord, WorldStateRecord,
} from "../types.js";

const key = (...parts: (string | number)[]) => parts.join("::");
const clone = <T>(x: T): T => structuredClone(x);

export class InMemoryAdapter implements StorageAdapter {
  private games = new Map<string, GameRecord>();
  private users = new Map<string, UserRecord>();
  private teams = new Map<string, TeamRecord>();
  private worldStates = new Map<string, WorldStateRecord>(); // key game::round
  private decisions = new Map<string, DecisionRecord>(); // key game::round::team
  private roundResults = new Map<string, RoundResultRecord>(); // key game::round
  private firmRounds: FirmRoundRow[] = [];
  private agreements = new Map<string, AgreementRow>(); // key game::agreementId
  private beliefs: BeliefRow[] = [];
  private telemetry: TelemetryRow[] = [];
  private reflections: ReflectionRow[] = [];
  private distinctiveness: DistinctivenessRow[] = [];

  async createGame(g: GameRecord): Promise<void> {
    if (this.games.has(g.id)) throw new Error(`game ${g.id} already exists`);
    this.games.set(g.id, clone(g));
  }
  async getGame(id: string): Promise<GameRecord | null> {
    return this.games.has(id) ? clone(this.games.get(id)!) : null;
  }
  async setGameLifecycle(id: string, lifecycle: Lifecycle, currentRound: number): Promise<void> {
    const g = this.games.get(id);
    if (!g) throw new Error(`no game ${id}`);
    g.lifecycle = lifecycle;
    g.current_round = currentRound;
  }

  async createUser(u: UserRecord): Promise<void> {
    this.users.set(u.id, clone(u));
  }
  async getUser(id: string): Promise<UserRecord | null> {
    return this.users.has(id) ? clone(this.users.get(id)!) : null;
  }
  async createTeam(t: TeamRecord): Promise<void> {
    this.teams.set(t.id, clone(t));
  }
  async getTeams(gameId: string): Promise<TeamRecord[]> {
    return [...this.teams.values()].filter((t) => t.game_id === gameId).map(clone);
  }
  async getTeam(id: string): Promise<TeamRecord | null> {
    return this.teams.has(id) ? clone(this.teams.get(id)!) : null;
  }

  async appendWorldState(rec: WorldStateRecord): Promise<void> {
    const k = key(rec.game_id, rec.round);
    if (this.worldStates.has(k)) throw new Error(`world_state ${k} is append-only and already exists`);
    this.worldStates.set(k, clone(rec));
  }
  async getWorldState(gameId: string, round: number): Promise<WorldStateRecord | null> {
    const r = this.worldStates.get(key(gameId, round));
    return r ? clone(r) : null;
  }
  async getLatestWorldState(gameId: string): Promise<WorldStateRecord | null> {
    let best: WorldStateRecord | null = null;
    for (const r of this.worldStates.values()) if (r.game_id === gameId && (!best || r.round > best.round)) best = r;
    return best ? clone(best) : null;
  }

  async upsertDecision(rec: DecisionRecord): Promise<void> {
    const k = key(rec.game_id, rec.round, rec.team_id);
    const existing = this.decisions.get(k);
    if (existing?.locked) throw new Error(`decision ${k} is locked`);
    this.decisions.set(k, clone(rec));
  }
  async getDecision(gameId: string, round: number, teamId: string): Promise<DecisionRecord | null> {
    const r = this.decisions.get(key(gameId, round, teamId));
    return r ? clone(r) : null;
  }
  async getDecisions(gameId: string, round: number): Promise<DecisionRecord[]> {
    return [...this.decisions.values()].filter((d) => d.game_id === gameId && d.round === round).map(clone);
  }
  async lockDecisions(gameId: string, round: number): Promise<void> {
    for (const d of this.decisions.values()) if (d.game_id === gameId && d.round === round) d.locked = true;
  }

  async appendRoundResult(rec: RoundResultRecord): Promise<void> {
    const k = key(rec.game_id, rec.round);
    if (this.roundResults.has(k)) throw new Error(`round_result ${k} is append-only and already exists`);
    this.roundResults.set(k, clone(rec));
  }
  async getRoundResult(gameId: string, round: number): Promise<RoundResultRecord | null> {
    const r = this.roundResults.get(key(gameId, round));
    return r ? clone(r) : null;
  }
  async getRoundResults(gameId: string): Promise<RoundResultRecord[]> {
    return [...this.roundResults.values()].filter((r) => r.game_id === gameId).sort((a, b) => a.round - b.round).map(clone);
  }

  async appendFirmRounds(rows: FirmRoundRow[]): Promise<void> {
    this.firmRounds.push(...rows.map(clone));
  }
  async getFirmRounds(gameId: string): Promise<FirmRoundRow[]> {
    return this.firmRounds.filter((r) => r.game_id === gameId).map(clone);
  }
  async upsertAgreements(rows: AgreementRow[]): Promise<void> {
    for (const r of rows) this.agreements.set(key(r.game_id, r.agreement_id), clone(r));
  }
  async getAgreements(gameId: string): Promise<AgreementRow[]> {
    return [...this.agreements.values()].filter((r) => r.game_id === gameId).map(clone);
  }
  async appendBeliefs(rows: BeliefRow[]): Promise<void> {
    this.beliefs.push(...rows.map(clone));
  }
  async getBeliefs(gameId: string): Promise<BeliefRow[]> {
    return this.beliefs.filter((r) => r.game_id === gameId).map(clone);
  }
  async appendTelemetry(rows: TelemetryRow[]): Promise<void> {
    this.telemetry.push(...rows.map(clone));
  }
  async getTelemetry(gameId: string): Promise<TelemetryRow[]> {
    return this.telemetry.filter((r) => r.game_id === gameId).map(clone);
  }
  async appendReflections(rows: ReflectionRow[]): Promise<void> {
    this.reflections.push(...rows.map(clone));
  }
  async getReflections(gameId: string): Promise<ReflectionRow[]> {
    return this.reflections.filter((r) => r.game_id === gameId).map(clone);
  }
  async appendDistinctiveness(rows: DistinctivenessRow[]): Promise<void> {
    this.distinctiveness.push(...rows.map(clone));
  }
  async getDistinctiveness(gameId: string): Promise<DistinctivenessRow[]> {
    return this.distinctiveness.filter((r) => r.game_id === gameId).map(clone);
  }
}
