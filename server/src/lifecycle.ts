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
import { ADAPTIVE_LEANS, ALL_LEVERS, decideAdaptive, initGame, mergeMemberDecisions, rankStandings, resolveRound as engineResolve, ROLE_DESK, segmentDemandTotals } from "drinkwars-engine";
import type { Config, FirmDecision, FirmId, RoundResult, ScheduledShock, SegmentId, WorldState } from "drinkwars-engine";
import { randomBreweryNames } from "./names.js";
import type {
  AgreementRow, BeliefRow, DecisionRecord, DistinctivenessRow, FirmMode, FirmRoundRow, GameRecord,
  ReflectionRow, StorageAdapter, TeamRecord, TelemetryRow,
  MemberDecisionRecord,
} from "./types.js";

// Team mode: one player per C-suite chair. The cap IS the number of seats — every
// member holds a distinct desk, so a sixth player has nowhere to sit that wouldn't
// silently overwrite a teammate (DW-039).
const MAX_SEATS_PER_FIRM = 5;

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
/** DW-050 pre-seating: one row of the instructor's seat plan (NetID → firm → chair). */
export interface SeatPlanRow { external_id: string; team: string; role: string }
export interface SeatPlanResult { seated: { external_id: string; name: string; team: string; role: string; moved: boolean }[]; errors: { external_id: string; error: string }[] }
/** DW-050 pulse: the cheap "did anything change for my firm?" signal the student client polls
 *  between full views. `stamp` changes whenever the view would. */
export interface Pulse { round: number; lifecycle: GameRecord["lifecycle"]; deadlineAt: number | null; stamp: string }

/** One row of the instructor's game list (DW-049). */
export interface GameSummary { gameId: string; title: string | null; joinCode: string | null; round: number; nRounds: number; lifecycle: GameRecord["lifecycle"]; firmMode: FirmMode; nFirms: number; joined: number; players: number; createdAt: number; ownerTag: string | null; modules: string[]; practiceRounds: number }

/** DW-051: sanitise a founder's house style — a hex colour and a short mark id, nothing else. */
const styleOf = (s: { color?: string | null; emblem?: string | null }) => ({
  color: typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : null,
  emblem: typeof s.emblem === "string" && /^[a-z0-9_-]{1,24}$/i.test(s.emblem) ? s.emblem : null,
});
export interface MyGame { gameId: string; title: string | null; joinCode: string | null; firmId: FirmId; teamName: string; round: number; lifecycle: GameRecord["lifecycle"]; nRounds: number; rank: number | null; score: number | null; status: string | null; complete: boolean }
/** A seat at one firm (team mode): who holds it, which desk, and whether they've submitted. */
export interface TeamSeat { name: string; role: string | null; desk: string | null; submitted: boolean }
/** One seat's slice of the team plan (DW-038): who, which desk, and the levers they've
 *  put on the table this round. Same-team eyes only; `me` marks the caller's own seat. */
export interface TeamPlanSeat { name: string; role: string | null; desk: string | null; submitted: boolean; me: boolean; updated_at: number | null; partial: Partial<FirmDecision> | null;
  /** DW-074: levers this seat changed this round (absent on a slice stored before DW-074). */
  touched?: string[] }
/** The team's live plan: every seat's submitted slice + the composed firm decision they
 *  merge into (the record the engine will resolve). The shared pre-lock review surface. */
export interface TeamPlan { seats: TeamPlanSeat[]; composed: FirmDecision | null; locked: boolean }

/** DW-072 #5 — the instructor's live view of one team's pending round: every seated chair's
 *  submitted slice, the standing plan the slices overlay, and the composed decision (the stored
 *  record when one exists — exactly what lock/resolve will run). Instructor-only. Which seat a
 *  composed value came from is NOT decided here: that is the engine's precedence rule. */
export interface InstructorTeamSeat { userId: string; name: string; role: string | null; desk: string | null; submitted: boolean; updatedAt: number | null; partial: Partial<FirmDecision> | null; touched?: string[] }
export interface InstructorTeamDecision {
  teamId: string; firmId: FirmId; name: string;
  seats: InstructorTeamSeat[];
  /** The plan the firm trades on absent fresh input (merge base / no-show fill). */
  standing: FirmDecision | null;
  /** What will run: the persisted decision record (null until anyone submits). */
  composed: FirmDecision | null;
  submitted: boolean; locked: boolean;
}
export interface InstructorTeamDecisions { round: number; lifecycle: GameRecord["lifecycle"]; firmMode: string; teams: InstructorTeamDecision[] }

/** The C-suite seats a team-game joiner may take. */
const TEAM_ROLES = new Set(["ceo", "cfo", "cmo", "coo", "chro"]);

/** Market research is a RATCHET, not a toggle (DW-061).
 *
 *  The moment a firm's composed plan buys research the view starts serving rival fundamentals,
 *  and information cannot be un-seen. But the CHARGE only lands at resolve, off whatever the
 *  decision says then — so un-ticking the box and re-submitting refunded the $12,000 while the
 *  numbers stayed in the student's head. Free intelligence, every round, repeatable. Reproduced
 *  2026-09-24: rival Q/cash went 0 → real → 0 across two submits, and the round resolved with
 *  `info_purchased: false` and no charge.
 *
 *  There was a client-side guard (`infoLocked` in Play.tsx) but it was excluded from multiplayer
 *  by an `&& !mp`, so it never fired in the mode a class actually uses — and being React state it
 *  died on refresh and was invisible to the player's teammates anyway. Authority over a purchase
 *  belongs on the server.
 *
 *  Once bought in a round, it stays bought for that round. The composed decision record is
 *  already persisted per (game, round, team), so this needs no new state and no migration.
 */
function ratchetBoughtInfo(next: FirmDecision, existing: { decision?: FirmDecision } | null | undefined): FirmDecision {
  if (existing?.decision?.buy_info) next.buy_info = true;
  return next;
}

export class LifecycleError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LifecycleError";
  }
}

// DW-074: which levers a seat actually changed this round travels with its slice. It is stored
// INSIDE the jsonb `partial` under one reserved key (no column, no migration) and split back out
// at this boundary — nothing past `memberDecisions()` ever sees the key, and the merge only
// walks ALL_LEVERS, so it can never reach a FirmDecision.
const TOUCHED_KEY = "_touched";
/** DW-080: a submit names the round its form was built for. The server writes to the CURRENT round,
 *  so a form held open across a resolve (the "Before you submit" check left up while the instructor
 *  resolved) would land last round's loans, builds and hires in the new round. Refuse it instead.
 *  Absent (an older client mid-deploy, in-process callers) ⇒ no check. */
function assertFormRound(current: number, forRound: number | undefined): void {
  if (typeof forRound === "number" && Number.isFinite(forRound) && forRound !== current)
    throw new LifecycleError(`round ${forRound + 1} has already closed — that form was for round ${forRound + 1}, so nothing was sent. You're on round ${current + 1} now: check your desk and submit again`);
}
/** Brewery-name identity for the uniqueness rule (DW-079): ignores case and spacing. */
const nameKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
const LEVER_SET: ReadonlySet<string> = new Set(ALL_LEVERS as string[]);
type SeatSlice = MemberDecisionRecord & { touched?: string[] };
function unpackTouched(md: MemberDecisionRecord): SeatSlice {
  const raw = (md.partial as Record<string, unknown> | null)?.[TOUCHED_KEY];
  if (raw === undefined) return md;
  const { [TOUCHED_KEY]: _drop, ...partial } = md.partial as Record<string, unknown>;
  return { ...md, partial: partial as Partial<FirmDecision>, touched: Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && LEVER_SET.has(x)) : undefined };
}
/** Fold a seat's touched list into the stored partial (junk and non-levers dropped). */
function packTouched(partial: Partial<FirmDecision>, touched: readonly unknown[] | undefined): Partial<FirmDecision> {
  const { [TOUCHED_KEY]: _drop, ...clean } = partial as Record<string, unknown>;
  if (!Array.isArray(touched)) return clean as Partial<FirmDecision>; // an older client: the merge infers it
  const set = new Set<string>();
  for (const x of touched) if (typeof x === "string" && LEVER_SET.has(x)) set.add(x);
  return { ...clean, [TOUCHED_KEY]: [...set].sort() } as Partial<FirmDecision>;
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
    private opts: { botFillEmptySlots?: boolean; noShowPolicy?: "carry" | "zero" } = {},
  ) {}

  /** Fresh id — a UUID, valid for both the in-memory store and Postgres uuid columns.
   *  Prefers crypto.randomUUID (Node, Deno, Edge, https/localhost browsers), but that
   *  API is gated to SECURE contexts — undefined when the web app is opened over plain
   *  http:// on a LAN IP (mobile testing). getRandomValues is NOT gated, so fall back to
   *  a hand-rolled v4 UUID; Math.random is the last resort if there's no Web Crypto. */
  private id(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const b = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0"));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
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

  /** n characters from a 32-symbol alphabet (ambiguous 0/O, 1/I omitted) drawn from the
   *  CSPRNG. Math.random is predictable from a few observed outputs, and the claim code is
   *  a student's whole credential. 32 divides 256, so `& 31` is unbiased. */
  static randomCode(n: number): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => alphabet[x & 31]).join("");
  }
  /** A 6-character join code. */
  static makeJoinCode(): string { return GameOrchestrator.randomCode(6); }
  /** A durable per-student claim credential (8 chars). The instructor distributes it;
   *  the student uses it to claim a seat AND to return to / list their games. */
  static makeClaimCode(): string { return GameOrchestrator.randomCode(8); }

  /**
   * A student joins by code + display name. Solo games: claim an unclaimed firm.
   * Team games (firm_mode="team"): join a specific firm (opts.teamId) or the emptiest
   * under-capacity firm, sharing it with teammates as a C-suite seat. Idempotent —
   * rejoining returns the same team. Server-side only (service role); RLS blocks a
   * student from reading the join code or another team. `userId` is the caller's
   * resolved identity (a roster user via claim_code, or an ephemeral anon user).
   */
  async joinGame(code: string, displayName: string, userId: string, opts: { teamId?: string; role?: string; teamName?: string; style?: { color?: string | null; emblem?: string | null } } = {}): Promise<{ gameId: string; teamId: string; firmId: FirmId; role?: string; claim?: string }> {
    const game = await this.store.getGameByCode(code);
    if (!game) throw new LifecycleError(`no game found for join code "${code}"`);
    const teams = await this.store.getTeams(game.id);
    const mine = teams.find((t) => t.member_user_ids.includes(userId));
    if (mine) {
      // Returning player keeps their seat (recovered from storage) unless they pick a new one.
      if (opts.role) {
        if (game.firm_mode === "team" && !TEAM_ROLES.has(opts.role)) throw new LifecycleError(`unknown seat "${opts.role}"`);
        const before = await this.store.getMemberRole(mine.id, userId);
        await this.assertSeatFree(mine, opts.role, userId);
        await this.store.setMemberRole(mine.id, userId, opts.role);
        // DW-076: a new chair starts clean. The slice stored under the OLD role is that desk's
        // levers; left in place it would now merge as off-desk entries from the new chair (and,
        // being untouched, could put a lever the CEO changed back to last round's value). Same
        // rule moveMember already applies.
        if (game.firm_mode === "team" && before && before !== opts.role) {
          await this.store.deleteMemberDecision(game.id, game.current_round, userId);
          if (game.lifecycle === "open") await this.recomposeTeamDecisions(game.id, game);
        }
      }
      const role = opts.role ?? (await this.store.getMemberRole(mine.id, userId)) ?? undefined;
      // DW-050: a pre-seated CEO still gets the founding moment — naming the brewery on first
      // arrival (the seat plan only gave the firm a working label). Only the CEO's chair renames.
      if (opts.teamName?.trim() && role === "ceo" && game.firm_mode === "team") await this.nameTeam(teams, mine.id, opts.teamName, true);
      if (opts.style && (role === "ceo" || game.firm_mode !== "team")) await this.store.setTeamStyle(mine.id, styleOf(opts.style));
      return { gameId: game.id, teamId: mine.id, firmId: mine.firm_id, role, claim: await this.ensureClaimCode(userId) };
    }
    if (!(await this.store.getUser(userId))) {
      // A fresh (anonymous) joiner: mint the user WITH a durable claim code + display
      // name, so even a casual player gets optional persistent identity for free — they
      // can return to this brewery and their game list later (getMyGames), no instructor
      // provisioning required. Roster students arrive via a claim code and already have
      // both, so this branch is skipped for them.
      await this.store.createUser({ id: userId, role: "student", email: null, consent: false, deid_code: `deid_${userId.slice(0, 8)}`, display_name: displayName || null, claim_code: GameOrchestrator.makeClaimCode() });
    }
    let target: TeamRecord | undefined;
    let seat: string | undefined = opts.role;
    if (game.firm_mode === "team") {
      // Join a specific firm, else the emptiest firm with an open seat.
      const open = teams.filter((t) => t.member_user_ids.length < MAX_SEATS_PER_FIRM);
      if (opts.teamId) {
        const named = teams.find((t) => t.id === opts.teamId);
        target = open.find((t) => t.id === opts.teamId);
        if (named && !target) throw new LifecycleError(`"${named.name}" is full — all ${MAX_SEATS_PER_FIRM} C-suite seats are taken`);
      } else {
        target = [...open].sort((a, b) => a.member_user_ids.length - b.member_user_ids.length)[0];
      }
      if (!target) throw new LifecycleError(`game "${code}" has no open seats`);
      // Seat guards (DW-038/DW-039): the desk merge lets generalist seats ("all") fill
      // every desk, so TWO of them on one firm silently overwrite each other. Every seat
      // at a team firm is therefore a distinct named chair — the founder defaults to CEO
      // (same whole-firm desk coverage a lone player had), everyone after picks a free one.
      if (seat && !TEAM_ROLES.has(seat)) throw new LifecycleError(`unknown seat "${seat}"`);
      if (!seat) {
        if (target.member_user_ids.length > 0) throw new LifecycleError(`"${target.name}" already has members — pick a C-suite seat to join it`);
        seat = "ceo";
      }
      await this.assertSeatFree(target, seat, userId);
    } else {
      target = teams.find((t) => t.member_user_ids.length === 0);
      if (!target) throw new LifecycleError(`game "${code}" is full`);
    }
    const wasEmpty = target.member_user_ids.length === 0;
    if (wasEmpty && opts.teamName?.trim()) this.nameClash(teams, target.id, opts.teamName); // throws before seating
    await this.store.addTeamMember(target.id, userId);
    if (seat) await this.store.setMemberRole(target.id, userId, seat); // persist the seat (authoritative across devices)
    // The founder names the firm. In team mode the brewery name is its own field, so a
    // teammate reads "Sam" in the seat list and "Sediment Co." on the board — not one name
    // doing both jobs (DW-039).
    if (wasEmpty) await this.nameTeam(teams, target.id, opts.teamName?.trim() || displayName, !!opts.teamName?.trim());
    if (wasEmpty && opts.style) await this.store.setTeamStyle(target.id, styleOf(opts.style)); // DW-051: the founder's colour/mark are the firm's
    return { gameId: game.id, teamId: target.id, firmId: target.firm_id, role: seat, claim: await this.ensureClaimCode(userId) };
  }

  /** DW-079: brewery names are unique within a game (ignoring case and spacing). Two firms called
   *  "Hop Theory" made the news ambiguous — a playtest read a house firm's build as the class
   *  team's. Throws when ANOTHER STUDENT TEAM already brews under `wanted`; an unseated slot's
   *  generated name never blocks (nameTeam re-draws it). */
  private nameClash(teams: TeamRecord[], teamId: string, wanted: string): TeamRecord | undefined {
    const clash = teams.find((t) => t.id !== teamId && nameKey(t.name) === nameKey(wanted));
    if (clash && clash.member_user_ids.length > 0) throw new LifecycleError(`"${wanted.trim().slice(0, 40)}" is already another team's brewery in this game — pick a different name`);
    return clash;
  }
  /** Name a firm. A typed name (`chosen`) that another student team has is refused (nameClash);
   *  one that merely falls back to the player's first name gets a number instead ("Alex 2") —
   *  two students named Alex shouldn't block a join. An unseated slot holding the name draws a
   *  fresh one from the pool. */
  private async nameTeam(teams: TeamRecord[], teamId: string, wanted: string, chosen: boolean): Promise<void> {
    let name = wanted.trim().slice(0, 40);
    if (!chosen) for (let i = 2; teams.some((t) => t.id !== teamId && t.member_user_ids.length > 0 && nameKey(t.name) === nameKey(name)); i++) name = `${wanted.trim().slice(0, 36)} ${i}`;
    const slot = this.nameClash(teams, teamId, name);
    if (slot) {
      const taken = new Set([...teams.map((t) => nameKey(t.name)), nameKey(name)]);
      const fresh = randomBreweryNames(64).find((n) => !taken.has(nameKey(n))) ?? `Brewery ${teams.indexOf(slot) + 1}`;
      await this.store.setTeamName(slot.id, fresh);
      slot.name = fresh;
    }
    await this.store.setTeamName(teamId, name);
    const me = teams.find((t) => t.id === teamId);
    if (me) me.name = name;
  }

  /** Rejects taking a C-suite seat another member of the firm already holds. */
  private async assertSeatFree(team: TeamRecord, role: string, userId: string): Promise<void> {
    for (const uid of team.member_user_ids) {
      if (uid === userId) continue;
      if ((await this.store.getMemberRole(team.id, uid)) === role) {
        throw new LifecycleError(`the ${role.toUpperCase()} seat is already taken on "${team.name}"`);
      }
    }
  }

  /** The user's durable claim code, minting one if they somehow lack it (a legacy
   *  anonymous user created before auto-issue). Never overwrites an existing code, so a
   *  roster student's provisioned credential is preserved. */
  private async ensureClaimCode(userId: string): Promise<string | undefined> {
    const u = await this.store.getUser(userId);
    if (!u) return undefined;
    if (u.claim_code) return u.claim_code;
    const claim = GameOrchestrator.makeClaimCode();
    await this.store.upsertUser({ ...u, claim_code: claim });
    return claim;
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
    const mds = await this.memberDecisions(gameId, game.current_round, teamId);
    // DW-065: the roster in one read (was getUser + getMemberRole per chair, in series). Iteration
    // still follows team.member_user_ids so seat order is unchanged.
    const roster = new Map((await this.store.getTeamMembers(teamId)).map((m) => [m.user_id, m]));
    const out: TeamSeat[] = [];
    for (const uid of team.member_user_ids) {
      const u = roster.get(uid);
      const role = u?.role ?? null;
      const md = mds.find((m) => m.user_id === uid);
      out.push({ name: u?.display_name ?? "Player", role, desk: md?.desk ?? (role ? (ROLE_DESK[role] ?? "all") : null), submitted: md?.submitted ?? false });
    }
    return out;
  }

  /** Submit (or revise) a team's decision while the window is open. */
  async submitDecision(gameId: string, teamId: string, decision: FirmDecision, userId?: string, forRound?: number): Promise<void> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle !== "open") throw new LifecycleError(`cannot submit: round is "${game.lifecycle}", not open`);
    assertFormRound(game.current_round, forRound);
    const team = await this.store.getTeam(teamId);
    if (!team || team.game_id !== gameId) throw new LifecycleError(`no team ${teamId} in game ${gameId}`);
    // Transports pass the session's user: a removed/replaced player's old token must not keep
    // writing the firm's decision (the team-mode twin of this check is DW-066). In-process
    // callers (solo controller, bots, smokes) omit it.
    if (userId !== undefined && !team.member_user_ids.includes(userId)) throw new LifecycleError(`you are no longer seated at "${team.name}" — reload to pick up your new seat`);
    if (decision.firm_id !== team.firm_id) throw new LifecycleError(`decision firm_id ${decision.firm_id} ≠ team firm ${team.firm_id}`);

    const existing = await this.store.getDecision(gameId, game.current_round, teamId);
    if (existing?.locked) throw new LifecycleError("decision is locked");
    ratchetBoughtInfo(decision, existing);
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
  async submitMemberDecision(gameId: string, teamId: string, userId: string, partial: Partial<FirmDecision>, role?: string, touched?: readonly unknown[], forRound?: number): Promise<void> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle !== "open") throw new LifecycleError(`cannot submit: round is "${game.lifecycle}", not open`);
    assertFormRound(game.current_round, forRound);
    const team = await this.store.getTeam(teamId);
    if (!team || team.game_id !== gameId) throw new LifecycleError(`no team ${teamId} in game ${gameId}`);
    // DW-066: the session token names the team the player joined, not the one they sit at NOW.
    // A player the instructor moved (or removed) kept submitting into their OLD firm — the slice
    // landed in member_decisions under the old team_id and composed into its plan. Membership is
    // the authority; the transports re-seat the session on the next view.
    if (!team.member_user_ids.includes(userId)) throw new LifecycleError(`you are no longer seated at "${team.name}" — reload to pick up your new seat`);
    const round = game.current_round;
    // The seat persisted at the move/join wins over the token's — a moved player's token still
    // says their old chair until the client re-seats. (Was: token role first.)
    const effRole = (team.members ? team.members.find((m) => m.user_id === userId)?.role ?? null : await this.store.getMemberRole(teamId, userId)) ?? role ?? undefined;
    const desk = effRole ? (ROLE_DESK[effRole] ?? "all") : "all";
    const now = this.clock();
    // DW-074: `touched` rides inside the slice. Write FIRST, then read — reading before the write
    // (to union this seat's earlier list server-side) let two seats submitting within one store
    // round-trip each compose without the other. The client sends the union instead: it already
    // holds its own stored list in the team plan it fetched.
    await this.store.upsertMemberDecision({ game_id: gameId, round, team_id: teamId, user_id: userId, desk, partial: packTouched(partial, touched), submitted: true, updated_at: now });

    // Compose the team's seats → the per-team decision the engine will resolve. Only slices from
    // players who STILL sit here — a moved player's stale row must not trade for this firm.
    const seats = (await this.memberDecisions(gameId, round, teamId)).filter((s) => team.member_user_ids.includes(s.user_id));
    const ws = (await this.store.getWorldState(gameId, round)) ?? (await this.store.getLatestWorldState(gameId));
    const base = await this.standingDecision(gameId, round, teamId, team.firm_id, ws?.state ?? null, game.config);
    const merged = mergeMemberDecisions(base, seats.map((s) => ({ desk: (s.desk as never) ?? "all", partial: s.partial, updated_at: s.updated_at, touched: s.touched })));
    const existing = await this.store.getDecision(gameId, round, teamId);
    if (existing?.locked) throw new LifecycleError("decision is locked");
    ratchetBoughtInfo(merged, existing);
    await this.store.upsertDecision({
      game_id: gameId, round, team_id: teamId, firm_id: team.firm_id, decision: merged,
      submitted: seats.some((s) => s.submitted), locked: false,
      revision_count: existing ? existing.revision_count + 1 : 0,
      submitted_at: now, first_opened_at: existing?.first_opened_at ?? now,
    });
  }

  /** Every read of seat slices goes through here: `_touched` split out of the stored partial. */
  private async memberDecisions(gameId: string, round: number, teamId: string): Promise<SeatSlice[]> {
    return (await this.store.getMemberDecisions(gameId, round, teamId)).map(unpackTouched);
  }

  private async recomposeTeamDecisions(gameId: string, game: GameRecord): Promise<void> {
    const round = game.current_round;
    const ws = (await this.store.getWorldState(gameId, round)) ?? (await this.store.getLatestWorldState(gameId));
    for (const team of await this.store.getTeams(gameId)) {
      const seats = (await this.memberDecisions(gameId, round, team.id)).filter((s) => team.member_user_ids.includes(s.user_id));
      const existing = await this.store.getDecision(gameId, round, team.id);
      if (existing?.locked) continue;
      if (!seats.length) {
        // No slices left this round. A record can only exist here because a member who HAD
        // submitted was removed (DW-048) — drop it, so nothing of theirs still trades. The
        // invariant "a decision record exists iff someone submitted" holds again: at resolve
        // the firm gets the NPC / standing-plan fill like any other non-submitter.
        if (existing) await this.store.deleteDecision(gameId, round, team.id);
        continue;
      }
      const base = await this.standingDecision(gameId, round, team.id, team.firm_id, ws?.state ?? null, game.config);
      const merged = mergeMemberDecisions(base, seats.map((s) => ({ desk: (s.desk as never) ?? "all", partial: s.partial, updated_at: s.updated_at, touched: s.touched })));
      ratchetBoughtInfo(merged, existing);
      await this.store.upsertDecision({
        game_id: gameId, round, team_id: team.id, firm_id: team.firm_id, decision: merged,
        submitted: seats.some((s) => s.submitted), locked: false,
        revision_count: existing?.revision_count ?? 0,
        submitted_at: existing?.submitted_at ?? this.clock(), first_opened_at: existing?.first_opened_at ?? this.clock(),
      });
    }
  }

  /**
   * The firm's STANDING decision — how it trades absent a fresh instruction (DW-038/039).
   * NOT the zero decision: a zero price literally gives the product away and zero presence
   * withdraws the firm from every market it was serving. Standing levers (price, presence,
   * run-rate, market posture, investments) carry from last round's decision — the same
   * round reset the solo controller applies — while one-shot transactions (builds, hires,
   * draws, agreement actions) stay zeroed. With no prior decision, prices anchor at ~1.8×
   * estimated unit cost with presence in every active segment, plus maintenance-level capex
   * so capacity doesn't silently rot.
   *
   * Two callers: the merge base a team's seats overlay their desks onto, and the fill-in
   * for a claimed firm that missed the submission deadline.
   */
  private async standingDecision(gameId: string, round: number, teamId: string, firmId: FirmId, state: WorldState | null, config: Config | null, knownPrior?: DecisionRecord | null): Promise<FirmDecision> {
    const segs = (state?.segments ?? []).map((s) => s.id);
    const base = zeroFirmDecision(firmId, segs);
    const firm = state?.firms.find((f) => f.id === firmId) ?? null;
    const active = (state?.segments ?? []).filter((s) => s.active).map((s) => s.id);
    const prior = knownPrior !== undefined ? knownPrior : round > 0 ? await this.store.getDecision(gameId, round - 1, teamId) : null; // a caller holding the round's records passes it in
    if (prior) {
      const d = prior.decision;
      base.price = { ...base.price, ...d.price };
      base.presence = { ...base.presence, ...d.presence };
      if (d.run_rate != null) base.run_rate = d.run_rate;
      if (d.market_presence) base.market_presence = d.market_presence;
      if (d.market_supply) base.market_supply = d.market_supply;
      base.invest_cap = d.invest_cap; base.invest_process = d.invest_process; base.invest_Q = d.invest_Q; base.invest_B = d.invest_B;
      base.invest_T_emp = d.invest_T_emp; base.invest_T_inv = d.invest_T_inv; base.invest_T_gov = d.invest_T_gov;
    } else {
      for (const s of active) base.presence[s] = 1;
      if (config) base.invest_cap = Math.round((config.capacity.depreciation * (firm?.cap ?? 0)) / config.capacity.gain);
    }
    const unit = firm && firm.unit_cost > 0 ? firm.unit_cost : (config?.costs.c_base ?? 3) * 0.85;
    for (const s of active) if (!base.price[s]) base.price[s] = Math.round(unit * 1.8 * 100) / 100;
    return base;
  }

  /** The team's live plan (DW-038): each seat's submitted slice + the composed firm
   *  decision they merge into. The transport resolves the caller's own team, so this is
   *  same-firm eyes only; `me` flags the caller's seat (draft rehydration client-side). */
  /** `standing`: the firm's standing plan, which the /view has already read — pass it and an open
   *  round's plan is composed live from the seat slices (DW-080), at no extra read. */
  async getTeamPlan(gameId: string, teamId: string, forUserId: string, standing?: FirmDecision | null): Promise<TeamPlan> {
    const game = await this.requireGame(gameId);
    const team = await this.store.getTeam(teamId);
    if (!team || team.game_id !== gameId) return { seats: [], composed: null, locked: false };
    const round = game.current_round;
    const mds = await this.memberDecisions(gameId, round, teamId);
    const roster = new Map((await this.store.getTeamMembers(teamId)).map((m) => [m.user_id, m])); // DW-065: one read, not two per chair
    const seats: TeamPlanSeat[] = [];
    for (const uid of team.member_user_ids) {
      const u = roster.get(uid);
      const role = u?.role ?? null;
      const md = mds.find((m) => m.user_id === uid);
      seats.push({
        name: u?.display_name ?? "Player", role,
        desk: md?.desk ?? (role ? (ROLE_DESK[role] ?? "all") : null),
        submitted: md?.submitted ?? false, me: uid === forUserId,
        updated_at: md?.updated_at ?? null, partial: md?.partial ?? null,
        ...(md?.touched ? { touched: md.touched } : {}),
      });
    }
    const rec = await this.store.getDecision(gameId, round, teamId);
    // DW-080 (twin of getTeamDecisions): the stored record can lag the slices when seats submit within
    // one store round-trip — each compose read missed the other's slice (10 of 40 simulated deadline
    // rushes on Supabase latency). Lock recomposes, so what LOCKED was right; the live "Locks at"
    // figures, the form mirror and the cover re-send were not. Compose live while the round is open.
    let composed = rec?.decision ?? null;
    if (standing && !rec?.locked && game.lifecycle === "open") {
      const live = mds.filter((m) => team.member_user_ids.includes(m.user_id));
      if (live.length) composed = ratchetBoughtInfo(mergeMemberDecisions(standing, live.map((m) => ({ desk: (m.desk as never) ?? "all", partial: m.partial, updated_at: m.updated_at, touched: m.touched }))), rec);
    }
    return { seats, composed, locked: rec?.locked ?? false };
  }

  /** Submission status for the instructor, including non-submitters (§5 Locked). */
  async getStatus(gameId: string): Promise<{ lifecycle: GameRecord["lifecycle"]; round: number; submissions: { team_id: string; firm_id: FirmId; submitted: boolean; locked: boolean }[]; nonSubmitters: string[]; deadlineAt: number | null }> {
    const game = await this.requireGame(gameId);
    const teams = await this.store.getTeams(gameId);
    const decisions = await this.store.getDecisions(gameId, game.current_round);
    const byTeam = new Map(decisions.map((d) => [d.team_id, d]));
    const world = (await this.store.getLatestWorldState(gameId))!.state;
    const activeFirms = new Set(world.firms.filter((f) => f.status === "active").map((f) => f.id));
    const submissions = teams.map((t) => ({ team_id: t.id, firm_id: t.firm_id, submitted: byTeam.get(t.id)?.submitted ?? false, locked: byTeam.get(t.id)?.locked ?? false }));
    const nonSubmitters = teams.filter((t) => activeFirms.has(t.firm_id) && !byTeam.get(t.id)?.submitted).map((t) => t.id);
    return { lifecycle: game.lifecycle, round: game.current_round, submissions, nonSubmitters, deadlineAt: game.deadline_at ?? null };
  }

  // ───────────────────────── Gamemaster (DW-037): the instructor's forward schedule ─────────────────────────
  // The engine already rolls a deterministic shock timeline at init and honors
  // `live_triggers`; these methods are the missing writers. Edits land on the CURRENT
  // round's stored world state (the exact record the next resolve consumes), so replay
  // stays deterministic — the edit is part of the persisted history.

  /** The forward schedule: every scheduled shock (engine-rolled + instructor-planted),
   *  what can be planted (the config's shock catalog), and any live triggers armed. */
  async getTimeline(gameId: string): Promise<{
    round: number; nRounds: number;
    timeline: ScheduledShock[]; liveTriggers: string[];
    catalog: { id: string; kind: string; target: string; magnitude_mean: number; duration: number; regional: boolean }[];
    regions: string[];
  }> {
    const game = await this.requireGame(gameId);
    const ws = await this.store.getLatestWorldState(gameId);
    if (!ws) throw new LifecycleError("no world state");
    const geo = game.config.modules?.geography;
    return {
      round: game.current_round,
      nRounds: game.n_rounds,
      timeline: [...ws.state.shock_timeline].sort((a, b) => a.round - b.round),
      liveTriggers: ws.state.live_triggers ?? [],
      catalog: game.config.shocks.types.map((t) => ({ id: t.id, kind: t.kind, target: String(t.target), magnitude_mean: t.magnitude_mean, duration: t.duration, regional: !!t.regional })),
      regions: geo?.enabled ? geo.markets.map((m) => m.id) : [],
    };
  }

  /** Plant a disruption (or cancel one) on a FUTURE-or-current round. Instructor-planted
   *  shocks are `locked` so nothing auto-edits them; already-fired entries are immutable. */
  async scheduleShock(gameId: string, spec: { type_id: string; round: number; magnitude?: number; duration?: number; region?: string }): Promise<ScheduledShock> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle === "complete") throw new LifecycleError("game is complete");
    const t = game.config.shocks.types.find((x) => x.id === spec.type_id);
    if (!t) throw new LifecycleError(`unknown shock type "${spec.type_id}"`);
    const round = Math.round(spec.round);
    if (!Number.isFinite(round) || round < game.current_round || round >= game.n_rounds) throw new LifecycleError(`round ${spec.round} is not schedulable (current ${game.current_round}, last ${game.n_rounds - 1})`);
    const ws = await this.store.getLatestWorldState(gameId);
    if (!ws) throw new LifecycleError("no world state");
    const s: ScheduledShock = {
      id: `gm_${round}_${t.id}_${ws.state.shock_timeline.length}`,
      type_id: t.id,
      kind: t.kind,
      target: t.target,
      round,
      // Magnitude bounds by kind (DW-046): a demand drop is a fraction of the segment (≤ 0.9),
      // a cash hit a fraction of cash (≤ 1); cost/capacity multipliers may run to 1.5.
      magnitude: Math.min(t.kind === "demand_drop" ? 0.9 : t.kind === "cash_hit" ? 1 : 1.5, Math.max(0.02, spec.magnitude ?? t.magnitude_mean)),
      signaling: t.signaling,
      resilience_mitigated: t.resilience_mitigated,
      duration: Math.min(6, Math.max(1, Math.round(spec.duration ?? t.duration))),
      locked: true,
      fired: false,
      ...(spec.region ? { region: spec.region } : {}),
    };
    ws.state.shock_timeline.push(s);
    await this.store.updateWorldState(gameId, ws.round, ws.state);
    return s;
  }

  /** Remove a not-yet-fired scheduled shock (engine-rolled or instructor-planted). */
  async unscheduleShock(gameId: string, shockId: string): Promise<void> {
    const game = await this.requireGame(gameId);
    const ws = await this.store.getLatestWorldState(gameId);
    if (!ws) throw new LifecycleError("no world state");
    const i = ws.state.shock_timeline.findIndex((s) => s.id === shockId);
    if (i < 0) throw new LifecycleError(`no scheduled shock "${shockId}"`);
    const s = ws.state.shock_timeline[i];
    if (s.fired || s.round < game.current_round) throw new LifecycleError("cannot remove a shock that already fired");
    ws.state.shock_timeline.splice(i, 1);
    await this.store.updateWorldState(gameId, ws.round, ws.state);
  }

  /** Arm (or disarm) a live trigger: the named shock type fires when THIS round resolves. */
  async setLiveTrigger(gameId: string, typeId: string, armed: boolean): Promise<string[]> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle === "complete") throw new LifecycleError("game is complete");
    if (!game.config.shocks.types.some((x) => x.id === typeId)) throw new LifecycleError(`unknown shock type "${typeId}"`);
    const ws = await this.store.getLatestWorldState(gameId);
    if (!ws) throw new LifecycleError("no world state");
    const cur = new Set(ws.state.live_triggers ?? []);
    if (armed) cur.add(typeId);
    else cur.delete(typeId);
    ws.state.live_triggers = [...cur];
    await this.store.updateWorldState(gameId, ws.round, ws.state);
    return ws.state.live_triggers;
  }

  /** Close the submission window (§5 Locked). Returns flagged non-submitters. */
  async lockRound(gameId: string): Promise<string[]> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle !== "open") throw new LifecycleError(`cannot lock: round is "${game.lifecycle}"`);
    // Team firms: re-compose every team's plan from its seats' slices right before the lock
    // (DW-046). Two teammates submitting at the same instant could each compose from a
    // read that missed the other's slice, and whichever wrote last won — the lock-time
    // recompose makes the persisted plan authoritative regardless of submit order.
    if (game.firm_mode === "team") await this.recomposeTeamDecisions(gameId, game);
    const { nonSubmitters } = await this.getStatus(gameId);
    await this.store.lockDecisions(gameId, game.current_round);
    await this.store.setGameLifecycle(gameId, "locked", game.current_round);
    return nonSubmitters;
  }

  /** Re-open a locked round (DW-048): a mis-click on Lock, or a late team that deserves
   *  the window back. Only "locked" reverts — a resolve in flight or published is final. */
  /** Pre-seat provisioned students (DW-050): "NetID → firm name → chair", applied before the
   *  students ever open the app. A firm named in the plan is matched by name (case-insensitive)
   *  or claims the next EMPTY firm and takes the plan's name. A student already seated in
   *  this game is re-seated (same-firm chair change or a move, slices dropped as in
   *  moveMember). When the student then enters the join code with their claim code, joinGame's
   *  returning-player path lands them in this chair with nothing to pick. Row-level errors are
   *  returned, not thrown — the rest of the plan applies. Idempotent: re-applying the same plan
   *  is a no-op. */
  async applySeatPlan(gameId: string, rows: SeatPlanRow[]): Promise<SeatPlanResult> {
    const game = await this.requireGame(gameId);
    if (game.firm_mode !== "team") throw new LifecycleError("a seat plan applies to team games (solo players each found their own firm)");
    if (game.lifecycle === "complete") throw new LifecycleError("game is complete");
    const out: SeatPlanResult = { seated: [], errors: [] };
    let teams = await this.store.getTeams(gameId);
    const norm = (s: string) => s.trim().toLowerCase();
    // 1. resolve each plan firm to a team: by name first (an explicit existing firm always
    //    wins), else where the group's members ALREADY sit (a CEO may have renamed the firm on
    //    arrival — re-pasting the plan must not move everyone to a fresh firm), else claim an
    //    empty one and name it.
    const byPlanName = new Map<string, TeamRecord>();
    const claimed = new Set<string>();
    for (const r of rows) {
      const key = norm(r.team ?? "");
      if (!key || byPlanName.has(key)) continue;
      let t: TeamRecord | undefined = teams.find((x) => norm(x.name) === key && !claimed.has(x.id));
      for (const rr of rows) {
        if (t) break;
        if (norm(rr.team ?? "") !== key) continue;
        const ext = String(rr.external_id ?? "").trim();
        const u = ext ? (await this.store.getUserByExternalId(ext)) ?? (await this.store.getUserByExternalId(ext.toLowerCase())) : null;
        const sits = u ? teams.find((x) => x.member_user_ids.includes(u.id) && !claimed.has(x.id)) : undefined;
        if (sits) { t = sits; break; }
      }
      if (!t) {
        t = teams.find((x) => x.member_user_ids.length === 0 && !claimed.has(x.id) && ![...byPlanName.values()].some((b) => b.id === x.id));
        if (t) { await this.store.setTeamName(t.id, r.team.trim().slice(0, 40)); t = { ...t, name: r.team.trim().slice(0, 40) }; }
      }
      if (!t) { continue; }
      claimed.add(t.id);
      byPlanName.set(key, t);
    }
    // 2. seat each student
    for (const r of rows) {
      const ext = String(r.external_id ?? "").trim();
      const role = String(r.role ?? "").trim().toLowerCase();
      const fail = (error: string) => out.errors.push({ external_id: ext || "(blank)", error });
      if (!ext) { fail("blank NetID"); continue; }
      if (!r.team.trim()) { fail("blank Firm — use any working label (e.g. Group 1); the CEO names the brewery on arrival"); continue; }
      const t = byPlanName.get(norm(r.team ?? ""));
      if (!t) { fail(`no firm available for "${r.team}" — every firm is named or occupied; raise Firms or fix the name`); continue; }
      if (!TEAM_ROLES.has(role)) { fail(`unknown chair "${r.role}" (ceo, cfo, cmo, coo, chro)`); continue; }
      const u = (await this.store.getUserByExternalId(ext)) ?? (await this.store.getUserByExternalId(ext.toLowerCase())) ?? (await this.store.getUserByExternalId(ext.toUpperCase()));
      if (!u) { fail("not on the roster — provision this NetID first"); continue; }
      teams = await this.store.getTeams(gameId); // fresh occupancy after each seat
      const cur = teams.find((x) => x.member_user_ids.includes(u.id));
      const target = teams.find((x) => x.id === t.id)!;
      try {
        if (cur && cur.id === target.id) {
          if ((await this.store.getMemberRole(target.id, u.id)) !== role) { await this.assertSeatFree(target, role, u.id); await this.store.setMemberRole(target.id, u.id, role); }
          out.seated.push({ external_id: ext, name: u.display_name ?? ext, team: target.name, role, moved: false });
        } else if (cur) {
          await this.moveMember(gameId, u.id, target.id, role);
          out.seated.push({ external_id: ext, name: u.display_name ?? ext, team: target.name, role, moved: true });
        } else {
          if (target.member_user_ids.length >= MAX_SEATS_PER_FIRM) throw new LifecycleError(`"${target.name}" is full — all ${MAX_SEATS_PER_FIRM} C-suite seats are taken`);
          await this.assertSeatFree(target, role, u.id);
          await this.store.addTeamMember(target.id, u.id);
          await this.store.setMemberRole(target.id, u.id, role);
          out.seated.push({ external_id: ext, name: u.display_name ?? ext, team: target.name, role, moved: false });
        }
      } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
    }
    return out;
  }

  /** Where a (claim-identified) student already sits in this game, if anywhere (DW-050):
   *  the Join screen skips the firm/chair picker for a pre-seated or returning player. */
  async seatOf(gameId: string, userId: string): Promise<{ teamId: string; team: string; role: string | null } | null> {
    const t = (await this.store.getTeams(gameId)).find((x) => x.member_user_ids.includes(userId));
    return t ? { teamId: t.id, team: t.name, role: await this.store.getMemberRole(t.id, userId) } : null;
  }

  /** DW-066: where this player sits NOW, from a team list already in hand (no extra read) — the
   *  transports compare it to the session token on every full view and re-seat the session when
   *  the instructor moved the player. `null` = removed from the game (the session is dead). */
  static seatIn(teams: TeamRecord[], userId: string): { teamId: string; firmId: FirmId; team: string; role: string | null } | null {
    const t = teams.find((x) => x.member_user_ids.includes(userId));
    if (!t) return null;
    return { teamId: t.id, firmId: t.firm_id, team: t.name, role: t.members?.find((m) => m.user_id === userId)?.role ?? null };
  }

  /** Cheap change signal for one firm (DW-050): 2–3 reads instead of the ~30 a full view
   *  costs. The stamp folds in everything that would change the student's view — round,
   *  lifecycle, deadline, the firm's roster, and every seat's last write. */
  async pulse(gameId: string, teamId: string): Promise<Pulse> {
    // DW-064: four reads that ran in series on the endpoint every student polls — 74% of all
    // traffic in the prod rehearsal. `game` and `team` need nothing from each other, and both
    // decision reads need only game.current_round / firm_mode, so this is two waits, not four.
    const [game, team] = await Promise.all([this.requireGame(gameId), this.store.getTeam(teamId)]);
    const round = game.current_round;
    const mdsPending = game.firm_mode === "team" ? this.memberDecisions(gameId, round, teamId) : null;
    const [rec, mdsMaybe] = await Promise.all([this.store.getDecision(gameId, round, teamId), mdsPending]);
    const mds = mdsMaybe ?? [];
    const writes = Math.max(rec?.submitted_at ?? 0, ...mds.map((m) => m.updated_at ?? 0));
    // DW-066: seats carry their ROLE in the stamp — a same-firm chair change (COO → CFO) must reach
    // the player's client too, and the adapters embed the roster in the team read, so this is free.
    const seats = team?.members ? team.members.map((m) => `${m.user_id}:${m.role ?? ""}`) : (team?.member_user_ids ?? []);
    const stamp = [round, game.lifecycle, game.deadline_at ?? 0, seats.join(","), writes, rec?.revision_count ?? -1, rec?.locked ? 1 : 0].join("|");
    return { round, lifecycle: game.lifecycle, deadlineAt: game.deadline_at ?? null, stamp };
  }

  /** End a game early (DW-049): the season completes at the current round — students see
   *  "Season complete", no further submissions are accepted, the dashboard/export keep every
   *  resolved round. A round mid-resolve must finish (Retry resolve) first. Idempotent. */
  async endGame(gameId: string): Promise<void> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle === "complete") return;
    if (game.lifecycle === "resolving") throw new LifecycleError("cannot end while a round is resolving — retry resolve first");
    if (game.deadline_at != null) await this.store.setGameDeadline(gameId, null);
    await this.store.setGameLifecycle(gameId, "complete", game.current_round);
  }

  /** Rename (or clear the title of) a game (DW-049). Titles are labels for the instructor's list. */
  async renameGame(gameId: string, title: string | null): Promise<void> {
    await this.requireGame(gameId);
    const t = title == null ? null : String(title).trim().slice(0, 60) || null;
    await this.store.setGameTitle(gameId, t);
  }

  /** The instructor's games, newest first (DW-049) — enough per row to pick one to resume or
   *  export. `filter` scopes by ownership (the transport applies its passcode tier). */
  async listGames(filter: (g: GameRecord) => boolean = () => true): Promise<GameSummary[]> {
    const out: GameSummary[] = [];
    for (const g of await this.store.listGames()) if (filter(g)) out.push(await this.summarize(g));
    return out;
  }

  /** One game's set-up as the console shows it (DW-049): title, size, mode, enabled modules. */
  async describeGame(gameId: string): Promise<GameSummary> {
    return this.summarize(await this.requireGame(gameId));
  }

  private async summarize(g: GameRecord): Promise<GameSummary> {
    const teams = await this.store.getTeams(g.id);
    const mods = (g.config.modules ?? {}) as Record<string, { enabled?: boolean } | undefined>;
    const scoring = (g.config as { scoring?: { accumulation_window?: { drop_first?: number } } }).scoring;
    return {
      gameId: g.id, title: g.title ?? null, joinCode: g.join_code, round: g.current_round, nRounds: g.n_rounds, lifecycle: g.lifecycle,
      firmMode: g.firm_mode ?? "solo", nFirms: teams.length, joined: teams.filter((t) => t.member_user_ids.length > 0).length,
      players: teams.reduce((n, t) => n + t.member_user_ids.length, 0), createdAt: g.created_at, ownerTag: g.owner_tag,
      modules: Object.entries(mods).filter(([, m]) => !!m?.enabled).map(([id]) => id),
      practiceRounds: scoring?.accumulation_window?.drop_first ?? 0,
    };
  }

  async unlockRound(gameId: string): Promise<void> {
    const game = await this.requireGame(gameId);
    if (game.lifecycle !== "locked") throw new LifecycleError(`cannot unlock: round is "${game.lifecycle}", not locked`);
    await this.store.unlockDecisions(gameId, game.current_round);
    await this.store.setGameLifecycle(gameId, "open", game.current_round);
  }

  /** Announce (or clear) a submission deadline for the current round (DW-048). Display-only:
   *  students see a countdown; the instructor still locks by hand. Cleared on advance. */
  async setDeadline(gameId: string, deadlineAt: number | null): Promise<void> {
    await this.requireGame(gameId);
    if (deadlineAt != null && !(Number.isFinite(deadlineAt) && deadlineAt > 0)) throw new LifecycleError("deadline must be a timestamp (ms) or null");
    await this.store.setGameDeadline(gameId, deadlineAt);
  }

  /** The firm's standing plan for the current round, as the client's draft seed (DW-048):
   *  a reload no longer falls back to house defaults — it picks up what the firm is
   *  actually trading on. Same record the merge base + no-show carry use. */
  async getStandingDecision(gameId: string, teamId: string): Promise<FirmDecision | null> {
    const game = await this.requireGame(gameId);
    const team = await this.store.getTeam(teamId);
    if (!team || team.game_id !== gameId) return null;
    const round = game.current_round;
    const ws = (await this.store.getWorldState(gameId, round)) ?? (await this.store.getLatestWorldState(gameId));
    return this.standingDecision(gameId, round, teamId, team.firm_id, ws?.state ?? null, game.config);
  }

  /** Instructor roster view (DW-048): every chair on every firm with its live submit state,
   *  keyed by user id so the console can remove or move a member. */
  async getRoster(gameId: string): Promise<{ teamId: string; firmId: FirmId; name: string; members: { userId: string; name: string; externalId: string | null; claim: string | null; role: string | null; submitted: boolean; updatedAt: number | null }[] }[]> {
    const game = await this.requireGame(gameId);
    const out = [];
    for (const team of await this.store.getTeams(gameId)) {
      const mds = await this.memberDecisions(gameId, game.current_round, team.id);
      const solo = game.firm_mode !== "team" ? await this.store.getDecision(gameId, game.current_round, team.id) : null;
      const roster = new Map((await this.store.getTeamMembers(team.id)).map((m) => [m.user_id, m])); // DW-065
      const members = [];
      for (const uid of team.member_user_ids) {
        const u = roster.get(uid);
        const md = mds.find((m) => m.user_id === uid);
        members.push({
          userId: uid, name: u?.display_name ?? "Player", externalId: u?.external_id ?? null,
          claim: u?.claim_code ?? null, // DW-049: instructor-only — so the console can re-issue a lost return code
          role: u?.role ?? null,
          submitted: game.firm_mode === "team" ? (md?.submitted ?? false) : (solo?.submitted ?? false),
          updatedAt: game.firm_mode === "team" ? (md?.updated_at ?? null) : (solo?.submitted_at ?? null),
        });
      }
      out.push({ teamId: team.id, firmId: team.firm_id, name: team.name, members });
    }
    return out;
  }

  /** DW-072 #5: every team's pending-round decision, seat by seat (instructor-only). Read-only.
   *  Read budget (the store serializes reads project-wide, ~110 ms each on Supabase, and the
   *  panel polls this): game + world + teams + two game-wide decision reads + one slice read per
   *  SEATED firm. Rosters come embedded in the team read; empty (NPC) firms cost nothing. */
  async getTeamDecisions(gameId: string): Promise<InstructorTeamDecisions> {
    const game = await this.requireGame(gameId);
    const round = game.current_round;
    const team_mode = game.firm_mode === "team";
    const ws = (await this.store.getWorldState(gameId, round)) ?? (await this.store.getLatestWorldState(gameId));
    const allTeams = await this.store.getTeams(gameId);
    const recs = new Map((await this.store.getDecisions(gameId, round)).map((d) => [d.team_id, d]));
    const priors = round > 0 ? new Map((await this.store.getDecisions(gameId, round - 1)).map((d) => [d.team_id, d])) : new Map<string, DecisionRecord>();
    const teams: InstructorTeamDecision[] = [];
    for (const team of allTeams) {
      const rec = recs.get(team.id) ?? null;
      if (!team.member_user_ids.length) { // an open slot / NPC: nothing to show, nothing to read
        teams.push({ teamId: team.id, firmId: team.firm_id, name: team.name, seats: [], standing: null, composed: rec?.decision ?? null, submitted: rec?.submitted ?? false, locked: rec?.locked ?? false });
        continue;
      }
      const firm = ws?.state.firms.find((f) => f.id === team.firm_id);
      const mds = team_mode ? (await this.memberDecisions(gameId, round, team.id)).filter((m) => team.member_user_ids.includes(m.user_id)) : [];
      const roster = new Map((team.members ?? (await this.store.getTeamMembers(team.id))).map((m) => [m.user_id, m]));
      const seats: InstructorTeamSeat[] = team.member_user_ids.map((uid) => {
        const u = roster.get(uid);
        const role = u?.role ?? null;
        const md = mds.find((m) => m.user_id === uid);
        // Solo firms have no seat slices: the one player's submission IS the decision record.
        if (!team_mode) return { userId: uid, name: u?.display_name ?? "Player", role, desk: "all", submitted: rec?.submitted ?? false, updatedAt: rec?.submitted_at ?? null, partial: rec?.submitted ? rec.decision : null };
        return {
          userId: uid, name: u?.display_name ?? "Player", role,
          desk: md?.desk ?? (role ? (ROLE_DESK[role] ?? "all") : null),
          submitted: md?.submitted ?? false, updatedAt: md?.updated_at ?? null, partial: md?.partial ?? null,
          ...(md?.touched ? { touched: md.touched } : {}),
        };
      });
      const standing = firm && firm.status === "active" ? await this.standingDecision(gameId, round, team.id, team.firm_id, ws?.state ?? null, game.config, priors.get(team.id) ?? null) : null;
      // "Will run" must be what lock WILL run. Lock re-composes an open team round from the slices,
      // so the stored record can lag them (two submits racing: the later compose read missed the
      // earlier slice). Compose live while the round is open; once locked, the record is the truth.
      let composed = rec?.decision ?? null;
      if (team_mode && standing && !rec?.locked && game.lifecycle === "open" && mds.length) {
        composed = ratchetBoughtInfo(mergeMemberDecisions(standing, mds.map((m) => ({ desk: (m.desk as never) ?? "all", partial: m.partial, updated_at: m.updated_at, touched: m.touched }))), rec);
      }
      teams.push({ teamId: team.id, firmId: team.firm_id, name: team.name, seats, standing, composed, submitted: rec?.submitted ?? mds.some((m) => m.submitted), locked: rec?.locked ?? false });
    }
    return { round, lifecycle: game.lifecycle, firmMode: game.firm_mode ?? "solo", teams };
  }

  /** Drop a member from their firm (DW-048): wrong-firm joins and dropped students used to be
   *  permanent — the chair stayed taken and the firm counted as "joined" forever. The member's
   *  slice for the open round is deleted and the firm's plan re-composed so nothing of theirs
   *  still trades. An emptied firm reverts to an NPC at the next lock (botFillEmptySlots). */
  async removeMember(gameId: string, teamId: string, userId: string): Promise<void> {
    const game = await this.requireGame(gameId);
    const team = await this.store.getTeam(teamId);
    if (!team || team.game_id !== gameId) throw new LifecycleError(`no team ${teamId} in game ${gameId}`);
    if (!team.member_user_ids.includes(userId)) throw new LifecycleError("that player is not on this firm");
    await this.store.removeTeamMember(teamId, userId);
    await this.store.deleteMemberDecision(gameId, game.current_round, userId);
    if (game.lifecycle === "open") {
      if (game.firm_mode === "team") await this.recomposeTeamDecisions(gameId, game);
      else {
        // Solo firm: the departing player's decision goes with them — the slot reads as
        // waiting (a new claimant submits fresh; otherwise NPC/carry fill at resolve).
        const existing = await this.store.getDecision(gameId, game.current_round, teamId);
        if (existing && !existing.locked) await this.store.deleteDecision(gameId, game.current_round, teamId);
      }
    }
  }

  /** Move a member to another firm's free chair (DW-048) — remove + seat, with the same
   *  guards a fresh join gets (cap, distinct chair). Team games only. */
  async moveMember(gameId: string, userId: string, toTeamId: string, role: string): Promise<void> {
    const game = await this.requireGame(gameId);
    if (game.firm_mode !== "team") throw new LifecycleError("move applies to team games (solo players re-join with their claim code)");
    if (!TEAM_ROLES.has(role)) throw new LifecycleError(`unknown seat "${role}"`);
    const teams = await this.store.getTeams(gameId);
    const from = teams.find((t) => t.member_user_ids.includes(userId));
    if (!from) throw new LifecycleError("that player is not in this game");
    const to = teams.find((t) => t.id === toTeamId);
    if (!to) throw new LifecycleError(`no team ${toTeamId} in game ${gameId}`);
    if (to.id === from.id) {
      await this.assertSeatFree(to, role, userId);
      await this.store.setMemberRole(to.id, userId, role);
    } else {
      if (to.member_user_ids.length >= MAX_SEATS_PER_FIRM) throw new LifecycleError(`"${to.name}" is full — all ${MAX_SEATS_PER_FIRM} C-suite seats are taken`);
      await this.assertSeatFree(to, role, userId);
      await this.removeMember(gameId, from.id, userId);
      await this.store.addTeamMember(to.id, userId);
      await this.store.setMemberRole(to.id, userId, role);
      if (to.member_user_ids.length === 0) await this.store.setTeamName(to.id, to.name); // keep the board name
    }
    // The seat's slice was deleted with the move; the old desk's levers no longer apply.
    await this.store.deleteMemberDecision(gameId, game.current_round, userId);
    if (game.lifecycle === "open") await this.recomposeTeamDecisions(gameId, game);
  }

  /**
   * Resolve the round (§5 Resolve): run the engine once over the full decision
   * set, append the new world state + results, write the research tables, advance
   * the clock. Effectively final once written (append-only).
   */
  async resolveRound(gameId: string, opts: { force?: boolean } = {}): Promise<{ round: number; lifecycle: GameRecord["lifecycle"] }> {
    const game = await this.requireGame(gameId);
    // `force` re-runs a resolve that died mid-way (a crash/timeout after the "resolving"
    // mark): every write below is idempotent on its natural key and the engine is
    // deterministic, so re-running produces the identical round. Without force a second
    // click while a resolve is in flight is still rejected.
    if (game.lifecycle !== "locked" && !(opts.force && game.lifecycle === "resolving")) throw new LifecycleError(`cannot resolve: round is "${game.lifecycle}", not locked`);
    await this.store.setGameLifecycle(gameId, "resolving", game.current_round);
    try {
      return await this.resolveRoundInner(gameId, game);
    } catch (e) {
      // Put the round back where the instructor can act on it (DW-046). Before this the
      // game stayed "resolving" forever with both Lock and Resolve disabled.
      try { await this.store.setGameLifecycle(gameId, "locked", game.current_round); } catch { /* keep the original error */ }
      throw e;
    }
  }

  private async resolveRoundInner(gameId: string, game: GameRecord): Promise<{ round: number; lifecycle: GameRecord["lifecycle"] }> {
    const round = game.current_round;
    const wsRec = await this.store.getWorldState(gameId, round);
    if (!wsRec) throw new LifecycleError(`missing world_state for round ${round}`);
    const world = wsRec.state;
    const config = game.config;
    const segmentIds = world.segments.map((s) => s.id);
    const teams = await this.store.getTeams(gameId);
    const teamByFirm = new Map(teams.map((t) => [t.firm_id, t]));

    // Fill in for non-submitting active firms so the research panel has a row for them.
    const submitted = await this.store.getDecisions(gameId, round);
    // DW-066: any record counts, not just submitted ones. A retried resolve (DW-046 `force`, or a
    // plain second click after the catch above put the round back to "locked") re-entered this loop
    // and re-upserted the fill-in rows it had written — which the adapters refuse because those rows
    // are locked. Every class game has at least one fill-in (an NPC slot or a no-show), so Retry
    // resolve never actually worked. A submitted:false record here can only be a fill-in from the
    // earlier attempt (submits always write submitted:true; recompose deletes sliceless records).
    const submittedFirms = new Set(submitted.map((d) => d.firm_id));
    for (const f of world.firms) {
      if (f.status !== "active" || submittedFirms.has(f.id)) continue;
      const team = teamByFirm.get(f.id);
      if (!team) continue;
      // An unclaimed slot plays as an adaptive NPC (when enabled), so a game with fewer
      // humans than firms stays lively. A CLAIMED team that missed the deadline keeps
      // trading on last quarter's standing plan (DW-039) — a brewery doesn't stop selling
      // beer because nobody filed paperwork, and zero-filling it (price 0 / presence 0)
      // cost a classroom team a whole quarter's revenue for one missed form. One-shot
      // moves (builds, hires, draws) do NOT repeat. `submitted: false` is still recorded,
      // so the non-submission signal for grading + research stays exact either way.
      let decision: FirmDecision;
      if (this.opts.botFillEmptySlots && team.member_user_ids.length === 0) {
        // NPC personality by NPC ORDINAL, not firm index (DW-046): unclaimed slots are the
        // last ones, and indexing leans by firm slot handed a 5-team class the three most
        // fragile personalities (aggressive / lean_ops / conservative — the ones that
        // decay into zombies in the full preset). The first NPCs now get the robust
        // leans (generalist, quality, cost, brand), so the field a class faces is competent.
        const myIdx = world.firms.findIndex((x) => x.id === f.id);
        const npcOrdinal = teams.filter((t) => t.member_user_ids.length === 0 && world.firms.findIndex((x) => x.id === t.firm_id) < myIdx).length;
        decision = decideAdaptive(ADAPTIVE_LEANS[npcOrdinal % ADAPTIVE_LEANS.length], f, world, config);
      } else if ((this.opts.noShowPolicy ?? "carry") === "carry") {
        decision = await this.standingDecision(gameId, round, team.id, f.id, world, config);
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
    const ranked = rankStandings(result.firm_results); // DW-071: survivors first
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
    // A deadline belongs to one round (DW-048).
    if (game.deadline_at != null) await this.store.setGameDeadline(gameId, null);
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
    const ranked = rankStandings(result.firm_results); // DW-071: survivors first
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
   *
   * DW-072 #8: the gamemaster (planted shocks, removed shocks, live triggers) edits the
   * PENDING round's stored world state in place, and that edited record is exactly what the
   * resolve consumed (migration 0008 then freezes it). So the stored world states ARE the
   * intervention record: before each round, replay lays the stored schedule over the
   * engine's (`gamemasterOverlay`) and reports the difference as `interventions`. Without
   * this a game with an instructor-fired shock (game 42b80c61, wire round 4) diverged from
   * that round on. Only the two gamemaster-writable fields are taken from storage; every
   * other field of the world still comes from the engine, so a real non-determinism still
   * shows up as a score mismatch.
   */
  async replay(gameId: string): Promise<{ ok: boolean; mismatches: string[]; interventions: GamemasterIntervention[] }> {
    const game = await this.requireGame(gameId);
    const results = await this.store.getRoundResults(gameId);
    const mismatches: string[] = [];
    const interventions: GamemasterIntervention[] = [];
    let world = initGame(game.config);
    for (const rr of results) {
      const stored = await this.store.getWorldState(gameId, rr.round);
      if (stored) {
        const o = gamemasterOverlay(world, stored.state, rr.round);
        world = o.world;
        if (o.intervention) {
          interventions.push(o.intervention);
          // The overlay trusts the stored schedule, so it must only trust what an instructor CAN
          // do: plant a (locked) shock, remove one, arm a live trigger. A shock whose fields
          // differ from the engine's own, or an unlocked one the engine never rolled, is not an
          // instructor action — it is a divergence (or a corrupted row) and must not pass.
          for (const id of o.intervention.changed) mismatches.push(`round ${o.intervention.round} shock ${id}: stored schedule differs from the engine's in place (no instructor action edits a shock)`);
          for (const sh of o.intervention.added) if (!sh.locked) mismatches.push(`round ${o.intervention.round} shock ${sh.id}: stored but neither engine-rolled nor instructor-planted`);
        }
      }
      const decisions = (await this.store.getDecisions(gameId, rr.round)).map((d) => d.decision);
      const { world: next, result } = engineResolve(world, decisions, game.config);
      for (const fr of result.firm_results) {
        const stored = rr.result.firm_results.find((x) => x.firm_id === fr.firm_id);
        if (!stored || Math.abs(stored.scorecard_cumulative - fr.scorecard_cumulative) > 1e-9 || Math.abs(stored.state.cash - fr.state.cash) > 1e-6) {
          mismatches.push(`round ${rr.round} firm ${fr.firm_id}: replay ${fr.scorecard_cumulative.toFixed(6)} / cash ${fr.state.cash.toFixed(0)} vs stored ${stored?.scorecard_cumulative.toFixed(6) ?? "—"} / cash ${stored?.state.cash.toFixed(0) ?? "—"}`);
        }
      }
      world = next;
    }
    return { ok: mismatches.length === 0, mismatches, interventions };
  }

  /** Public state anyone in the game may see: round, lifecycle, segment activity. */
  async getPublicState(gameId: string): Promise<{ round: number; lifecycle: GameRecord["lifecycle"]; segments: { id: SegmentId; D: number; active: boolean }[] }> {
    const game = await this.requireGame(gameId);
    const ws = await this.store.getLatestWorldState(gameId);
    // D = total addressable demand across every open market (matches RoundResult.market.D).
    const totals = ws ? segmentDemandTotals(ws.state, game.config) : new Map<SegmentId, number>();
    return { round: game.current_round, lifecycle: game.lifecycle, segments: (ws?.state.segments ?? []).map((s) => ({ id: s.id, D: totals.get(s.id) ?? s.D, active: s.active })) };
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
    const standings = rankStandings(last?.result.firm_results ?? []).map((f) => ({ firm_id: f.firm_id, score: f.scorecard_cumulative })); // DW-071: survivors first
    return { own, publishedResults: results.map((r) => r.round), standings: game.lifecycle === "open" && results.length === 0 ? [] : standings };
  }
}

/** What the instructor changed on one round's schedule, relative to what the engine alone
 *  would have carried into it (DW-072 #8). */
export interface GamemasterIntervention {
  round: number;
  /** Shocks on the stored schedule the engine did not put there (instructor-planted). */
  added: ScheduledShock[];
  /** Shocks the engine scheduled that the instructor removed. */
  removed: string[];
  /** Same id, different content (e.g. an edited magnitude). */
  changed: string[];
  /** Live triggers armed when this round resolved. */
  liveTriggers: string[];
}

/** Lay the stored round's gamemaster-writable fields (shock schedule + live triggers) over the
 *  engine's replayed world, and describe the difference. Pure; the input world is not mutated. */
export function gamemasterOverlay(replayed: WorldState, stored: WorldState, round: number): { world: WorldState; intervention: GamemasterIntervention | null } {
  // Canonical (sorted-key) JSON: Postgres jsonb reorders keys, so plain stringify would call every
  // stored shock "changed" on prod.
  const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
  const mine = new Map(replayed.shock_timeline.map((s) => [s.id, canon(s)]));
  const theirs = stored.shock_timeline ?? [];
  const theirIds = new Set(theirs.map((s) => s.id));
  const added = theirs.filter((s) => !mine.has(s.id));
  const changed = theirs.filter((s) => mine.has(s.id) && mine.get(s.id) !== canon(s)).map((s) => s.id);
  const removed = [...mine.keys()].filter((id) => !theirIds.has(id));
  const liveTriggers = [...(stored.live_triggers ?? [])];
  const world: WorldState = { ...replayed, shock_timeline: JSON.parse(JSON.stringify(theirs)), live_triggers: liveTriggers };
  const touched = added.length || removed.length || changed.length || liveTriggers.length;
  return { world, intervention: touched ? { round, added, removed, changed, liveTriggers } : null };
}
