/**
 * Pipeline: create a new weekly issue from scratch.
 *
 * Each restaurant is scored ONCE (one set of API calls, one set of Claude
 * sentiment scores) but appears in MULTIPLE occasion leaderboards. The
 * normalization happens per-occasion so a restaurant's rank can differ
 * between its leaderboards (e.g. Carbone is #1 in date-night but #4 in
 * group-dinner).
 *
 * Steps:
 *   1. Pull active restaurants
 *   2. Score each one (TikTok, IG, Google, Reddit + Claude sentiment)
 *      — produces absolute hype/reality
 *   3. For each occasion:
 *        - filter to restaurants tagged for that occasion
 *        - normalize hype/reality across that subset
 *        - generate per-occasion verdict
 *        - rank by gap
 *   4. Write rows to `occasion_scores`
 */

import { createAdminClient } from "./supabase";
import {
  scoreRestaurant,
  generateVerdictForScore,
  normalizeHypeAcrossIssue,
  normalizeRealityAcrossIssue,
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

  // === 2. Score each (sequential) ===
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

  // === 3. Issue number ===
  const { data: lastIssue } = await supabase
    .from("issues")
    .select("number")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const newIssueNumber = (lastIssue?.number ?? 0) + 1;

  // === 4. Aggregate stats for the issue stat bar ===
  const total_tiktok_views = scored.reduce((s, e) => s + e.score.tiktok_views, 0);
  const total_ig_posts = scored.reduce((s, e) => s + e.score.ig_posts, 0);
  const total_reviews = scored.reduce((s, e) => s + e.score.google_reviews + e.score.reddit_mentions, 0);

  // === 5. Look up previous issue for trend computation ===
  const { data: prevIssue } = await supabase
    .from("issues")
    .select("id, number")
    .eq("is_published", true)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Map prev (occasion, restaurant_id) → rank for trend deltas
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

  // === 7. For each occasion, build a per-occasion leaderboard ===
  const occasionRows: any[] = [];
  let occasionsBuilt = 0;

  for (const occasion of OCCASIONS) {
    // Filter to restaurants tagged for this occasion
    const inOccasion = scored.filter((s) => s.restaurant.occasions.includes(occasion));

    // Skip occasions with too few entries
    if (inOccasion.length < 3) {
      console.log(`[pipeline] skipping ${occasion} — only ${inOccasion.length} restaurants tagged`);
      continue;
    }

    console.log(`[pipeline] building ${occasion} leaderboard (${inOccasion.length} restaurants)`);

    // Normalize hype + reality WITHIN this occasion's subset
    const hypeMap = normalizeHypeAcrossIssue(
      inOccasion.map((s) => ({ restaurant_id: s.restaurant.id, absolute_hype: s.score.hype_score }))
    );
    const realityMap = normalizeRealityAcrossIssue(
      inOccasion.map((s) => ({
        restaurant_id: s.restaurant.id,
        absolute_reality: s.score.reality_score,
      }))
    );

    // Build per-occasion entries with normalized scores
    type OccasionEntry = {
      entry: ScoredEntry;
      hype: number;
      reality: number;
      gap: number;
      isUnderrated: boolean;
      verdict: string;
    };
    const entries: OccasionEntry[] = [];

    for (const s of inOccasion) {
      const hype = hypeMap.get(s.restaurant.id) ?? s.score.hype_score;
      const reality = realityMap.get(s.restaurant.id) ?? s.score.reality_score;
      const gap = hype - reality;
      const isUnderrated = gap < -8;
      entries.push({
        entry: s,
        hype: Math.round(hype * 100) / 100,
        reality: Math.round(reality * 100) / 100,
        gap: Math.round(gap * 100) / 100,
        isUnderrated,
        verdict: "", // populated below
      });
    }

    // Generate verdicts for this occasion using its FINAL normalized scores
    for (const e of entries) {
      e.verdict = await generateVerdictForScore({
        restaurant: { name: e.entry.restaurant.name, neighborhood: e.entry.restaurant.neighborhood },
        finalHype: e.hype,
        finalReality: e.reality,
        finalGap: e.gap,
        isUnderrated: e.isUnderrated,
        debug: e.entry.score.debug,
      });
    }

    // Sort: overrated descending by gap, then underrated ascending by gap (most negative first)
    const overrated = entries.filter((e) => !e.isUnderrated).sort((a, b) => b.gap - a.gap);
    const underrated = entries.filter((e) => e.isUnderrated).sort((a, b) => a.gap - b.gap);

    // Combine: overrated first (rank 1, 2, 3...), then underrated continues numbering
    const ordered = [...overrated, ...underrated];

    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i];
      const rank = e.isUnderrated ? underrated.indexOf(e) + 1 : overrated.indexOf(e) + 1;
      const trendInfo = computeTrend(occasion, e.entry.restaurant.id, rank);

      occasionRows.push({
        issue_id: issueRow.id,
        restaurant_id: e.entry.restaurant.id,
        occasion,
        hype_score: e.hype,
        reality_score: e.reality,
        gap: e.gap,
        rank,
        is_underrated: e.isUnderrated,
        trend: trendInfo.trend,
        trend_label: trendInfo.label,
        verdict: e.verdict,
      });
    }

    occasionsBuilt++;
  }

  // === 8. Insert all occasion_scores rows ===
  if (occasionRows.length > 0) {
    // Insert in chunks to stay under any payload limits
    const CHUNK = 100;
    for (let i = 0; i < occasionRows.length; i += CHUNK) {
      const slice = occasionRows.slice(i, i + CHUNK);
      const { error } = await supabase.from("occasion_scores").insert(slice);
      if (error) throw new Error(`insert occasion_scores chunk: ${error.message}`);
    }
  }

  console.log(
    `[pipeline] issue #${newIssueNumber}: ${occasionsBuilt} occasions, ${occasionRows.length} total rankings`
  );

  return {
    issueId: issueRow.id,
    issueNumber: newIssueNumber,
    scored: scored.length,
    failed: failures.length,
    occasionsBuilt,
  };
}
