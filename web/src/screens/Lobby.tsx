import { MP_ENABLED } from "../game/multiplayer.js";

/** Entry screen: solo practice always; live join/instructor only where a game
 *  server is reachable (local dev / hosted), gated on the public static build. */
export function Lobby({ onPick }: { onPick: (s: "solo" | "join" | "instructor") => void }) {
  const choices: { id: "solo" | "join" | "instructor"; title: string; blurb: string }[] = [
    { id: "solo", title: "Play solo", blurb: "Practice against 7 adaptive AI rivals. No sign-in." },
    ...(MP_ENABLED
      ? ([
          { id: "join", title: "Join a game →", blurb: "Enter a 6-character code from your instructor." },
          { id: "instructor", title: "Instructor", blurb: "Create a game and run the rounds." },
        ] as const)
      : []),
  ];
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <div className="rise">
        <div className="eyebrow">A craft-beverage strategy simulation</div>
        <h1 className="wordmark mt-2 text-6xl leading-[0.95] text-ink sm:text-7xl">
          Drink<span className="text-copper">&nbsp;Wars</span>
        </h1>
        <div className="mt-4 h-px w-24 bg-copper" />
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-inksoft">
          Run a craft beverage company against adaptive rivals — set your prices, build the brewery, and out-strategize the field across a 16-round season.
        </p>
        <div className={`mt-8 grid gap-3 ${MP_ENABLED ? "sm:grid-cols-3" : "sm:grid-cols-1"}`}>
          {choices.map((c) => (
            <button key={c.id} onClick={() => onPick(c.id)} className="card p-4 text-left transition-all hover:-translate-y-0.5">
              <div className="display text-lg">{c.title}</div>
              <div className="mt-0.5 text-[0.8rem] leading-snug text-inksoft">{c.blurb}</div>
            </button>
          ))}
        </div>
        <p className="mt-6 font-mono text-[0.68rem] tracking-wide text-inksoft">
          {MP_ENABLED
            ? "Solo runs in your browser; live multiplayer needs the local game server (npm run serve)."
            : "Live multiplayer (instructor-run classroom games with join codes) is coming to this page soon."}
        </p>
      </div>
    </div>
  );
}
