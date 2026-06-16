import { useState } from "react";
import type { AgreementAction, ClauseAction, ClauseCondition, FirmDecision, GovernanceForm, SegmentId, TemplateId } from "drinkwars-engine";
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
  const clausesAllowed = ccOn && (form === "formal" || form === "collective");

  const togglePartner = (id: string) => setPartners((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const commitForm = () => {
    const action: AgreementAction = {
      type: "form", form, template, counterparties: partners,
      segment: template === "joint_marketing" ? segment : undefined,
      clauses: clausesAllowed && clauses.length ? clauses.map((c) => ({ condition: c.condition, action: c.action })) : undefined,
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
                <div className="mt-0.5 text-[0.7rem] text-inksoft">with {a.partnerNames.join(", ") || "—"}</div>
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
                      <div className="flex items-center gap-1.5">
                        <span className="text-[0.7rem] text-copperdeep">Propose switch to</span>
                        <select value={queued.proposed_template ?? a.template}
                          onChange={(e) => setAgAction(a.id, { ...queued, proposed_template: e.target.value as TemplateId })}
                          className="text-[0.7rem]">
                          {TEMPLATES.map((t) => <option key={t} value={t}>{TEMPLATE_LABEL[t]}</option>)}
                        </select>
                        <button className="text-[0.66rem] text-inksoft underline hover:text-ink" onClick={() => setAgAction(a.id, null)}>cancel</button>
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
              <span>Proposing a {FORM_LABEL[formAction.form!].toLowerCase()} {TEMPLATE_LABEL[formAction.template!].toLowerCase()} with {(formAction.counterparties ?? []).map((id) => view.standings.find((s) => s.firm_id === id)?.name ?? id).join(", ")}{formAction.clauses?.length ? ` · ${formAction.clauses.length} clause(s)` : ""}.</span>
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
