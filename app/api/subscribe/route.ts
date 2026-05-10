import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * POST /api/subscribe
 * Body: { email }
 * Public.
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email." }, { status: 400 });
  }

  const supabase = createAdminClient();
  // Upsert so duplicate signups don't error
  const { error } = await supabase
    .from("subscribers")
    .upsert({ email, source: "web" }, { onConflict: "email" });

  if (error) {
    console.error("[subscribe] failed:", error);
    return NextResponse.json({ error: "Couldn't subscribe. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
