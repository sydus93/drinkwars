/**
 * Reconcile card (DW-050) — team firms only. Lists the levers where this seat and another
 * disagree, says who the merge favours, and offers "adopt theirs" (writes the value into
 * this form) or "keep mine / noted" (acknowledges for the round). Lives above the decision
 * form so nobody is surprised at lock.
 */
import { useState } from "react";
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { ackConflict, isAcked, leverText, type Conflict, type OffDeskEdit } from "../lib/reconcile.js";
const SEAT_LABEL: Record<string, string> = { ceo: "CEO", cfo: "CFO", cmo: "CMO", coo: "COO", chro: "CHRO" };
const DESK_LABEL: Record<string, string> = { commercial: "CMO", operations: "COO", people: "CHRO", finance: "CFO", strategy: "CEO" };

export function Reconcile({ view, conflicts, offDesk = [], seatRole, onAdopt }: { view: GameView; conflicts: Conflict[]; offDesk?: OffDeskEdit[]; seatRole: string; onAdopt: (field: keyof FirmDecision, value: unknown) => void }) {
  const [, bump] = useState(0);
  const t = (f: keyof FirmDecision, v: unknown) => leverText(String(f), v, view);
  const open = conflicts.filter((c) => !isAcked(c));
  const noted = conflicts.length - open.length;
  if (!conflicts.length && !offDesk.length) return null;
  const isCeo = seatRole === "ceo";
  const hot = open.length > 0 || offDesk.length > 0;
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: hot ? "var(--color-gold)" : "var(--color-line2)", background: hot ? "color-mix(in srgb, var(--color-gold) 10%, var(--color-panel))" : "var(--color-panel)" }}>
      {offDesk.length > 0 && (
        <div className="mb-1.5 grid gap-1">
          <div className="text-[0.84rem] text-ink"><b className="text-brick">Not your desk.</b> These levers belong to another chair. {offDesk.some((e) => e.applies) ? "That chair is empty, so what you set here counts — the CEO will see it and can change it." : "The chair that owns them decides; your value is only a suggestion until you talk to them."}</div>
          {offDesk.map((e) => (
            <div key={String(e.field)} className="grid gap-0.5 border-t border-line pt-1 text-[0.88rem]">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold text-ink">{e.label}</span>
                <span className="text-inksoft">— the {e.deskOwner}'s desk{e.ownerName ? ` (${e.ownerName})` : e.ceoSeated ? " (empty — the CEO covers it)" : " (empty, and no CEO seated)"}</span>
                <span className="flex-1" />
                <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide ${e.applies ? "border-hop/60 text-hop" : "border-brick/60 text-brick"}`}>{e.applies ? "yours will be used" : `${e.deskOwner} decides`}</span>
                <button onClick={() => onAdopt(e.field, e.firm)} className="rounded-md border border-line2 px-2 py-0.5 font-mono text-[0.66rem] uppercase tracking-wide text-inksoft hover:text-ink">Put back firm's value</button>
              </div>
              <div className="text-inksoft">You set: <b className="text-ink">{t(e.field, e.mine)}</b> · Firm's plan: <b className="text-ink">{t(e.field, e.firm)}</b></div>
            </div>
          ))}
        </div>
      )}
      {conflicts.length > 0 && (<>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.64rem] font-bold uppercase tracking-[0.12em] text-copperdeep">Reconcile · {open.length ? `${open.length} open` : "all noted"}{noted ? ` · ${noted} noted` : ""}</span>
        <span className="text-[0.84rem] text-inksoft">
          {isCeo
            ? "Teammates have submitted values that differ from your form. On their own desk, theirs is used. Where they covered an empty chair, theirs is used unless you submit again after them. A suggestion for a seated teammate's desk is that officer's call."
            : "Your desk is yours: your value is used at lock, not anyone else's. Adopt a teammate's number if you agree, or keep yours and tell them."}
        </span>
      </div>
      {open.length > 0 && (
        <div className="mt-1.5 grid gap-1">
          {open.map((c) => {
          // The lever belongs to a SEATED teammate: nothing anyone clicks here changes what
          // resolves at lock. Offering "Take theirs / Noted" staged a decision that does not
          // exist — it read as approve/deny and it was neither. This row is a NOTIFICATION.
          // The way to change the value is to go and ask that officer to re-submit it.
          const ownersCall = !c.suggestion && !c.cover && c.winner === "them";
          return (
            <div key={c.key} className="grid gap-0.5 border-t border-line pt-1 text-[0.88rem]">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold text-ink">{c.label}</span>
                <span className="text-inksoft">{c.suggestion
                  ? `— ${SEAT_LABEL[c.whoRole] ?? c.whoRole.toUpperCase()} ${c.who} suggests this for YOUR desk`
                  : c.cover?.ownerName
                    ? `— ${SEAT_LABEL[c.whoRole] ?? c.whoRole.toUpperCase()} ${c.who} suggests this for the ${DESK_LABEL[c.cover.desk] ?? c.cover.desk}'s desk (${c.cover.ownerName})`
                    : c.cover
                      ? `— ${SEAT_LABEL[c.whoRole] ?? c.whoRole.toUpperCase()} ${c.who} set this for the empty ${DESK_LABEL[c.cover.desk] ?? c.cover.desk} desk`
                      : `— ${SEAT_LABEL[c.whoRole] ?? c.whoRole.toUpperCase()} ${c.who}${isCeo ? "'s desk" : " (CEO)"}`}</span>
                <span className="flex-1" />
                <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[0.62rem] uppercase tracking-wide ${c.winner === "me" ? "border-hop/60 text-hop" : "border-brick/60 text-brick"}`}>{c.suggestion
                  ? "your call — yours is used"
                  : c.cover?.ownerName
                    ? (c.cover.ownerSubmitted ? `the ${DESK_LABEL[c.cover.desk] ?? c.cover.desk} decides` : `theirs, unless the ${DESK_LABEL[c.cover.desk] ?? c.cover.desk} submits`)
                    : c.cover
                      ? (c.winner === "me" ? "yours — you submitted after them" : "theirs, unless you submit again")
                      : c.winner === "me" ? "yours will be used" : "theirs will be used"}</span>
                {!ownersCall && !(c.cover?.ownerName) && <button onClick={() => { onAdopt(c.field, c.theirs); ackConflict(c); bump((n) => n + 1); }} className="rounded-md border border-copper px-2 py-0.5 font-mono text-[0.66rem] font-bold uppercase tracking-wide text-copperdeep hover:bg-copper/10">{c.suggestion ? "Adopt their suggestion" : c.cover ? "OK, keep theirs" : "Take theirs"}</button>}
                <button onClick={() => { ackConflict(c); bump((n) => n + 1); }} className="rounded-md border border-line2 px-2 py-0.5 font-mono text-[0.66rem] uppercase tracking-wide text-inksoft hover:text-ink">{ownersCall ? "Got it" : c.suggestion ? "Keep mine" : c.cover?.ownerName ? "Noted" : c.cover ? "Keep mine (submit to overrule)" : c.winner === "me" ? "Keep mine" : "Noted"}</button>
              </div>
              <div className="text-inksoft">{c.who} set: <b className="text-ink">{t(c.field, c.theirs)}</b> · You have: <b className="text-ink">{t(c.field, c.mine)}</b>
                {ownersCall && <span className="italic"> — this lever is theirs; to change it, ask {c.who} to set it and submit again.</span>}</div>
            </div>
          ); })}
        </div>
      )}
      </>)}
    </div>
  );
}
