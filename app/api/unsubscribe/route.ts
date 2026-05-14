/**
 * GET /api/unsubscribe?token=<token>
 *
 * One-click unsubscribe via opaque token. Renders a small HTML
 * confirmation page so users see something visual.
 *
 * Also supports POST for RFC 8058 List-Unsubscribe=One-Click compliance
 * (Gmail/Outlook bulk-sender requirement).
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function unsubscribeByToken(token: string): Promise<{ ok: boolean; email?: string }> {
  if (!token || token.length < 10) return { ok: false };
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("subscribers")
    .update({ is_active: false })
    .eq("unsubscribe_token", token)
    .select("email")
    .maybeSingle();
  if (error) {
    console.error("[unsubscribe] error:", error);
    return { ok: false };
  }
  if (!data) return { ok: false };
  return { ok: true, email: data.email };
}

function renderPage(ok: boolean, email?: string): string {
  if (ok) {
    return `<!DOCTYPE html>
<html><head><title>Unsubscribed — The NYC Hype Index</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;padding:48px 24px;background:#efe9da;font-family:Georgia,serif;color:#1a1a1a;min-height:100vh;display:flex;align-items:center;justify-content:center;}
  .box{max-width:480px;text-align:center;}
  h1{font-size:54px;font-weight:900;line-height:1;letter-spacing:-0.02em;margin:0 0 16px 0;}
  em{font-weight:400;color:#c0392b;}
  p{font-size:17px;line-height:1.5;color:#444;margin:0 0 12px 0;}
  .em{font-family:'Courier New',monospace;font-size:12px;color:#666;letter-spacing:0.1em;margin-top:16px;}
  a{color:#1a1a1a;text-decoration:underline;}
</style>
</head><body><div class="box">
<h1>You're <em>out</em>.</h1>
<p>${email ? `<strong>${email}</strong> won't receive any more emails from us.` : "You won't receive any more emails from us."}</p>
<p>If this was an accident, you can <a href="/">subscribe again on the home page</a>.</p>
<div class="em">— The NYC Hype Index</div>
</div></body></html>`;
  }
  return `<!DOCTYPE html>
<html><head><title>Unsubscribe Failed — The NYC Hype Index</title>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;padding:48px 24px;background:#efe9da;font-family:Georgia,serif;color:#1a1a1a;min-height:100vh;display:flex;align-items:center;justify-content:center;}
  .box{max-width:480px;text-align:center;}
  h1{font-size:42px;font-weight:900;letter-spacing:-0.02em;margin:0 0 16px 0;}
  p{font-size:17px;line-height:1.5;color:#444;}
  a{color:#1a1a1a;text-decoration:underline;}
</style>
</head><body><div class="box">
<h1>Couldn't process that.</h1>
<p>The unsubscribe link may have expired or already been used. <a href="/">Back to the site</a>.</p>
</div></body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const result = await unsubscribeByToken(token);
  return new NextResponse(renderPage(result.ok, result.email), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// One-click POST per RFC 8058 (Gmail/Outlook bulk sender requirement)
export async function POST(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const result = await unsubscribeByToken(token);
  if (result.ok) {
    return new NextResponse(null, { status: 200 });
  }
  return new NextResponse(null, { status: 400 });
}