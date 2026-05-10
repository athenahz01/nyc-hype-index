/**
 * Reddit via Reddit's public .json endpoints. No API key, no auth, free.
 *
 * Reddit exposes JSON for any URL by appending `.json`. We hit the search
 * endpoint scoped to NYC food subreddits and pull post titles + selftext.
 *
 * Rate limit: anonymous Reddit allows ~10 req/min per IP. We throttle.
 *
 * Why this is the right choice for us:
 *   - Free forever, no dependency on Apify credits
 *   - No keys to rotate
 *   - Same data quality as Apify's Reddit scraper (which itself just hits
 *     these endpoints behind residential proxies)
 *   - Reddit's only complaint about anonymous access is volume — we make
 *     ~3 requests per restaurant, which is well within the polite limit
 */

const TARGET_SUBREDDITS = [
  // r/FoodNYC dropped — it's private/restricted; returns 403 to anonymous
  "AskNYC",
  "nyc",
  "AskFoodies",
];

// Polite user agent so Reddit doesn't ban our IP
const USER_AGENT = "nyc-hype-index/1.0 (https://nychypeindex.vercel.app; weekly leaderboard)";

// Throttle to stay under Reddit's anonymous rate limit (10 req/min).
// 6 seconds between requests = 10 req/min exactly. We use 7s to be safe.
const REQUEST_DELAY_MS = 7000;
let lastRequestAt = 0;

async function throttledFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < REQUEST_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, REQUEST_DELAY_MS - elapsed));
  }
  lastRequestAt = Date.now();
  return fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
}

export type RedditMention = {
  postId: string;
  subreddit: string;
  title: string;
  text: string;
  score: number;
  comments: number;
  createdAt: string;
};

export type RedditSignal = {
  mentionCount: number;
  totalScore: number;
  mentions: RedditMention[];
};

/**
 * Search one subreddit for the restaurant name. Returns up to `limit` posts.
 *
 * URL pattern (verified working with anonymous access):
 *   https://www.reddit.com/r/{sub}/search.json
 *     ?q=<query>&restrict_sr=on&sort=relevance&t=year&limit=<n>
 */
async function searchSubreddit(
  subreddit: string,
  query: string,
  limit: number
): Promise<RedditMention[]> {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(
    query
  )}&restrict_sr=on&sort=relevance&t=year&limit=${limit}&raw_json=1`;

  try {
    const res = await throttledFetch(url);
    if (!res.ok) {
      // Don't log 403s — we already know FoodNYC is private; other 403s are
      // likely rate-limit hiccups that we'll retry next run anyway.
      if (res.status !== 403) {
        console.warn(`[reddit] r/${subreddit} "${query}" returned ${res.status}`);
      }
      return [];
    }

    const data = await res.json();
    const children: any[] = data?.data?.children ?? [];

    return children
      .filter((c) => c?.kind === "t3" && c?.data) // t3 = post (vs t1 = comment)
      .map((c) => {
        const d = c.data;
        return {
          postId: String(d.id ?? ""),
          subreddit: String(d.subreddit ?? subreddit),
          title: String(d.title ?? "").slice(0, 300),
          text: String(d.selftext ?? "").slice(0, 1000),
          score: Number(d.score ?? 0),
          comments: Number(d.num_comments ?? 0),
          createdAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : "",
        };
      })
      .filter((m) => m.postId !== "");
  } catch (e: any) {
    console.warn(`[reddit] r/${subreddit} "${query}" exception:`, e?.message ?? e);
    return [];
  }
}

/**
 * Public entry point — hits each target subreddit and aggregates results.
 *
 * For 30 restaurants × 3 subreddits, total ~90 requests at 7s delay = ~10.5 min
 * for the Reddit phase alone. That's slow, but Reddit signal is now only 5%
 * of Reality Score and runs in parallel with TikTok/IG/Google for each
 * restaurant, so it doesn't actually extend the wall clock much.
 */
export async function fetchRedditSignal(
  restaurantName: string,
  opts: { maxItemsPerSubreddit?: number } = {}
): Promise<RedditSignal> {
  const { maxItemsPerSubreddit = 8 } = opts;

  const seen = new Set<string>();
  const mentions: RedditMention[] = [];
  let totalScore = 0;

  for (const subreddit of TARGET_SUBREDDITS) {
    const found = await searchSubreddit(subreddit, restaurantName, maxItemsPerSubreddit);
    for (const m of found) {
      if (seen.has(m.postId)) continue;
      seen.add(m.postId);
      mentions.push(m);
      totalScore += m.score;
    }
  }

  return {
    mentionCount: mentions.length,
    totalScore,
    mentions,
  };
}
