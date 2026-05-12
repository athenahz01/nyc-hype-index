-- ============================================================
-- Migration 003 — persist signal summaries to corpus
-- Run AFTER 002_corpus.sql. Idempotent.
-- ============================================================
--
-- Why: publishIssue() generates verdicts from the corpus, but the corpus
-- only had numeric scores — no caption/review text. Claude with no signal
-- input refused to write verdicts and instead wrote "I can't write this
-- verdict because the signals section shows no actual data..." which
-- leaked into production.
--
-- Fix: persist short text summaries to the corpus so verdicts at publish
-- time always have real material to work with.
-- ============================================================

alter table restaurant_latest_scores
  add column if not exists google_summary text,
  add column if not exists reddit_summary text,
  add column if not exists ig_summary text,
  add column if not exists tiktok_summary text;