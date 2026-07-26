# Maple Scramble

The daily word-tile sprint from Burlington, Vermont — a
[Btown Games](https://play.btownbrief.com) production from the
[BTown Brief](https://www.btownbrief.com).

**Play: https://play.btownbrief.com/maple-scramble/**

Everyone gets the same **16 letter tiles** each day. Drag them onto an open
grid and build **one connected crossword** where every horizontal and
vertical run of 2+ letters is a real word. Invalid words glow red; rearrange
freely. The clock counts **up** from your first tile and stops the moment all
16 are placed and everything checks out — that's a **TAP** 🍁. Fastest taps
make the shared monthly leaderboard. Streaks, stats, and an emoji share grid
included. Mid-solve progress is saved locally, so closing the tab and coming
back resumes your board (the clock only runs while you're looking at it).

Plain static site — no build step, no frameworks. `index.html` + `style.css`
+ ES modules in `js/`. Deployed by GitHub Pages via
`.github/workflows/deploy.yml` on push.

## The daily rack generator

`js/engine.js` turns the date string (America/New_York) into 16 tiles, the
same for every player:

1. The date seeds a small deterministic RNG (xmur3 hash → mulberry32), which
   shuffles a standard Scrabble letter bag (98 tiles, no blanks).
2. The rack takes the first 16 letters, **skipping any letter already picked
   twice** (max 2 copies of anything).
3. The draw is rejected and deterministically redrawn (attempt number folded
   into the seed) unless it has **5–9 vowels** and, if it contains a **Q**,
   also a **U** — the word list has no "qi", so a U-less Q could strand you.
4. If the default rack fails the offline crossword solver, its date gets a
   small integer in `RESALT`; that salt is folded into the seed for a
   deterministic reroll.

Same date in → same rack out, on every device, with no server involved.
Dates without a `RESALT` entry keep their original seed and rack exactly.

## Solvability sweep

`node scripts/test-solvable.mjs` runs the greedy crossword builder against
every daily rack in its date range, including any rerolls from `RESALT`.
`node scripts/test-solvable.mjs --find-salts` rechecks unsalted defaults and
prints the first passing salt for each failure. The committed sweep covers
through **2028-07-26**; extend the range and rerun it before mid-2028.

## Dictionary

`data/words.txt` is the **ENABLE** word list (172,823 words), vendored
verbatim. ENABLE is **public domain** — it was released without copyright
restriction and is the base of many word games. Loaded once at startup into
a `Set`; all validation is client-side.

## Engine tests

```
node scripts/test-engine.mjs
```

Plain Node asserts (no framework): rack determinism + constraints across a
full year of dates, connectivity detection, word-run extraction/validation,
and the time→points conversion.

## Leaderboard

Shared Btown Games Supabase backend (`js/leaderboard.js`, game slug
`maple-scramble`) — same project, RPCs, and `btown-*` localStorage identity
as the rest of the arcade. The backend ranks **higher scores as better** and
keeps each player's monthly best, so the game submits
`36000 − elapsed deciseconds` (floored at 0) and the UI formats scores back
into times — a faster tap is a higher score, and "monthly best" means
"fastest tap this month". Solves longer than an hour simply aren't
submitted. No new SQL was needed; see `supabase/SETUP.md`.
