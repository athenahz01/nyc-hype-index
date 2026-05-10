/**
 * The scoring pipeline.
 *
 * For one restaurant, fetch all four signals (Google, TikTok, Reddit, Instagram),
 * score them with Claude, and return raw signals + per-restaurant scores.
 *
 * IMPORTANT: This module returns *absolute* scores per restaurant. The pipeline
 * (lib/pipeline.ts) then applies a relative-ranking pass across all 30 restaurants
 * in the issue to produce final, well-spread Hype/Reality scores. That two-stage
 * approach is critical: absolute scoring alone produces compressed distributions
 * because (a) Google reviews are mostly 4+ stars regardless of quality, and
 * (b) TikTok view sampling under-represents true virality at the high end.
 */

import type { Restaurant } from "./types";
import { getReviewsForRestaurant } from "./sources/google";
import { fetchTikTokSignal, type TikTokSignal } from "./sources/tiktok";
import { fetchRedditSignal, type RedditSignal } from "./sources/reddit";
import { fetchInstagramSignal, type InstagramSignal } from "./sources/instagram";
import { scoreSentiment, generateVerdict, summarizeTexts } from "./ai";

// ============================================================
// HYPE SCORING — capture peak virality, not just average
// ============================================================

/**
 * Returns an *absolute* hype score 0-100 for a single restaurant based on
 * three sub-signals from TikTok:
 *   1. Peak views (max single-video view count) — captures whether this
 *      restaurant has ever gone viral
 *   2. Total views across all returned videos — captures volume
 *   3. Engagement rate (likes/views) — captures whether the videos resonate
 *
 * The pipeline will z-score-normalize these across the issue afterward.
 */
function tiktokRawHype(s: TikTokSignal): number {
  if (s.videoCount === 0 || s.totalViews === 0) return 0;

  // Peak views — the single most-viewed video about this place.
  // This is the clearest signal of "has this gone viral".
  const peakViews = Math.max(...s.videos.map((v) => v.views), 0);

  // Three log-scaled sub-signals, each 0-100.
  // Peak: 1K → 20, 100K → 50, 1M → 70, 10M → 85, 100M → 100
  const peakScore = peakViews > 0 ? Math.min(100, (Math.log10(peakViews) - 3) * 15 + 20) : 0;

  // Volume: 10K total → 30, 1M → 60, 10M → 75, 100M → 90
  const volumeScore = s.totalViews > 0 ? Math.min(100, (Math.log10(s.totalViews) - 4) * 15 + 30) : 0;

  // Video count: how many videos came back from search.
  // 1 video → 20, 5 → 40, 20 → 60, 50 → 80, 100+ → 95
  const countScore = s.videoCount > 0 ? Math.min(100, (Math.log10(s.videoCount) + 1) * 30) : 0;

  // Blend: peak dominates (true viral signal), volume confirms, count is texture.
  return Math.max(0, peakScore * 0.55 + volumeScore * 0.30 + countScore * 0.15);
}

function instagramRawHype(s: InstagramSignal): number {
  if (s.postCount === 0) return 0;
  const peakLikes = Math.max(...s.posts.map((p) => p.likes), 0);
  const peakScore = peakLikes > 0 ? Math.min(100, (Math.log10(peakLikes) - 2) * 18 + 25) : 0;
  const engScore = s.totalEngagement > 0 ? Math.min(100, (Math.log10(s.totalEngagement) - 3) * 14 + 30) : 0;
  return Math.max(0, peakScore * 0.6 + engScore * 0.4);
}

// ============================================================
// REALITY SCORING — stretch the distribution
// ============================================================

/**
 * Stretch sentiment scores so they don't all cluster at 70-85.
 *
 * The problem: Google reviews are positively biased (happy people review more),
 * so Claude's sentiment scoring rarely goes below 65 even for mediocre places.
 *
 * The fix: re-anchor so that:
 *   - sentiment 50 (truly mixed) → reality 30
 *   - sentiment 70 (default "mostly positive") → reality 50
 *   - sentiment 85 (genuinely loved) → reality 75
 *   - sentiment 95 (universally raving) → reality 95
 *
 * This is a non-linear stretch. Mathematically it's a scaled exponential.
 */
function stretchSentiment(raw: number | null): number | null {
  if (raw === null) return null;
  // Normalize 50-100 → 0-1, then apply mild S-curve to spread the middle
  const t = Math.max(0, Math.min(1, (raw - 50) / 50));
  // Power curve: stretches the "default positive" middle range
  const stretched = Math.pow(t, 1.7);
  // Re-scale so we span 30-95 rather than 0-100 (a place with reviews
  // shouldn't score 0 just because Claude said 50)
  return 30 + stretched * 65;
}

// ============================================================
// MAIN SCORING FUNCTION
// ============================================================

export type ScoreResult = {
  // Raw counts
  tiktok_views: number;
  tiktok_posts: number;
  tiktok_peak_views: number;
  ig_posts: number;
  ig_engagement: number;
  google_rating: number | null;
  google_reviews: number;
  reddit_mentions: number;

  // Per-source sentiment scores (post-stretch, 0-100)
  google_sentiment: number | null;
  reddit_sentiment: number | null;
  ig_comment_sentiment: number | null;

  // Absolute scores (0-100). The pipeline may z-score-normalize these
  // across the issue to produce final published scores.
  hype_score: number;
  reality_score: number;
  gap: number;
  is_underrated: boolean;

  // Editorial
  verdict: string;

  // Debug
  debug: {
    googleSummary: string;
    redditSummary: string;
    igSummary: string;
    tiktokSummary: string;
  };
};

const HYPE_BLEND = { tiktok: 0.6, instagram: 0.4 };
const REALITY_WEIGHTS = {
  google: 0.55, // long-form local-guide reviews are the strongest signal
  reddit: 0.30, // honest discussions, no influencer noise — now via free Reddit JSON
  igComments: 0.15, // weakest of the three; people post nice photos
};

export async function scoreRestaurant(
  restaurant: Restaurant
): Promise<ScoreResult> {
  console.log(`[score] starting ${restaurant.name}`);

  // === Fetch all signals in parallel ===
  const [googleResult, tiktokResult, redditResult, instagramResult] =
    await Promise.allSettled([
      getReviewsForRestaurant(restaurant.name, restaurant.google_place_id),
      fetchTikTokSignal(restaurant.search_terms.length ? restaurant.search_terms : [restaurant.name]),
      fetchRedditSignal(restaurant.name),
      fetchInstagramSignal(restaurant.name),
    ]);

  const google =
    googleResult.status === "fulfilled" ? googleResult.value : { placeId: null, details: null };
  const tiktok =
    tiktokResult.status === "fulfilled"
      ? tiktokResult.value
      : { totalViews: 0, totalLikes: 0, totalComments: 0, videoCount: 0, videos: [] };
  const reddit =
    redditResult.status === "fulfilled"
      ? redditResult.value
      : { mentionCount: 0, totalScore: 0, mentions: [] };
  const instagram =
    instagramResult.status === "fulfilled"
      ? instagramResult.value
      : { postCount: 0, totalLikes: 0, totalComments: 0, totalEngagement: 0, posts: [] };

  if (googleResult.status === "rejected") console.warn(`[score] google failed:`, googleResult.reason);
  if (tiktokResult.status === "rejected") console.warn(`[score] tiktok failed:`, tiktokResult.reason);
  if (redditResult.status === "rejected") console.warn(`[score] reddit failed:`, redditResult.reason);
  if (instagramResult.status === "rejected")
    console.warn(`[score] instagram failed:`, instagramResult.reason);

  // === Sentiment scoring (parallel) ===
  const googleTexts = (google.details?.reviews ?? []).map((r) => r.text).filter(Boolean);
  const redditTexts = reddit.mentions.map((m) => `${m.title}\n${m.text}`).filter(Boolean);
  const igCaptions = instagram.posts.map((p) => p.caption).filter(Boolean);

  const [googleSent, redditSent, igSent] = await Promise.allSettled([
    googleTexts.length
      ? scoreSentiment("google", googleTexts)
      : Promise.resolve({ score: null, reasoning: "no data" }),
    redditTexts.length
      ? scoreSentiment("reddit", redditTexts)
      : Promise.resolve({ score: null, reasoning: "no data" }),
    igCaptions.length
      ? scoreSentiment("instagram_comments", igCaptions)
      : Promise.resolve({ score: null, reasoning: "no data" }),
  ]);

  const rawGoogle = googleSent.status === "fulfilled" ? (googleSent.value.score as number | null) : null;
  const rawReddit = redditSent.status === "fulfilled" ? (redditSent.value.score as number | null) : null;
  const rawIG = igSent.status === "fulfilled" ? (igSent.value.score as number | null) : null;

  // Apply sentiment stretch so reality scores aren't all clustered at 70-85
  const google_sentiment = stretchSentiment(rawGoogle);
  const reddit_sentiment = stretchSentiment(rawReddit);
  const ig_comment_sentiment = stretchSentiment(rawIG);

  // === Hype Score ===
  const tiktokHype = tiktokRawHype(tiktok);
  const instagramHype = instagramRawHype(instagram);
  const hype_score = tiktokHype * HYPE_BLEND.tiktok + instagramHype * HYPE_BLEND.instagram;

  // === Reality Score (weighted blend of available signals) ===
  let realityNumerator = 0;
  let realityDenominator = 0;
  if (google_sentiment !== null) {
    realityNumerator += google_sentiment * REALITY_WEIGHTS.google;
    realityDenominator += REALITY_WEIGHTS.google;
  }
  if (reddit_sentiment !== null) {
    realityNumerator += reddit_sentiment * REALITY_WEIGHTS.reddit;
    realityDenominator += REALITY_WEIGHTS.reddit;
  }
  if (ig_comment_sentiment !== null) {
    realityNumerator += ig_comment_sentiment * REALITY_WEIGHTS.igComments;
    realityDenominator += REALITY_WEIGHTS.igComments;
  }

  // Fallback if no sentiment signal at all
  const reality_score =
    realityDenominator > 0
      ? realityNumerator / realityDenominator
      : stretchSentiment((google.details?.rating ?? 4.0) * 20) ?? 50;

  const gap = hype_score - reality_score;
  const is_underrated = gap < -10;

  const debug = {
    googleSummary: summarizeTexts(googleTexts),
    redditSummary: summarizeTexts(redditTexts),
    igSummary: summarizeTexts(igCaptions),
    tiktokSummary: summarizeTexts(tiktok.videos.map((v) => v.text)),
  };

  const peakViews = tiktok.videos.length > 0 ? Math.max(...tiktok.videos.map((v) => v.views)) : 0;

  console.log(
    `[score] ${restaurant.name}: hype=${hype_score.toFixed(1)} reality=${reality_score.toFixed(1)} gap=${gap.toFixed(1)} (peakTT=${peakViews.toLocaleString()})`
  );

  // Verdict is generated AFTER normalization — see generateVerdictForScore.
  return {
    tiktok_views: tiktok.totalViews,
    tiktok_posts: tiktok.videoCount,
    tiktok_peak_views: peakViews,
    ig_posts: instagram.postCount,
    ig_engagement: instagram.totalEngagement,
    google_rating: google.details?.rating ?? null,
    google_reviews: google.details?.userRatingCount ?? 0,
    reddit_mentions: reddit.mentionCount,

    google_sentiment,
    reddit_sentiment,
    ig_comment_sentiment,

    hype_score: Math.round(hype_score * 100) / 100,
    reality_score: Math.round(reality_score * 100) / 100,
    gap: Math.round(gap * 100) / 100,
    is_underrated,
    verdict: "",  // populated later by generateVerdictForScore

    debug,
  };
}

/**
 * Generate the editorial verdict using the FINAL (normalized) scores.
 * Called by pipeline.ts in a second pass after relative normalization.
 *
 * Why split: relative normalization may flip a restaurant from "underrated"
 * to "overrated", so the verdict tone needs to match the final classification.
 */
export async function generateVerdictForScore(input: {
  restaurant: { name: string; neighborhood: string };
  finalHype: number;
  finalReality: number;
  finalGap: number;
  isUnderrated: boolean;
  debug: ScoreResult["debug"];
}): Promise<string> {
  try {
    return await generateVerdict({
      name: input.restaurant.name,
      neighborhood: input.restaurant.neighborhood,
      hypeScore: Math.round(input.finalHype),
      realityScore: Math.round(input.finalReality),
      gap: Math.round(input.finalGap),
      isUnderrated: input.isUnderrated,
      signals: input.debug,
    });
  } catch (e) {
    console.warn(`[verdict] failed for ${input.restaurant.name}:`, e);
    return input.isUnderrated
      ? "Quietly excellent. Locals know."
      : "Hype outpacing reality this week.";
  }
}

// ============================================================
// RELATIVE NORMALIZATION (called by pipeline)
// ============================================================

/**
 * Apply z-score-style normalization to spread Hype Scores across the issue.
 *
 * Why: even with the absolute formulas above, all 30 restaurants tend to
 * score in a tight 30-60 band. We want the *most* viral spot on the
 * leaderboard at ~92 and the *least* viral at ~12, with proportional
 * spread between. This is fundamentally what makes the leaderboard read
 * as a leaderboard.
 *
 * The transform: rank restaurants by their absolute score, then map to a
 * target distribution centered at 50 with reasonable spread (15-90).
 */
export function normalizeHypeAcrossIssue(
  scores: { restaurant_id: string; absolute_hype: number }[]
): Map<string, number> {
  const result = new Map<string, number>();
  if (scores.length === 0) return result;
  if (scores.length === 1) {
    result.set(scores[0].restaurant_id, scores[0].absolute_hype);
    return result;
  }

  // Sort by absolute hype descending
  const sorted = [...scores].sort((a, b) => b.absolute_hype - a.absolute_hype);

  // Map to target range. Top → 92, bottom → 12, with linear-ish spread
  // weighted toward the middle (so we don't squish the top).
  const N = sorted.length;
  for (let i = 0; i < N; i++) {
    // Percentile rank: 0 = top, 1 = bottom
    const pct = i / (N - 1);
    // Mirror it to a slight S-curve: the top few get more separation
    // pct=0 → 0.92, pct=0.5 → 0.50, pct=1 → 0.12
    const target = 92 - pct * 80;
    result.set(sorted[i].restaurant_id, Math.round(target * 100) / 100);
  }

  return result;
}

/**
 * Same normalization for reality scores. Less aggressive because reality
 * scores already have decent spread after the stretch transform.
 */
export function normalizeRealityAcrossIssue(
  scores: { restaurant_id: string; absolute_reality: number }[]
): Map<string, number> {
  const result = new Map<string, number>();
  if (scores.length === 0) return result;
  if (scores.length === 1) {
    result.set(scores[0].restaurant_id, scores[0].absolute_reality);
    return result;
  }

  // For reality, blend absolute + percentile-rank 70/30. We want absolute
  // values to mostly carry through (a 4.7-star place beats a 4.1-star place
  // even within an issue), but with some normalization to avoid clustering.
  const sorted = [...scores].sort((a, b) => b.absolute_reality - a.absolute_reality);
  const N = sorted.length;

  for (let i = 0; i < N; i++) {
    const pct = i / (N - 1);
    const percentileTarget = 90 - pct * 60; // 90 → 30
    const absoluteScore = sorted[i].absolute_reality;
    const blended = absoluteScore * 0.6 + percentileTarget * 0.4;
    result.set(sorted[i].restaurant_id, Math.round(blended * 100) / 100);
  }

  return result;
}
