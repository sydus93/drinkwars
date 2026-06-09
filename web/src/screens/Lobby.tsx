/** Entry screen: choose solo practice, join a live game, or run one as instructor. */
export function Lobby({ onPick }: { onPick: (s: "solo" | "join" | "instructor") => void }) {
  const choices: { id: "solo" | "join" | "instructor"; title: string; blurb: string }[] = [
    { id: "solo", title: "Play solo", blurb: "Practice against 7 adaptive AI rivals. No sign-in." },
    { id: "join", title: "Join a game →", blurb: "Enter a 6-character code from your instructor." },
    { id: "instructor", title: "Instructor", blurb: "Create a game and run the rounds." },
  ];
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <div className="rise">
        <div className="eyebrow">A craft-beverage strategy simulation</div>
        <h1 className="wordmark mt-2 text-6xl leading-[0.95] text-ink sm:text-7xl">
          Drink<span className="text-copper">&nbsp;Wars</span>
        </h1>
        <div className="mt-4 h-px w-24 bg-copper" />
        <p className="mt-6 max-w-xl font-display text-xl leading-relaxed text-inksoft">
          Run a craft beverage company against adaptive rivals — solo, or live against your classmates.
        </p>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {choices.map((c) => (
            <button key={c.id} onClick={() => onPick(c.id)} className="card p-4 text-left transition-all hover:border-line2">
              <div className="font-semibold">{c.title}</div>
              <div className="mt-0.5 text-[0.78rem] leading-snug text-inksoft">{c.blurb}</div>
            </button>
          ))}
        </div>
        <p className="mt-6 font-mono text-[0.68rem] tracking-wide text-inksoft">Single-player runs in your browser; multiplayer needs the local game server running.</p>
      </div>
    </div>
  );
}
