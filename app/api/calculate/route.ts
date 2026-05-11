/**
 * POST /api/calculate
 * Body: { name: string, neighborhood?: string }
 *
 * On-demand restaurant scoring. The slow path. Used when:
 *   - User searches a restaurant not in our corpus
 *   - They click "calculate it for me"
 *
 * Steps:
 *   1. Rate-limit by IP (3 per IP per hour, soft cap)
 *   2. Try to find a Google Place match for the name + "new york"
 *   3. If found, create a `restaurants` row marked inactive (so it doesn't
 *      appear in leaderboards until manually approved)
 *   4. Score it (calls Apify TikTok, Google reviews, Reddit, IG, Claude sentiment)
 *   5. Persist to restaurant_latest_scores
 *   6. Compute z-score against existing corpus
 *   7. Return the display scores
 *
 * Cost: ~$0.05 per call (4 Claude sentiment calls + 1 Apify TikTok run).
 *       Cached forever once computed.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { scoreOneRestaurant } from "@/lib/corpus";
import { normalizeIssue, GAP_THRESHOLD } from "@/lib/scoring";
import type { Restaurant } from "@/lib/types";
import { searchPlace } from "@/lib/sources/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // generous — single-restaurant scoring takes ~30-45s

// Simple rate limiting: 3 live calculations per IP per hour.
// Uses search_log table; queries `was_live_calc=true` rows by ip_hash.
const RATE_LIMIT_PER_HOUR = 3;

function hashIp(ip: string): string {
  // Lightweight non-crypto hash; we just need to bucket requests by IP
  // without storing raw IPs (privacy). For real prod use sha256.
  let h = 0;
  for (let i = 0; i < ip.length; i++) {
    h = (h * 31 + ip.charCodeAt(i)) >>> 0;
  }
  return `ip_${h.toString(16)}`;
}

async function checkRateLimit(ipHash: string): Promise<{ ok: boolean; remaining: number }> {
  const supabase = createAdminClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("search_log")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .eq("was_live_calc", true)
    .gte("searched_at", oneHourAgo);

  const used = count ?? 0;
  return { ok: used < RATE_LIMIT_PER_HOUR, remaining: Math.max(0, RATE_LIMIT_PER_HOUR - used) };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function POST(request: Request) {
  let body: { name?: string; neighborhood?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name || name.length < 2 || name.length > 100) {
    return NextResponse.json({ error: "name must be 2-100 characters" }, { status: 400 });
  }

  // Rate limit
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const ipHash = hashIp(ip);
  const rl = await checkRateLimit(ipHash);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate limit exceeded — try again in an hour", code: "RATE_LIMITED" },
      { status: 429 }
    );
  }

  const supabase = createAdminClient();

  try {
    // Check if this restaurant already exists in our corpus (by fuzzy name match)
    const { data: existing } = await supabase
      .from("restaurants")
      .select("*")
      .ilike("name", name)
      .maybeSingle();

    let restaurant: Restaurant;

    if (existing) {
      restaurant = existing as Restaurant;
    } else {
      // Find via Google Places
      const placeId = await searchPlace(name);
      if (!placeId) {
        return NextResponse.json(
          { error: `Couldn't find a NYC restaurant called "${name}". Try a different spelling?` },
          { status: 404 }
        );
      }

      // Insert as inactive — it won't show in leaderboards until approved
      const slug = slugify(name);
      const { data: created, error: createErr } = await supabase
        .from("restaurants")
        .insert({
          slug: `live-${slug}-${Date.now().toString(36)}`, // unique slug for live additions
          name,
          neighborhood: body.neighborhood ?? "TBD",
          borough: "manhattan", // default; will be updated when approved
          google_place_id: placeId,
          search_terms: [name],
          cuisines: [],
          occasions: [],
          price_tier: null,
          active: false, // !!! inactive until manually reviewed
          notes: "Added via live search",
        })
        .select()
        .single();

      if (createErr || !created) {
        return NextResponse.json(
          { error: `couldn't create restaurant: ${createErr?.message}` },
          { status: 500 }
        );
      }
      restaurant = created as Restaurant;
    }

    // Score it — slow path
    console.log(`[/api/calculate] live-scoring ${restaurant.name}`);
    const score = await scoreOneRestaurant(restaurant, "live_search");

    // Compute z-score against existing corpus
    const { data: corpus } = await supabase
      .from("restaurant_latest_scores")
      .select("restaurant_id, hype_absolute, reality_absolute")
      .not("hype_absolute", "is", null)
      .not("reality_absolute", "is", null);

    let display = null;
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

    // Log the search
    await supabase.from("search_log").insert({
      query: name,
      matched_restaurant_id: restaurant.id,
      was_cache_hit: false,
      was_live_calc: true,
      ip_hash: ipHash,
    });

    return NextResponse.json({
      restaurant: {
        id: restaurant.id,
        slug: restaurant.slug,
        name: restaurant.name,
        neighborhood: restaurant.neighborhood,
        borough: restaurant.borough,
        cuisines: restaurant.cuisines,
        price_tier: restaurant.price_tier,
      },
      score,
      display,
      remaining_rate_limit: rl.remaining - 1,
    });
  } catch (e: any) {
    console.error("[/api/calculate]", e);
    return NextResponse.json({ error: e?.message ?? "calculation failed" }, { status: 500 });
  }
}
