/**
 * Round lifecycle orchestration (application-spec §5). A simple instructor-driven
 * state machine over the engine:
 *
 *   open → locked → resolving → published → (open | complete)
 *
 * Open: teams submit/revise decisions. Locked: window shut, non-submitters flagged.
 * Resolving: the engine runs once over the full decision set; append-only history +
 * research tables are written. Published: results released; the round advances.
 *
 * The engine is a dependency we *call*, never reimplement (§2.3). Resolution is a
 * pure function of (state, decisions, config, seed), so any round is replayable
 * (§3.3) — `replay()` verifies that against the persisted history.
 */
import { ADAPTIVE_LEANS, decideAdaptive, initGame, mergeMemberDecisions, resolveRound as engineResolve, ROLE_DESK } from "drinkwars-engine";
import type { Config, FirmDecision, FirmId, RoundResult, SegmentId, WorldState } from "drinkwars-engine";
import type {
  AgreementRow, BeliefRow, DecisionRecord, DistinctivenessRow, FirmMode, FirmRoundRow, GameRecord,
  ReflectionRow, StorageAdapter, TeamRecord, TelemetryRow,
} from "./types.js";

const MAX_SEATS_PER_FIRM = 6; // team mode: C-suite + a couple extra

export interface CreateGameInput {
  config: Config;
  teams: { name: string; memberUserIds?: string[] }[];
  gameId?: string;
  joinCode?: string; // multiplayer: students enter this to claim an open slot
  ownerTag?: string | null; // instructor passcode tier that owns this game (control scoping)
  firmMode?: FirmMode; // "solo" (default) | "team" (multi-seat firms)
  title?: string | null; // human title for the game (player's game list)
}

/** Per-student roster entry for instructor provisioning. */
export interface RosterEntry { external_id: string; name: string; email?: string | null; user_id?: string }
/** What provisioning returns per student — the durable claim_code is the credential to distribute. */
export interface ProvisionedStudent { external_id: string; name: string; claim_code: string; user_id: string; existing: boolean }
/** A game in a player's "my games" / return-to-game list, with their latest standing. */
export interface MyGame { gameId: string; title: string | null; joinCode: string | null; firmId: FirmId; teamName: string; round: number; lifecycle: GameRecord["lifecycle"]; nRounds: number; rank: number | null; score: number | null; status: string | null; complete: boolean }
/** A seat at one firm (team mode): who holds it, which desk, and whether they've submitted. */
export interface TeamSeat { name: string; role: string | null; desk: string | null; submitted: boolean }

export class LifecycleError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LifecycleError";
  }
}

function zeroFirmDecision(firmId: FirmId, segments: SegmentId[]): FirmDecision {
  const price: Record<SegmentId, number> = {};
  const presence: Record<SegmentId, number> = {};
  for (const s of segments) {
    price[s] = 0;
    presence[s] = 0;
  }
  return {
    firm_id: firmId, price, presence,
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0,
    buy_info: false, agreement_actions: [], exit_action: null,
  };
}

export class GameOrchestrator {
  constructor(
    private store: StorageAdapter,
    private clock: () => number = () => Date.now(),
    private opts: { botFillEmptySlots?: boolean } = {},
  ) {}

  /** Fresh id — a UUID, valid for both the in-memory store and Postgres uuid columns
   *  (global crypto works in Node and Deno, so this survives the Edge Function bundle). */
  private id(): string {
    return crypto.randomUUID();
  }
  private async requireGame(gameId: string): Promise<GameRecord> {
    const g = await this.store.getGame(gameId);
    if (!g) throw new LifecycleError(`no game ${gameId}`);
    return g;
  }

  /** Create a game: init the engine world, persist game + teams + round-0 state. */
  async createGame(input: CreateGameInput): Promise<string> {
    const { config } = input;
    if (input.teams.length > config.game.n_firms) throw new LifecycleError(`${input.teams.length} teams exceeds n_firms ${config.game.n_firms}`);
    const gameId = input.gameId ?? this.id();
    const world = initGame(config);
    const game: GameRecord = { id: gameId, config, n_rounds: config.game.n_rounds, current_round: 0, lifecycle: "open", join_code: input.joinCode ?? null, owner_tag: input.ownerTag ?? null, firm_mode: input.firmMode ?? "solo", title: input.title ?? null, created_at: this.clock() };
    await this.store.createGame(game);
    for (let i = 0; i < input.teams.length; i++) {
      const t = input.teams[i];
      const team: TeamRecord = { id: this.id(), game_id: gameId, firm_id: world.firms[i].id, name: t.name, member_user_ids: t.memberUserIds ?? [] };
      await this.store.createTeam(team);
    }
    await this.store.appendWorldState({ game_id: gameId, round: 0, state: world, seed: config.game.seed, created_at: this.clock() });
    return gameId;
  }

  /** A 6-character join code, ambiguous characters (0/O, 1/I) omitted. */
  static makeJoinCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  }
  /** A durable per-student claim credential (8 chars). The instructor distributes it;
   *  the student uses it to claim a seat AND to return to / list their games. */
  static makeClaimCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  }

  /**
   * A student joins by code + display name. Solo games: claim an unclaimed firm.
   * Team games (firm_mode="team"): join a specific firm (opts.teamId) or the emptiest
   * under-capacity firm, sharing it with teammates as a C-suite seat. Idempotent —
   * rejoining returns the same team. Server-side only (service role); RLS blocks a
   * student from reading the join code or another team. `userId` is the caller's
   * resolved identity (a roster user via claim_code, or an ephemeral anon user).
   */
  async joinGame(code: string, displayName: string, userId: string, opts: { teamId?: string; role?: string } = {}): Promise<{ gameId: string; teamId: string; firmId: FirmId; role?: string }> {
    const game = await this.store.getGameByCode(code);
    if (!game) throw new LifecycleError(`no game found for join code "${code}"`);
    const teams = await this.store.getTeams(game.id);
    const mine = teams.find((t) => t.member_user_ids.includes(userId));
    if (mine) {
      // Returning player keeps their seat (recovered from storage) unless they pick a new one.
      if (opts.role) await this.store.setMemberRole(mine.id, userId, opts.role);
      const role = opts.role ?? (await this.store.getMemberRole(mine.id, userId)) ?? undefined;
      return { gameId: game.id, teamId: mine.id, firmId: mine.firm_id, role };
    }
    if (!(await this.store.getUser(userId))) {
      await this.store.createUser({ id: userId, role: "student", email: null, consent: false, deid_code: `deid_${userId.slice(0, 8)}` });
    }
    let target: TeamRecord | undefined;
    if (game.firm_mode === "team") {
      // Join a specific firm, else the emptiest firm with an open seat.
      const open = teams.filter((t) => t.member_user_ids.length < MAX_SEATS_PER_FIRM);
      target = opts.teamId ? open.find((t) => t.id === opts.teamId) : [...open].sort((a, b) => a.member_user_ids.length - b.member_user_ids.length)[0];
      if (!target) throw new LifecycleError(`game "${code}" has no open seats`);
    } else {
      target = teams.find((t) => t.member_user_ids.length === 0);
      if (!target) throw new LifecycleError(`game "${code}" is full`);
    }
    const wasEmpty = target.member_user_ids.length === 0;
    await this.store.addTeamMember(target.id, userId);
    if (opts.role) await this.store.setMemberRole(target.id, userId, opts.role); // persist the seat (authoritative across devices)
    if (wasEmpty) await this.store.setTeamName(target.id, displayName); // the first member names the firm
    return { gameId: game.id, teamId: target.id, firmId: target.firm_id, role: opts.role };
  }

  /**
   * Instructor roster provisioning: create/refresh a persistent user per roster entry,
   * keyed by external_id (NetID) so a student's identity — and career — is stable across
   * games. Returns each student's durable claim_code (the credential the instructor
   * distributes). In Supabase mode the caller pre-creates the auth user and passes its id;
   * in memory mode a fresh id is minted. Idempotent: an existing NetID keeps its claim_code.
   */
  async provisionRoster(roster: RosterEntry[], opts: { cohort?: string | null } = {}): Promise<ProvisionedStudent[]> {
    const out: ProvisionedStudent[] = [];
    for (const r of roster) {
      const existing = await this.store.getUserByExternalId(r.external_id);
      if (existing) {
        const claim = existing.claim_code ?? GameOrchestrator.makeClaimCode();
        await this.store.upsertUser({ ...existing, display_name: r.name ?? existing.display_name ?? null, cohort: opts.cohort ?? existing.cohort ?? null, claim_code: claim });
        out.push({ external_id: r.external_id, name: r.name, claim_code: claim, user_id: existing.id, existing: true });
      } else {
        const userId = r.user_id ?? this.id();
        const claim = GameOrchestrator.makeClaimCode();
        await this.store.upsertUser({ id: userId, role: "student", email: r.email ?? null, consent: false, deid_code: `deid_${userId.slice(0, 8)}`, external_id: r.external_id, display_name: r.name ?? null, cohort: opts.cohort ?? null, claim_code: claim });
        out.push({ external_id: r.external_id, name: r.name, claim_code: claim, user_id: userId, existing: false });
      }
    }
    return out;
  }

  /** Every game a player is in, with their latest standing — the return-to-game picker
   *  + career list. Standing comes from the public_round projection (no rival privates). */
  async getMyGames(userId: string): Promise<MyGame[]> {
    const teams = await this.store.getTeamsForUser(userId);
    const out: MyGame[] = [];
    for (const t of teams) {
      const g = await this.store.getGame(t.game_id);
      if (!g) continue;
      const pubs = await this.store.getPublicRounds(t.game_id);
      const standing = pubs.at(-1)?.standings.find((s) => s.firm_id === t.firm_id) ?? null;
      out.push({
        gameId: g.id, title: g.title ?? null, joinCode: g.join_code, firmId: t.firm_id, teamName: t.name,
        round: g.current_round, lifecycle: g.lifecycle, nRounds: g.n_rounds,
        rank: standing?.rank ?? null, score: standing?.score ?? null, status: standing?.status ?? null, complete: g.lifecycle === "complete",
      });
    }
    // Newest activity first.
    return out.sort((a, b) => b.round - a.round);
  }

  /** The seats at a player's firm (team mode): who holds each, their desk, and whether
   *  they've submitted this round — for the live "your firm's desks" panel. */
  async getTeamSeats(gameId: string, teamId: string): Promise<TeamSeat[]> {
    const game = await this.requireGame(gameId);
    const team = await this.store.getTeam(teamId);
    if (!team) return [];
    const mds = await this.store.getMemberDecisions(gameId, game.current_round, teamId);
    const out: TeamSeat[] = [];
    for (const uid of team.member_user_ids) {
      const u = await this.store.getUser(uid);
      const role = await this.store.getMemberRole(teamId, uid);
      const md = mds.find((m) => m.user_id === uid);
      out.push({ name: u?.display_name ?? "Player", role, desk: md?.desk ?? (role ? (ROLE_DESK[role] ?? "all") : null), submitted: md?.submitted ?? false });
    }
    return out;
  }

  /** Submit (or revise) a team's decision while the window is open. */
  async submitDecision(gameId: string, teamId: string, decision: FirmDecision): Promise<void> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle !== "open") throw new LifecycleError(`cannot submit: round is "${game.lifecycle}", not open`);
    const team = await this.store.getTeam(teamId);
    if (!team || team.game_id !== gameId) throw new LifecycleError(`no team ${teamId} in game ${gameId}`);
    if (decision.firm_id !== team.firm_id) throw new LifecycleError(`decision firm_id ${decision.firm_id} ≠ team firm ${team.firm_id}`);

    const existing = await this.store.getDecision(gameId, game.current_round, teamId);
    if (existing?.locked) throw new LifecycleError("decision is locked");
    const now = this.clock();
    await this.store.upsertDecision({
      game_id: gameId, round: game.current_round, team_id: teamId, firm_id: team.firm_id, decision,
      submitted: true, locked: false,
      revision_count: existing ? existing.revision_count + 1 : 0,
      submitted_at: now,
      first_opened_at: existing?.first_opened_at ?? now,
    });
  }

  /**
   * Submit one C-suite seat's slice of a team firm's decision (firm_mode="team").
   * Upserts the seat's partial, then RE-MERGES all of the team's seats into the single
   * per-team DecisionRecord (via the engine's mergeMemberDecisions over a zero base), so
   * lock / resolve / status read the composed decision with no change. The firm counts as
   * submitted once any seat has submitted; desks with no seat keep their zero default.
   */
  async submitMemberDecision(gameId: string, teamId: string, userId: string, partial: Partial<FirmDecision>, role?: string): Promise<void> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle !== "open") throw new LifecycleError(`cannot submit: round is "${game.lifecycle}", not open`);
    const team = await this.store.getTeam(teamId);
    if (!team || team.game_id !== gameId) throw new LifecycleError(`no team ${teamId} in game ${gameId}`);
    const round = game.current_round;
    // Use the passed role, else the seat persisted at join — so a returning player never
    // falls back to "all" (which would clobber teammates' desks).
    const effRole = role ?? (await this.store.getMemberRole(teamId, userId)) ?? undefined;
    const desk = effRole ? (ROLE_DESK[effRole] ?? "all") : "all";
    const now = this.clock();
    await this.store.upsertMemberDecision({ game_id: gameId, round, team_id: teamId, user_id: userId, desk, partial, submitted: true, updated_at: now });

    // Compose the team's seats → the per-team decision the engine will resolve.
    const seats = await this.store.getMemberDecisions(gameId, round, teamId);
    const ws = (await this.store.getWorldState(gameId, round)) ?? (await this.store.getLatestWorldState(gameId));
    const segs = (ws?.state.segments ?? []).map((s) => s.id);
    const merged = mergeMemberDecisions(zeroFirmDecision(team.firm_id, segs), seats.map((s) => ({ desk: (s.desk as never) ?? "all", partial: s.partial })));
    const existing = await this.store.getDecision(gameId, round, teamId);
    if (existing?.locked) throw new LifecycleError("decision is locked");
    await this.store.upsertDecision({
      game_id: gameId, round, team_id: teamId, firm_id: team.firm_id, decision: merged,
      submitted: seats.some((s) => s.submitted), locked: false,
      revision_count: existing ? existing.revision_count + 1 : 0,
      submitted_at: now, first_opened_at: existing?.first_opened_at ?? now,
    });
  }

  /** Submission status for the instructor, including non-submitters (§5 Locked). */
  async getStatus(gameId: string): Promise<{ lifecycle: GameRecord["lifecycle"]; round: number; submissions: { team_id: string; firm_id: FirmId; submitted: boolean; locked: boolean }[]; nonSubmitters: string[] }> {
    const game = await this.requireGame(gameId);
    const teams = await this.store.getTeams(gameId);
    const decisions = await this.store.getDecisions(gameId, game.current_round);
    const byTeam = new Map(decisions.map((d) => [d.team_id, d]));
    const world = (await this.store.getLatestWorldState(gameId))!.state;
    const activeFirms = new Set(world.firms.filter((f) => f.status === "active").map((f) => f.id));
    const submissions = teams.map((t) => ({ team_id: t.id, firm_id: t.firm_id, submitted: byTeam.get(t.id)?.submitted ?? false, locked: byTeam.get(t.id)?.locked ?? false }));
    const nonSubmitters = teams.filter((t) => activeFirms.has(t.firm_id) && !byTeam.get(t.id)?.submitted).map((t) => t.id);
    return { lifecycle: game.lifecycle, round: game.current_round, submissions, nonSubmitters };
  }

  /** Close the submission window (§5 Locked). Returns flagged non-submitters. */
  async lockRound(gameId: string): Promise<string[]> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle !== "open") throw new LifecycleError(`cannot lock: round is "${game.lifecycle}"`);
    const { nonSubmitters } = await this.getStatus(gameId);
    await this.store.lockDecisions(gameId, game.current_round);
    await this.store.setGameLifecycle(gameId, "locked", game.current_round);
    return nonSubmitters;
  }

  /**
   * Resolve the round (§5 Resolve): run the engine once over the full decision
   * set, append the new world state + results, write the research tables, advance
   * the clock. Effectively final once written (append-only).
   */
  async resolveRound(gameId: string): Promise<{ round: number; lifecycle: GameRecord["lifecycle"] }> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle !== "locked") throw new LifecycleError(`cannot resolve: round is "${game.lifecycle}", not locked`);
    await this.store.setGameLifecycle(gameId, "resolving", game.current_round);

    const round = game.current_round;
    const wsRec = await this.store.getWorldState(gameId, round);
    if (!wsRec) throw new LifecycleError(`missing world_state for round ${round}`);
    const world = wsRec.state;
    const config = game.config;
    const segmentIds = world.segments.map((s) => s.id);
    const teams = await this.store.getTeams(gameId);
    const teamByFirm = new Map(teams.map((t) => [t.firm_id, t]));

    // Zero-fill non-submitting active firms so the research panel has a row for them.
    const submitted = await this.store.getDecisions(gameId, round);
    const submittedFirms = new Set(submitted.filter((d) => d.submitted).map((d) => d.firm_id));
    for (const f of world.firms) {
      if (f.status !== "active" || submittedFirms.has(f.id)) continue;
      const team = teamByFirm.get(f.id);
      if (!team) continue;
      // An unclaimed slot plays as an adaptive NPC (when enabled), so a game with
      // fewer humans than firms stays lively; a claimed team that ghosted is
      // zero-filled + flagged so the non-submission research signal stays honest.
      let decision: FirmDecision;
      if (this.opts.botFillEmptySlots && team.member_user_ids.length === 0) {
        const idx = world.firms.findIndex((x) => x.id === f.id);
        decision = decideAdaptive(ADAPTIVE_LEANS[idx % ADAPTIVE_LEANS.length], f, world, config);
      } else {
        decision = zeroFirmDecision(f.id, segmentIds);
      }
      await this.store.upsertDecision({
        game_id: gameId, round, team_id: team.id, firm_id: f.id, decision,
        submitted: false, locked: true, revision_count: 0, submitted_at: null, first_opened_at: null,
      });
    }

    const allDecisions = await this.store.getDecisions(gameId, round);
    const decisionVectors: FirmDecision[] = allDecisions.map((d) => d.decision);

    // The one engine call. Append-only history written from its output.
    const { world: nextWorld, result } = engineResolve(world, decisionVectors, config);
    await this.store.appendWorldState({ game_id: gameId, round: round + 1, state: nextWorld, seed: config.game.seed, created_at: this.clock() });
    await this.store.appendRoundResult({ game_id: gameId, round, result, created_at: this.clock() });
    await this.appendPublicProjection(gameId, round, result);
    await this.persistResearchRows(game, round, result, nextWorld, allDecisions, teamByFirm);

    const nextRound = round + 1;
    const lifecycle = nextRound >= game.n_rounds ? "complete" : "published";
    await this.store.setGameLifecycle(gameId, lifecycle, nextRound);
    return { round, lifecycle };
  }

  /** Persist the student-facing public projection for a resolved round (§3.2):
   *  ranked standings, public events, and per-segment market — no private diagnostics. */
  private async appendPublicProjection(gameId: string, round: number, result: RoundResult): Promise<void> {
    const ranked = [...result.firm_results].sort((a, b) => b.scorecard_cumulative - a.scorecard_cumulative);
    await this.store.appendPublicRound({
      game_id: gameId, round,
      events: result.events,
      standings: ranked.map((f, i) => ({ firm_id: f.firm_id, rank: i + 1, score: f.scorecard_cumulative, status: f.status })),
      market: result.market.map((m) => ({ segment: m.segment, D: m.D, total_q: m.total_q, active: m.active })),
      created_at: this.clock(),
    });
  }

  /** Open the next round's submission window (§5 Published → Open). */
  async advanceRound(gameId: string): Promise<void> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle !== "published") throw new LifecycleError(`cannot advance: round is "${game.lifecycle}"`);
    if (game.current_round >= game.n_rounds) await this.store.setGameLifecycle(gameId, "complete", game.current_round);
    else await this.store.setGameLifecycle(gameId, "open", game.current_round);
  }

  private async persistResearchRows(
    game: GameRecord,
    round: number,
    result: Awaited<ReturnType<typeof engineResolve>>["result"],
    nextWorld: WorldState,
    decisions: DecisionRecord[],
    teamByFirm: Map<FirmId, TeamRecord>,
  ): Promise<void> {
    const decByFirm = new Map(decisions.map((d) => [d.firm_id, d]));
    const teamConsent = async (team: TeamRecord): Promise<boolean> => {
      if (!team.member_user_ids.length) return false;
      const users = await Promise.all(team.member_user_ids.map((id) => this.store.getUser(id)));
      return users.every((u) => u?.consent === true);
    };

    // firm_round (§15.1) + distinctiveness (§15.4)
    const firmRows: FirmRoundRow[] = [];
    const distRows: DistinctivenessRow[] = [];
    for (const fr of result.firm_results) {
      const team = teamByFirm.get(fr.firm_id);
      firmRows.push({
        game_id: game.id, round, firm_id: fr.firm_id, team_id: team?.id ?? "?",
        consent: team ? await teamConsent(team) : false,
        deid_code: team ? `deid_${team.firm_id}` : "deid_?",
        data: fr,
      });
      if (fr.distinctiveness) distRows.push({ game_id: game.id, round, firm_id: fr.firm_id, mahalanobis: fr.distinctiveness.mahalanobis, nearest_neighbor: fr.distinctiveness.nearest_neighbor });
    }
    await this.store.appendFirmRounds(firmRows);
    if (distRows.length) await this.store.appendDistinctiveness(distRows);

    // agreements (§15.6) — upsert so dissolution is captured as it happens
    const agRows: AgreementRow[] = nextWorld.agreements.map((a) => ({
      game_id: game.id, agreement_id: a.id, form: a.form, template: a.template, signatories: a.signatories,
      formation_round: a.formation_round, dissolution_round: a.dissolution_round, dissolution_type: a.dissolution_type,
    }));
    if (agRows.length) await this.store.upsertAgreements(agRows);

    // Standings (for belief realization): rank firms by cumulative scorecard.
    const ranked = [...result.firm_results].sort((a, b) => b.scorecard_cumulative - a.scorecard_cumulative);
    const rankOf = new Map(ranked.map((f, i) => [f.firm_id, i + 1]));
    const realMarketSize = result.market.filter((m) => m.active).reduce((a, m) => a + m.D, 0);
    const nFirms = result.firm_results.length || 1;

    const beliefRows: BeliefRow[] = [];
    const telemetryRows: TelemetryRow[] = [];
    const reflectionRows: ReflectionRow[] = [];
    for (const fr of result.firm_results) {
      const d = decByFirm.get(fr.firm_id);
      const team = teamByFirm.get(fr.firm_id);
      if (!d || !team) continue;
      const dec = d.decision;
      if (dec.beliefs) {
        const realRank = rankOf.get(fr.firm_id) ?? null;
        const rankErr = dec.beliefs.own_rank != null && realRank != null ? Math.abs(dec.beliefs.own_rank - realRank) / nFirms : null;
        const sizeErr = dec.beliefs.market_size != null && realMarketSize > 0 ? Math.abs(dec.beliefs.market_size - realMarketSize) / realMarketSize : null;
        const score = rankErr != null || sizeErr != null ? Math.max(0, 1 - 0.5 * (rankErr ?? 0) - 0.5 * (sizeErr ?? 0)) : null;
        beliefRows.push({
          game_id: game.id, round, team_id: team.id,
          pred_own_rank: dec.beliefs.own_rank ?? null, pred_market_size: dec.beliefs.market_size ?? null, pred_rival_move: dec.beliefs.rival_move ?? null,
          real_own_rank: realRank, real_market_size: realMarketSize, score,
        });
      }
      telemetryRows.push({
        game_id: game.id, round, team_id: team.id,
        revision_count: d.revision_count, info_purchased: dec.buy_info, submitted: d.submitted, submitted_at: d.submitted_at,
        time_to_decide_s: d.submitted_at != null && d.first_opened_at != null ? (d.submitted_at - d.first_opened_at) / 1000 : null,
      });
      if (dec.reflection) reflectionRows.push({ game_id: game.id, round, team_id: team.id, text: dec.reflection });
    }
    if (beliefRows.length) await this.store.appendBeliefs(beliefRows);
    if (telemetryRows.length) await this.store.appendTelemetry(telemetryRows);
    if (reflectionRows.length) await this.store.appendReflections(reflectionRows);
  }

  /**
   * Replay verification (§3.3): re-run the engine from the persisted config + seed
   * and the recorded decisions, and confirm the recomputed standings match the
   * stored results round-for-round. Proves the history is reproducible.
   */
  async replay(gameId: string): Promise<{ ok: boolean; mismatches: string[] }> {
    const game = await this.requireGame(gameId);
    const results = await this.store.getRoundResults(gameId);
    const mismatches: string[] = [];
    let world = initGame(game.config);
    for (const rr of results) {
      const decisions = (await this.store.getDecisions(gameId, rr.round)).map((d) => d.decision);
      const { world: next, result } = engineResolve(world, decisions, game.config);
      for (const fr of result.firm_results) {
        const stored = rr.result.firm_results.find((x) => x.firm_id === fr.firm_id);
        if (!stored || Math.abs(stored.scorecard_cumulative - fr.scorecard_cumulative) > 1e-9) {
          mismatches.push(`round ${rr.round} firm ${fr.firm_id}: replay ${fr.scorecard_cumulative.toFixed(6)} vs stored ${stored?.scorecard_cumulative.toFixed(6) ?? "—"}`);
        }
      }
      world = next;
    }
    return { ok: mismatches.length === 0, mismatches };
  }

  /** Public state anyone in the game may see: round, lifecycle, segment activity. */
  async getPublicState(gameId: string): Promise<{ round: number; lifecycle: GameRecord["lifecycle"]; segments: { id: SegmentId; D: number; active: boolean }[] }> {
    const game = await this.requireGame(gameId);
    const ws = await this.store.getLatestWorldState(gameId);
    return { round: game.current_round, lifecycle: game.lifecycle, segments: (ws?.state.segments ?? []).map((s) => ({ id: s.id, D: s.D, active: s.active })) };
  }

  /** A team's view: its own firm state + published results. Pending decisions of
   *  other teams are never exposed here (the SQL layer enforces the same via RLS). */
  async getTeamView(gameId: string, teamId: string): Promise<{ own: WorldState["firms"][number] | null; publishedResults: number[]; standings: { firm_id: FirmId; score: number }[] }> {
    const game = await this.requireGame(gameId);
    const team = await this.store.getTeam(teamId);
    const ws = await this.store.getLatestWorldState(gameId);
    const own = ws && team ? ws.state.firms.find((f) => f.id === team.firm_id) ?? null : null;
    const results = await this.store.getRoundResults(gameId);
    const last = results.at(-1);
    const standings = (last?.result.firm_results ?? []).map((f) => ({ firm_id: f.firm_id, score: f.scorecard_cumulative })).sort((a, b) => b.score - a.score);
    return { own, publishedResults: results.map((r) => r.round), standings: game.lifecycle === "open" && results.length === 0 ? [] : standings };
  }
}
