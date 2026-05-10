/**
 * TikTok via RapidAPI's `tiktok-scraper7` (tikwm).
 *
 * Endpoint used: `/feed/search` — keyword video search.
 * Returns up to 30 videos per query, each with view counts, likes,
 * comments, and the caption text we need for downstream sentiment.
 *
 * Why this provider:
 *   - Free tier (~500 req/mo) easily covers 30 restaurants × 1-3 search terms = ~90 reqs/run
 *   - Same RAPIDAPI_KEY as the existing Instagram integration
 *   - Returns rich engagement metrics including play_count (views), digg_count (likes)
 *
 * If endpoint shape changes, only this file needs updating — the contract
 * with the rest of the system (TikTokSignal type) is stable.
 */

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY!;
const RAPIDAPI_HOST =
  process.env.RAPIDAPI_TIKTOK_HOST || "tiktok-scraper7.p.rapidapi.com";

export type TikTokVideo = {
  id: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  text: string;
  createdAt: string;
};

export type TikTokSignal = {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  videoCount: number;
  videos: TikTokVideo[];
};

/**
 * Try a list of likely keyword-search endpoints and use whichever one returns data.
 * Different builds of this provider expose the keyword-search endpoint slightly
 * differently. We try the known patterns in order.
 */
async function trySearchEndpoints(query: string, count: number): Promise<any | null> {
  const encoded = encodeURIComponent(query);
  const candidates = [
    // tikwm-style: GET /feed/search?keywords=...&count=...&cursor=0&region=US&publish_time=0&sort_type=0
    `https://${RAPIDAPI_HOST}/feed/search?keywords=${encoded}&count=${count}&cursor=0&region=US&publish_time=0&sort_type=0`,
    // alternative
    `https://${RAPIDAPI_HOST}/search/general?keywords=${encoded}&count=${count}&cursor=0`,
    `https://${RAPIDAPI_HOST}/api/search/general?keywords=${encoded}&count=${count}`,
    `https://${RAPIDAPI_HOST}/search?keyword=${encoded}&count=${count}`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      // Check if this looks like a real video search response
      if (data && (data.data?.videos || data.videos || data.data?.results || data.results || Array.isArray(data.data) || Array.isArray(data))) {
        return data;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Normalize the response into our TikTokVideo shape.
 * Different providers nest the video array differently, so we probe known shapes.
 */
function normalizeVideos(payload: any): TikTokVideo[] {
  if (!payload) return [];

  const candidates: any[] =
    payload.data?.videos ||
    payload.videos ||
    payload.data?.results ||
    payload.results ||
    (Array.isArray(payload.data) ? payload.data : null) ||
    (Array.isArray(payload) ? payload : null) ||
    [];

  return candidates
    .filter(Boolean)
    .map((v: any) => ({
      id: String(v.video_id ?? v.aweme_id ?? v.id ?? v.itemId ?? ""),
      // tikwm-style fields: play_count (views), digg_count (likes), comment_count, share_count
      views: Number(v.play_count ?? v.playCount ?? v.viewCount ?? v.statistics?.play_count ?? 0),
      likes: Number(v.digg_count ?? v.diggCount ?? v.likeCount ?? v.statistics?.digg_count ?? 0),
      comments: Number(v.comment_count ?? v.commentCount ?? v.statistics?.comment_count ?? 0),
      shares: Number(v.share_count ?? v.shareCount ?? v.statistics?.share_count ?? 0),
      text: String(v.title ?? v.desc ?? v.description ?? v.text ?? "").slice(0, 500),
      createdAt: String(v.create_time ?? v.createTime ?? v.createdAt ?? ""),
    }))
    .filter((v) => v.id !== "");
}

/**
 * Run searches for each search term in parallel and aggregate.
 * De-duped by video ID across queries.
 *
 * Note: opts.maxItemsPerQuery and opts.oldestDays are accepted for backwards
 * compatibility with the old Apify-based signature, but RapidAPI's free tier
 * doesn't expose date filtering reliably so oldestDays is ignored.
 */
export async function fetchTikTokSignal(
  searchTerms: string[],
  opts: { maxItemsPerQuery?: number; oldestDays?: number } = {}
): Promise<TikTokSignal> {
  const { maxItemsPerQuery = 20 } = opts;

  if (!RAPIDAPI_KEY) {
    console.warn("[tiktok] RAPIDAPI_KEY missing — skipping");
    return { totalViews: 0, totalLikes: 0, totalComments: 0, videoCount: 0, videos: [] };
  }

  // Sequential to be polite to free tier rate limits (5 req/sec on most plans)
  const seen = new Set<string>();
  const allVideos: TikTokVideo[] = [];

  for (const term of searchTerms) {
    try {
      const payload = await trySearchEndpoints(term, maxItemsPerQuery);
      const videos = normalizeVideos(payload);

      if (videos.length === 0 && payload) {
        // Helpful one-time debug output if the response shape is unexpected
        const preview = JSON.stringify(payload).slice(0, 200);
        console.warn(`[tiktok] "${term}": got response but parsed 0 videos — payload preview: ${preview}`);
      }

      for (const v of videos) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        allVideos.push(v);
      }
    } catch (e: any) {
      console.warn(`[tiktok] search "${term}" failed:`, e?.message ?? e);
    }
  }

  return {
    totalViews: allVideos.reduce((s, v) => s + v.views, 0),
    totalLikes: allVideos.reduce((s, v) => s + v.likes, 0),
    totalComments: allVideos.reduce((s, v) => s + v.comments, 0),
    videoCount: allVideos.length,
    videos: allVideos,
  };
}
