# NYC Hype Index v3 — Categorized Edition

This is a major architectural upgrade. The flat 30-restaurant leaderboard becomes **6 occasion-based leaderboards** (Date Night, Group Dinner, Solo Dining, Brunch, Late Night, Under $25), each with cuisine filter chips and a price tier on every row.

## What changes for the user

**Old home page:** one big leaderboard ranking all 30 NYC restaurants by gap.
**New home page:** a grid of 6 occasion cards. Click one → its own ranked leaderboard with cuisine filters at top.

A restaurant can appear in multiple occasion leaderboards with **different ranks per occasion** because the relative-normalization happens within each occasion. So Carbone might be #2 most overrated in Date Night but #5 in Group Dinner.

Restaurant rows now show price tier ($/$$/$$$/$$$$) and cuisines next to the neighborhood.

## What changes for you

- **Seed list grows from 30 → 77 restaurants** (more variety needed for 6 leaderboards)
- **Each restaurant is now tagged** with cuisines, occasions, and a price tier
- **Cost per refresh slightly higher** — ~$1.20/run vs. ~$0.50, since we score 77 restaurants instead of 30
- **Reddit takes longer** — ~25 min for the throttled Reddit phase across 77 restaurants. Total run time: ~25-30 min.

## Files to update

Drop these into your `nyc-hype-index/` project, replacing existing files (or creating new ones):

```
lib/
  types.ts                   ← REPLACE
  seed-data.ts               ← REPLACE
  queries.ts                 ← REPLACE
  pipeline.ts                ← REPLACE
  scoring.ts                 ← REPLACE
  ai.ts                      ← REPLACE
  sources/
    tiktok.ts                ← REPLACE
    reddit.ts                ← REPLACE

app/
  page.tsx                   ← REPLACE
  occasion/[slug]/page.tsx   ← NEW (create the directory)
  archive/page.tsx           ← REPLACE

components/
  OccasionLeaderboard.tsx    ← NEW
  Leaderboard.tsx            ← DELETE the old one

scripts/
  seed.ts                    ← REPLACE

supabase/migrations/
  001_occasions.sql          ← NEW (create the directory)
```

**Files to delete from your local copy:**
- `components/Leaderboard.tsx` (replaced by OccasionLeaderboard.tsx)
- `app/issue/[number]/page.tsx` and the `app/issue/` directory entirely (the old per-issue route is gone — issues no longer have their own pages, only the latest one matters)

## Step-by-step deployment

### 1. Replace files

Replace the 14 files above in your `C:\AA_Projects\nyc-hype-index\` project. In Cursor's file explorer, drag each file in. Make sure `app/occasion/[slug]/page.tsx` is at exactly that path (the brackets matter — they're Next.js dynamic route syntax).

### 2. Delete old files

In PowerShell:

```powershell
Remove-Item components\Leaderboard.tsx
Remove-Item -Recurse app\issue
```

### 3. Run the migration on Supabase

Open Supabase dashboard → SQL Editor. Open `supabase/migrations/001_occasions.sql` in a text editor, copy the whole file, paste into the SQL editor, run.

This adds:
- Three new columns to `restaurants`: `cuisines`, `occasions`, `price_tier`
- A new table `occasion_scores`
- Indexes on the new columns
- Row Level Security policy for the new table

Safe to run multiple times — it's idempotent.

### 4. Re-seed restaurants

```powershell
npm run seed
```

This will:
- Update your existing 30 restaurants with their new cuisine/occasion/price tags
- Add 47 new restaurants (total: 77)

If it errors saying `column "cuisines" of relation "restaurants" does not exist`, your migration didn't run. Re-do step 3.

### 5. TypeScript check

```powershell
npx tsc --noEmit
```

Should be clean. If you get errors, paste them to me — usually just an import path mismatch from the file copy.

### 6. Run the test refresh

Use the `--limit=10` flag to test cheaply (~$0.30, 10 minutes):

```powershell
npm run refresh -- --limit=10
```

Watch the logs. You're looking for:
- `[pipeline] scoring 10 restaurants (limit=10)`
- One `[score] {Name}: hype=X.X reality=X.X gap=X.X (peakTT=NNN,NNN)` line per restaurant
- `[pipeline] building date-night leaderboard (N restaurants)` for each occasion that has 3+ restaurants in the limited set
- `[pipeline] issue #N: M occasions, K total rankings` at the end

If you see `[score] tiktok failed` or `[verdict] failed`, paste me the error.

### 7. Promote the test issue (optional)

The test creates a draft issue. If the data looks right in Supabase (`occasion_scores` table has rows with non-null verdicts and reasonable hype/reality numbers), you can either:

- **(a) Promote the draft to published:** in Supabase, edit the new issue's row, set `is_published = true`. Then refresh `localhost:3000` and click into an occasion.
- **(b) Skip the draft and run for real:** `npm run refresh -- --publish` for all 77 restaurants. ~$1.20, 25-30 minutes.

I'd do (b) since the limit=10 sample is too small to spread across 6 occasions properly anyway.

### 8. View it

```powershell
npm run dev
```

Open http://localhost:3000:
- Home page = grid of 6 occasion cards, each showing its top 3 most-overrated
- Click any card → full ranked leaderboard for that occasion
- Top of each occasion page = cuisine filter chips (multi-select)
- Each row shows: rank, name, price tier, neighborhood/borough/cuisines, verdict, hype score, reality score, gap

## What I built and why

**77-restaurant seed list** with these distributions:
- Date Night: 46 candidates
- Group Dinner: 25
- Solo Dining: 19
- Brunch: 16
- Late Night: 15
- Under $25: 17 explicit (+ $ tier auto-qualifiers)
- 11 cuisines, each with 4+ restaurants
- 61 Manhattan / 10 Brooklyn / 6 Queens

**Per-occasion normalization** — a restaurant's gap is computed against the other restaurants *in the same occasion*, not against the global pool. This is what makes each leaderboard read as a real ranking instead of mush.

**Per-occasion verdicts** — Claude generates a separate one-line take for each occasion a restaurant appears in, since context changes (Carbone-as-date-night-spot has a different vibe than Carbone-as-group-dinner-spot). This means we generate ~150 verdicts per refresh instead of 30, hence the slightly higher Anthropic cost.

**Cuisine multi-select chips** — soft filter at the top of each occasion page. State is client-side React; selecting "Italian + Korean" filters to restaurants tagged with either. "Clear" resets.

**Price tier display** — `$` `$$` `$$$` `$$$$` next to each restaurant name. Restaurants tagged `$` automatically qualify for Under $25 (the seed script handles this — no double-tagging needed).

## Things to know

- **Old issues #1 and #2** still exist in your `restaurant_scores` table but are now invisible (the new home page only reads `occasion_scores`). They're harmless. You can ignore them or delete them with `delete from restaurant_scores;` and `delete from issues where number < 3;` if you want a clean slate.
- **The /issue/[number] route is gone** — historical issues don't have their own pages anymore. The /archive page just lists issue numbers without links.
- **TypeScript is strict** — if you tweak `seed-data.ts` to add a restaurant with a typo'd occasion, the build will fail.
- **Cuisine filtering is OR logic** — selecting "Italian + Pizza" shows Italian *or* Pizza places, not Italian-and-also-Pizza. That's intentional; AND logic would empty the list.

## What to test

After publishing your first categorized issue, click through each occasion:

- **Date Night:** Carbone, Don Angie, The Eighty-Six, Saint Theo's, Polo Bar should be near the top of overrated. Via Carota, I Sodi, Eyval, Cervo's near the top of underrated.
- **Group Dinner:** Carbone, COTE, Tatiana, Bonnie's near top overrated. Wu's Wonton King, Casa Enrique, Dhamaka near top underrated.
- **Solo Dining:** Sushi Nakazawa, Ippudo, Joe's Pizza most likely overrated. Tomoe Sushi, Ho Foods, Punjabi Deli underrated.
- **Brunch:** Jack's Wife Freda, Sadelle's, Clinton St Baking near top overrated. Russ & Daughters, Egg Shop somewhere middle.
- **Late Night:** Mel's, Eighty-Six near top overrated. Wo Hop, Veselka underrated.
- **Under $25:** Joe's Pizza, Prince St Pizza near top overrated. Wo Hop, Punjabi Deli, Vanessa's Dumpling House underrated.

If something feels really off (a TikTok-viral place ranking as quietly underrated, or vice versa), the scoring needs tuning — let me know and I'll adjust.

## Cuisine filter list (final)

`Italian · Korean · Japanese · Chinese · Pizza · Mexican · French · Thai · Mediterranean · American · Indian`

## Occasion list (final)

`Date Night · Group Dinner · Solo Dining · Brunch · Late Night · Under $25`
