/**
 * GET /api/og/digest?issue=<number>
 *
 * Returns the share card for a published issue — top 3 overrated + top 3
 * underrated across all occasions. Used as the og:image for the home page
 * and as the email-digest preview image.
 *
 * If `issue` param is missing, uses the latest published issue.
 */

import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase";
import { OG_COLORS, OG_SIZE } from "@/lib/og-tokens";
import { ogFontDescriptors } from "@/lib/og-fonts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Entry = {
  name: string;
  gap: number;
  verdict: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const issueParam = url.searchParams.get("issue");

  const supabase = createAdminClient();

  let issueQuery = supabase
    .from("issues")
    .select("id, number, published_at")
    .eq("is_published", true);
  if (issueParam) {
    issueQuery = issueQuery.eq("number", parseInt(issueParam, 10));
  } else {
    issueQuery = issueQuery.order("number", { ascending: false });
  }
  const { data: issue } = await issueQuery.limit(1).maybeSingle();

  if (!issue) {
    return new Response("issue not found", { status: 404 });
  }

  const { data: rows } = await supabase
    .from("occasion_scores")
    .select(
      `gap, is_underrated, verdict, restaurant:restaurants!inner ( name )`
    )
    .eq("issue_id", issue.id);

  // Dedupe by restaurant (highest-|gap| wins per restaurant per side)
  const seenOver = new Set<string>();
  const seenUnder = new Set<string>();

  const overratedSorted = ((rows ?? []) as any[])
    .filter((r) => !r.is_underrated)
    .sort((a, b) => Number(b.gap) - Number(a.gap));
  const underratedSorted = ((rows ?? []) as any[])
    .filter((r) => r.is_underrated)
    .sort((a, b) => Number(a.gap) - Number(b.gap));

  const overrated: Entry[] = [];
  for (const r of overratedSorted) {
    const name = r.restaurant?.name;
    if (!name || seenOver.has(name)) continue;
    seenOver.add(name);
    overrated.push({
      name,
      gap: Math.abs(Number(r.gap)),
      verdict: shortenVerdict(r.verdict),
    });
    if (overrated.length >= 3) break;
  }

  const underrated: Entry[] = [];
  for (const r of underratedSorted) {
    const name = r.restaurant?.name;
    if (!name || seenUnder.has(name)) continue;
    seenUnder.add(name);
    underrated.push({
      name,
      gap: Math.abs(Number(r.gap)),
      verdict: shortenVerdict(r.verdict),
    });
    if (underrated.length >= 3) break;
  }

  const fonts = await ogFontDescriptors();

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: OG_COLORS.paper,
          flexDirection: "column",
          fontFamily: "Fraunces",
        }}
      >
        {/* Masthead — slightly bigger because this card represents the whole issue */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "28px 56px 16px",
            borderBottom: `1px solid ${OG_COLORS.hairline}`,
            fontSize: 15,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: OG_COLORS.muted,
          }}
        >
          <div style={{ display: "flex", gap: 14 }}>
            <span
              style={{
                display: "flex",
                fontStyle: "italic",
                textTransform: "none",
                letterSpacing: 0,
                fontSize: 17,
                color: OG_COLORS.ink,
              }}
            >
              The
            </span>
            <span style={{ display: "flex", color: OG_COLORS.ink, fontWeight: 900 }}>
              NYC HYPE INDEX
            </span>
          </div>
          <span style={{ display: "flex" }}>
            {issue.published_at
              ? new Date(issue.published_at).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              : ""}
          </span>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", padding: "24px 56px 0", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 14,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: OG_COLORS.red,
              fontWeight: 900,
              marginBottom: 4,
            }}
          >
            Issue №{issue.number}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 60,
              fontWeight: 900,
              color: OG_COLORS.ink,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            <span style={{ display: "flex" }}>This week's</span>
            <span
              style={{
                display: "flex",
                fontStyle: "italic",
                fontWeight: 400,
                color: OG_COLORS.red,
                marginLeft: 18,
              }}
            >
              verdicts
            </span>
            <span style={{ display: "flex" }}>.</span>
          </div>
        </div>

        {/* Two columns */}
        <div style={{ display: "flex", flex: 1, padding: "24px 56px 0", gap: 36 }}>
          <Column
            label="↑ Most Overrated"
            accent={OG_COLORS.red}
            entries={overrated}
            sign="+"
          />
          <div style={{ display: "flex", width: 1, background: OG_COLORS.hairline }} />
          <Column
            label="↓ Quietly Underrated"
            accent={OG_COLORS.gold}
            entries={underrated}
            sign="−"
          />
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            marginTop: "auto",
            padding: "16px 56px",
            borderTop: `1px solid ${OG_COLORS.hairline}`,
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 14,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: OG_COLORS.muted,
          }}
        >
          <span style={{ display: "flex" }}>A weekly autopsy of NYC restaurant hype</span>
          <span style={{ display: "flex" }}>nyc-hype-index.vercel.app</span>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}

function Column({
  label,
  accent,
  entries,
  sign,
}: {
  label: string;
  accent: string;
  entries: Entry[];
  sign: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 14 }}>
      <div
        style={{
          display: "flex",
          fontSize: 14,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: accent,
          fontWeight: 900,
        }}
      >
        {label}
      </div>
      {entries.map((e, i) => {
        const name = e.name.length > 24 ? e.name.slice(0, 23) + "…" : e.name;
        return (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              borderTop: `1px solid ${OG_COLORS.hairline}`,
              paddingTop: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 26,
                  fontWeight: 900,
                  color: OG_COLORS.ink,
                  lineHeight: 1.1,
                  letterSpacing: "-0.01em",
                }}
              >
                {name}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 36,
                  fontWeight: 900,
                  color: accent,
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                }}
              >
                {sign}
                {e.gap.toFixed(0)}
              </div>
            </div>
            {e.verdict && (
              <div
                style={{
                  display: "flex",
                  fontSize: 15,
                  fontStyle: "italic",
                  color: OG_COLORS.inkSoft,
                  lineHeight: 1.3,
                  marginTop: 2,
                }}
              >
                {e.verdict}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function shortenVerdict(v: string | null): string {
  if (!v) return "";
  if (v.length > 90) return v.slice(0, 87).trimEnd() + "…";
  return v;
}