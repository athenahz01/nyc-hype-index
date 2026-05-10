-- ============================================================
-- NYC Hype Index — Migration 001: occasion-based leaderboards
-- Run this AFTER the original schema.sql has been applied.
-- Safe to re-run (idempotent).
-- ============================================================

-- 1. Add new columns to restaurants
alter table restaurants
  add column if not exists cuisines text[] not null default '{}',
  add column if not exists occasions text[] not null default '{}',
  add column if not exists price_tier text check (price_tier in ('$','$$','$$$','$$$$'));

create index if not exists restaurants_cuisines_idx on restaurants using gin (cuisines);
create index if not exists restaurants_occasions_idx on restaurants using gin (occasions);

-- 2. Per-occasion scores within an issue.
-- One row per (issue, restaurant, occasion) — a single restaurant can appear
-- in multiple occasion leaderboards with different ranks but the same
-- absolute hype/reality scores.
create table if not exists occasion_scores (
  id                uuid primary key default gen_random_uuid(),
  issue_id          uuid not null references issues(id) on delete cascade,
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  occasion          text not null,

  -- Hype/reality scores normalized RELATIVE TO this occasion's restaurants only
  hype_score        numeric(5,2) not null,
  reality_score     numeric(5,2) not null,
  gap               numeric(5,2) not null,

  rank              int not null,
  is_underrated     boolean not null default false,

  -- Trend within this occasion
  trend             text check (trend in ('up','down','same','new')) default 'new',
  trend_label       text,

  -- The verdict can vary per occasion since context changes
  verdict           text,

  computed_at       timestamptz not null default now(),
  unique (issue_id, restaurant_id, occasion)
);

create index if not exists occasion_scores_issue_occasion_idx on occasion_scores (issue_id, occasion, rank);
create index if not exists occasion_scores_occasion_idx on occasion_scores (occasion);

-- 3. RLS for the new table
alter table occasion_scores enable row level security;

drop policy if exists "Public can read occasion scores for published issues" on occasion_scores;
create policy "Public can read occasion scores for published issues" on occasion_scores
  for select using (
    exists (select 1 from issues where issues.id = occasion_scores.issue_id and issues.is_published = true)
  );
