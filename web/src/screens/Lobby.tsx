import { MP_ENABLED } from "../game/multiplayer.js";

/** Entry screen: solo practice always; live join/instructor only where a game
 *  server is reachable (local dev / hosted), gated on the public static build. */
export function Lobby({ onPick }: { onPick: (s: "solo" | "join" | "instructor" | "player") => void }) {
  const choices: { id: "solo" | "join" | "instructor" | "player"; title: string; blurb: string }[] = [
    { id: "solo", title: "Play solo", blurb: "Practice against 7 adaptive AI rivals. No sign-in." },
    ...(MP_ENABLED
      ? ([
          { id: "join", title: "Join a game →", blurb: "Enter a 6-character code from your instructor." },
          { id: "player", title: "My games", blurb: "Returning? Enter your claim code for your games & history." },
          { id: "instructor", title: "Instructor", blurb: "Create a game, provision a roster, run the rounds." },
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
        <div className={`mt-8 grid gap-3 ${MP_ENABLED ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
          {choices.map((c) => (
            <button key={c.id} onClick={() => onPick(c.id)} className="card p-4 text-left transition-all hover:-translate-y-0.5">
              <div className="display text-lg">{c.title}</div>
              <div className="mt-0.5 text-[0.8rem] leading-snug text-inksoft">{c.blurb}</div>
            </button>
          ))}
        </div>
        <p className="mt-6 max-w-xl text-[0.82rem] leading-relaxed text-inksoft">
          {MP_ENABLED
            ? "Solo play runs entirely in your browser — no sign-in. To play with a class, join a live game with a code from your instructor, or set up your own session."
            : "Solo play runs entirely in your browser — no sign-in, no setup."}
        </p>
      </div>
    </div>
  );
}
