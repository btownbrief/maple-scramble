# Wiring a Btown game for async duels ("challenge a friend")

This repo is the CANONICAL duel reference. A duel is the OTHER multiplayer
shape — not turn-based like the board games, but *same challenge, two
phones, compare results*. It rides the identical shared rooms backend
(btownbrief.github.io/supabase/rooms-2026-07-30.sql): a duel room's state
is `{ kind: 'duel', payload, results }` where `payload` is the shared
challenge (a seed, a date, a question set) and `results` holds one
write-once entry per seat. No turns — each phone plays alone and pushes
one result; the version lock merges concurrent submissions.

## 1. Vendor three files — never edit them here

- `js/rooms.js`            (canonical: four-in-a-rowboat)
- `js/duel.js`             (canonical: THIS repo)
- `scripts/rooms-shim.mjs` (canonical: four-in-a-rowboat)

## 2. Copy the UI pattern from this repo

Read `index.html` (duel overlays), `style.css` (duel section), and the
`duel mode` section of `js/main.js`. Keep these element ids EXACTLY (the
fleet's duel smoke test drives them): `duelBtn hostBtn joinBtn rejoinBtn
onlinePanel opTitle opName opCodeWrap opCode opError opGo opCancel lobby
lobbyCode lobbyCancel duelBar duelDone duelDoneHead duelDoneRows
duelRematchBtn duelExitBtn`. Re-theme every visible word to the game's
voice; reuse the game's own modal/button classes.

## 3. The five rules that are not optional

1. **The daily stays sacred.** A duel challenge must never be today's
   puzzle and must never touch daily saves, stats, streaks, or the
   monthly leaderboard. Reuse whatever isolation the repo already has
   (Scramble rides its `?testdate=` guards); if none exists, add one gate
   at every persistence site.
2. **The payload is deterministic and pre-validated.** Whatever seeds the
   challenge (an archive date, a word index, a question set) must produce
   the identical experience on both phones, and only from content the
   repo already guarantees is good (Scramble: the solvability-verified
   date window).
3. **Results are write-once** and submitted through `duel.submitResult`
   only — it retry-merges on version conflicts. Define the result shape
   and the win rule in ONE place; a player who gives up/abandons submits
   a losing result rather than vanishing.
4. **Every dead end has an exit.** Waiting on a rival, rival left, race
   swept away, backend not installed (`not_ready`) — each shows friendly
   copy and a way back to the daily. Transient network failures never
   clear the saved session; only `not_found`/`not_seated`/`room_started` do.
5. **Timing is self-reported and that's fine.** Each phone times or
   scores its own run (devtools cheating between friends is the accepted
   fleet tradeoff — note it in a comment, don't engineer around it).

## 4. Tests before you finish

Adapt `scripts/test-duel.mjs`: keep the generic duel checks (create/join,
concurrent submit merge, write-once, rematch convergence, resume, leave →
`opponent_left`) and swap in THIS game's payload + result shapes. Run and
report:

    node scripts/test-duel.mjs
    node scripts/test-engine.mjs   (or the repo's existing suites)
    node --check js/main.js        (and any other touched file)

## 5. Update AGENTS.md

Note the duel mode, the vendored files and where their canonical copies
live, and add test-duel.mjs to the before-you-finish list.

## Backend

Same one-paste Supabase setup as the board games (PR #8 on
btownbrief.github.io). Duels self-register by slug; until the SQL is
pasted, clients get `not_ready` and the UI says races aren't switched on.

## 6. Race-link invites (added 2026-08-02)

Same rule as ROOMS-INTEGRATION.md §6: lobby "send an invite" button
sharing `?join=CODE`; on load a valid `?join=` prefills the join panel and
is scrubbed from the URL. Reference: the end of this repo's js/main.js.
