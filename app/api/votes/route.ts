/**
 * GET /api/votes?restaurant_id=<uuid>&occasion=<slug>
 *
 * Returns aggregate vote counts + the caller's existing vote (if any).
 *
 * Response:
 *   {
 *     agree: number,
 *     disagree: number,
 *     total: number,
 *     userVote: 'agree' | 'disagree' | null
 *   }
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { hashIp } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurant_id")?.trim();
  const occasion = url.searchParams.get("occasion")?.trim();

  if (!restaurantId || !occasion) {
    return NextResponse.json(
      { error: "restaurant_id and occasion required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Use admin client because RLS public-select would technically work too,
  // but admin is cleaner for aggregate operations.
  const { data: votes, error } = await supabase
    .from("restaurant_votes")
    .select("vote, ip_hash")
    .eq("restaurant_id", restaurantId)
    .eq("occasion", occasion);

  if (error) {
    console.error("[/api/votes] read error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const myHash = hashIp(ip);

  let agree = 0;
  let disagree = 0;
  let userVote: "agree" | "disagree" | null = null;
  for (const v of votes ?? []) {
    if (v.vote === "agree") agree++;
    else if (v.vote === "disagree") disagree++;
    if (v.ip_hash === myHash) userVote = v.vote as "agree" | "disagree";
  }

  return NextResponse.json({
    agree,
    disagree,
    total: agree + disagree,
    userVote,
  });
}