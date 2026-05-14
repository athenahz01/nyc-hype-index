-- ============================================================
-- Migration 004 — Phase 3A: voting + email infrastructure
-- ============================================================

-- ============================================================
-- 1. Votes table
-- ============================================================
-- Each row is one user voting agree/disagree on one verdict for one restaurant.
-- Scoped to (restaurant_id, occasion) because the same restaurant has different
-- verdicts in different occasion leaderboards — a user might agree Carbone is
-- overrated for date night but disagree for group dinner.
--
-- ip_hash is used to dedupe; one vote per IP per (restaurant_id, occasion).
-- Idempotent via unique constraint. Users can change their vote by re-voting
-- (upsert pattern).

create table if not exists restaurant_votes (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  occasion        text not null,
  vote            text not null check (vote in ('agree', 'disagree')),
  ip_hash         text not null,
  user_agent      text,
  voted_at        timestamptz not null default now(),

  unique (restaurant_id, occasion, ip_hash)
);

create index if not exists votes_restaurant_occasion_idx
  on restaurant_votes (restaurant_id, occasion);
create index if not exists votes_voted_at_idx
  on restaurant_votes (voted_at desc);

-- RLS: anyone can read aggregate counts; anyone can insert their own vote
alter table restaurant_votes enable row level security;

drop policy if exists "Public can read votes" on restaurant_votes;
create policy "Public can read votes" on restaurant_votes
  for select using (true);

drop policy if exists "Public can insert votes" on restaurant_votes;
create policy "Public can insert votes" on restaurant_votes
  for insert with check (true);

drop policy if exists "Public can update own vote" on restaurant_votes;
create policy "Public can update own vote" on restaurant_votes
  for update using (true);

-- ============================================================
-- 2. Subscriber enhancements for real email sending
-- ============================================================
-- Add columns to subscribers table to track sending state.

alter table subscribers
  add column if not exists welcomed_at timestamptz,
  add column if not exists last_digest_at timestamptz,
  add column if not exists unsubscribe_token text unique default gen_random_uuid()::text,
  add column if not exists is_active boolean default true;

create index if not exists subscribers_active_idx on subscribers (is_active);
create index if not exists subscribers_unsubscribe_token_idx on subscribers (unsubscribe_token);