# Roll Call — Govroll visual system (Direction A, v0.1)

Source of truth: Holly's brand guide at
https://howellandgibbs.com/brand-guides/govroll-roll-call (sample app home at
`…/sample`). This file is the codebase-side digest of it. Reconcile with the
guide when they diverge.

The premise: **a bill is a route.** It has fixed stops, a terminus, and most
bills never arrive. The register is wayfinding, not editorial — transit
signage that makes a complicated public network legible without ever telling
you whether your destination is a good idea.

## The encoding law (governs everything)

Each visual channel carries exactly one fact:

| Channel       | Encodes                               | Vocabulary                                            |
| ------------- | ------------------------------------- | ----------------------------------------------------- |
| Signal colour | Position — what happened/is happening | sapphire cleared · gold current · maya yes · flame no |
| Node fill     | Stage — how far along the route       | solid, gold, hollow, faded                            |
| Letter        | Party                                 | D · R · I in identical circular frames                |
| Line colour   | Topic                                 | 11 deep hues, only ever a 5–6px rule/bar              |

- **Party never gets a colour.** Letter only, identical frames (`.party-node`).
- Signal colours are bright and appear as chips, nodes, fills. Line colours
  are deep/muted and appear **only** as a rule or left-margin bar — never a
  chip fill, never type. If both families appear in one component, the
  component is wrong.
- Flame means "against", **never** error/warning/destructive. Errors use an
  ink dashed frame.
- Gold means "here, now" — exactly one gold element per row and per route.
- No urgency/countdown/red-alert styling for legislative timing.

## Tokens (all defined in `src/app/globals.css`)

Signal palette — Tailwind utilities `bg-sand`, `text-ink`, `bg-sapphire`, …:

| Token           | Hex       | Role                                                             |
| --------------- | --------- | ---------------------------------------------------------------- |
| `sand`          | `#F2EDE3` | Page ground. Every page sits on this.                            |
| `paper`         | `#FBF8F2` | Cards and raised surfaces only.                                  |
| `ink`           | `#14161C` | All type, all rules, all node strokes.                           |
| `ink-muted`     | `#5C5F69` | Secondary text (≈ muted-foreground).                             |
| `sapphire`      | `#4164FF` | Brand, route line, cleared track, interactive. 18px+ text only.  |
| `sapphire-deep` | `#3258FF` | Links, kickers, small labels, and any fill carrying text < 18px. |
| `gold`          | `#FFB62E` | Current position, pending action. Never text.                    |
| `maya`          | `#7CC3FF` | Yes / in favour. Fill only, never text.                          |
| `flame`         | `#FE6237` | No / against. Fill only, never text.                             |
| `rule`          | `#D3CCBE` | Hairlines on sand.                                               |
| `hollow`        | `#BCB3A2` | Untravelled track, dashed borders.                               |

Line palette (topic) — `bg-line-health` etc., see `src/lib/topic-mapping.ts`:
Health `#14707A` · Defense `#3F4C5C` · Education `#7A3E6B` · Economy
`#2C6B45` · Environment `#6E8C3A` · Immigration `#4B3A6B` · Crime & Justice
`#7E2F3E` · Civil Rights `#9C4A22` · Technology `#4A6E8C` · Foreign Affairs
`#8A6A2B` · Housing `#A33A5B`. Eleven is the ceiling. Topics beyond the
eleven (Transportation, Agriculture, …) get **no** line colour — they are set
typographically (guide §5.3 fallback).

Contrast rules (against sand):

- Ink is the text colour on all four signal fills (gold, maya, flame — and
  ink-on-sapphire fails, so sapphire fills carry **paper** text, and any
  sapphire fill with text under 18px uses `sapphire-deep`).
- Never: gold/maya/flame/topic-hue as type; paper text on gold or maya.
- Focus-visible is a gold ring on every interactive element (`--ring`).

## Typography

Two families, never a third. No monospace — data uses Public Sans with
`tabular-nums` (mandatory anywhere digits stack in a column).

- **Archivo** (display, `font-heading`) — variable wdth 62–125 / wght
  400–800. Wordmark wdth 125 wght 800; h1 125; h2 112; h3 105; bill titles 110. Negative tracking at display sizes (−.015em to −.03em). **Never below
  18px, never for body copy.**
- **Public Sans** (`font-sans`) — everything else. 400 prose, 500 data/labels,
  600 buttons/emphasis, 700 uppercase chips. (It's the USWDS typeface — a
  deliberate credibility signal.)
- Uppercase only for chips, kickers, table headers — always ≥ .1em tracking.
- Bill titles in sentence case exactly as Congress titles them.

Global CSS sets h1–h3 to Archivo with the right wdth; h4–h6 stay Public Sans
600 (they're usually under 18px).

## Wordmark & node

Wordmark = gold node ringed in sapphire (paper ring when reversed on ink) +
`GOVROLL` in Archivo 800, wdth 125, letterspacing .02em. The node is the
"current position" mark — the smallest statement of the system. Below 96px
wide, use the node alone (favicon). Never sentence case, never Public Sans,
never on a topic colour, photo, maya, or flame. The old `★` stars,
"E Pluribus Unum" flourishes, and star-field patterns are retired.

## The route (bill progress)

Six stops: Introduced → Committee → Passed House → Passed Senate → Signature
→ Law (Senate bills mirror chambers; count stays six). Node states:

- **Cleared** — solid sapphire, sapphire track behind it, date shown
- **Current** — solid gold, enlarged; exactly one per route; sits on the
  stage _completed_, never between nodes
- **Ahead** — hollow (hollow-colour stroke), hairline track; not a prediction
- **Dead** — hollow at 45% opacity; the route ended here

Row scale: six 8px dots, same grammar, no labels. The track never bends,
branches, animates, or runs vertically except < 640px. Track is always
sapphire, never topic-coloured.

## Votes

- Chips: `YES` on maya, `NO` on flame — ink text, the word is **mandatory**
  (maya/flame differ only in hue, 1.56:1). `NOT VOTING` / `NO RECORD` in a
  dashed hollow frame — different states: not voting = member absent from a
  recorded vote; no record = no per-member vote exists.
- Tallies: stacked maya/flame/blank bar with 1px ink separators + a key. Not
  voting occupies its true width — an absence is part of the record.
- Never sort/rank members by vote colour; order follows the roll call.
- Voice votes: name the absence in plain language (model paragraph in guide
  §2.2/§9). Never render an empty state that looks like a loading failure.

## UI patterns

- Ground sand; cards paper with `rule` hairline borders; square corners
  (`--radius: 0`). Section labels: 11px uppercase, .18em tracking, ink-muted.
- Status pills: uppercase Public Sans 700; gold fill = pending ("AWAITING
  SIGNATURE"), sapphire-deep fill + paper text = terminal cleared
  ("ENACTED"), outline/hollow = in progress, faded = dead. Bill failure is
  hollow/faded, **not** red.
- Rep cards: paper, rule border, 4px sapphire left border, circular
  ink-stroked initials avatar, party letter node.
- Bills index rows: 5px topic bar in the left margin (its only home), one
  saturated element per row (gold node _or_ vote spark), fixed row height,
  titles truncate at two lines.
- Nav: ink bar, reversed wordmark, search field ink-translucent.
- System banner (recess/shutdown/new Congress): full-bleed directly under the
  nav, gold 30% over sand ground, 2px ink rule beneath, illustration anchored
  bottom-right (hidden < 900px; the only illustrated surface, the only large
  gold area). Not dismissible, one at a time, states a calendar fact — never
  a promotion. Illustrations live in `public/brand/illos/`.
- Voice & words: state the position, not the verdict; name the absence;
  attribute everything; describe mechanism, not motive. Banned: slammed,
  blasted, crucial, landmark, controversial, common-sense, "failed to" where
  "did not" is accurate, exclamation marks. Bills are _enacted_, not won.

## Out of scope in v0.1

Dark mode (palette unverified on dark grounds — the `.dark` block and `dark:`
utilities are inert and stay that way). Green for yes/no is an open question;
Maya Blue ships. "Ask AI" surface treatment is v0.2.
