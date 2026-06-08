# Drink Wars — Web (single-player prototype)

A browser prototype that runs the **entire game client-side** — the engine, the
orchestration layer (on the in-memory adapter), and the adaptive AI rivals — with
**no backend**. This is application-spec §9 step 0 (the self-contained
single-player prototype) and the fastest way to feel the core loop. It doubles as
the "play against bots" onboarding mode.

```bash
# from repo root: npm install   (once)
npm run dev --workspace web      # → http://localhost:5173
npm run build --workspace web    # production bundle (also verifies browser-safety)
npm run typecheck --workspace web
```

## What you play

You run one brewery (firm_1); 7 adaptive best-response bots (`decideAdaptive`,
from the engine) run the rivals — pick a **difficulty** (relaxed / competitive /
cutthroat) that controls how hard they contest Craft Premium. Each round is a
tabbed workspace so every dashboard stays reachable while you decide:

- **Decide** — prices, a single drag-to-split **capacity allocation bar**, and
  investment in quality / brand / operations / taproom. Your previous round's
  choices **carry forward** (tweak from there). A "Before You Brew" panel shows
  cash, committed spend, and coverage *before* you commit (§6.3). **Buy market
  research** (a real costed action) to unlock rival intel in the Field tab.
- **Last round** — the diagnostics decomposition (§6.4): where your sales came
  from (attraction factors), unit-cost build-up, the three statements with
  coverage/leverage, durable-capital stocks.
- **Trends** — season time-series: score vs field, cash, net income, share,
  quality & brand.
- **Field & intel** — the market, you-vs-field benchmarks, and (once you've
  bought research) the rival table + the price×quality **strategy map** (§6.5).

A persistent rail shows standings and public dispatches (shocks, antitrust, a new
category opening) at all times.

## Design

Aesthetic direction: **"Taproom Ledger"** — warm paper, copper/ink, Fraunces
display + Hanken Grotesk body + Spline Sans Mono for figures. **Every color and
font is a CSS token** in `src/index.css` (`@theme`), so re-skinning to the Relief
brand is a token swap, not a rewrite — components never hardcode a color.

## Structure

```
src/
  game/controller.ts   SinglePlayerGame — wires orchestrator + in-memory adapter + NPCs in-browser
  game/useGame.ts       React hook around the controller
  labels.ts             Beverage vocabulary + number formatting (presentation only)
  screens/Setup.tsx     Landing / start
  screens/Play.tsx      Round shell: decide ⇄ review
  components/           DecisionForm, Diagnostics, Standings, Events, ui atoms
  index.css             Tailwind v4 + "Taproom Ledger" design tokens
```

## Notes / next

- The same UI components will drive the multiplayer build — swap the in-browser
  controller for the Supabase-backed orchestrator; the screens don't change.
- Not yet built here: the strategy map (§6.5), full progressive disclosure, and
  the instructor interface (§7) — those come with the multiplayer/Supabase phase.
- To re-skin to the Relief brand, share its tokens (Tailwind theme / CSS
  variables / a couple screenshots) and we swap `@theme` in `index.css`.
