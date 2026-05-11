/**
 * GET /api/search?q=<query>
 *
 * Returns up to 8 matching restaurants from the active corpus.
 * Fast — pure DB lookup, no scraping.
 *
 * Use cases:
 *   - Autocomplete dropdown as user types
 *   - "Did you mean..." suggestions
 *
 * For full live calculation on a name not in the corpus, see /api/scrape.
 */
import { NextResponse } from "next/server";
import { searchRestaurants } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (!q || q.length < 2) {
    return NextResponse.json({ matches: [] });
  }

  try {
    const matches = await searchRestaurants(q, 8);
    return NextResponse.json({ matches });
  } catch (e: any) {
    console.error("[/api/search]", e);
    return NextResponse.json({ matches: [], error: e?.message ?? "search failed" }, { status: 500 });
  }
}
