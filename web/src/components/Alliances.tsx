import { useState } from "react";
import type { AgreementAction, AgreementTerms, ClauseAction, ClauseCondition, FirmDecision, GovernanceForm, SegmentId, TemplateId } from "drinkwars-engine";
import { TERM_BOUNDS } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_LABEL } from "../labels.js";
import { Button, Tag } from "./ui.js";
import { InfoDot } from "./InfoDot.js";

const FORM_LABEL: Record<GovernanceForm, string> = {
  relational: "Handshake",
  formal: "Formal contract",
  collective: "Collective (guild)",
};
const FORM_BLURB: Record<GovernanceForm, string> = {
  relational: "Trust-based, no paperwork. Walking away costs goodwill (employee & investor trust), not cash.",
  formal: "A binding contract. Breaking it pays a breach penalty — but clauses and renegotiation are available.",
  collective: "A multi-firm guild (3+). Powerful, but coordinated behavior draws antitrust scrutiny.",
};
const TEMPLATE_LABEL: Record<TemplateId, string> = {
  joint_marketing: "Joint marketing",
  capacity_coordination: "Capacity coordination",
  supply_share: "Supply sharing",
};
const TEMPLATE_BLURB: Record<TemplateId, string> = {
  joint_marketing: "Pool brand in one category — each partner borrows a share of the others' brand there.",
  capacity_coordination: "Restrain capacity together to firm up prices — but this is what trips antitrust.",
  supply_share: "Share inputs/infrastructure to cut each partner's unit cost.",
};
const COND_LABEL: Record<ClauseCondition, string> = {
  water_shock: "a water shock hits",
  harvest_shock: "a harvest shock hits",
  capacity_shock: "a packaging / CO₂ shock hits",
  partner_distress: "a partner falls into distress",
  segment_emerges: "a new category emerges",
};
const ACTION_LABEL: Record<ClauseAction, string> = {
  suspend: "pause the pact",
  terminate: "dissolve the pact",
  renegotiate: "open it for renegotiation",
};

const FORMS: GovernanceForm[] = ["relational", "formal", "collective"];
const TEMPLATES: TemplateId[] = ["joint_marketing", "capacity_coordination", "supply_share"];
const CONDS: ClauseCondition[] = ["water_shock", "harvest_shock", "capacity_shock", "partner_distress", "segment_emerges"];

// ── Negotiable terms (DW-037) ──────────────────────────────────────────────────
// Each template has ONE economic dial; a deal can also carry a sunset and a split
// of the formation cost. Bounds mirror engine TERM_BOUNDS (clamped again server-side).
const DIAL: Record<TemplateId, { label: string; std: number }> = {
  joint_marketing: { label: "Brand pooled", std: 0.3 },
  capacity_coordination: { label: "Capacity restrained", std: 0.2 },
  supply_share: { label: "Unit-cost cut", std: 0.1 },
};
const DURATIONS: (number | null)[] = [null, 4, 6, 8, 12];
const pctS = (v: number) => `${Math.round(v * 100)}%`;
const splitLabel = (split: number, proposerIsYou: boolean, proposerName: string) => {
  const who = proposerIsYou ? "You" : proposerName;
  return split >= 0.99 ? `${who} pay${proposerIsYou ? "" : "s"} the setup` : split <= 0.01 ? `partners pay the setup` : `setup split ${pctS(split)} / ${pctS(1 - split)}`;
};
/** One-line reading of a deal's terms (null terms ⇒ the standard config economics). */
const termsLine = (t: AgreementTerms | null | undefined, template: TemplateId): string => {
  const bits = [`${DIAL[template].label.toLowerCase()} ${pctS(t?.magnitude ?? DIAL[template].std)}`];
  bits.push(t?.duration_rounds ? `${t.duration_rounds}-round term` : "evergreen");
  return bits.join(" · ");
};

/** The negotiable-terms editor: the template's dial, a sunset, and (when the form has a
 *  real formation cost) who pays the setup. Used by propose, counter, and renegotiate. */
function TermsEditor({ template, form, terms, onChange }: { template: TemplateId; form: GovernanceForm; terms: AgreementTerms; onChange: (t: AgreementTerms) => void }) {
  const b = TERM_BOUNDS[template];
  const mag = terms.magnitude ?? DIAL[template].std;
  return (
    <div className="grid gap-1.5 rounded border border-line bg-paper/40 p-2">
      <div className="flex items-center justify-between gap-2 text-[0.68rem]">
        <span className="text-inksoft">{DIAL[template].label}</span>
        <span className="tnum font-semibold text-copperdeep">{pctS(mag)}{Math.abs(mag - DIAL[template].std) < 0.005 ? " · standard" : ""}</span>
      </div>
      <input type="range" min={b.min} max={b.max} step={0.01} value={mag} onChange={(e) => onChange({ ...terms, magnitude: +e.target.value })} />
      <div className="flex flex-wrap items-center gap-2 text-[0.68rem]">
        <span className="text-inksoft">Term</span>
        <select value={terms.duration_rounds == null ? "" : String(terms.duration_rounds)} onChange={(e) => onChange({ ...terms, duration_rounds: e.target.value === "" ? null : +e.target.value })} className="text-[0.68rem]">
          {DURATIONS.map((dur) => <option key={dur ?? "∞"} value={dur == null ? "" : dur}>{dur == null ? "evergreen" : `${dur} rounds`}</option>)}
        </select>
        {form !== "relational" && (
          <>
            <span className="text-inksoft">· setup cost</span>
            <select value={String(terms.cost_split ?? 1)} onChange={(e) => onChange({ ...terms, cost_split: +e.target.value })} className="text-[0.68rem]">
              <option value="1">proposer pays</option>
              <option value="0.5">split 50/50</option>
              <option value="0">partners pay</option>
            </select>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Alliances panel (MOD-A05 contingent contracts + MOD-A06 renegotiation, on top of
 * the base coopetition layer). Lets a human form a pact, attach contingent clauses,
 * and call / answer a renegotiation — the player-facing surface coopetition never had.
 * Only rendered when a coopetition module is enabled, so the base game is unchanged.
 */
export function Alliances({
  view,
  d,
  set,
}: {
  view: GameView;
  d: FirmDecision;
  set: (patch: Partial<FirmDecision>) => void;
}) {
  const ccOn = !!view.modules?.contingentContracts?.enabled;
  const renegOn = !!view.modules?.renegotiation?.enabled;
  const maxClauses = view.modules?.contingentContracts?.max_clauses_per_agreement ?? 2;
  const activeSegs = view.segments.filter((s) => s.active).map((s) => s.id);
  const rivals = view.standings.filter((s) => !s.isYou && s.status === "active");

  const actions: AgreementAction[] = d.agreement_actions ?? [];
  const setActions = (next: AgreementAction[]) => set({ agreement_actions: next });
  const actionFor = (agId: string) => actions.find((a) => a.agreement_id === agId);
  const setAgAction = (agId: string, action: AgreementAction | null) =>
    setActions([...actions.filter((a) => a.agreement_id !== agId), ...(action ? [action] : [])]);
  // Pending-proposal responses key on proposal_id (mutual-consent formation).
  const proposalActionFor = (pid: string) => actions.find((a) => a.proposal_id === pid);
  const setProposalAction = (pid: string, action: AgreementAction | null) =>
    setActions([...actions.filter((a) => a.proposal_id !== pid), ...(action ? [action] : [])]);
  const formAction = actions.find((a) => a.type === "form");
  const setFormAction = (action: AgreementAction | null) =>
    setActions([...actions.filter((a) => a.type !== "form"), ...(action ? [action] : [])]);

  // --- "Form a new alliance" draft ---
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<GovernanceForm>("formal");
  const [template, setTemplate] = useState<TemplateId>("supply_share");
  const [partners, setPartners] = useState<string[]>([]);
  const [segment, setSegment] = useState<SegmentId>(activeSegs[0] ?? "niche");
  const [clauses, setClauses] = useState<{ condition: ClauseCondition; action: ClauseAction }[]>([]);
  const [terms, setTerms] = useState<AgreementTerms>({});
  // Counter-offers: per-proposal draft terms while the counter editor is open.
  const [counterDraft, setCounterDraft] = useState<Record<string, AgreementTerms>>({});
  const clausesAllowed = ccOn && (form === "formal" || form === "collective");

  const togglePartner = (id: string) => setPartners((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const commitForm = () => {
    const action: AgreementAction = {
      type: "form", form, template, counterparties: partners,
      segment: template === "joint_marketing" ? segment : undefined,
      clauses: clausesAllowed && clauses.length ? clauses.map((c) => ({ condition: c.condition, action: c.action })) : undefined,
      terms: Object.keys(terms).length ? terms : undefined,
    };
    setFormAction(action);
    setShowForm(false);
  };
  const minPartners = form === "collective" ? 2 : 1; // +you ⇒ 3 / 2 signatories
  const canCommit = partners.length >= minPartners;

  return (
    <div className="grid gap-3">
      {/* Active alliances */}
      {view.agreements.length === 0 ? (
        <div className="text-[0.72rem] text-inksoft">No active alliances. Propose one below — pool brand, coordinate capacity, or share supply with a rival.</div>
      ) : (
        <div className="grid gap-2">
          {view.agreements.map((a) => {
            // A pending PROPOSAL (mutual consent) renders its own card: the counterparty
            // gets Accept / Decline; the proposer sees who they're waiting on.
            if (a.proposal) {
              const p = a.proposal;
              const q = proposalActionFor(a.id);
              return (
                <div key={a.id} className="rounded-md border border-copper/50 bg-copper/5 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Tag tone="copper">Proposal</Tag>
                    <span className="text-[0.8rem] font-semibold">{TEMPLATE_LABEL[a.template]}</span>
                    <Tag tone="ink">{FORM_LABEL[a.form]}</Tag>
                    {a.segment && <Tag tone="ink">{SEG_LABEL[a.segment] ?? a.segment}</Tag>}
                  </div>
                  <div className="mt-0.5 text-[0.7rem] text-inksoft">
                    {p.proposerIsYou
                      ? <>You proposed this to {a.partnerNames.join(", ")} — awaiting {p.awaitingNames.join(", ") || "no one"}. Lapses after round {p.expiresRound + 1} unanswered.</>
                      : <>{p.proposerName} proposes this pact with you{a.partnerNames.length > 1 ? ` (and ${a.partnerNames.filter((n) => n !== p.proposerName).join(", ")})` : ""}. Nothing binds until you agree.</>}
                    {p.counters > 0 && <span className="text-copperdeep"> · counter #{p.counters}</span>}
                  </div>
                  {/* The terms ON THE TABLE — what you're actually agreeing to. */}
                  <div className="mt-1 text-[0.68rem] text-ink">
                    <span className="font-mono text-[0.56rem] uppercase tracking-wide text-copperdeep">Terms </span>
                    {termsLine(a.terms, a.template)}
                    {a.form !== "relational" && <span className="text-inksoft"> · {splitLabel(a.terms?.cost_split ?? 1, p.proposerIsYou, p.proposerName)}</span>}
                  </div>
                  {a.clauses.length > 0 && (
                    <div className="mt-1 grid gap-0.5">
                      {a.clauses.map((cl, i) => (
                        <div key={i} className="text-[0.66rem] text-inksoft">↳ if {COND_LABEL[cl.condition]}, {ACTION_LABEL[cl.action]}</div>
                      ))}
                    </div>
                  )}
                  {p.youMustRespond ? (
                    <div className="mt-1.5">
                      <div className="flex flex-wrap gap-1.5">
                        <Button onClick={() => setProposalAction(a.id, q?.type === "accept_proposal" ? null : { type: "accept_proposal", proposal_id: a.id })}
                          variant={q?.type === "accept_proposal" ? "go" : "solid"} className="px-3 py-1 text-[0.7rem]">
                          {q?.type === "accept_proposal" ? "Accepting ✓" : "Accept"}
                        </Button>
                        {/* Counter with revised terms: roles swap — the ball goes back to them. */}
                        {p.counterable && (
                          <Button onClick={() => { if (q?.type === "counter_proposal") { setProposalAction(a.id, null); } else if (counterDraft[a.id]) { const { [a.id]: _x, ...rest } = counterDraft; setCounterDraft(rest); } else { setCounterDraft({ ...counterDraft, [a.id]: { magnitude: a.terms?.magnitude ?? DIAL[a.template].std, duration_rounds: a.terms?.duration_rounds ?? null, cost_split: a.terms?.cost_split ?? 1 } }); } }}
                            variant={q?.type === "counter_proposal" ? "go" : "solid"} className="px-3 py-1 text-[0.7rem]">
                            {q?.type === "counter_proposal" ? "Countering ✓" : counterDraft[a.id] ? "Close counter" : "Counter…"}
                          </Button>
                        )}
                        <Button onClick={() => setProposalAction(a.id, q?.type === "decline_proposal" ? null : { type: "decline_proposal", proposal_id: a.id })}
                          variant={q?.type === "decline_proposal" ? "go" : "ghost"} className="px-3 py-1 text-[0.7rem]">
                          {q?.type === "decline_proposal" ? "Declining ✓" : "Decline"}
                        </Button>
                      </div>
                      {counterDraft[a.id] && q?.type !== "counter_proposal" && (
                        <div className="mt-1.5 grid gap-1.5">
                          <TermsEditor template={a.template} form={a.form} terms={counterDraft[a.id]} onChange={(t) => setCounterDraft({ ...counterDraft, [a.id]: t })} />
                          <div className="flex items-center gap-2">
                            <Button variant="go" className="px-3 py-1 text-[0.68rem]" onClick={() => { setProposalAction(a.id, { type: "counter_proposal", proposal_id: a.id, terms: counterDraft[a.id] }); const { [a.id]: _x, ...rest } = counterDraft; setCounterDraft(rest); }}>Send counter-offer</Button>
                            <span className="text-[0.62rem] text-inksoft">countering makes YOU the proposer — "proposer pays" then means you pay the setup</span>
                          </div>
                        </div>
                      )}
                      {q?.type === "counter_proposal" && (
                        <div className="mt-1 text-[0.68rem] text-copperdeep">Countering with: {termsLine(q.terms, a.template)}{a.form !== "relational" ? ` · ${splitLabel(q.terms?.cost_split ?? 1, true, p.proposerName)}` : ""} — they must accept your terms.</div>
                      )}
                    </div>
                  ) : !p.proposerIsYou ? (
                    <div className="mt-1.5 text-[0.7rem] text-copperdeep">You've accepted — awaiting {p.awaitingNames.join(", ")}.</div>
                  ) : null}
                </div>
              );
            }
            const queued = actionFor(a.id);
            const openRenegForMe = a.reneg?.open && !a.reneg.callerIsYou;
            const iCalledReneg = a.reneg?.open && a.reneg.callerIsYou;
            return (
              <div key={a.id} className="rounded-md border border-line bg-paper2/40 p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[0.8rem] font-semibold">{TEMPLATE_LABEL[a.template]}</span>
                  <Tag tone="copper">{FORM_LABEL[a.form]}</Tag>
                  {a.segment && <Tag tone="ink">{SEG_LABEL[a.segment] ?? a.segment}</Tag>}
                  {a.suspendedUntil != null && <Tag tone="brick">suspended → r{a.suspendedUntil + 1}</Tag>}
                </div>
                <div className="mt-0.5 text-[0.7rem] text-inksoft">with {a.partnerNames.join(", ") || "—"} · <span className="text-ink">{termsLine(a.terms, a.template)}</span></div>
                {a.clauses.length > 0 && (
                  <div className="mt-1 grid gap-0.5">
                    {a.clauses.map((cl, i) => (
                      <div key={i} className={`text-[0.66rem] ${cl.fired ? "text-brick" : "text-inksoft"}`}>
                        ↳ if {COND_LABEL[cl.condition]}, {ACTION_LABEL[cl.action]}{cl.fired ? " — fired" : ""}
                      </div>
                    ))}
                  </div>
                )}

                {/* Renegotiation status / response */}
                {iCalledReneg && <div className="mt-1.5 text-[0.7rem] text-copperdeep">Renegotiation called — awaiting {a.partnerNames.join(", ")}.</div>}
                {openRenegForMe && (
                  <div className="mt-1.5 rounded border border-copper/40 bg-copper/5 p-2">
                    <div className="text-[0.72rem] font-semibold">{a.reneg!.callerName} wants to renegotiate{a.reneg!.proposedTemplate ? ` → switch to ${TEMPLATE_LABEL[a.reneg!.proposedTemplate]}` : ""}.</div>
                    {a.reneg!.proposedTerms && <div className="mt-0.5 text-[0.68rem] text-inksoft">New terms on the table: <span className="text-ink">{termsLine(a.reneg!.proposedTerms, a.reneg!.proposedTemplate ?? a.template)}</span></div>}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(["accept", "reject", "exit"] as const).map((r) => (
                        <Button key={r} onClick={() => setAgAction(a.id, { type: "renegotiate_response", agreement_id: a.id, response: r })}
                          variant={queued?.type === "renegotiate_response" && queued.response === r ? "go" : "solid"} className="px-3 py-1 text-[0.7rem] capitalize">
                          {r === "exit" ? "Exit (reduced penalty)" : r}{queued?.type === "renegotiate_response" && queued.response === r ? " ✓" : ""}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Your actions on this pact */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {!a.reneg?.open && (
                    <Button onClick={() => setAgAction(a.id, queued?.type === "defect" ? null : { type: "defect", agreement_id: a.id })}
                      variant={queued?.type === "defect" ? "go" : "ghost"} className="px-3 py-1 text-[0.7rem]">
                      {queued?.type === "defect" ? "Walking away ✓" : "Walk away"}
                    </Button>
                  )}
                  {renegOn && !a.reneg?.open && !a.renegUsed && (a.form === "formal" || a.form === "collective") && (
                    queued?.type === "renegotiate" ? (
                      <div className="grid w-full gap-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[0.7rem] text-copperdeep">Propose switch to</span>
                          <select value={queued.proposed_template ?? a.template}
                            onChange={(e) => setAgAction(a.id, { ...queued, proposed_template: e.target.value as TemplateId })}
                            className="text-[0.7rem]">
                            {TEMPLATES.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>)}
                          </select>
                          {/* Joint marketing pools brand in ONE category — the switch needs to name it. */}
                          {(queued.proposed_template ?? a.template) === "joint_marketing" && (
                            <select value={queued.proposed_segment ?? a.segment ?? activeSegs[0]}
                              onChange={(e) => setAgAction(a.id, { ...queued, proposed_segment: e.target.value })}
                              className="text-[0.7rem]">
                              {activeSegs.map((s) => <option key={s} value={s}>{SEG_LABEL[s] ?? s}</option>)}
                            </select>
                          )}
                          <button className="text-[0.66rem] text-inksoft underline hover:text-ink" onClick={() => setAgAction(a.id, null)}>cancel</button>
                        </div>
                        {/* Revised economics ride along with the call (partner sees them before answering). */}
                        <TermsEditor template={(queued.proposed_template ?? a.template) as TemplateId} form={a.form}
                          terms={queued.proposed_terms ?? { magnitude: a.terms?.magnitude ?? DIAL[(queued.proposed_template ?? a.template) as TemplateId].std, duration_rounds: a.terms?.duration_rounds ?? null }}
                          onChange={(t) => setAgAction(a.id, { ...queued, proposed_terms: t })} />
                      </div>
                    ) : (
                      <Button onClick={() => setAgAction(a.id, { type: "renegotiate", agreement_id: a.id, proposed_template: a.template })}
                        variant="solid" className="px-3 py-1 text-[0.7rem]">Renegotiate…</Button>
                    )
                  )}
                  {a.renegUsed && !a.reneg?.open && <span className="text-[0.64rem] text-inksoft">renegotiation spent</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form a new alliance */}
      {rivals.length > 0 && (
        <div className="border-t border-line pt-2">
          {!showForm && !formAction && (
            <Button onClick={() => setShowForm(true)} variant="solid" className="px-3 py-1 text-[0.72rem]">Propose an alliance →</Button>
          )}
          {formAction && !showForm && (
            <div className="flex items-center justify-between gap-2 text-[0.72rem]">
              <span>Proposing a {FORM_LABEL[formAction.form!].toLowerCase()} {TEMPLATE_LABEL[formAction.template!].toLowerCase()} with {(formAction.counterparties ?? []).map((id) => view.standings.find((s) => s.firm_id === id)?.name ?? id).join(", ")}{formAction.clauses?.length ? ` · ${formAction.clauses.length} clause(s)` : ""} — they must accept before it binds.</span>
              <button className="text-inksoft underline hover:text-ink" onClick={() => setFormAction(null)}>cancel</button>
            </div>
          )}
          {showForm && (
            <div className="grid gap-2 rounded-md border border-line bg-paper2/40 p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[0.78rem] font-semibold">Propose an alliance</span>
                <InfoDot title="Coopetition">The governance form is the real choice — a handshake costs trust to break, a formal contract costs cash but supports clauses & renegotiation, a guild is powerful but draws antitrust.</InfoDot>
              </div>
              <label className="text-[0.7rem] text-inksoft">Governance form</label>
              <div className="flex flex-wrap gap-1.5">
                {FORMS.map((fm) => (
                  <button key={fm} type="button" onClick={() => setForm(fm)}
                    className={`rounded-full border px-2.5 py-1 text-[0.7rem] ${form === fm ? "border-copper bg-copper/10 text-copperdeep" : "border-line2 text-inksoft hover:border-copper"}`}>
                    {FORM_LABEL[fm]}
                  </button>
                ))}
              </div>
              <div className="text-[0.64rem] leading-snug text-inksoft">{FORM_BLURB[form]}</div>
              <label className="text-[0.7rem] text-inksoft">What you coordinate</label>
              <div className="flex flex-wrap gap-1.5">
                {TEMPLATES.map((t) => (
                  <button key={t} type="button" onClick={() => setTemplate(t)}
                    className={`rounded-full border px-2.5 py-1 text-[0.7rem] ${template === t ? "border-copper bg-copper/10 text-copperdeep" : "border-line2 text-inksoft hover:border-copper"}`}>
                    {TEMPLATE_LABEL[t]}
                  </button>
                ))}
              </div>
              <div className="text-[0.64rem] leading-snug text-inksoft">{TEMPLATE_BLURB[template]}</div>
              {template === "joint_marketing" && (
                <div className="flex items-center gap-2">
                  <label className="text-[0.7rem] text-inksoft">Category</label>
                  <select value={segment} onChange={(e) => setSegment(e.target.value)} className="text-[0.72rem]">
                    {activeSegs.map((s) => <option key={s} value={s}>{SEG_LABEL[s] ?? s}</option>)}
                  </select>
                </div>
              )}
              <label className="text-[0.7rem] text-inksoft">The terms <span className="text-[0.62rem]">· hammer out the economics — partners can accept, decline, or counter</span></label>
              <TermsEditor template={template} form={form} terms={terms} onChange={setTerms} />
              <label className="text-[0.7rem] text-inksoft">Partners {form === "collective" ? "(pick 2+ for a guild)" : "(pick 1+)"}</label>
              <div className="flex flex-wrap gap-1.5">
                {rivals.map((r) => (
                  <button key={r.firm_id} type="button" onClick={() => togglePartner(r.firm_id)}
                    className={`rounded-full border px-2.5 py-1 text-[0.7rem] ${partners.includes(r.firm_id) ? "border-copper bg-copper/10 text-copperdeep" : "border-line2 text-inksoft hover:border-copper"}`}>
                    {r.name}
                  </button>
                ))}
              </div>
              {clausesAllowed && (
                <div className="rounded border border-line bg-paper/40 p-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[0.72rem] font-semibold">Contingent clauses</span>
                    <InfoDot title="Contingent contracts">A clause fires automatically if its condition occurs — the contract adapts to a shock or a partner's distress without you having to act.</InfoDot>
                  </div>
                  {clauses.map((cl, i) => (
                    <div key={i} className="mt-1 flex flex-wrap items-center gap-1 text-[0.68rem]">
                      <span className="text-inksoft">if</span>
                      <select value={cl.condition} onChange={(e) => setClauses((cs) => cs.map((x, j) => (j === i ? { ...x, condition: e.target.value as ClauseCondition } : x)))} className="text-[0.68rem]">
                        {CONDS.map((c) => <option key={c} value={c}>{COND_LABEL[c]}</option>)}
                      </select>
                      <span className="text-inksoft">→</span>
                      <select value={cl.action} onChange={(e) => setClauses((cs) => cs.map((x, j) => (j === i ? { ...x, action: e.target.value as ClauseAction } : x)))} className="text-[0.68rem]">
                        <option value="suspend">{ACTION_LABEL.suspend}</option>
                        <option value="terminate">{ACTION_LABEL.terminate}</option>
                        {renegOn && <option value="renegotiate">{ACTION_LABEL.renegotiate}</option>}
                      </select>
                      <button className="text-inksoft underline hover:text-brick" onClick={() => setClauses((cs) => cs.filter((_, j) => j !== i))}>remove</button>
                    </div>
                  ))}
                  {clauses.length < maxClauses && (
                    <button className="mt-1 text-[0.68rem] text-copperdeep underline hover:text-ink" onClick={() => setClauses((cs) => [...cs, { condition: "harvest_shock", action: "suspend" }])}>+ add clause</button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button onClick={commitForm} variant="go" disabled={!canCommit} className="px-3 py-1 text-[0.72rem]">Add to this round</Button>
                <button className="text-[0.7rem] text-inksoft underline hover:text-ink" onClick={() => setShowForm(false)}>cancel</button>
                {!canCommit && <span className="text-[0.66rem] text-brick">pick {minPartners}+ partner{minPartners > 1 ? "s" : ""}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
