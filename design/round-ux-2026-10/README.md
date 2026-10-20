# Handoff: Drink Wars round UX (event takeover, seat & team plan, round resolved + calls)

## Overview
Four changes to the existing Drink Wars student game screens. They fix problems students hit during play:
- **A. Event moment:** market shocks were easy to miss in a small header pill. Now there is a one-time takeover card when an event is announced or starts, then a full-width "wire strip" under the header.
- **B. Seat identity:** students lost track of which role (CEO/CFO/COO/CMO/CHRO) they were playing. Now a persistent seat plate and a page edge in the seat's colour.
- **C. Team plan differs:** the commit panel showed the student's own projected cash, not what would actually lock. It now leads with the team-plan number and lists each lever where the student's form differs from what locks, and who decides it.
- **D. Round resolved + Calls:** a new optional prediction step ("calls") inside the commit panel, and a results page after the instructor resolves a round: rank, events, desk numbers, then the student's calls settled with a running record.

**Out of scope:** the "Control Room" / liquid-glass redesign files are a separate future exploration. Do not implement them. Keep the current theme (warm brown/cream, EB Garamond + IBM Plex Sans).

## About the design files
The `.dc.html` files are **design references built in HTML**: prototypes of the intended look and behaviour, not production code. Rebuild them in the existing Drink Wars codebase using its components, state management and data layer. Each file opens directly in a browser (keep `support.js` next to them). Buttons at the top of each file switch between the states described below. Each screen is shown at 1440px desktop and 390px mobile, in dark and light themes.

## Fidelity
**High fidelity** for layout, hierarchy, copy, colours and type. Match these closely, but reuse the codebase's existing header, tabs, lever inputs, cards and buttons wherever they already exist. Only the parts described below are new. All figures (cash, margins, names, team names) are sample data; use live game data.

## Shared design tokens (current theme)
Fonts: **EB Garamond** (body, headlines, numbers) and **IBM Plex Sans** (labels, kickers, buttons, tags; caps with 0.08–0.16em letter-spacing).

| token | dark | light |
|---|---|---|
| bg | #1b130c | #f2e6cd |
| bg2 (header/footer) | #22180f | #ebdbbb |
| card | #2c2117 | #fcf6ea |
| card2 | #36291c (#33261a in D) | #f5ead6 |
| line | #4d3b28 | #d6bf98 |
| ink | #f4e8d2 | #2a1b0f |
| ink2 (muted) | #c4ad8c | #65503a |
| gold (kickers, rank) | #ecb54a | #9a5512 |
| red (hit / differs / missed) | #e8735d (A), #ef8a64 (B–D) | #a3321f |
| redbg | #3b1f16 / #3a2015 | #f7ddd2 / #f8e0d3 |
| amber (announced / close) | #eab84c | #8f5c06 |
| amberbg | #362a13 | #f6e6bf |
| green (ok / nailed / yours used) | #8ec95a | #3d6b18 |
| btn (primary) | #7fb544, ink #15230a | #6ea83a, ink #13210a |
| field (input bg) | #1a120b | #efdfc0 |

**Seat colours** (seat = dark / light; text on the seat colour is #1a120a in dark and #fdf8ee in light):
- CEO #bf9ae0 / #6c4294 · CFO #9bcb5e / #3d6b18 · COO #4cc0cb / #1d7a83 · CMO #ee9a4a / #a65424 · CHRO #edbe48 / #855a08
- Tinted seat-plate background (B): CEO #2b2030 / #f2e8f6, CFO #1f2a17 / #e9f2dc. Derive the others the same way: the seat hue at very low chroma.

Radii: 6px tags, 8px inputs, 10px buttons, 12px plates and tickets, 14px cards, 16–18px modals, 24px mobile bottom sheet. Minimum body text is 16px; 13px is used only for caps labels.

---

## A. Event moment (`Event Moment.dc.html`)
**States:** no event · announced (amber, e.g. Recession, about 1 round out) · it hits (red, e.g. Water shortage, in effect this round) · two at once. Each can be shown as the takeover or after it is dismissed. The copy changes per seat.

**Takeover (desktop):** a dimmed overlay rgba(12,7,3,.62) over the Decide screen. A centred card, 820px wide, top 110px, radius 18, shadow 0 30px 80px rgba(0,0,0,.45). In order:
1. A 14px hazard stripe in the event colour (repeating 135° stripes, 14px apart).
2. A kicker, e.g. "ON THE WIRE · ROUND 3 · HITTING NOW", with "INDUSTRY-WIDE" on the right.
3. The headline at 62px/700 ("The water shortage is here") and a 22px muted subline.
4. A **"What it means for your desk, {FIRST NAME}"** box (card2): seat role tag plus a 21px seat-specific sentence. The copy for every seat and event is in the `FOR` object in the file.
5. When two events are active, one "ALSO ON THE WIRE" row per extra event.
6. The primary button "Got it, back to my desk" (ink background), next to "7:42 left in Round 3. The clock keeps running."

**Mobile:** the same content as a bottom sheet (top 70px, radius 24 at the top), with the button pinned at the bottom.

**After dismissal (wire strip):** a full-width row per active event directly under the header. It has a 3px top border in the event colour on the redbg/amberbg tint. Grid: 150px tag ("HITTING NOW" / "NEXT ROUND") · title + " · one-line summary" with "**For your desk:** {short seat line}" below · "IN EFFECT · ROUND 3" on the right. When there are no events, a single muted line: "The wire is quiet. No market events this round."

**Behaviour:**
- Show the takeover once per student, per event, per state change (announced → hits), on the next load of the Decide view.
- Store the dismissal per event id and phase.
- The round timer keeps running.
- The wire strip appears on all tabs (Decide / Review / Map).

## B. Seat identity & C. Team plan differs (`Seat and Team Plan.dc.html`)
**Seat plate:** in the header next to the round number. 2px border in the seat colour, radius 12, tinted background. A solid seat-colour block holding the role (24px Plex 700), then the name (22px) over "YOUR SEAT · FINANCE DESK" in caps.
- Next to the plate: a row of small chips for the other seats ("CEO ✓", "CHRO · empty"); your own chip is at 35% opacity.
- The whole page has an 8px left border in the seat colour.
- The desk card has a 5px top border in the seat colour and a seat-coloured caps title, followed by the mandate line (e.g. "Fund the round. Set the envelope before others overspend it.").
- **Mobile:** a solid seat-colour bar at the very top (role · name · short desk label) and a 4px seat-colour frame around the screen.

**Commit panel ("What locks at round end"):**
- It leads with **projected cash on the team's plan** (50px). Below, when the plans differ: "Your form alone would give {myCash}".
- **Differs block** (redbg, 3px red top border):
  - A red count disc and a headline, e.g. "4 levers lock at a teammate's number, not yours".
  - A table with columns LEVER · WHO DECIDES | LOCKS | YOU TYPED.
  - Overridden values are struck through. When the student's own change wins, the LOCKS value shows in green with the note "You changed it, so yours is used".
- From the non-CEO seat view, two buttons: "Take the CEO's numbers" / "Keep mine".
- A short rule line explains why. CEO view: "These levers sit on a seated teammate's desk, so their number is used…". CFO view: "A lever you leave at last round's value follows the CEO. Change it yourself to override."
- **No differences:** a green dot and "Your form matches the team's plan."
- **Lever inputs:** levers that differ get a 2px red border (green when theirs wins) and the caption "Locks at $X · {who}".
- **Submit label:** "SUBMIT MY DESK · N LEVERS FOLLOW TEAMMATES", or "SUBMIT MY DESK (ROUND n)" when nothing differs.
- **Mobile:** a bottom sheet with the differs block (first 2 rows, then "+N more · see all"), "TEAM LOCKS {cash}" and the submit button.

**Lock rules shown in the design** (confirm against the real resolver):
- A lever on a seated teammate's desk uses that teammate's value.
- A lever the student left unchanged from last round follows the CEO.
- A lever the student changed uses the student's value.
- Empty seats use defaults.

## D. Round resolved + Calls (`Round Resolved and Calls.dc.html`)
**Before lock: calls step**, inside the commit panel above Submit:
- Heading "Your calls for Round 3", with the record ("Record 3 of 5") on the right. Subline: "Optional. Settled when the round resolves."
- Three tickets, each a card with a caps title, a hint and a row of segmented options:
  - WHERE WE FINISH (#1–#4)
  - MY GROSS MARGIN (<28%, 28–32%, 32–36%, >36%; hint "last round 31.9%")
  - LOW TIDE'S PRICE, i.e. the top rival (Cut / Hold / Raise; hint "now $8.05")
- An unfilled ticket has a dashed border; a filled one is solid, with the chosen option inverted (ink background, bg-coloured text).
- The submit label counts calls: "SUBMIT MY DESK + 3 CALLS", or "(NO CALLS)" when there are none.
- Calls are submitted with the desk and are editable until lock.

**After resolve: results page.** It opens when the instructor resolves the round. The header shows "Round 2 resolved" and "ROUND 3 OPENS · when ready".
- **Left column, top to bottom:**
  1. Kicker "ROUND 2 IS IN", 58px "You finished #4 of 4", subline on movement and leader.
  2. Three KPI cards (net income, cash, gross margin) with coloured change vs last round.
  3. "WHAT HIT THE MARKET": one row per event with an 8px colour bar and "**On your desk:** …". With no events: "A quiet round…".
  4. "YOUR DESK'S NUMBERS": before/after rows for the desk's KPIs, with "Full statements →" and "The Tap Dispatch →" links.
- **Right column (540px, card2) "YOUR CALLS · SETTLED":**
  - Headline "2 of 3 came good" and "SEASON RECORD 5 of 8".
  - Per call: kind; a verdict tag (NAILED green / CLOSE amber / MISSED red); "You called" vs "It came in" at 30px; and a one-line explanation.
  - A streak bar of the last 6 calls in verdict colours, with the line "Close means within 2 points or one rank place."
  - The primary button "ON TO ROUND 3 →".
- **No calls:** "You made no calls in Round 2, so there's nothing to settle. Your record holds at X."
- **Mobile:** a single column: rank, events, compact calls list, statements link, and a pinned "ON TO ROUND 3 →".

**Scoring:**
- NAILED: exact bucket, rank, or price direction.
- CLOSE: within 2 margin points, or one rank place.
- MISSED: anything else.
- The record counts NAILED and CLOSE as hits. Calls are for engagement only and do not affect the game score unless the instructor decides they should.

## State / data needed
- Per event: `id`, `phase` (announced | active), `eta`, title and summary, and per-seat impact copy (short + long).
- Per student: their seat (role, colour), and dismissed takeovers by {eventId, phase}.
- Team plan resolution: for each lever, the locked value, the student's value, and the source seat plus the reason. Projected cash for both the team plan and the student's form alone.
- Calls: up to 3 per student per round ({kind, choice}); after resolve, {actual, verdict}. A season record and the last-6 history.

## Files
- `Event Moment.dc.html`: A
- `Seat and Team Plan.dc.html`: B + C (switch between CEO and CFO views)
- `Round Resolved and Calls.dc.html`: D (before lock / resolved; 0, 1 or 3 calls; 0, 1 or 2 events)
- `support.js`: the prototype runtime, only needed to open the files in a browser. Not for production.
