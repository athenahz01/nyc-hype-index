import { NextResponse } from "next/server";
import { runRefresh } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300; // ~13 min — Vercel Pro cap is 800s, Hobby is 60s

/**
 * GET /api/cron/refresh
 * Triggered by Vercel Cron weekly.
 * Authenticated via the CRON_SECRET header that Vercel automatically sends.
 *
 * Hobby plan note: maxDuration above won't be honored on Hobby (60s cap).
 * To run on Hobby, either upgrade or run the refresh script manually.
 */
export async function GET(req: Request) {
  // Verify Vercel Cron auth
  const authHeader = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runRefresh({ publish: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[cron] failed:", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
