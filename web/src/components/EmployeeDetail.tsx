import { useEffect, useState } from "react";
import type { Employee, EmployeeRoleConfig } from "drinkwars-engine";
import { Avatar, SkillStars } from "./People.js";
import { Button } from "./ui.js";
import { STOCK_LABEL, fmt } from "../labels.js";

const ROLE_SCENE: Record<string, string> = {
  head_brewer: "the brewhouse",
  brand_manager: "brand and marketing",
  operations_manager: "operations and the line",
  taproom_manager: "the taproom floor",
  finance_lead: "the finance desk",
  sales_director: "distribution and accounts",
};
const bio = (role: string, skill: number, first: string): string => {
  const seniority = skill >= 5 ? "a marquee veteran" : skill >= 4 ? "a seasoned hand" : skill >= 3 ? "a steady contributor" : skill >= 2 ? "an up-and-comer" : "a green hire";
  return `${first} is ${seniority} in ${ROLE_SCENE[role] ?? "the team"}, ${skill >= 3 ? "and a real asset when kept happy." : "with room to grow."}`;
};

/** Full-screen dossier for one of your people (spec §3.6): identity + bio, morale and
 *  its drivers, what they contribute, compensation vs. the market, and the actions. */
export function EmployeeDetail({ employee: e, role, roleLabel, raiseValue, onRaise, onFire, firing, onClose }: {
  employee: Employee;
  role?: EmployeeRoleConfig;
  roleLabel: string;
  raiseValue?: number;
  onRaise: (salary: number) => void;
  onFire: () => void;
  firing: boolean;
  onClose: () => void;
}) {
  const [raise, setRaise] = useState<string>(raiseValue ? String(raiseValue) : "");
  useEffect(() => {
    const onKey = (k: KeyboardEvent) => { if (k.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const market = role ? role.base_salary * (0.55 + 0.15 * e.skill) : e.salary;
  const stockLabel = role ? STOCK_LABEL[role.primary_stock as keyof typeof STOCK_LABEL] ?? role.primary_stock : "";
  const contrib = role ? e.skill * role.gain_per_skill * e.satisfaction : 0;
  const satPct = Math.round(e.satisfaction * 100);
  const satTone = e.satisfaction > 0.6 ? "var(--color-hop)" : e.satisfaction > 0.35 ? "var(--color-gold)" : "var(--color-brick)";
  const paidWell = e.salary >= market;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="card w-full max-w-lg overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Avatar seed={e.avatar_seed} name={e.name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="display text-xl leading-tight">{e.name}</div>
            <div className="flex items-center gap-2 text-[0.78rem] text-inksoft">{roleLabel} <SkillStars n={e.skill} /></div>
          </div>
          <button onClick={onClose} className="text-inksoft transition-colors hover:text-ink" aria-label="Close">✕</button>
        </div>

        <div className="grid gap-4 px-5 py-4">
          <p className="text-[0.82rem] italic leading-snug text-inksoft">{bio(e.role, e.skill, e.name.split(" ")[0])}</p>

          {/* Morale */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[0.7rem] uppercase tracking-[0.1em] text-inksoft">
              <span>Morale</span><span className="tnum">{satPct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-[2px] bg-line"><div className="h-full" style={{ width: `${satPct}%`, background: satTone }} /></div>
            <div className="mt-1.5 grid gap-0.5 text-[0.72rem]">
              <Driver good={paidWell} label={paidWell ? "Paid at or above market" : "Paid below market"} />
              <Driver good={e.tenure_rounds >= 3} label={e.tenure_rounds >= 3 ? `Settled in (${e.tenure_rounds} rounds)` : "Still new"} />
            </div>
          </div>

          {/* Contribution */}
          {role && (
            <div className="rounded-md border border-line bg-paper2/30 p-3 text-[0.8rem]">
              <span className="text-inksoft">Contribution</span>
              <div className="mt-0.5 text-ink">Raises <span className="font-semibold">{stockLabel}</span> by <span className="tnum font-semibold">+{contrib.toFixed(2)}</span>/round <span className="text-inksoft">(skill {e.skill} × morale)</span></div>
            </div>
          )}

          {/* Compensation */}
          <div>
            <div className="mb-1 text-[0.7rem] uppercase tracking-[0.1em] text-inksoft">Compensation</div>
            <div className="flex items-center justify-between text-[0.82rem]">
              <span className="text-inksoft">Current</span><span className="tnum text-ink">{fmt.money(e.salary)}/round</span>
            </div>
            <div className="flex items-center justify-between text-[0.82rem]">
              <span className="text-inksoft">Market rate</span><span className="tnum text-ink">{fmt.money(Math.round(market))}/round</span>
            </div>
            <label className="mt-2 flex items-center gap-2 text-[0.78rem]">
              <span className="text-inksoft">Raise to $</span>
              <input type="number" min={e.salary} value={raise} onChange={(ev) => setRaise(ev.target.value)} placeholder={String(e.salary)}
                className="tnum w-20 rounded border border-line bg-paper px-1.5 py-0.5 text-right text-[0.78rem]" />
              <Button onClick={() => onRaise(Math.max(0, +raise))} disabled={!raise || +raise <= e.salary}>Give raise</Button>
            </label>
          </div>

          <div className="flex items-center justify-between border-t border-line pt-3">
            <button onClick={onFire} className={`text-[0.78rem] font-semibold transition-colors ${firing ? "text-copperdeep" : "text-brick hover:opacity-80"}`}>
              {firing ? "↩ Keep them on" : "Let them go"}
            </button>
            <Button variant="ghost" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Driver({ good, label }: { good: boolean; label: string }) {
  return <div className="flex items-center gap-1.5"><span style={{ color: good ? "var(--color-hop)" : "var(--color-brick)" }}>{good ? "▲" : "▼"}</span><span className="text-inksoft">{label}</span></div>;
}
