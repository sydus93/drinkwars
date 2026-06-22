import { useEffect, useState } from "react";
import type { Facility, FacilityTypeConfig } from "drinkwars-engine";
import { Button } from "./ui.js";
import { fmt } from "../labels.js";

/** Full-screen view of one owned facility (spec §3.4): condition + projection,
 *  what it contributes, its cost, and the maintenance / mothball actions. */
export function FacilityDetail({ facility: f, type: t, round, maintainValue, onMaintain, active, onToggleActive, onClose }: {
  facility: Facility;
  type?: FacilityTypeConfig;
  round: number;
  maintainValue?: number;
  onMaintain: (spend: number) => void;
  active: boolean;
  onToggleActive: () => void;
  onClose: () => void;
}) {
  const [spend, setSpend] = useState<string>(maintainValue ? String(maintainValue) : "");
  useEffect(() => {
    const onKey = (k: KeyboardEvent) => { if (k.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const online = round >= f.online_round;
  const condPct = Math.round(f.condition * 100);
  const condTone = f.condition > 0.6 ? "var(--color-hop)" : f.condition > 0.35 ? "var(--color-gold)" : "var(--color-brick)";
  const liveCap = t ? Math.round(t.capacity_contribution * (0.5 + 0.5 * f.condition)) : 0;
  const spendN = Math.max(0, +spend || 0);
  // Project next round's condition at the entered upkeep.
  const projCond = t ? Math.max(0, Math.min(1, f.condition - t.condition_decay + spendN * t.maintenance_effect)) : f.condition;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="card w-full max-w-lg overflow-hidden">
        <div className="h-2 w-full" style={{ background: condTone }} />
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="display text-xl leading-tight">{f.name}</div>
            <div className="text-[0.78rem] text-inksoft">{t?.label ?? f.type} · {online ? "operational" : `online round ${f.online_round + 1}`}{!active && " · mothballed"}</div>
          </div>
          <button onClick={onClose} className="text-inksoft transition-colors hover:text-ink" aria-label="Close">✕</button>
        </div>

        <div className="grid gap-4 px-5 py-4">
          {/* Condition */}
          <div>
            <div className="mb-1 flex items-center justify-between text-[0.7rem] uppercase tracking-[0.1em] text-inksoft">
              <span>Condition</span><span className="tnum">{condPct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-[2px] bg-line"><div className="h-full" style={{ width: `${condPct}%`, background: condTone }} /></div>
            <div className="mt-1 text-[0.72rem] text-inksoft">At {fmt.money(spendN)} upkeep, next round ≈ <span className="tnum">{Math.round(projCond * 100)}%</span>{t && projCond < f.condition ? " (still slipping — add upkeep)" : ""}</div>
          </div>

          {/* Output + cost */}
          <div className="grid grid-cols-2 gap-3 text-[0.82rem]">
            <div className="rounded-md border border-line bg-paper2/30 p-3">
              <div className="text-inksoft">Capacity</div>
              <div className="tnum mt-0.5 text-lg font-semibold text-ink">{online && active ? `+${fmt.int(liveCap)}` : "—"}<span className="text-[0.7rem] font-normal text-inksoft"> tanks</span></div>
              {t && <div className="text-[0.66rem] text-inksoft">full: {fmt.int(t.capacity_contribution)}</div>}
            </div>
            <div className="rounded-md border border-line bg-paper2/30 p-3">
              <div className="text-inksoft">Fixed cost</div>
              <div className="tnum mt-0.5 text-lg font-semibold text-ink">{active ? fmt.money(t?.fixed_cost ?? 0) : "—"}<span className="text-[0.7rem] font-normal text-inksoft">/rd</span></div>
              <div className="text-[0.66rem] text-inksoft">rent + upkeep baseline</div>
            </div>
          </div>

          {/* Maintenance */}
          {active && online && (
            <label className="flex items-center gap-2 text-[0.8rem]">
              <span className="text-inksoft">Upkeep this round $</span>
              <input type="number" min={0} value={spend} onChange={(ev) => setSpend(ev.target.value)} placeholder="0"
                className="tnum w-20 rounded border border-line bg-paper px-1.5 py-0.5 text-right text-[0.8rem]" />
              <Button onClick={() => onMaintain(spendN)}>Set upkeep</Button>
            </label>
          )}

          <div className="flex items-center justify-between border-t border-line pt-3">
            <button onClick={onToggleActive} className="text-[0.78rem] font-semibold text-inksoft transition-colors hover:text-copperdeep">
              {active ? "Mothball (stop cost + output)" : "Reactivate"}
            </button>
            <Button variant="ghost" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
