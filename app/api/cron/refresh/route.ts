import { NextResponse } from "next/server";
import { runBatch } from "@/lib/corpus";

export const runtime = "nodejs";
export const maxDuration = 300; // Hobby plan cap

/**
 * GET /api/cron/refresh
 * Triggered by Vercel Cron. Authenticated via Bearer CRON_SECRET header.
 *
 * Strategy: Runs a SMALL batch (5 restaurants) per cron invocation.
 * Designed for Hobby plan's 300s timeout. To keep the full corpus fresh,
 * configure the cron to run frequently (e.g. every 4 hours) — over a week
 * that covers ~40 restaurants which is enough for our corpus.
 *
 * Note: this does NOT publish an issue. For that, run `npm run publish-issue`
 * manually weekly (or upgrade to Vercel Pro for longer timeouts and a
 * dedicated weekly publish cron).
 */
export async function GET(req: Request) {
  // Verify Vercel Cron auth
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Prefer scoring stale restaurants first (haven't been touched in 7+ days)
    const result = await runBatch({ limit: 5, staleOnly: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[cron] failed:", e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
