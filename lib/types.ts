export type Borough = "manhattan" | "brooklyn" | "queens" | "bronx" | "staten-island";
export type Trend = "up" | "down" | "same" | "new";

// ============================================================
// OCCASIONS — the user-facing categories. Each gets its own page.
// ============================================================
export type Occasion =
  | "date-night"
  | "group-dinner"
  | "solo-dining"
  | "brunch"
  | "late-night"
  | "under-25";

export const OCCASIONS: Occasion[] = [
  "date-night",
  "group-dinner",
  "solo-dining",
  "brunch",
  "late-night",
  "under-25",
];

export const OCCASION_LABELS: Record<Occasion, string> = {
  "date-night": "Date Night",
  "group-dinner": "Group Dinner",
  "solo-dining": "Solo Dining",
  brunch: "Brunch",
  "late-night": "Late Night",
  "under-25": "Under $25",
};

export const OCCASION_TAGLINES: Record<Occasion, string> = {
  "date-night": "The most overrated places to take someone you actually like.",
  "group-dinner": "Big tables, big hype, big disappointments — and the spots that deliver.",
  "solo-dining": "Counter seats, bar tops, and the truth about eating alone in NYC.",
  brunch: "The most overhyped genre in food. Ranked.",
  "late-night": "Open past 11. Worth the trip vs. just open.",
  "under-25": "Cheap done right, and cheap that's only cheap on TikTok.",
};

// ============================================================
// CUISINES — used as multi-select filters within each occasion page.
// ============================================================
export type Cuisine =
  | "italian"
  | "korean"
  | "japanese"
  | "chinese"
  | "pizza"
  | "mexican"
  | "french"
  | "thai"
  | "mediterranean"
  | "american"
  | "indian";

export const CUISINES: Cuisine[] = [
  "italian",
  "korean",
  "japanese",
  "chinese",
  "pizza",
  "mexican",
  "french",
  "thai",
  "mediterranean",
  "american",
  "indian",
];

export const CUISINE_LABELS: Record<Cuisine, string> = {
  italian: "Italian",
  korean: "Korean",
  japanese: "Japanese",
  chinese: "Chinese",
  pizza: "Pizza",
  mexican: "Mexican",
  french: "French",
  thai: "Thai",
  mediterranean: "Mediterranean",
  american: "American",
  indian: "Indian",
};

// ============================================================
// PRICE TIER — visible on every restaurant row, qualifies for Under $25
// ============================================================
export type PriceTier = "$" | "$$" | "$$$" | "$$$$";

// ============================================================
// DB ROW TYPES
// ============================================================

export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  neighborhood: string;
  borough: Borough;
  google_place_id: string | null;
  search_terms: string[];
  cuisines: Cuisine[];
  occasions: Occasion[];
  price_tier: PriceTier | null;
  active: boolean;
  notes: string | null;
  created_at: string;
};

export type Issue = {
  id: string;
  number: number;
  published_at: string;
  total_tiktok_views: number;
  total_ig_posts: number;
  total_reviews: number;
  is_published: boolean;
  notes: string | null;
};

/** Per-restaurant absolute scores (kept for back-compat + admin views) */
export type RestaurantScore = {
  id: string;
  issue_id: string;
  restaurant_id: string;

  tiktok_views: number;
  tiktok_posts: number;
  ig_posts: number;
  ig_engagement: number;
  hype_score: number;

  google_rating: number | null;
  google_reviews: number;
  google_sentiment: number | null;
  reddit_mentions: number;
  reddit_sentiment: number | null;
  ig_comment_sentiment: number | null;
  reality_score: number;

  gap: number;
  rank: number | null;
  is_underrated: boolean;

  verdict: string | null;
  trend: Trend;
  trend_label: string | null;

  computed_at: string;
};

/** Per-occasion ranking — what powers the occasion pages */
export type OccasionScore = {
  id: string;
  issue_id: string;
  restaurant_id: string;
  occasion: Occasion;

  hype_score: number;
  reality_score: number;
  gap: number;

  rank: number;
  is_underrated: boolean;

  trend: Trend;
  trend_label: string | null;

  verdict: string | null;

  computed_at: string;
};

/** Joined view used by the public pages */
export type OccasionScoreWithRestaurant = OccasionScore & {
  restaurant: Pick<Restaurant, "slug" | "name" | "neighborhood" | "borough" | "cuisines" | "price_tier">;
};

export type ScoreWithRestaurant = RestaurantScore & {
  restaurant: Pick<Restaurant, "slug" | "name" | "neighborhood" | "borough">;
};

/** A row in the continuous-corpus table — one per restaurant, latest scores */
export type LatestScore = {
  restaurant_id: string;
  tiktok_views: number;
  tiktok_posts: number;
  tiktok_peak_views: number;
  tiktok_caption_sentiment: number | null;
  ig_posts: number;
  ig_engagement: number;
  google_rating: number | null;
  google_reviews: number;
  reddit_mentions: number;
  google_sentiment: number | null;
  reddit_sentiment: number | null;
  ig_comment_sentiment: number | null;
  hype_absolute: number | null;
  reality_absolute: number | null;
  scored_at: string;
  source: "batch" | "live_search" | "manual";
};

/** Latest score joined with restaurant info — what search/detail pages get */
export type LatestScoreWithRestaurant = LatestScore & {
  restaurant: Restaurant;
  /** Computed at display time: relative position within full corpus (z-scored) */
  hype_display?: number;
  reality_display?: number;
  gap_display?: number;
};
