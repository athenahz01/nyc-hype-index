/**
 * TikTok via Apify's clockworks/tiktok-scraper actor.
 *
 * Why this provider:
 *   - Runs on Apify FREE plan (apidojo's tiktok-scraper-api requires paid)
 *   - 175K+ users on Apify, well-maintained, stable schema
 *   - Costs ~$3.70/1K results — fits in $5 free credit if we keep volume low
 *
 * Cost control:
 *   - 1 search term per restaurant (down from 3)
 *   - 5 videos per query (down from 20)
 *   - Total: 77 restaurants × 5 = 385 results per refresh
 *   - At $3.70/1K = ~$1.42 per refresh, ~$5.70/month for 4 weekly refreshes
 *   - If running bi-weekly that drops to ~$2.85/mo, well within $5 free credit
 *
 * Input schema (verified from clockworks docs):
 *   {
 *     searchQueries: ["carbone nyc"],     // list of search terms
 *     resultsPerPage: 5,                  // max videos per query
 *     shouldDownloadVideos: false,        // we only need metadata
 *     shouldDownloadCovers: false,        // skip preview images
 *     proxyConfiguration: { useApifyProxy: true }
 *   }
 *
 * Output schema (clockworks/tiktok-scraper):
 *   {
 *     id, text (=caption), createTimeISO,
 *     playCount, diggCount, commentCount, shareCount,
 *     authorMeta: { name, ... },
 *     ...
 *   }
 */

import { ApifyClient } from "apify-client";

const APIFY_TOKEN = process.env.APIFY_TOKEN!;
const ACTOR_ID = "clockworks/tiktok-scraper";

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
 * Normalize a single output item from clockworks into our TikTokVideo shape.
 */
function normalizeVideo(item: any): TikTokVideo | null {
  if (!item || !item.id) return null;
  return {
    id: String(item.id),
    // clockworks uses playCount/diggCount/commentCount/shareCount
    views: Number(item.playCount ?? 0),
    likes: Number(item.diggCount ?? 0),
    comments: Number(item.commentCount ?? 0),
    shares: Number(item.shareCount ?? 0),
    // Caption is in `text` field for clockworks
    text: String(item.text ?? "").slice(0, 500),
    createdAt: String(item.createTimeISO ?? ""),
  };
}

/**
 * Fetch TikTok signal for a restaurant.
 *
 * Uses only the FIRST search term to keep cost down. The first term is
 * usually the most distinctive (e.g. "carbone nyc") and the additional
 * terms produced diminishing returns since search results overlap heavily.
 */
export async function fetchTikTokSignal(
  searchTerms: string[],
  opts: { maxItemsPerQuery?: number; oldestDays?: number } = {}
): Promise<TikTokSignal> {
  // 5 default — balance between signal quality and cost
  // (peak-views model only needs 1-2 videos to work; extras are bonus)
  const { maxItemsPerQuery = 5 } = opts;

  if (!APIFY_TOKEN) {
    console.warn("[tiktok] APIFY_TOKEN missing — skipping");
    return { totalViews: 0, totalLikes: 0, totalComments: 0, videoCount: 0, videos: [] };
  }

  if (searchTerms.length === 0) {
    return { totalViews: 0, totalLikes: 0, totalComments: 0, videoCount: 0, videos: [] };
  }

  const primaryTerm = searchTerms[0];
  const client = new ApifyClient({ token: APIFY_TOKEN });

  try {
    // Use clockworks' searchQueries input. shouldDownload* flags off for speed/cost.
    const run = await client.actor(ACTOR_ID).call(
      {
        searchQueries: [primaryTerm],
        resultsPerPage: maxItemsPerQuery,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSubtitles: false,
        shouldDownloadSlideshowImages: false,
        proxyConfiguration: { useApifyProxy: true },
      },
      { waitSecs: 120 } // hard cap: 2 minutes per restaurant
    );

    if (!run?.defaultDatasetId) {
      console.warn(`[tiktok] "${primaryTerm}" — no dataset returned`);
      return { totalViews: 0, totalLikes: 0, totalComments: 0, videoCount: 0, videos: [] };
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const videos = (items as any[])
      .map(normalizeVideo)
      .filter((v): v is TikTokVideo => v !== null);

    console.log(`[tiktok] "${primaryTerm}" → ${videos.length} videos`);

    return {
      totalViews: videos.reduce((s, v) => s + v.views, 0),
      totalLikes: videos.reduce((s, v) => s + v.likes, 0),
      totalComments: videos.reduce((s, v) => s + v.comments, 0),
      videoCount: videos.length,
      videos,
    };
  } catch (e: any) {
    // Common cases: out-of-credit, actor timeout, transient Apify error.
    // Log and return empty — pipeline tolerates missing TikTok data
    // (the restaurant just gets hype=0 and likely filters as calibrated).
    console.warn(`[tiktok] "${primaryTerm}" failed:`, e?.message ?? e);
    return { totalViews: 0, totalLikes: 0, totalComments: 0, videoCount: 0, videos: [] };
  }
}