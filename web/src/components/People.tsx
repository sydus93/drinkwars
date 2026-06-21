/** Small shared bits for the people/employee UI: a generated avatar (deterministic
 *  from a seed) and a skill-star readout. No real photos — a colored monogram, the
 *  Sims "this is a specific person" affordance without the art pipeline. */

export function Avatar({ seed, name, size = 28 }: { seed: string; name: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-bold text-paper shadow-inner"
      style={{ width: size, height: size, fontSize: size * 0.44, background: `hsl(${hue} 42% 44%)` }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

export function SkillStars({ n }: { n: number }) {
  return (
    <span className="shrink-0 text-[0.64rem] leading-none text-copperdeep" title={`Skill ${n} of 5`}>
      {"★".repeat(Math.max(0, Math.min(5, n)))}
      <span className="text-line2">{"★".repeat(Math.max(0, 5 - n))}</span>
    </span>
  );
}
