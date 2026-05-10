-- ============================================================
-- NYC Hype Index — database schema
-- Run this in Supabase SQL editor (one-time setup)
-- ============================================================

-- Restaurants we track
create table if not exists restaurants (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,                   -- "carbone", "don-angie"
  name            text not null,                          -- "Carbone"
  neighborhood    text not null,                          -- "Greenwich Village"
  borough         text not null check (borough in ('manhattan','brooklyn','queens','bronx','staten-island')),
  google_place_id text,                                   -- pulled once, cached
  search_terms    text[] not null default '{}',           -- alt names for social search ["carbone nyc", "@carbonenyc"]
  active          boolean not null default true,          -- toggle off without deleting
  notes           text,                                   -- internal notes
  created_at      timestamptz not null default now()
);

create index if not exists restaurants_borough_idx on restaurants (borough);
create index if not exists restaurants_active_idx on restaurants (active);

-- Weekly issues (one row per Monday drop)
create table if not exists issues (
  id              uuid primary key default gen_random_uuid(),
  number          int unique not null,                    -- 1, 2, 3, ...
  published_at    timestamptz not null default now(),
  total_tiktok_views bigint default 0,                    -- aggregate stats for the issue stat bar
  total_ig_posts     int default 0,
  total_reviews      int default 0,
  is_published    boolean not null default false,         -- draft vs live
  notes           text                                    -- editor's note
);

create index if not exists issues_published_idx on issues (is_published, number desc);

-- Per-restaurant scores within an issue
create table if not exists restaurant_scores (
  id                uuid primary key default gen_random_uuid(),
  issue_id          uuid not null references issues(id) on delete cascade,
  restaurant_id     uuid not null references restaurants(id) on delete cascade,

  -- Hype side (social virality)
  tiktok_views      bigint default 0,
  tiktok_posts      int default 0,
  ig_posts          int default 0,
  ig_engagement     bigint default 0,
  hype_score        numeric(5,2) not null,                -- 0-100

  -- Reality side (what actual diners say)
  google_rating     numeric(3,2),
  google_reviews    int default 0,
  google_sentiment  numeric(5,2),                         -- 0-100, claude-scored
  reddit_mentions   int default 0,
  reddit_sentiment  numeric(5,2),
  ig_comment_sentiment numeric(5,2),
  reality_score     numeric(5,2) not null,                -- 0-100

  -- Result
  gap               numeric(5,2) not null,                -- hype - reality (positive=overrated, negative=underrated)
  rank              int,                                  -- final ranking in this issue (1, 2, 3...)
  is_underrated     boolean not null default false,       -- shown in bonus section if true

  -- Editorial
  verdict           text,                                 -- claude-generated 1-line take
  trend             text check (trend in ('up','down','same','new')) default 'new',
  trend_label       text,                                 -- "↑ 4 from last week"

  computed_at       timestamptz not null default now(),
  unique (issue_id, restaurant_id)
);

create index if not exists scores_issue_idx on restaurant_scores (issue_id);
create index if not exists scores_rank_idx on restaurant_scores (issue_id, rank);

-- User submissions (tip a restaurant)
create table if not exists tips (
  id              uuid primary key default gen_random_uuid(),
  restaurant_name text not null,
  neighborhood    text,
  reason          text,
  submitter_email text,                                   -- optional
  status          text not null default 'pending' check (status in ('pending','reviewing','added','rejected')),
  created_at      timestamptz not null default now()
);

-- Email subscribers
create table if not exists subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text unique not null,
  source          text default 'web',                     -- where they signed up from
  confirmed       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists subscribers_email_idx on subscribers (email);

-- Raw cache so we don't re-fetch same data within a refresh window
create table if not exists raw_cache (
  cache_key       text primary key,                       -- e.g. "google:carbone-nyc"
  data            jsonb not null,
  fetched_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

create index if not exists raw_cache_expires_idx on raw_cache (expires_at);

-- ============================================================
-- ROW LEVEL SECURITY
-- Public reads on published data only.
-- Writes only via service role key (cron job).
-- ============================================================

alter table restaurants enable row level security;
alter table issues enable row level security;
alter table restaurant_scores enable row level security;
alter table tips enable row level security;
alter table subscribers enable row level security;
alter table raw_cache enable row level security;

-- Public can read active restaurants
drop policy if exists "Public can read active restaurants" on restaurants;
create policy "Public can read active restaurants" on restaurants
  for select using (active = true);

-- Public can read published issues
drop policy if exists "Public can read published issues" on issues;
create policy "Public can read published issues" on issues
  for select using (is_published = true);

-- Public can read scores for published issues
drop policy if exists "Public can read scores for published issues" on restaurant_scores;
create policy "Public can read scores for published issues" on restaurant_scores
  for select using (
    exists (select 1 from issues where issues.id = restaurant_scores.issue_id and issues.is_published = true)
  );

-- Anyone can insert tips (with rate limit handled at API layer)
drop policy if exists "Anyone can submit tips" on tips;
create policy "Anyone can submit tips" on tips
  for insert with check (true);

-- Anyone can subscribe
drop policy if exists "Anyone can subscribe" on subscribers;
create policy "Anyone can subscribe" on subscribers
  for insert with check (true);

-- raw_cache is service-role only (no public policy = no public access)
