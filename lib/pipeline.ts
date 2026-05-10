/**
 * Pipeline v1.5 — global z-score normalization with per-occasion filtering.
 *
 * Flow:
 *   1. Score each restaurant (TikTok views + sentiment, IG, Google + volume,
 *      Reddit if reliable). Produces absolute hype/reality scores.
 *   2. Normalize ONCE across the entire issue using z-scores. Hype and
 *      Reality become comparable across all occasions.
 *   3. For each occasion: filter to its restaurants, exclude |gap| < 10
 *      (the "calibrated middle"), sort by gap, generate verdicts.
 *   4. Write to occasion_scores. Write a per-restaurant entry to
 *      restaurant_scores too (for consistency/debugging).
 */

import { createAdminClient } from "./supabase";
import {
  scoreRestaurant,
  generateVerdictForScore,
  normalizeIssue,
  GAP_THRESHOLD,
  type ScoreResult,
} from "./scoring";
import type { Restaurant, Trend, Occasion } from "./types";
import { OCCASIONS } from "./types";

export type RefreshResult = {
  issueId: string;
  issueNumber: number;
  scored: number;
  failed: number;
  occasionsBuilt: number;
  totalRankings: number;
};

export async function runRefresh(
  opts: { publish?: boolean; limit?: number } = {}
): Promise<RefreshResult> {
  const supabase = createAdminClient();

  // === 1. Get active restaurants ===
  const { data: restaurants, error: rErr } = await supabase
    .from("restaurants")
    .select("*")
    .eq("active", true)
    .order("name");

  if (rErr) throw new Error(`fetch restaurants: ${rErr.message}`);
  if (!restaurants?.length) throw new Error("no active restaurants — run seed first");

  const targetList = opts.limit
    ? (restaurants as Restaurant[]).slice(0, opts.limit)
    : (restaurants as Restaurant[]);
  console.log(
    `[pipeline] scoring ${targetList.length} restaurants${opts.limit ? ` (limit=${opts.limit})` : ""}`
  );

  // === 2. Score each (sequential to respect rate limits) ===
  type ScoredEntry = { restaurant: Restaurant; score: ScoreResult };
  const scored: ScoredEntry[] = [];
  const failures: { name: string; error: string }[] = [];

  for (const r of targetList) {
    try {
      const score = await scoreRestaurant(r);
      scored.push({ restaurant: r, score });
    } catch (e: any) {
      console.error(`[pipeline] failed scoring ${r.name}:`, e?.message ?? e);
      failures.push({ name: r.name, error: String(e?.message ?? e) });
    }
  }

  if (scored.length === 0) {
    throw new Error(`all ${targetList.length} restaurants failed — see logs`);
  }

  // === 3. GLOBAL z-score normalization ===
  // This is the crucial v1.5 change: hype/reality are now comparable
  // across all occasions, not normalized per-occasion.
  const normalized = normalizeIssue(
    scored.map((s) => ({
      restaurant_id: s.restaurant.id,
      absolute_hype: s.score.hype_score,
      absolute_reality: s.score.reality_score,
    }))
  );
  const normMap = new Map(normalized.map((n) => [n.restaurant_id, n]));

  // Apply normalized values back onto entries
  for (const entry of scored) {
    const norm = normMap.get(entry.restaurant.id);
    if (norm) {
      entry.score.hype_score = norm.hype_normalized;
      entry.score.reality_score = norm.reality_normalized;
      entry.score.gap = norm.gap_normalized;
      entry.score.is_underrated = norm.gap_normalized < -GAP_THRESHOLD;
    }
  }

  // === 4. Issue metadata ===
  const { data: lastIssue } = await supabase
    .from("issues")
    .select("number")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const newIssueNumber = (lastIssue?.number ?? 0) + 1;

  const total_tiktok_views = scored.reduce((s, e) => s + e.score.tiktok_views, 0);
  const total_ig_posts = scored.reduce((s, e) => s + e.score.ig_posts, 0);
  const total_reviews = scored.reduce((s, e) => s + e.score.google_reviews + e.score.reddit_mentions, 0);

  // === 5. Trend lookup against previous issue ===
  const { data: prevIssue } = await supabase
    .from("issues")
    .select("id, number")
    .eq("is_published", true)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevRanks: Map<string, number> = new Map();
  if (prevIssue) {
    const { data: prev } = await supabase
      .from("occasion_scores")
      .select("restaurant_id, occasion, rank")
      .eq("issue_id", prevIssue.id);
    for (const ps of prev ?? []) {
      prevRanks.set(`${ps.occasion}:${ps.restaurant_id}`, ps.rank ?? 0);
    }
  }

  function computeTrend(
    occasion: Occasion,
    restaurantId: string,
    newRank: number
  ): { trend: Trend; label: string } {
    const key = `${occasion}:${restaurantId}`;
    const prev = prevRanks.get(key);
    if (prev === undefined) return { trend: "new", label: "★ new entry" };
    const diff = prev - newRank;
    if (diff === 0) return { trend: "same", label: "—  unchanged" };
    if (diff > 0) return { trend: "up", label: `↑ ${diff} from last week` };
    return { trend: "down", label: `↓ ${Math.abs(diff)} from last week` };
  }

  // === 6. Insert new issue ===
  const { data: issueRow, error: issueErr } = await supabase
    .from("issues")
    .insert({
      number: newIssueNumber,
      total_tiktok_views,
      total_ig_posts,
      total_reviews,
      is_published: opts.publish ?? false,
      published_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (issueErr || !issueRow) throw new Error(`insert issue: ${issueErr?.message}`);

  // === 7. Per-occasion leaderboards ===
  const occasionRows: any[] = [];
  let occasionsBuilt = 0;

  for (const occasion of OCCASIONS) {
    // Filter to restaurants tagged for this occasion
    const inOccasion = scored.filter((s) => s.restaurant.occasions.includes(occasion));

    // Filter out the calibrated middle (|gap| < threshold) — these aren't
    // interesting either way and produce contradictory verdicts.
    const significant = inOccasion.filter((s) => Math.abs(s.score.gap) >= GAP_THRESHOLD);

    if (significant.length < 3) {
      console.log(
        `[pipeline] skipping ${occasion} — only ${significant.length} restaurants past threshold ` +
        `(${inOccasion.length} tagged total, but most are calibrated)`
      );
      continue;
    }

    console.log(
      `[pipeline] building ${occasion}: ${significant.length} significant entries ` +
      `(${inOccasion.length - significant.length} calibrated/filtered)`
    );

    // Generate verdicts using the globally-normalized scores
    type EntryWithVerdict = { entry: ScoredEntry; verdict: string };
    const withVerdicts: EntryWithVerdict[] = [];
    for (const e of significant) {
      const verdict = await generateVerdictForScore({
        restaurant: { name: e.restaurant.name, neighborhood: e.restaurant.neighborhood },
        finalHype: e.score.hype_score,
        finalReality: e.score.reality_score,
        finalGap: e.score.gap,
        isUnderrated: e.score.is_underrated,
        debug: e.score.debug,
      });
      withVerdicts.push({ entry: e, verdict });
    }

    // Sort
    const overrated = withVerdicts.filter((e) => !e.entry.score.is_underrated).sort((a, b) => b.entry.score.gap - a.entry.score.gap);
    const underrated = withVerdicts.filter((e) => e.entry.score.is_underrated).sort((a, b) => a.entry.score.gap - b.entry.score.gap);

    // Build rows
    for (let i = 0; i < overrated.length; i++) {
      const { entry, verdict } = overrated[i];
      const rank = i + 1;
      const trendInfo = computeTrend(occasion, entry.restaurant.id, rank);
      occasionRows.push({
        issue_id: issueRow.id,
        restaurant_id: entry.restaurant.id,
        occasion,
        hype_score: entry.score.hype_score,
        reality_score: entry.score.reality_score,
        gap: entry.score.gap,
        rank,
        is_underrated: false,
        trend: trendInfo.trend,
        trend_label: trendInfo.label,
        verdict,
      });
    }
    for (let i = 0; i < underrated.length; i++) {
      const { entry, verdict } = underrated[i];
      const rank = i + 1;
      const trendInfo = computeTrend(occasion, entry.restaurant.id, rank);
      occasionRows.push({
        issue_id: issueRow.id,
        restaurant_id: entry.restaurant.id,
        occasion,
        hype_score: entry.score.hype_score,
        reality_score: entry.score.reality_score,
        gap: entry.score.gap,
        rank,
        is_underrated: true,
        trend: trendInfo.trend,
        trend_label: trendInfo.label,
        verdict,
      });
    }

    occasionsBuilt++;
  }

  // === 8. Bulk insert occasion_scores in chunks ===
  if (occasionRows.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < occasionRows.length; i += CHUNK) {
      const slice = occasionRows.slice(i, i + CHUNK);
      const { error } = await supabase.from("occasion_scores").insert(slice);
      if (error) throw new Error(`insert occasion_scores chunk: ${error.message}`);
    }
  }

  console.log(
    `[pipeline] issue #${newIssueNumber}: ${occasionsBuilt} occasions, ` +
    `${occasionRows.length} total rankings (after filtering calibrated middle)`
  );

  return {
    issueId: issueRow.id,
    issueNumber: newIssueNumber,
    scored: scored.length,
    failed: failures.length,
    occasionsBuilt,
    totalRankings: occasionRows.length,
  };
}
