/**
 * POST /api/vote
 * Body: { restaurant_id: string, occasion: string, vote: 'agree' | 'disagree' }
 *
 * Cast a vote. If the user has already voted on this (restaurant, occasion),
 * their vote is updated. One vote per IP per leaderboard entry.
 *
 * Response:
 *   { ok: true, agree: number, disagree: number, userVote: 'agree' | 'disagree' }
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { hashIp } from "@/lib/ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_VOTES = new Set(["agree", "disagree"]);

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const restaurantId = String(body.restaurant_id ?? "").trim();
  const occasion = String(body.occasion ?? "").trim();
  const vote = String(body.vote ?? "").trim();

  if (!restaurantId || !occasion) {
    return NextResponse.json(
      { error: "restaurant_id and occasion required" },
      { status: 400 }
    );
  }
  if (!ALLOWED_VOTES.has(vote)) {
    return NextResponse.json(
      { error: "vote must be 'agree' or 'disagree'" },
      { status: 400 }
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const ipHash = hashIp(ip);
  const userAgent = request.headers.get("user-agent")?.slice(0, 200) ?? null;

  const supabase = createAdminClient();

  // Upsert — change vote if user voted before, insert if not
  const { error } = await supabase.from("restaurant_votes").upsert(
    {
      restaurant_id: restaurantId,
      occasion,
      vote,
      ip_hash: ipHash,
      user_agent: userAgent,
      voted_at: new Date().toISOString(),
    },
    { onConflict: "restaurant_id,occasion,ip_hash" }
  );

  if (error) {
    console.error("[/api/vote] insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Re-read aggregates
  const { data: votes } = await supabase
    .from("restaurant_votes")
    .select("vote")
    .eq("restaurant_id", restaurantId)
    .eq("occasion", occasion);

  let agree = 0;
  let disagree = 0;
  for (const v of votes ?? []) {
    if (v.vote === "agree") agree++;
    else if (v.vote === "disagree") disagree++;
  }

  return NextResponse.json({
    ok: true,
    agree,
    disagree,
    userVote: vote,
  });
}