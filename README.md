# The NYC Hype Index

A weekly leaderboard ranking NYC restaurants by the gap between their social hype (TikTok + Instagram virality) and their reality (Google reviews + Reddit + IG comment sentiment).

The bigger the gap, the more overrated. Updated weekly via Vercel Cron.

---

## What's in this repo

```
nyc-hype-index/
├── app/
│   ├── api/
│   │   ├── cron/refresh/route.ts    # Weekly cron — recomputes all scores
│   │   ├── tips/route.ts            # Public tip submission
│   │   └── subscribe/route.ts       # Email signup
│   ├── globals.css                  # Editorial design tokens + animations
│   ├── layout.tsx                   # Root layout + Google Fonts
│   └── page.tsx                     # Home page (latest issue)
├── components/
│   ├── Leaderboard.tsx              # The actual ranked table
│   ├── SubmitTip.tsx                # Tip-a-restaurant form
│   └── SubscribeForm.tsx            # Email capture
├── lib/
│   ├── sources/
│   │   ├── google.ts                # Google Places + reviews
│   │   ├── tiktok.ts                # Apify TikTok scraper
│   │   ├── reddit.ts                # Apify Reddit scraper
│   │   └── instagram.ts             # RapidAPI Instagram scraper
│   ├── ai.ts                        # Claude sentiment scoring + verdicts
│   ├── scoring.ts                   # Per-restaurant score computation
│   ├── pipeline.ts                  # Weekly issue creation orchestrator
│   ├── queries.ts                   # Public-facing data reads
│   ├── seed-data.ts                 # 30 NYC restaurants to track (edit me)
│   ├── supabase.ts                  # DB clients (anon + admin)
│   └── types.ts                     # Shared TypeScript types
├── scripts/
│   ├── seed.ts                      # `npm run seed` — populate restaurants
│   └── refresh.ts                   # `npm run refresh` — manual issue build
├── supabase/
│   └── schema.sql                   # Run this once in Supabase SQL editor
└── vercel.json                      # Cron schedule (every Monday 6am ET)
```

---

## Deployment — 7 steps

### 1. Install locally

```bash
npm install
```

### 2. Create your `.env.local`

Copy the template and fill in your collected keys:

```bash
cp .env.local.example .env.local
# then edit .env.local with your actual values
```

You'll also need to add a `CRON_SECRET` — make one up. Any random string works (e.g. paste from `openssl rand -hex 32`). This is what authenticates the cron job.

### 3. Set up the Supabase database

In your Supabase dashboard:
1. Open **SQL Editor**
2. Paste the entire contents of `supabase/schema.sql`
3. Click **Run**

This creates all 6 tables, indexes, and Row Level Security policies. Re-running the file is safe (everything uses `if not exists` / `drop policy if exists`).

### 4. Seed the restaurants

```bash
npm run seed
```

This uploads the 30 restaurants defined in `lib/seed-data.ts` to Supabase. To change the list, edit that file and re-run — it upserts on `slug` so it's safe to run repeatedly.

### 5. Run the first refresh manually

```bash
npm run refresh -- --publish
```

This:
- Pulls TikTok data via Apify (~$0.20 in credits)
- Pulls Reddit data via Apify (~$0.10 in credits)
- Pulls Instagram data via RapidAPI (free tier)
- Pulls Google Places reviews ($0, within free tier)
- Sends review/comment text to Claude for sentiment scoring (~$0.50 with Haiku 4.5)
- Computes Hype Score, Reality Score, and Gap for all 30 restaurants
- Creates "Issue #1" in Supabase, marked as published

**Total cost: ~$1 for the first run.** Takes 5-10 minutes since we score sequentially to respect rate limits.

After it finishes, your home page will show the real first issue.

> Without `--publish`, it creates a draft so you can preview before going live. Toggle `is_published = true` in Supabase manually to publish a draft.

### 6. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create nyc-hype-index --public --source=. --push
# or use the GitHub website to create the repo and push manually
```

### 7. Deploy to Vercel

1. Go to https://vercel.com/new
2. Import your `nyc-hype-index` repo
3. Add all environment variables from your `.env.local` to the Vercel project (Settings → Environment Variables)
4. Deploy

Vercel will:
- Build the site (~30 seconds)
- Set up the cron job for every Monday at 6am ET (defined in `vercel.json`)
- Give you a `nyc-hype-index.vercel.app` URL

### Optional: custom domain

Buy `nychypeindex.com` (or whatever you want) on Namecheap, point its DNS to Vercel per their instructions. Total cost ~$12/year.

---

## How the cron job works

Every Monday at 10:00 UTC (6am ET), Vercel Cron pings `/api/cron/refresh` with the auth header `Bearer ${CRON_SECRET}`.

That route runs `runRefresh({ publish: true })` which:
1. Reads all active restaurants
2. Scores each one (TikTok + IG + Google + Reddit + Claude sentiment)
3. Computes ranks vs. previous issue (for the "↑ 4 from last week" trend labels)
4. Writes a new `issues` row + 30 `restaurant_scores` rows
5. Marks the issue published — page goes live automatically

**Vercel Hobby plan note:** the free Hobby plan caps API routes at 60 seconds. The full pipeline takes ~5-10 minutes, so cron will time out on Hobby. Two options:
- (a) Upgrade to **Pro** ($20/mo, 800-second timeout) — cron works as designed
- (b) Stay on Hobby and run `npm run refresh -- --publish` manually each week

The local `npm run refresh` always works regardless of Vercel plan.

---

## Editing the restaurant list

Edit `lib/seed-data.ts`, then run `npm run seed` again. The seed function upserts on `slug` — adding a new restaurant just adds it; deleting one from the file does NOT delete it from Supabase (toggle `active = false` in the dashboard if you want to drop it from the rankings).

To add a new restaurant:
```ts
{
  slug: "kebab-case-name",                 // unique
  name: "Display Name",
  neighborhood: "West Village",
  borough: "manhattan",                    // manhattan | brooklyn | queens | bronx | staten-island
  search_terms: ["display name", "@iginhandle"],   // used for social search
  notes: "Internal note about why it's in the index",
}
```

The `search_terms` array is critical — it's what the TikTok and Reddit scrapers use to find content. Include common variations and the Instagram handle if known.

---

## How the scoring works

Every Monday, for every active restaurant:

**Hype Score (0-100)** = `0.55 × TikTok signal + 0.45 × Instagram signal`
- TikTok signal: log10 of total view count across recent videos, mapped to 0-100
- Instagram signal: log10 of total engagement (likes + comments) across hashtag posts

**Reality Score (0-100)** = weighted average of:
- 0.55 × Google review sentiment (Claude-scored from up to 5 most recent reviews)
- 0.30 × Reddit thread sentiment (Claude-scored from r/FoodNYC, r/AskNYC, r/nyc)
- 0.15 × Instagram caption sentiment

**Gap** = Hype − Reality.
- Gap > 0 → overrated (goes in main leaderboard)
- Gap < -5 → underrated (goes in Bonus Round section)
- -5 ≤ Gap ≤ 5 → not interesting enough either way; appears in main with low rank

You can tune these weights in `lib/scoring.ts`. They're all marked `HYPE_WEIGHTS` and `REALITY_WEIGHTS` as constants.

---

## Costs per weekly run

| Service | Per run | Notes |
|---------|---------|-------|
| Apify TikTok | ~$0.20 | 30 restaurants × ~15 videos each |
| Apify Reddit | ~$0.10 | 30 restaurants × 4 subreddits |
| Google Places | $0 | Within $200/mo free credit |
| RapidAPI Instagram | $0 | Within free tier (120 req/mo) |
| Claude Haiku 4.5 | ~$0.50 | ~30 restaurants × 4 sentiment calls + 30 verdicts |
| **Total** | **~$0.80–1.00** | per weekly issue |

Plus:
- Vercel: $0 on Hobby (cron capped at 60s — won't finish), $20/mo Pro (works)
- Supabase: $0 on free tier
- Domain: ~$12/year if you buy one

**Annual cost: ~$50 + Vercel Pro if you want auto-cron = ~$300/year.** Or ~$50 if you run refresh manually each week.

---

## Local testing

```bash
npm run dev          # starts dev server on localhost:3000
npm run build        # production build (catches type errors)
npm run seed         # uploads restaurant list
npm run refresh      # creates a draft issue
npm run refresh -- --publish    # creates and publishes
```

If you change the schema, re-run `supabase/schema.sql` in the Supabase SQL editor (it's idempotent).

---

## Going public — checklist before you tweet about it

- [ ] Visit your live URL — does it look right?
- [ ] Open it on your phone — does it look right?
- [ ] Read every verdict — are any embarrassingly wrong? Edit them in the Supabase `restaurant_scores` table directly. Verdicts are AI-generated; some will need a human pass for the first issue.
- [ ] Submit a test tip via the form — does it land in the `tips` table?
- [ ] Subscribe with your own email — does it land in the `subscribers` table?
- [ ] Take a screenshot of your top 10 — is it screenshot-worthy? That's the whole product.

---

## Things you'll probably want to add later (not blockers)

- Email sending (hook `subscribers` up to Resend, Buttondown, or Beehiiv to actually send the weekly digest)
- Issue archive (`/issue/[number]` route — already plumbed for it via `lib/queries.ts:fetchIssueByNumber`, just needs the page file)
- Restaurant detail pages (`/r/[slug]` — show all historical scores for one restaurant over time)
- "Compare" feature (pick 2 restaurants, see their gap trajectories side-by-side)
- LA Hype Index, London Hype Index — same code, new seed list, new domain

---

Built for screenshots. Made to be petty in a fun, defensible way.
