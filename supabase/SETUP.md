# Leaderboard setup (Supabase)

**Good news: there is nothing to run.** Maple Scramble uses the shared Btown
Games Supabase project, and its schema is *game-agnostic* — every score row
carries a game slug, so a new game registers itself the first time someone
submits a score as `maple-scramble`. The same `submit_score` /
`get_leaderboard` / `rename_player` RPCs that power the other games power
this one, and players keep their existing `btown-*` name and identity.

[`schema.sql`](./schema.sql) is a reference copy of that shared schema
(identical to the one in trivia-ladder and news-quiz). It's idempotent and
safe to re-run, but you don't need to — it's already live.

## One thing to know about the scores

The shared backend keeps each player's **highest** score per month. A
leaderboard of *fastest times* needs lower-is-better, so the game submits
**`36000 − elapsed deciseconds`** (an hour-long solve scores 0 and isn't
submitted). The UI converts scores back into times everywhere you see them.
If you ever look at the raw `scores` table, a `maple-scramble` score of
`34766` means 36000 − 34766 = 1234 deciseconds = **2:03.4**.

## Verify

Solve a puzzle, enter a name, then in the Supabase **SQL Editor**:

```sql
select * from get_leaderboard('maple-scramble', to_char(now() at time zone 'America/New_York', 'YYYY-MM'));
```
