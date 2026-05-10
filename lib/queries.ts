import { createBrowserClient } from "./supabase";
import type {
  Issue,
  Occasion,
  OccasionScoreWithRestaurant,
} from "./types";

export type OccasionData = {
  issue: Issue;
  occasion: Occasion;
  scores: OccasionScoreWithRestaurant[];
} | null;

/**
 * Fetch the latest published issue (metadata only).
 */
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

/**
 * Fetch the leaderboard for one occasion in the latest published issue.
 * Returns scores joined with restaurant data so we have the cuisine tags
 * for filtering on the client.
 */
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

  return {
    issue,
    occasion,
    scores: (scores ?? []) as unknown as OccasionScoreWithRestaurant[],
  };
}

/**
 * Fetch top-N highlights for each occasion — used by the home page grid.
 * Returns a Map<Occasion, top scores>.
 */
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

/**
 * List published issue numbers for the archive index.
 */
export async function listPublishedIssues(): Promise<{ number: number; published_at: string }[]> {
  const supabase = createBrowserClient();
  const { data } = await supabase
    .from("issues")
    .select("number, published_at")
    .eq("is_published", true)
    .order("number", { ascending: false });
  return data ?? [];
}
