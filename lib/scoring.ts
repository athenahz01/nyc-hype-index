/**
 * Scoring v1.5 — sentiment-aware hype + volume-weighted reality + z-score gap.
 *
 * KEY MODEL CHANGES vs. v1:
 *
 *   1. TikTok hype is sentiment-aware. We score TikTok captions for sentiment
 *      separately, and roast-y / mixed content reduces effective hype. A
 *      restaurant with 50M views of "this place is overrated" videos no
 *      longer counts as hyped — it counts as the algorithm AGREEING with
 *      the overrated thesis.
 *
 *   2. Google sentiment is volume-weighted. A 4.7★ on 8,000 reviews now
 *      scores higher than a 4.7★ on 80 reviews. log10(count) saturates
 *      around 3,000 reviews so the largest places don't dominate.
 *
 *   3. Reddit weight is dynamic. With <3 mentions Reddit's contribution to
 *      Reality drops to 0 (one offhand comment shouldn't move a score 30%).
 *      Google + IG re-weight to fill the gap.
 *
 *   4. Cross-issue z-score normalization. Hype and Reality are normalized
 *      against ALL restaurants in the issue (not per-occasion). A "+50 gap
 *      on Date Night" now means the same thing as "+50 gap on Brunch" —
 *      both are 1 stddev above mean hype, 1 stddev below mean reality, etc.
 *
 *   5. Calibrated middle is filtered. Restaurants with |gap| < 10 (about
 *      0.5 stddev) appear on neither leaderboard. They're "the algorithm
 *      and locals roughly agree" — not the story this product tells.
 *
 * The pipeline calls scoreRestaurant() for each, then normalizeIssue() once.
 */

import type { Restaurant } from "./types";
import { getReviewsForRestaurant } from "./sources/google";
import { fetchTikTokSignal, type TikTokSignal } from "./sources/tiktok";
import { fetchRedditSignal } from "./sources/reddit";
import { fetchInstagramSignal, type InstagramSignal } from "./sources/instagram";
import { scoreSentiment, generateVerdict, summarizeTexts } from "./ai";

// ============================================================
// HYPE — raw signal computation per restaurant
// ============================================================

/**
 * Convert TikTok signal to a 0-100 hype score, then dampen by sentiment.
 *
 * Sentiment dampening: a restaurant whose top videos are mostly positive
 * gets full hype credit. If captions skew negative ("don't waste your money,"
 * "overrated," "save your time"), those views count as agreement with the
 * overrated thesis — not as hype.
 *
 * Specifically:
 *   - sentiment >= 65 (mostly positive): full hype credit (multiplier 1.0)
 *   - sentiment ~ 50 (mixed): 70% credit
 *   - sentiment < 35 (negative): 40% credit — high views still indicate
 *     attention, but they're not "the algorithm thinks this is great"
 */
function tiktokHypeWithSentiment(s: TikTokSignal, captionSentiment: number | null): number {
  if (s.videoCount === 0 || s.totalViews === 0) return 0;

  const peakViews = Math.max(...s.videos.map((v) => v.views), 0);

  // Peak: 1K → 20, 100K → 50, 1M → 70, 10M → 85, 100M → 100
  const peakScore = peakViews > 0 ? Math.min(100, (Math.log10(peakViews) - 3) * 15 + 20) : 0;
  // Volume: 10K total → 30, 1M → 60, 10M → 75, 100M → 90
  const volumeScore = s.totalViews > 0 ? Math.min(100, (Math.log10(s.totalViews) - 4) * 15 + 30) : 0;
  // Distinct videos returned: 1 → 20, 5 → 40, 20 → 60, 50+ → 80
  const countScore = s.videoCount > 0 ? Math.min(100, (Math.log10(s.videoCount) + 1) * 30) : 0;

  const rawHype = peakScore * 0.55 + volumeScore * 0.30 + countScore * 0.15;

  // Sentiment multiplier — only dampen, never amplify above 1.0
  let multiplier = 1.0;
  if (captionSentiment !== null) {
    if (captionSentiment >= 65) multiplier = 1.0;
    else if (captionSentiment >= 50) multiplier = 0.85;
    else if (captionSentiment >= 35) multiplier = 0.65;
    else multiplier = 0.45; // strongly negative: views are roasts, not hype
  }

  return Math.max(0, rawHype * multiplier);
}

function instagramHype(s: InstagramSignal): number {
  if (s.postCount === 0) return 0;
  const peakLikes = Math.max(...s.posts.map((p) => p.likes), 0);
  const peakScore = peakLikes > 0 ? Math.min(100, (Math.log10(peakLikes) - 2) * 18 + 25) : 0;
  const engScore = s.totalEngagement > 0 ? Math.min(100, (Math.log10(s.totalEngagement) - 3) * 14 + 30) : 0;
  return Math.max(0, peakScore * 0.6 + engScore * 0.4);
}

// ============================================================
// REALITY — sentiment + volume, with dynamic source weighting
// ============================================================

/**
 * Volume-weight a sentiment score by review count.
 *
 * The intuition: a sentiment of 80 backed by 5,000 reviews is far stronger
 * evidence than a sentiment of 80 backed by 50 reviews. We multiply the
 * sentiment by a volume factor that saturates around 3,000 reviews:
 *
 *   100 reviews   → factor 0.57 (downweighted)
 *   500 reviews   → factor 0.77
 *   1,000 reviews → factor 0.86
 *   3,000 reviews → factor 1.00 (full weight)
 *
 * For places with very few reviews we don't zero them out — we still want
 * SOME signal — just trust them less.
 */
function volumeFactor(count: number): number {
  if (count <= 0) return 0.5; // no reviews → modest fallback
  // log10-saturating curve, capped at 1.0
  return Math.min(1.0, Math.log10(count) / 3.5);
}

/**
 * Stretch raw sentiment 0-100 → reality 0-100 to spread the typical 65-90
 * cluster across a wider range.
 *
 * Anchor points:
 *   sentiment 50 → reality 30  (truly mixed reviews)
 *   sentiment 65 → reality 45  (default "positive but with quibbles")
 *   sentiment 80 → reality 65  (clearly loved)
 *   sentiment 95 → reality 92  (universally raving)
 */
function stretchSentiment(raw: number | null): number | null {
  if (raw === null) return null;
  const t = Math.max(0, Math.min(1, (raw - 50) / 50));
  const stretched = Math.pow(t, 1.7);
  return 30 + stretched * 65;
}

// ============================================================
// SCORE RESULT
// ============================================================

export type ScoreResult = {
  // Raw counts
  tiktok_views: number;
  tiktok_posts: number;
  tiktok_peak_views: number;
  tiktok_caption_sentiment: number | null;
  ig_posts: number;
  ig_engagement: number;
  google_rating: number | null;
  google_reviews: number;
  reddit_mentions: number;

  // Per-source sentiment (post-stretch, 0-100)
  google_sentiment: number | null;
  reddit_sentiment: number | null;
  ig_comment_sentiment: number | null;

  // Pre-normalization absolute scores
  hype_score: number;
  reality_score: number;
  gap: number;
  is_underrated: boolean;

  // Editorial — populated by pipeline AFTER normalization
  verdict: string;

  debug: {
    googleSummary: string;
    redditSummary: string;
    igSummary: string;
    tiktokSummary: string;
  };
};

const HYPE_BLEND = { tiktok: 0.6, instagram: 0.4 };

// Reality weights are dynamic — see computeRealityScore below
const REALITY_FULL_WEIGHTS = {
  google: 0.55,
  reddit: 0.30,
  igComments: 0.15,
};

const MIN_REDDIT_MENTIONS = 3; // below this, Reddit is dropped from reality

/**
 * Compute a reality score given available sentiment signals + their volume.
 * Dynamically reweights when sources are missing or low-volume.
 */
function computeRealityScore(input: {
  googleSentiment: number | null;
  googleReviewCount: number;
  redditSentiment: number | null;
  redditMentionCount: number;
  igSentiment: number | null;
  igPostCount: number;
}): number {
  // Drop Reddit entirely if mentions are too few — one offhand comment isn't 30% of truth
  const useReddit = input.redditSentiment !== null && input.redditMentionCount >= MIN_REDDIT_MENTIONS;
  const useGoogle = input.googleSentiment !== null;
  const useIG = input.igSentiment !== null;

  // Compute effective weights from the full table, dropping unused sources
  let totalWeight = 0;
  if (useGoogle) totalWeight += REALITY_FULL_WEIGHTS.google;
  if (useReddit) totalWeight += REALITY_FULL_WEIGHTS.reddit;
  if (useIG) totalWeight += REALITY_FULL_WEIGHTS.igComments;

  if (totalWeight === 0) return 50; // no data — neutral fallback

  let numerator = 0;
  if (useGoogle) {
    // Volume-weight Google: sentiment * (review-count factor)
    const vf = volumeFactor(input.googleReviewCount);
    // Apply factor as a pull-toward-50 — places with few reviews get pulled
    // toward "we don't know"; places with many reviews keep their score.
    const adjusted = 50 + (input.googleSentiment! - 50) * vf;
    numerator += adjusted * REALITY_FULL_WEIGHTS.google;
  }
  if (useReddit) {
    numerator += input.redditSentiment! * REALITY_FULL_WEIGHTS.reddit;
  }
  if (useIG) {
    // IG also gets a (lighter) volume factor — single posts shouldn't dominate
    const vf = volumeFactor(input.igPostCount * 10); // *10 since IG counts are smaller
    const adjusted = 50 + (input.igSentiment! - 50) * vf;
    numerator += adjusted * REALITY_FULL_WEIGHTS.igComments;
  }

  return numerator / totalWeight;
}

// ============================================================
// MAIN SCORING FUNCTION
// ============================================================

export async function scoreRestaurant(restaurant: Restaurant): Promise<ScoreResult> {
  console.log(`[score] starting ${restaurant.name}`);

  // === Fetch all signals in parallel ===
  const [googleResult, tiktokResult, redditResult, instagramResult] = await Promise.allSettled([
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

  // === Sentiment scoring (4 calls in parallel — added TikTok captions in v1.5) ===
  const googleTexts = (google.details?.reviews ?? []).map((r) => r.text).filter(Boolean);
  const redditTexts = reddit.mentions.map((m) => `${m.title}\n${m.text}`).filter(Boolean);
  const igCaptions = instagram.posts.map((p) => p.caption).filter(Boolean);
  const tiktokCaptions = tiktok.videos.map((v) => v.text).filter(Boolean);

  const [googleSent, redditSent, igSent, tiktokSent] = await Promise.allSettled([
    googleTexts.length
      ? scoreSentiment("google", googleTexts)
      : Promise.resolve({ score: null, reasoning: "no data" }),
    redditTexts.length
      ? scoreSentiment("reddit", redditTexts)
      : Promise.resolve({ score: null, reasoning: "no data" }),
    igCaptions.length
      ? scoreSentiment("instagram_comments", igCaptions)
      : Promise.resolve({ score: null, reasoning: "no data" }),
    tiktokCaptions.length
      ? scoreSentiment("tiktok_captions", tiktokCaptions)
      : Promise.resolve({ score: null, reasoning: "no data" }),
  ]);

  const rawGoogle = googleSent.status === "fulfilled" ? (googleSent.value.score as number | null) : null;
  const rawReddit = redditSent.status === "fulfilled" ? (redditSent.value.score as number | null) : null;
  const rawIG = igSent.status === "fulfilled" ? (igSent.value.score as number | null) : null;
  const rawTiktok = tiktokSent.status === "fulfilled" ? (tiktokSent.value.score as number | null) : null;

  // Stretch reality-side sentiments into 0-100 reality-space
  const google_sentiment = stretchSentiment(rawGoogle);
  const reddit_sentiment = stretchSentiment(rawReddit);
  const ig_comment_sentiment = stretchSentiment(rawIG);
  // TikTok sentiment is NOT stretched — we use it directly as a 0-100 multiplier signal

  // === Hype Score (now sentiment-aware) ===
  const tiktokHype = tiktokHypeWithSentiment(tiktok, rawTiktok);
  const igHype = instagramHype(instagram);
  const hype_score = tiktokHype * HYPE_BLEND.tiktok + igHype * HYPE_BLEND.instagram;

  // === Reality Score (dynamic weighting) ===
  const reality_score = computeRealityScore({
    googleSentiment: google_sentiment,
    googleReviewCount: google.details?.userRatingCount ?? 0,
    redditSentiment: reddit_sentiment,
    redditMentionCount: reddit.mentionCount,
    igSentiment: ig_comment_sentiment,
    igPostCount: instagram.postCount,
  });

  // Pre-normalization gap (will be re-computed by pipeline after z-score normalization)
  const gap = hype_score - reality_score;
  const is_underrated = gap < -10;

  const debug = {
    googleSummary: summarizeTexts(googleTexts),
    redditSummary: summarizeTexts(redditTexts),
    igSummary: summarizeTexts(igCaptions),
    tiktokSummary: summarizeTexts(tiktokCaptions),
  };

  const peakViews = tiktok.videos.length > 0 ? Math.max(...tiktok.videos.map((v) => v.views)) : 0;

  console.log(
    `[score] ${restaurant.name}: hype=${hype_score.toFixed(1)} reality=${reality_score.toFixed(1)} gap=${gap.toFixed(1)} ` +
    `(peakTT=${peakViews.toLocaleString()}, ttSent=${rawTiktok ?? "—"}, gReviews=${google.details?.userRatingCount ?? 0}, redditN=${reddit.mentionCount})`
  );

  return {
    tiktok_views: tiktok.totalViews,
    tiktok_posts: tiktok.videoCount,
    tiktok_peak_views: peakViews,
    tiktok_caption_sentiment: rawTiktok,
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
    verdict: "", // populated later by generateVerdictForScore

    debug,
  };
}

/**
 * Generate the editorial verdict using the FINAL (normalized) scores.
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
// CROSS-ISSUE Z-SCORE NORMALIZATION
// ============================================================

/**
 * Compute mean and standard deviation of a number array.
 */
function meanStddev(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 50, stddev: 1 };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.max(1, Math.sqrt(variance)); // floor at 1 to avoid div-by-0
  return { mean, stddev };
}

/**
 * Map a z-score to a 0-100 display value.
 *   z = 0     → 50    (mean)
 *   z = +1    → 70    (above average)
 *   z = +2    → 90    (top decile)
 *   z = -1    → 30
 *   z = -2    → 10
 * Clamped to [5, 95] so display values don't go off the rails.
 */
function zToDisplay(z: number): number {
  return Math.max(5, Math.min(95, 50 + z * 20));
}

export type NormalizedScore = {
  restaurant_id: string;
  hype_normalized: number;     // 0-100, z-scored
  reality_normalized: number;  // 0-100, z-scored
  gap_normalized: number;      // hype_normalized - reality_normalized (-90 to +90)
};

/**
 * Z-score-normalize hype and reality across the entire issue.
 *
 * This produces COMPARABLE scores across all occasions: a "+50 gap" on
 * Date Night means the same thing as a "+50 gap" on Brunch, because both
 * are computed from z-scores against the same global mean and stddev.
 */
export function normalizeIssue(
  scores: { restaurant_id: string; absolute_hype: number; absolute_reality: number }[]
): NormalizedScore[] {
  if (scores.length === 0) return [];

  const hypes = scores.map((s) => s.absolute_hype);
  const realities = scores.map((s) => s.absolute_reality);
  const { mean: hMean, stddev: hStd } = meanStddev(hypes);
  const { mean: rMean, stddev: rStd } = meanStddev(realities);

  console.log(
    `[normalize] hype: mean=${hMean.toFixed(1)} σ=${hStd.toFixed(1)}, ` +
    `reality: mean=${rMean.toFixed(1)} σ=${rStd.toFixed(1)}`
  );

  return scores.map((s) => {
    const hZ = (s.absolute_hype - hMean) / hStd;
    const rZ = (s.absolute_reality - rMean) / rStd;
    const hN = zToDisplay(hZ);
    const rN = zToDisplay(rZ);
    return {
      restaurant_id: s.restaurant_id,
      hype_normalized: Math.round(hN * 100) / 100,
      reality_normalized: Math.round(rN * 100) / 100,
      gap_normalized: Math.round((hN - rN) * 100) / 100,
    };
  });
}

/**
 * Threshold for inclusion in either leaderboard.
 *   |gap| < UNDERRATED_THRESHOLD → calibrated, hidden from both sections
 *   gap >= +THRESHOLD → overrated
 *   gap <= -THRESHOLD → underrated
 */
export const GAP_THRESHOLD = 10;
