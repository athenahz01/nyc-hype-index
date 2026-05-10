/**
 * Instagram via RapidAPI (mediacrawlers/instagram-api-fast-reliable-data-scraper).
 *
 * Strategy: search Instagram by hashtag (restaurant name as hashtag),
 * sum likes + comments across posts to build hype signal.
 *
 * NOTE: RapidAPI services on this provider can change endpoint shapes.
 * This module is structured so that if the endpoint shape shifts,
 * we only need to edit fetchInstagramSignal — the contract is stable.
 */

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY!;
const RAPIDAPI_HOST =
  process.env.RAPIDAPI_INSTAGRAM_HOST ||
  "instagram-api-fast-reliable-data-scraper.p.rapidapi.com";

export type InstagramPost = {
  id: string;
  caption: string;
  likes: number;
  comments: number;
  takenAt: string;
  ownerUsername: string;
};

export type InstagramSignal = {
  postCount: number;
  totalLikes: number;
  totalComments: number;
  totalEngagement: number;
  posts: InstagramPost[];
};

/**
 * Try a list of likely hashtag-search endpoints and use whichever one works.
 * Different RapidAPI Instagram providers structure their hashtag endpoint differently:
 *   - /v1/hashtag?hashtag=foo
 *   - /hashtag/foo/posts
 *   - /v1/info/hashtag?name=foo
 * We attempt them in order and fall through.
 */
async function tryHashtagEndpoints(hashtag: string): Promise<any | null> {
  const candidates = [
    `https://${RAPIDAPI_HOST}/v1/hashtag?hashtag=${encodeURIComponent(hashtag)}`,
    `https://${RAPIDAPI_HOST}/hashtag/${encodeURIComponent(hashtag)}`,
    `https://${RAPIDAPI_HOST}/v1/hashtag/${encodeURIComponent(hashtag)}/posts`,
    `https://${RAPIDAPI_HOST}/hashtag?hashtag=${encodeURIComponent(hashtag)}`,
    `https://${RAPIDAPI_HOST}/api/v1/hashtag?hashtag=${encodeURIComponent(hashtag)}`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: {
          "x-rapidapi-key": RAPIDAPI_KEY,
          "x-rapidapi-host": RAPIDAPI_HOST,
        },
      });
      if (res.ok) {
        const data = await res.json();
        // If the API returned a clear error envelope, skip
        if (data && (data.error || data.message === "Endpoint '/wrong' does not exist")) continue;
        return data;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Normalize different Instagram API payload shapes into a consistent post array.
 */
function normalizePosts(payload: any): InstagramPost[] {
  if (!payload) return [];

  // Common shapes we've seen across RapidAPI providers
  const candidates: any[] =
    payload.posts ||
    payload.data?.posts ||
    payload.data?.items ||
    payload.items ||
    payload.media ||
    payload.data?.media ||
    [];

  return candidates
    .filter(Boolean)
    .map((p: any) => ({
      id: String(p.id ?? p.pk ?? p.shortcode ?? p.code ?? ""),
      caption: String(
        p.caption?.text ??
          p.caption ??
          p.edge_media_to_caption?.edges?.[0]?.node?.text ??
          ""
      ).slice(0, 500),
      likes: Number(
        p.like_count ?? p.likes ?? p.edge_liked_by?.count ?? p.edge_media_preview_like?.count ?? 0
      ),
      comments: Number(
        p.comment_count ?? p.comments ?? p.edge_media_to_comment?.count ?? 0
      ),
      takenAt: String(p.taken_at ?? p.taken_at_timestamp ?? ""),
      ownerUsername: String(p.user?.username ?? p.owner?.username ?? p.username ?? ""),
    }))
    .filter((p) => p.id !== "");
}

/**
 * Convert a restaurant name to a likely Instagram hashtag.
 * Carbone → carbone
 * Don Angie → donangie
 * Café Mogador → cafemogador
 */
export function nameToHashtag(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function fetchInstagramSignal(
  restaurantName: string
): Promise<InstagramSignal> {
  const tags = [
    nameToHashtag(restaurantName),
    nameToHashtag(restaurantName) + "nyc",
  ].filter((t, i, a) => t.length >= 3 && a.indexOf(t) === i);

  const allPosts: InstagramPost[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const data = await tryHashtagEndpoints(tag);
    const posts = normalizePosts(data);
    for (const p of posts) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      allPosts.push(p);
    }
  }

  const totalLikes = allPosts.reduce((s, p) => s + p.likes, 0);
  const totalComments = allPosts.reduce((s, p) => s + p.comments, 0);

  return {
    postCount: allPosts.length,
    totalLikes,
    totalComments,
    totalEngagement: totalLikes + totalComments,
    posts: allPosts,
  };
}
