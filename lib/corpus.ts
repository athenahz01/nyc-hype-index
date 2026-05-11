/**
 * Continuous corpus: the heart of the v2 architecture.
 *
 * The product previously coupled "score N restaurants" with "publish issue."
 * That made batching impossible and live search hard. v2 decouples:
 *
 *   - `scoreOneRestaurant(r)` — scores one restaurant, upserts its row
 *     into `restaurant_latest_scores`. Used by batch jobs AND live search.
 *
 *   - `runBatch(offset, limit)` — scores a slice of the active corpus.
 *     Can be run multiple times across days (Mon batch 1, Tue batch 2…)
 *     to spread cost and avoid long-running scripts.
 *
 *   - `publishIssue()` — reads all current scores from `restaurant_latest_scores`,
 *     applies z-score normalization across the entire corpus, builds the
 *     per-occasion leaderboards, and writes a frozen snapshot to
 *     `occasion_scores`. Does no scraping.
 *
 * This separation means:
 *   - Live search can update one row in real time
 *   - A batch failure doesn't kill the issue
 *   - Issue publishing is cheap & fast (DB-only)
 */

import { createAdminClient } from "./supabase";
import { scoreRestaurant, normalizeIssue, GAP_THRESHOLD, generateVerdictForScore, type ScoreResult } from "./scoring";
import type { Restaurant, Trend, Occasion } from "./types";
import { OCCASIONS } from "./types";

// ============================================================
// SCORE & PERSIST ONE RESTAURANT
// ============================================================

/**
 * Score one restaurant and upsert its row to `restaurant_latest_scores`.
 * Returns the score for inspection. Throws on critical errors.
 *
 * Tags the row's `source` field so we can tell where the score came from
 * (batched refresh vs. live search vs. manual override).
 */
export async function scoreOneRestaurant(
  restaurant: Restaurant,
  source: "batch" | "live_search" | "manual" = "batch"
): Promise<ScoreResult> {
  const supabase = createAdminClient();

  const score = await scoreRestaurant(restaurant);

  const { error } = await supabase
    .from("restaurant_latest_scores")
    .upsert(
      {
        restaurant_id: restaurant.id,
        tiktok_views: score.tiktok_views,
        tiktok_posts: score.tiktok_posts,
        tiktok_peak_views: score.tiktok_peak_views,
        tiktok_caption_sentiment: score.tiktok_caption_sentiment,
        ig_posts: score.ig_posts,
        ig_engagement: score.ig_engagement,
        google_rating: score.google_rating,
        google_reviews: score.google_reviews,
        reddit_mentions: score.reddit_mentions,
        google_sentiment: score.google_sentiment,
        reddit_sentiment: score.reddit_sentiment,
        ig_comment_sentiment: score.ig_comment_sentiment,
        hype_absolute: score.hype_score,
        reality_absolute: score.reality_score,
        scored_at: new Date().toISOString(),
        source,
      },
      { onConflict: "restaurant_id" }
    );

  if (error) throw new Error(`persist score for ${restaurant.name}: ${error.message}`);

  return score;
}

// ============================================================
// BATCHED SCRAPING
// ============================================================

export type BatchResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  failures: { name: string; error: string }[];
};

/**
 * Score a slice of active restaurants and persist to corpus.
 *
 *   runBatch({offset: 0, limit: 20}) → first 20
 *   runBatch({offset: 20, limit: 20}) → next 20
 *
 * Useful for spreading a 200-restaurant refresh over multiple sessions
 * or days without timing out.
 */
export async function runBatch(
  opts: { offset?: number; limit?: number; staleOnly?: boolean } = {}
): Promise<BatchResult> {
  const supabase = createAdminClient();
  const { offset = 0, limit = 20, staleOnly = false } = opts;

  // Fetch active restaurants in alphabetical order so offset/limit are deterministic
  let query = supabase.from("restaurants").select("*").eq("active", true).order("name");
  const { data: restaurants, error } = await query;
  if (error) throw new Error(`fetch restaurants: ${error.message}`);
  if (!restaurants?.length) throw new Error("no active restaurants — run seed first");

  let targets = restaurants as Restaurant[];

  // Optional: only re-score restaurants that haven't been scored in 7+ days
  if (staleOnly) {
    const { data: fresh } = await supabase
      .from("restaurant_latest_scores")
      .select("restaurant_id")
      .gte("scored_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    const freshIds = new Set((fresh ?? []).map((r) => r.restaurant_id));
    targets = targets.filter((r) => !freshIds.has(r.id));
    console.log(`[batch] staleOnly mode: ${targets.length} of ${restaurants.length} need refresh`);
  }

  const slice = targets.slice(offset, offset + limit);
  console.log(
    `[batch] scoring ${slice.length} restaurants (offset=${offset}, limit=${limit}, of ${targets.length} total)`
  );

  const failures: { name: string; error: string }[] = [];
  let succeeded = 0;

  for (const r of slice) {
    try {
      await scoreOneRestaurant(r, "batch");
      succeeded++;
    } catch (e: any) {
      console.error(`[batch] failed ${r.name}:`, e?.message ?? e);
      failures.push({ name: r.name, error: String(e?.message ?? e) });
    }
  }

  return {
    attempted: slice.length,
    succeeded,
    failed: failures.length,
    failures,
  };
}

// ============================================================
// PUBLISH ISSUE (reads from corpus, builds frozen snapshot)
// ============================================================

export type PublishResult = {
  issueId: string;
  issueNumber: number;
  corpusSize: number;
  occasionsBuilt: number;
  totalRankings: number;
};

/**
 * Read the latest scores from `restaurant_latest_scores`, run z-score
 * normalization across the entire corpus, build per-occasion leaderboards,
 * and write a frozen snapshot to `occasion_scores`.
 *
 * Does NO scraping. Just transforms the corpus state into a published issue.
 */
export async function publishIssue(opts: { publish?: boolean } = {}): Promise<PublishResult> {
  const supabase = createAdminClient();

  // Read all current scored restaurants
  const { data: corpus, error: cErr } = await supabase
    .from("restaurant_latest_scores")
    .select(
      `
      *,
      restaurant:restaurants!inner ( id, slug, name, neighborhood, borough, cuisines, occasions, price_tier, active )
    `
    )
    .not("hype_absolute", "is", null)
    .not("reality_absolute", "is", null);

  if (cErr) throw new Error(`fetch corpus: ${cErr.message}`);
  if (!corpus || corpus.length === 0) throw new Error("corpus is empty — run scoring first");

  // Filter to only active restaurants
  const active = (corpus as any[]).filter((c) => c.restaurant?.active);
  console.log(`[publish] corpus size: ${active.length} active restaurants`);

  if (active.length < 10) {
    throw new Error(`corpus too small to publish (${active.length} restaurants) — need at least 10`);
  }

  // === Global z-score normalization across the whole corpus ===
  const normalized = normalizeIssue(
    active.map((c) => ({
      restaurant_id: c.restaurant_id,
      absolute_hype: Number(c.hype_absolute),
      absolute_reality: Number(c.reality_absolute),
    }))
  );
  const normMap = new Map(normalized.map((n) => [n.restaurant_id, n]));

  // === Issue number + previous issue trend lookup ===
  const { data: lastIssue } = await supabase
    .from("issues")
    .select("number")
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const newIssueNumber = (lastIssue?.number ?? 0) + 1;

  const { data: prevIssue } = await supabase
    .from("issues")
    .select("id, number")
    .eq("is_published", true)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const prevRanks = new Map<string, number>();
  if (prevIssue) {
    const { data: prev } = await supabase
      .from("occasion_scores")
      .select("restaurant_id, occasion, rank")
      .eq("issue_id", prevIssue.id);
    for (const ps of prev ?? []) {
      prevRanks.set(`${ps.occasion}:${ps.restaurant_id}`, ps.rank ?? 0);
    }
  }

  function trend(occ: Occasion, rId: string, newRank: number): { trend: Trend; label: string } {
    const prev = prevRanks.get(`${occ}:${rId}`);
    if (prev === undefined) return { trend: "new", label: "★ new entry" };
    const diff = prev - newRank;
    if (diff === 0) return { trend: "same", label: "—  unchanged" };
    if (diff > 0) return { trend: "up", label: `↑ ${diff} from last week` };
    return { trend: "down", label: `↓ ${Math.abs(diff)} from last week` };
  }

  // === Stats for the issue ===
  const total_tiktok_views = active.reduce((s, c) => s + Number(c.tiktok_views ?? 0), 0);
  const total_ig_posts = active.reduce((s, c) => s + Number(c.ig_posts ?? 0), 0);
  const total_reviews = active.reduce((s, c) => s + Number(c.google_reviews ?? 0) + Number(c.reddit_mentions ?? 0), 0);

  // === Insert the issue ===
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

  // === For each occasion, build the leaderboard ===
  const occasionRows: any[] = [];
  let occasionsBuilt = 0;

  for (const occasion of OCCASIONS) {
    const inOccasion = active.filter((c) => c.restaurant?.occasions?.includes(occasion));
    const significant = inOccasion
      .map((c) => {
        const n = normMap.get(c.restaurant_id);
        if (!n) return null;
        return { entry: c, n };
      })
      .filter((x): x is { entry: any; n: any } => x !== null)
      .filter((x) => Math.abs(x.n.gap_normalized) >= GAP_THRESHOLD);

    if (significant.length < 3) {
      console.log(`[publish] skipping ${occasion} — only ${significant.length} significant entries`);
      continue;
    }

    console.log(`[publish] ${occasion}: ${significant.length} significant entries`);

    // Generate verdicts using normalized scores
    type WithVerdict = { entry: any; n: any; verdict: string; isUnderrated: boolean };
    const withVerdicts: WithVerdict[] = [];
    for (const e of significant) {
      const isUnderrated = e.n.gap_normalized < 0;
      const verdict = await generateVerdictForScore({
        restaurant: { name: e.entry.restaurant.name, neighborhood: e.entry.restaurant.neighborhood },
        finalHype: e.n.hype_normalized,
        finalReality: e.n.reality_normalized,
        finalGap: e.n.gap_normalized,
        isUnderrated,
        // We don't have debug summaries in the corpus (they're scoring-time only).
        // The verdict prompt handles missing signals OK.
        debug: { googleSummary: "", redditSummary: "", igSummary: "", tiktokSummary: "" },
      });
      withVerdicts.push({ entry: e.entry, n: e.n, verdict, isUnderrated });
    }

    const over = withVerdicts.filter((w) => !w.isUnderrated).sort((a, b) => b.n.gap_normalized - a.n.gap_normalized);
    const under = withVerdicts.filter((w) => w.isUnderrated).sort((a, b) => a.n.gap_normalized - b.n.gap_normalized);

    for (let i = 0; i < over.length; i++) {
      const w = over[i];
      const rank = i + 1;
      const trendInfo = trend(occasion, w.entry.restaurant_id, rank);
      occasionRows.push({
        issue_id: issueRow.id,
        restaurant_id: w.entry.restaurant_id,
        occasion,
        hype_score: w.n.hype_normalized,
        reality_score: w.n.reality_normalized,
        gap: w.n.gap_normalized,
        rank,
        is_underrated: false,
        trend: trendInfo.trend,
        trend_label: trendInfo.label,
        verdict: w.verdict,
      });
    }
    for (let i = 0; i < under.length; i++) {
      const w = under[i];
      const rank = i + 1;
      const trendInfo = trend(occasion, w.entry.restaurant_id, rank);
      occasionRows.push({
        issue_id: issueRow.id,
        restaurant_id: w.entry.restaurant_id,
        occasion,
        hype_score: w.n.hype_normalized,
        reality_score: w.n.reality_normalized,
        gap: w.n.gap_normalized,
        rank,
        is_underrated: true,
        trend: trendInfo.trend,
        trend_label: trendInfo.label,
        verdict: w.verdict,
      });
    }
    occasionsBuilt++;
  }

  // Bulk insert in chunks
  if (occasionRows.length > 0) {
    const CHUNK = 100;
    for (let i = 0; i < occasionRows.length; i += CHUNK) {
      const slice = occasionRows.slice(i, i + CHUNK);
      const { error } = await supabase.from("occasion_scores").insert(slice);
      if (error) throw new Error(`insert occasion_scores: ${error.message}`);
    }
  }

  console.log(
    `[publish] issue #${newIssueNumber}: ${occasionsBuilt} occasions, ${occasionRows.length} total rankings`
  );

  return {
    issueId: issueRow.id,
    issueNumber: newIssueNumber,
    corpusSize: active.length,
    occasionsBuilt,
    totalRankings: occasionRows.length,
  };
}
