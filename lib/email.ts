/**
 * Email module — Resend integration for transactional + digest emails.
 *
 * Three flows:
 *   1. sendWelcomeEmail() — when a new subscriber confirms via /api/subscribe
 *   2. sendDigestEmail()  — when a new issue publishes; one call per subscriber
 *   3. Unsubscribe is handled via /api/unsubscribe?token=<token>
 *
 * Required env vars:
 *   RESEND_API_KEY        — your Resend account API key
 *   EMAIL_FROM            — sender address (must be a verified domain on Resend),
 *                           e.g. "The NYC Hype Index <hello@nychypeindex.com>"
 *   NEXT_PUBLIC_SITE_URL  — used to build unsubscribe links (e.g. https://nyc-hype-index.vercel.app)
 *
 * Resend setup steps (one-time):
 *   1. Sign up at https://resend.com
 *   2. Verify a sending domain (or use their resend.dev sandbox for testing)
 *   3. Copy API key into .env.local
 *
 * Cost: 3,000 free emails/month. At ~200 subscribers × 4 issues/month = 800
 * emails, you're well within free tier.
 */

import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM ?? "The NYC Hype Index <hello@resend.dev>";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nyc-hype-index.vercel.app";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ============================================================
// Welcome email
// ============================================================

export async function sendWelcomeEmail(opts: {
  to: string;
  unsubscribeToken: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY missing — skipping welcome email");
    return { ok: false, error: "email service not configured" };
  }

  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: opts.to,
      subject: "You're on the list. The NYC Hype Index drops Mondays.",
      html: welcomeHtml(opts),
      text: welcomeText(opts),
      headers: {
        "List-Unsubscribe": `<${SITE_URL}/api/unsubscribe?token=${opts.unsubscribeToken}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (error) {
      console.error("[email/welcome] Resend error:", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    console.error("[email/welcome] threw:", e);
    return { ok: false, error: e?.message ?? "send failed" };
  }
}

// ============================================================
// Weekly digest
// ============================================================

export type DigestData = {
  issueNumber: number;
  topOverrated: Array<{ name: string; verdict: string; gap: number; slug: string; occasion: string }>;
  topUnderrated: Array<{ name: string; verdict: string; gap: number; slug: string; occasion: string }>;
};

export async function sendDigestEmail(opts: {
  to: string;
  unsubscribeToken: string;
  digest: DigestData;
}): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY missing — skipping digest email");
    return { ok: false, error: "email service not configured" };
  }

  try {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: opts.to,
      subject: `Issue №${opts.digest.issueNumber}: This week's most overrated NYC restaurants`,
      html: digestHtml(opts),
      text: digestText(opts),
      headers: {
        "List-Unsubscribe": `<${SITE_URL}/api/unsubscribe?token=${opts.unsubscribeToken}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (error) {
      console.error("[email/digest] Resend error:", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    console.error("[email/digest] threw:", e);
    return { ok: false, error: e?.message ?? "send failed" };
  }
}

// ============================================================
// HTML templates — keep these inline to avoid a templating dependency.
// Style is deliberately editorial (matches the site's typographic feel).
// Inline styles only — many email clients strip <style> tags.
// ============================================================

function unsubLink(token: string): string {
  return `${SITE_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

function emailShell(bodyHtml: string, token: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#efe9da;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#efe9da;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;background:#efe9da;">
          <tr>
            <td style="border-bottom:2px solid #1a1a1a;padding-bottom:18px;text-align:center;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#666;margin-bottom:6px;">A weekly autopsy of NYC restaurant hype</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:900;letter-spacing:-0.02em;color:#1a1a1a;">
                <em style="font-weight:400;font-size:18px;color:#666;">The</em> NYC Hype Index
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 8px 16px 8px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #1a1a1a;padding:24px 8px;text-align:center;font-family:'Courier New',monospace;font-size:11px;color:#666;letter-spacing:0.1em;">
              <p style="margin:0 0 12px 0;">© The NYC Hype Index · Made for screenshots</p>
              <p style="margin:0;">
                <a href="${unsubLink(token)}" style="color:#666;text-decoration:underline;">Unsubscribe</a>
                &nbsp;·&nbsp;
                <a href="${SITE_URL}" style="color:#666;text-decoration:underline;">View on the web</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function welcomeHtml(opts: { unsubscribeToken: string }): string {
  const body = `
    <div style="text-align:center;margin-bottom:36px;">
      <h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:900;font-size:48px;line-height:1;letter-spacing:-0.02em;color:#1a1a1a;margin:0 0 16px 0;">
        You're <em style="font-weight:400;color:#c0392b;">in</em>.
      </h1>
      <p style="font-family:Georgia,serif;font-size:17px;line-height:1.5;color:#333;max-width:46ch;margin:0 auto;">
        Every Monday, we'll send you the week's most overrated NYC restaurants — ranked by the gap between TikTok hype and what locals actually think.
      </p>
    </div>
    <div style="background:#1a1a1a;color:#efe9da;padding:24px;margin:24px 0;border-left:4px solid #c0392b;">
      <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#c0392b;margin-bottom:8px;">What you'll get</div>
      <p style="font-family:Georgia,serif;font-size:15px;line-height:1.6;margin:0;color:#efe9da;">
        Top 3 overrated. Top 3 underrated. The sharpest verdicts of the week. One short email. No drama, just data.
      </p>
    </div>
    <div style="text-align:center;margin:36px 0;">
      <a href="${SITE_URL}" style="display:inline-block;font-family:Georgia,serif;font-size:15px;font-weight:600;background:#1a1a1a;color:#efe9da;padding:14px 28px;text-decoration:none;border:2px solid #1a1a1a;">
        See this week's leaderboard →
      </a>
    </div>
    <p style="font-family:Georgia,serif;font-size:14px;line-height:1.5;color:#666;font-style:italic;text-align:center;margin:24px 0 0 0;">
      P.S. Forward this to the friend who keeps recommending the most overrated spots. You know the one.
    </p>
  `;
  return emailShell(body, opts.unsubscribeToken);
}

function welcomeText(opts: { unsubscribeToken: string }): string {
  return `You're in.

Every Monday, we'll send you the week's most overrated NYC restaurants — ranked by the gap between TikTok hype and what locals actually think.

What you'll get:
Top 3 overrated. Top 3 underrated. The sharpest verdicts of the week. One short email. No drama, just data.

See this week's leaderboard: ${SITE_URL}

—
The NYC Hype Index

Unsubscribe: ${unsubLink(opts.unsubscribeToken)}`;
}

function digestHtml(opts: { unsubscribeToken: string; digest: DigestData }): string {
  const { issueNumber, topOverrated, topUnderrated } = opts.digest;

  function entryRow(e: typeof topOverrated[number], color: string, prefix: string): string {
    return `
      <tr>
        <td style="padding:18px 0;border-bottom:1px solid rgba(26,26,26,0.15);">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align:top;width:60px;">
                <div style="font-family:Georgia,serif;font-weight:900;font-size:28px;color:${color};letter-spacing:-0.02em;">
                  ${prefix}${Math.abs(e.gap).toFixed(0)}
                </div>
              </td>
              <td style="vertical-align:top;padding-left:8px;">
                <a href="${SITE_URL}/restaurant/${encodeURIComponent(e.slug)}" style="font-family:Georgia,serif;font-weight:900;font-size:22px;color:#1a1a1a;text-decoration:none;letter-spacing:-0.01em;">
                  ${escapeHtml(e.name)}
                </a>
                <div style="font-family:'Courier New',monospace;font-size:10px;color:#666;letter-spacing:0.15em;text-transform:uppercase;margin-top:4px;">
                  ${escapeHtml(e.occasion.replace("-", " "))}
                </div>
                <p style="font-family:Georgia,serif;font-style:italic;font-size:15px;color:#333;margin:8px 0 0 0;line-height:1.4;">
                  "${escapeHtml(e.verdict)}"
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  const body = `
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#c0392b;margin-bottom:8px;">Issue №${issueNumber}</div>
      <h1 style="font-family:Georgia,serif;font-weight:900;font-size:36px;line-height:1.1;letter-spacing:-0.02em;color:#1a1a1a;margin:0;">
        This week's <em style="font-weight:400;color:#c0392b;">verdicts</em>.
      </h1>
    </div>

    <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#c0392b;margin:0 0 4px 0;font-weight:700;">↑ Most Overrated</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      ${topOverrated.map((e) => entryRow(e, "#c0392b", "+")).join("")}
    </table>

    <div style="font-family:'Courier New',monospace;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#b8860b;margin:32px 0 4px 0;font-weight:700;">↓ Quietly Underrated</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      ${topUnderrated.map((e) => entryRow(e, "#b8860b", "−")).join("")}
    </table>

    <div style="text-align:center;margin:36px 0 16px 0;">
      <a href="${SITE_URL}" style="display:inline-block;font-family:Georgia,serif;font-size:15px;font-weight:600;background:#1a1a1a;color:#efe9da;padding:14px 28px;text-decoration:none;">
        See the full leaderboard →
      </a>
    </div>
  `;
  return emailShell(body, opts.unsubscribeToken);
}

function digestText(opts: { unsubscribeToken: string; digest: DigestData }): string {
  const { issueNumber, topOverrated, topUnderrated } = opts.digest;
  const lines: string[] = [];
  lines.push(`Issue №${issueNumber}: This week's verdicts`);
  lines.push("");
  lines.push("MOST OVERRATED");
  lines.push("==============");
  for (const e of topOverrated) {
    lines.push(`+${Math.abs(e.gap).toFixed(0)} ${e.name} (${e.occasion})`);
    lines.push(`  "${e.verdict}"`);
    lines.push("");
  }
  lines.push("QUIETLY UNDERRATED");
  lines.push("==================");
  for (const e of topUnderrated) {
    lines.push(`−${Math.abs(e.gap).toFixed(0)} ${e.name} (${e.occasion})`);
    lines.push(`  "${e.verdict}"`);
    lines.push("");
  }
  lines.push("");
  lines.push(`See the full leaderboard: ${SITE_URL}`);
  lines.push("");
  lines.push(`Unsubscribe: ${unsubLink(opts.unsubscribeToken)}`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}