import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * POST /api/tips
 * Body: { restaurant_name, neighborhood?, reason?, submitter_email? }
 * Public — anyone can submit. Basic rate limit at the IP level.
 */

// In-memory rate limiter (per cold-start instance — fine for low-volume tips)
const ipHits = new Map<string, { count: number; reset: number }>();
const RATE_LIMIT = 5; // 5 tips per
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || entry.reset < now) {
    ipHits.set(ip, { count: 1, reset: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0] ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Slow down — try again in an hour." }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const restaurant_name = String(body.restaurant_name ?? "").trim().slice(0, 200);
  const neighborhood = String(body.neighborhood ?? "").trim().slice(0, 100) || null;
  const reason = String(body.reason ?? "").trim().slice(0, 1000) || null;
  const submitter_email =
    String(body.submitter_email ?? "").trim().slice(0, 200) || null;

  if (!restaurant_name || restaurant_name.length < 2) {
    return NextResponse.json({ error: "Restaurant name required." }, { status: 400 });
  }

  // Light email format check (skip if not provided)
  if (submitter_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitter_email)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("tips").insert({
    restaurant_name,
    neighborhood,
    reason,
    submitter_email,
  });

  if (error) {
    console.error("[tips] insert failed:", error);
    return NextResponse.json({ error: "Couldn't save tip. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
