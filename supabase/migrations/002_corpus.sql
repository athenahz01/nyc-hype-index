-- ============================================================
-- Migration 002 — continuous corpus + live search support
-- Run AFTER 001_occasions.sql. Idempotent.
-- ============================================================

-- 1. Continuous corpus: one row per restaurant with its current scores.
-- This is the source of truth for live search and for issue creation.
create table if not exists restaurant_latest_scores (
  restaurant_id     uuid primary key references restaurants(id) on delete cascade,

  -- Same fields as restaurant_scores, but only the latest set per restaurant
  tiktok_views      bigint default 0,
  tiktok_posts      int default 0,
  tiktok_peak_views bigint default 0,
  tiktok_caption_sentiment numeric(5,2),
  ig_posts          int default 0,
  ig_engagement     bigint default 0,
  google_rating     numeric(3,2),
  google_reviews    int default 0,
  reddit_mentions   int default 0,

  google_sentiment       numeric(5,2),
  reddit_sentiment       numeric(5,2),
  ig_comment_sentiment   numeric(5,2),

  -- Pre-normalization absolute scores. The publish step computes
  -- normalized versions and writes them to occasion_scores.
  hype_absolute     numeric(5,2),
  reality_absolute  numeric(5,2),

  scored_at         timestamptz not null default now(),

  -- Search source tracking (helps debug "where did this score come from")
  source            text check (source in ('batch','live_search','manual')) default 'batch',

  unique (restaurant_id)
);

create index if not exists rls_scored_at_idx on restaurant_latest_scores (scored_at desc);
create index if not exists rls_hype_idx on restaurant_latest_scores (hype_absolute desc nulls last);

-- 2. Search log for analytics + identifying which queries get repeat traffic
-- (so we can prioritize what to pre-scrape)
create table if not exists search_log (
  id            uuid primary key default gen_random_uuid(),
  query         text not null,
  matched_restaurant_id uuid references restaurants(id) on delete set null,
  was_cache_hit boolean default false,
  was_live_calc boolean default false,
  ip_hash       text, -- for rate limiting (sha256 of ip, not raw)
  searched_at   timestamptz not null default now()
);

create index if not exists search_log_query_idx on search_log (lower(query));
create index if not exists search_log_searched_at_idx on search_log (searched_at desc);
create index if not exists search_log_ip_idx on search_log (ip_hash, searched_at);

-- 3. Trigram extension for fuzzy restaurant name search
-- (so "carbon" finds "Carbone" etc.)
create extension if not exists pg_trgm;
create index if not exists restaurants_name_trgm_idx on restaurants using gin (name gin_trgm_ops);

-- 4. RLS for the new tables
alter table restaurant_latest_scores enable row level security;
alter table search_log enable row level security;

drop policy if exists "Public can read latest scores" on restaurant_latest_scores;
create policy "Public can read latest scores" on restaurant_latest_scores
  for select using (true); -- public, since this powers the search UI

drop policy if exists "Public can insert search logs" on search_log;
create policy "Public can insert search logs" on search_log
  for insert with check (true);

-- Service role can do everything; anon/auth can read latest_scores + insert search_log
