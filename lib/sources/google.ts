/**
 * Google Places API (New) integration.
 *
 * Two-step flow:
 *   1. searchPlace(query) → place_id (cache this on the restaurant row)
 *   2. fetchPlaceDetails(place_id) → reviews + rating
 *
 * Uses the "Places API (New)" — the modern v1 endpoint.
 * Docs: https://developers.google.com/maps/documentation/places/web-service/overview
 */

const API_KEY = process.env.GOOGLE_PLACES_API_KEY!;
const BASE = "https://places.googleapis.com/v1";

export type GoogleReview = {
  rating: number;
  text: string;
  authorName: string;
  authorIsLocalGuide: boolean;
  publishedAt: string;
  relativePublishTime: string;
};

export type GooglePlaceDetails = {
  placeId: string;
  name: string;
  formattedAddress: string;
  rating: number | null;
  userRatingCount: number;
  reviews: GoogleReview[];
};

/**
 * Step 1: Find a place by name + city, return its place_id.
 * We use Text Search since restaurants share names across boroughs.
 */
export async function searchPlace(
  name: string,
  cityHint = "New York, NY"
): Promise<string | null> {
  const query = `${name} ${cityHint}`;
  const res = await fetch(`${BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress",
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "en",
      regionCode: "US",
      maxResultCount: 1,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google searchPlace failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const first = data.places?.[0];
  return first?.id ?? null;
}

/**
 * Step 2: Fetch place details including up to 5 most recent reviews.
 * Google's Places API only returns 5 reviews per call — that's a hard limit.
 * For more reviews we'd need the Outscraper / SerpAPI route, but 5 is enough
 * for sentiment scoring at our volume.
 */
export async function fetchPlaceDetails(placeId: string): Promise<GooglePlaceDetails | null> {
  const res = await fetch(`${BASE}/places/${placeId}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": API_KEY,
      "X-Goog-FieldMask":
        "id,displayName,formattedAddress,rating,userRatingCount,reviews",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google fetchPlaceDetails failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const p = await res.json();

  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    formattedAddress: p.formattedAddress ?? "",
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? 0,
    reviews: (p.reviews ?? []).map((r: any) => ({
      rating: r.rating,
      text: r.text?.text ?? r.originalText?.text ?? "",
      authorName: r.authorAttribution?.displayName ?? "Anonymous",
      // Google deprecated explicit "is local guide" flag in 2024; we proxy via review length
      authorIsLocalGuide: (r.text?.text?.length ?? 0) > 200,
      publishedAt: r.publishTime ?? "",
      relativePublishTime: r.relativePublishTimeDescription ?? "",
    })),
  };
}

/**
 * Convenience: search + fetch in one call.
 */
export async function getReviewsForRestaurant(
  name: string,
  cachedPlaceId: string | null
): Promise<{ placeId: string | null; details: GooglePlaceDetails | null }> {
  const placeId = cachedPlaceId ?? (await searchPlace(name));
  if (!placeId) return { placeId: null, details: null };
  const details = await fetchPlaceDetails(placeId);
  return { placeId, details };
}
