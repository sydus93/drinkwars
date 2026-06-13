import type { RoleBriefing } from "drinkwars-engine";
import { Card, Eyebrow, Tag } from "./ui.js";
import { InfoDot } from "./InfoDot.js";

const ROLE_TONE: Record<RoleBriefing["role"], "copper" | "hop" | "ink" | "brick"> = {
  cfo: "copper",
  cmo: "hop",
  coo: "ink",
  ceo: "brick",
};

/** MOD-B05 — the round's role-tagged intel briefs. Each officer sees a different
 *  slice of the truth, with different noise; the team integrates them. */
export function Boardroom({ briefings }: { briefings: RoleBriefing[] }) {
  if (!briefings.length) return null;
  return (
    <Card>
      <div className="flex items-center gap-1.5">
        <Eyebrow>Boardroom</Eyebrow>
        <InfoDot title="Role briefings" align="right">
          Each officer reads the market through their own lens — and none of them is perfectly right. Weigh the briefs against each other before you lock the round.
        </InfoDot>
      </div>
      <div className="grid gap-2.5">
        {briefings.map((b) => (
          <div key={b.role} className="border-b border-line pb-2 last:border-0 last:pb-0">
            <Tag tone={ROLE_TONE[b.role]}>{b.role.toUpperCase()}</Tag>
            <ul className="mt-1 grid gap-0.5">
              {b.lines.map((l, i) => (
                <li key={i} className="text-[0.74rem] leading-snug text-ink">{l}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
