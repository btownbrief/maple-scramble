# Maple Scramble — agent instructions

Shared brain for any AI agent working in this repo (Codex, Claude Code, etc.).
Read `README.md` first for how the game works — this file only adds the rules an
agent needs so it doesn't break something. Stephen is non-technical — explain
consequential changes in plain language.

## What this is
Btown's daily 16-tile crossword sprint. Plain static site, **no build step**:
`index.html` + `style.css` + ES modules in `js/`. Deployed by GitHub Pages via
`.github/workflows/deploy.yml` on push to the default branch.

## Rules that will trip you up
- **`js/engine.js` is pure and deterministic** — no DOM, no `Date.now()`; the
  date arrives as a string. The daily rack must stay a pure function of the date
  string, or players on different devices get different puzzles mid-day. If you
  touch the generator or grid logic, update `scripts/test-engine.mjs` in the same
  change and run it (`node scripts/test-engine.mjs`).
- **`data/common.txt` is a vendored frequency-ordered common-word list**
  (intersected with ENABLE) that biases the give-up reveal solver
  (`js/solver.js`) toward everyday words. Bulk data like `words.txt` — don't
  hand-edit. If you touch the solver, run `node scripts/test-reveal.mjs`.
- **`data/words.txt` is the vendored public-domain ENABLE list.** Bulk data, not
  logic — don't reformat, dedupe, or "clean" it by hand; validity of everyone's
  boards depends on it byte-for-byte.
- The leaderboard uses the **shared Btown Games Supabase backend**
  (`js/leaderboard.js`, game slug `maple-scramble`). Scores are
  `36000 − deciseconds` so faster = higher on a higher-is-better backend — don't
  submit raw times. The public anon key can only call security-definer RPCs;
  never put a service-role key or secret in client JS.

## Before you finish
Run `node scripts/test-engine.mjs` if you touched `js/engine.js`. For UI
changes, load the page at a phone-sized viewport and do a real drag — the
drag/snap feel is the whole game. Say what you verified.
When touching the rack generator, also run `node scripts/test-solvable.mjs`;
before mid-2028, extend its date range past 2028-07-26 and rerun it.
