# Drink Wars — Web (single-player + multiplayer + instructor console)

The React/Vite/Tailwind front end. It runs in three modes from one app:

- **Single-player** — the **entire game runs client-side** (engine + orchestration
  on the in-memory adapter + adaptive AI rivals) with **no backend**. This is
  application-spec §9 step 0 and the fastest way to feel the core loop.
- **Multiplayer** — the same screens talk to the Supabase-backed orchestrator
  (join by code, live rounds, bot-fill, session resume). Gated behind a build flag.
- **Instructor console** — passcode-gated game control plus the analytics
  dashboard. See the repo root [`README.md`](../README.md) for the multiplayer/
  instructor overview and [`server/README.md`](../server/README.md) for the backend.

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

Aesthetic direction: **"Tap House Tycoon"** — a warm, glossy management-sim HUD
(cream/copper/amber by day, a night-shift dark mode), Big Shoulders Display for
headers + Archivo for UI + Space Mono for figures, beveled panels and coin icons.
**Every color and font is a CSS token** in `src/index.css` (`@theme`), so
re-skinning is a token swap, not a rewrite — components never hardcode a color.

## Structure

```
src/
  game/controller.ts     SinglePlayerGame — orchestrator + in-memory adapter + NPCs, in-browser
  game/useGame.ts        React hook around the single-player controller
  game/multiplayer.ts    Client for the backend transport (student + InstructorClient)
  labels.ts              Beverage vocabulary + number formatting (presentation only)
  screens/Setup.tsx      Single-player landing / start
  screens/Play.tsx       Single-player round shell: decide ⇄ review
  screens/Lobby.tsx      Mode picker: Solo / Join / Instructor
  screens/Join.tsx       Student join-by-code + name
  screens/MultiplayerPlay.tsx   Student round shell (backend-driven)
  screens/Instructor.tsx        Instructor console: create / roster / lock / resolve + Dashboard tab
  screens/InstructorDashboard.tsx   The 8-panel analytics dashboard + CSV/JSON export
  components/            DecisionForm, Diagnostics, Standings, Trends, Field, AllocationBar,
                         charts (dependency-free SVG), CategoryIcons, Events, ui atoms
  index.css              Tailwind v4 + "Tap House Tycoon" design tokens
```

## Multiplayer build flag

Multiplayer + instructor screens are gated on `MP_ENABLED` (`import.meta.env.DEV ||
VITE_ENABLE_MP === "1"`), so the default single-player bundle stays self-contained.
To build with multiplayer on, point it at a running transport:

```bash
VITE_ENABLE_MP=1 VITE_TRANSPORT_URL=<your-function-url> npm run build --workspace web
```

## Notes

- The strategy map (§6.5), the instructor interface (§7), and live multiplayer are
  **built** — single-player and multiplayer share the same components; only the data
  source differs (in-browser controller vs. the backend transport client).
- Progressive disclosure (the phased lever reveal) is still partial — a roadmap item.
