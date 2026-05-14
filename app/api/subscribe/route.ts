/**
 * POST /api/subscribe
 * Body: { email }
 *
 * Public endpoint. Upserts subscriber + sends welcome email.
 * Idempotent on duplicate emails (returns ok without re-sending welcome).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { sendWelcomeEmail } from "@/lib/email";

export const runtime = "nodejs";

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

  // Check if already subscribed (so we don't re-send welcome email)
  const { data: existing } = await supabase
    .from("subscribers")
    .select("email, welcomed_at, unsubscribe_token, is_active")
    .eq("email", email)
    .maybeSingle();

  // Reactivate if they unsubscribed previously
  if (existing && existing.is_active === false) {
    await supabase
      .from("subscribers")
      .update({ is_active: true })
      .eq("email", email);
    // Don't re-send welcome on reactivation; they've seen it before
    return NextResponse.json({ ok: true, status: "reactivated" });
  }

  // Already subscribed and active → no-op
  if (existing) {
    return NextResponse.json({ ok: true, status: "already subscribed" });
  }

  // New subscription → insert + welcome
  const { data: inserted, error } = await supabase
    .from("subscribers")
    .insert({ email, source: "web", is_active: true })
    .select("email, unsubscribe_token")
    .single();

  if (error || !inserted) {
    console.error("[subscribe] failed:", error);
    return NextResponse.json({ error: "Couldn't subscribe. Try again." }, { status: 500 });
  }

  // Send welcome email (don't block response on it — fire and update DB after)
  // We do await it so we can record welcomed_at, but errors don't fail the subscription.
  const welcomeResult = await sendWelcomeEmail({
    to: email,
    unsubscribeToken: inserted.unsubscribe_token,
  });

  if (welcomeResult.ok) {
    await supabase
      .from("subscribers")
      .update({ welcomed_at: new Date().toISOString() })
      .eq("email", email);
  } else {
    // The subscription succeeded; just log the email failure
    console.warn(`[subscribe] welcome email failed for ${email}: ${welcomeResult.error}`);
  }

  return NextResponse.json({ ok: true, status: "subscribed" });
}