import { createBrowserClient, createAdminClient } from "./supabase";
import { normalizeIssue, GAP_THRESHOLD } from "./scoring";
import type {
  Issue,
  Occasion,
  OccasionScoreWithRestaurant,
  Restaurant,
  LatestScore,
  LatestScoreWithRestaurant,
} from "./types";

// ============================================================
// ISSUE / LEADERBOARD QUERIES (existing product surface)
// ============================================================

export type OccasionData = {
  issue: Issue;
  occasion: Occasion;
  scores: OccasionScoreWithRestaurant[];
} | null;

export async function fetchLatestIssue(): Promise<Issue | null> {
  const supabase = createBrowserClient();
  const { data: issue } = await supabase
    .from("issues")
    .select("*")
    .eq("is_published", true)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return issue ?? null;
}

export async function fetchOccasionLeaderboard(occasion: Occasion): Promise<OccasionData> {
  const supabase = createBrowserClient();
  const issue = await fetchLatestIssue();
  if (!issue) return null;

  const { data: scores, error } = await supabase
    .from("occasion_scores")
    .select(
      `
      *,
      restaurant:restaurants!inner ( slug, name, neighborhood, borough, cuisines, price_tier )
    `
    )
    .eq("issue_id", issue.id)
    .eq("occasion", occasion)
    .order("is_underrated", { ascending: true })
    .order("rank", { ascending: true });

  if (error) {
    console.error("[fetchOccasionLeaderboard]", error);
    return { issue, occasion, scores: [] };
  }
  return { issue, occasion, scores: (scores ?? []) as unknown as OccasionScoreWithRestaurant[] };
}

export async function fetchOccasionHighlights(
  topN = 3
): Promise<{ issue: Issue | null; highlights: Record<string, OccasionScoreWithRestaurant[]> }> {
  const issue = await fetchLatestIssue();
  if (!issue) return { issue: null, highlights: {} };

  const supabase = createBrowserClient();
  const { data: scores } = await supabase
    .from("occasion_scores")
    .select(
      `
      *,
      restaurant:restaurants!inner ( slug, name, neighborhood, borough, cuisines, price_tier )
    `
    )
    .eq("issue_id", issue.id)
    .eq("is_underrated", false)
    .order("rank", { ascending: true });

  const highlights: Record<string, OccasionScoreWithRestaurant[]> = {};
  for (const s of (scores ?? []) as unknown as OccasionScoreWithRestaurant[]) {
    if (!highlights[s.occasion]) highlights[s.occasion] = [];
    if (highlights[s.occasion].length < topN) highlights[s.occasion].push(s);
  }
  return { issue, highlights };
}

export async function listPublishedIssues(): Promise<{ number: number; published_at: string }[]> {
  const supabase = createBrowserClient();
  const { data } = await supabase
    .from("issues")
    .select("number, published_at")
    .eq("is_published", true)
    .order("number", { ascending: false });
  return data ?? [];
}

// ============================================================
// SEARCH (live, corpus-first with fuzzy match)
// ============================================================

export type SearchMatch = {
  restaurant: Pick<Restaurant, "id" | "slug" | "name" | "neighborhood" | "borough" | "cuisines" | "price_tier">;
  /** true if we have current scores in the corpus (instant display) */
  hasScores: boolean;
};

/**
 * Fuzzy-match a query against restaurant names + neighborhoods.
 * Uses pg_trgm similarity for typo tolerance.
 */
export async function searchRestaurants(query: string, limit = 8): Promise<SearchMatch[]> {
  const supabase = createBrowserClient();
  const q = query.trim();
  if (!q) return [];

  // ilike for prefix match (fast, common case), trigram for typos.
  // We do ilike first since it's a sublinear index lookup.
  const ilikePattern = `%${q}%`;

  // Note: don't filter by active. Live-calculated restaurants (active=false)
  // SHOULD appear in search results — that's how cache reuse works. The
  // active flag only filters leaderboards.
  const { data, error } = await supabase
    .from("restaurants")
    .select(
      `
      id, slug, name, neighborhood, borough, cuisines, price_tier,
      latest:restaurant_latest_scores ( hype_absolute )
    `
    )
    .or(`name.ilike.${ilikePattern},neighborhood.ilike.${ilikePattern}`)
    .limit(limit);

  if (error) {
    console.error("[searchRestaurants]", error);
    return [];
  }

  return (data ?? []).map((r: any) => ({
    restaurant: {
      id: r.id,
      slug: r.slug,
      name: r.name,
      neighborhood: r.neighborhood,
      borough: r.borough,
      cuisines: r.cuisines,
      price_tier: r.price_tier,
    },
    hasScores: !!r.latest && r.latest.length > 0 && r.latest[0].hype_absolute !== null,
  }));
}

// ============================================================
// RESTAURANT DETAIL
// ============================================================

export type RestaurantDetail = {
  restaurant: Restaurant;
  latest: LatestScore | null;
  /** Rankings across all occasions in the current published issue */
  occasionRankings: {
    occasion: Occasion;
    rank: number;
    is_underrated: boolean;
    hype_score: number;
    reality_score: number;
    gap: number;
    verdict: string | null;
  }[];
  /** Computed display scores (z-scored against current corpus) */
  display: {
    hype: number;
    reality: number;
    gap: number;
    is_underrated: boolean;
    is_calibrated: boolean; // |gap| < threshold
  } | null;
};

/**
 * Get full detail for one restaurant by slug.
 *
 * Returns:
 *   - The restaurant row
 *   - Its latest corpus score (if scored)
 *   - Its ranks in the current published issue (per occasion)
 *   - Display-friendly z-scored hype/reality/gap (computed at read time)
 */
export async function fetchRestaurantDetail(slug: string): Promise<RestaurantDetail | null> {
  const supabase = createBrowserClient();

  // Note: don't filter by active here. Live-calculated restaurants are
  // inserted with active=false (so they don't appear in leaderboards
  // until manually approved), but they SHOULD be viewable by anyone with
  // the URL — that's how live-search delivers results.
  const { data: restaurant, error: rErr } = await supabase
    .from("restaurants")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (rErr) {
    console.error(`[fetchRestaurantDetail] error reading restaurant for slug="${slug}":`, rErr);
    return null;
  }
  if (!restaurant) {
    console.warn(`[fetchRestaurantDetail] no restaurant found for slug="${slug}"`);
    // Diagnostic: see if there's a row matching with ilike (in case of casing/whitespace)
    const { data: fuzzy } = await supabase
      .from("restaurants")
      .select("slug, name, active")
      .ilike("slug", `%${slug}%`)
      .limit(3);
    console.warn(`[fetchRestaurantDetail] fuzzy probe for "${slug}":`, JSON.stringify(fuzzy));
    return null;
  }

  console.log(`[fetchRestaurantDetail] found restaurant: ${restaurant.name} (id=${restaurant.id}, active=${restaurant.active})`);

  const { data: latest, error: lErr } = await supabase
    .from("restaurant_latest_scores")
    .select("*")
    .eq("restaurant_id", restaurant.id)
    .maybeSingle();

  if (lErr) console.warn(`[fetchRestaurantDetail] error reading latest scores:`, lErr);

  // Compute display scores by z-scoring this restaurant against the full corpus
  let display: RestaurantDetail["display"] = null;
  if (latest && latest.hype_absolute !== null && latest.reality_absolute !== null) {
    const { data: corpus } = await supabase
      .from("restaurant_latest_scores")
      .select("restaurant_id, hype_absolute, reality_absolute")
      .not("hype_absolute", "is", null)
      .not("reality_absolute", "is", null);

    if (corpus && corpus.length > 5) {
      const normalized = normalizeIssue(
        corpus.map((c: any) => ({
          restaurant_id: c.restaurant_id,
          absolute_hype: Number(c.hype_absolute),
          absolute_reality: Number(c.reality_absolute),
        }))
      );
      const mine = normalized.find((n) => n.restaurant_id === restaurant.id);
      if (mine) {
        display = {
          hype: mine.hype_normalized,
          reality: mine.reality_normalized,
          gap: mine.gap_normalized,
          is_underrated: mine.gap_normalized < -GAP_THRESHOLD,
          is_calibrated: Math.abs(mine.gap_normalized) < GAP_THRESHOLD,
        };
      }
    }
  }

  // Get rankings in current published issue
  const issue = await fetchLatestIssue();
  let occasionRankings: RestaurantDetail["occasionRankings"] = [];
  if (issue) {
    const { data: ranks } = await supabase
      .from("occasion_scores")
      .select("occasion, rank, is_underrated, hype_score, reality_score, gap, verdict")
      .eq("issue_id", issue.id)
      .eq("restaurant_id", restaurant.id);
    occasionRankings = (ranks ?? []) as any;
  }

  return {
    restaurant: restaurant as Restaurant,
    latest: (latest as LatestScore) ?? null,
    occasionRankings,
    display,
  };
}

// ============================================================
// CORPUS STATS (for the home page)
// ============================================================

export async function fetchCorpusStats(): Promise<{
  totalRestaurants: number;
  scoredRestaurants: number;
  lastScoredAt: string | null;
}> {
  const supabase = createBrowserClient();
  const { count: totalRestaurants } = await supabase
    .from("restaurants")
    .select("*", { count: "exact", head: true })
    .eq("active", true);

  const { data: latest, count: scoredRestaurants } = await supabase
    .from("restaurant_latest_scores")
    .select("scored_at", { count: "exact" })
    .order("scored_at", { ascending: false })
    .limit(1);

  return {
    totalRestaurants: totalRestaurants ?? 0,
    scoredRestaurants: scoredRestaurants ?? 0,
    lastScoredAt: latest && latest.length > 0 ? latest[0].scored_at : null,
  };
}