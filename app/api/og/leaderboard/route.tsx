/**
 * GET /api/og/leaderboard?occasion=<slug>
 * GET /api/og/leaderboard?cuisine=<slug>
 * GET /api/og/leaderboard?neighborhood=<slug>
 *
 * Returns a 1200×630 PNG share card showing the top 3 overrated + top 3
 * underrated for a leaderboard slice. The "spread" format: two columns,
 * red on left, gold on right, each with a verdict pull-quote.
 *
 * Wired into occasion / cuisine / neighborhood pages as the og:image.
 */

import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase";
import { OG_COLORS, OG_SIZE } from "@/lib/og-tokens";
import { ogFontDescriptors } from "@/lib/og-fonts";
import {
  OCCASION_LABELS,
  CUISINE_LABELS,
  type Occasion,
  type Cuisine,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Entry = {
  name: string;
  gap: number;
  verdict: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const occasion = url.searchParams.get("occasion") as Occasion | null;
  const cuisine = url.searchParams.get("cuisine") as Cuisine | null;
  const neighborhoodRaw = url.searchParams.get("neighborhood");

  // Normalize neighborhood: URL form "West-Village" → DB "West Village"
  const neighborhood = neighborhoodRaw
    ? decodeURIComponent(neighborhoodRaw).replace(/-/g, " ")
    : null;

  if (!occasion && !cuisine && !neighborhood) {
    return new Response("one of occasion, cuisine, neighborhood required", {
      status: 400,
    });
  }

  const supabase = createAdminClient();

  const { data: issue } = await supabase
    .from("issues")
    .select("id, number")
    .eq("is_published", true)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!issue) {
    return new Response("no published issue", { status: 404 });
  }

  // Build the query. We always need: restaurant name, gap, verdict, is_underrated.
  // For cuisine/neighborhood: filter via the restaurant join.
  let q = supabase
    .from("occasion_scores")
    .select(
      `gap, is_underrated, verdict, restaurant:restaurants!inner ( name, cuisines, neighborhood )`
    )
    .eq("issue_id", issue.id);

  if (occasion) q = q.eq("occasion", occasion);
  if (cuisine) q = q.contains("restaurant.cuisines", [cuisine]);
  if (neighborhood) q = q.eq("restaurant.neighborhood", neighborhood);

  const { data: rows } = await q;
  if (!rows) {
    return new Response("query failed", { status: 500 });
  }

  // Collapse to max-|gap| per restaurant for cuisine/neighborhood slices
  // (same restaurant can appear on multiple occasion boards)
  const collapsed = new Map<string, any>();
  for (const r of rows as any[]) {
    const name = r.restaurant?.name;
    if (!name) continue;
    const existing = collapsed.get(name);
    if (!existing || Math.abs(Number(r.gap)) > Math.abs(Number(existing.gap))) {
      collapsed.set(name, r);
    }
  }
  const allEntries = Array.from(collapsed.values());

  const overrated: Entry[] = allEntries
    .filter((r) => !r.is_underrated)
    .sort((a, b) => Number(b.gap) - Number(a.gap))
    .slice(0, 3)
    .map((r) => ({
      name: r.restaurant.name,
      gap: Math.abs(Number(r.gap)),
      verdict: shortenVerdict(r.verdict),
    }));

  const underrated: Entry[] = allEntries
    .filter((r) => r.is_underrated)
    .sort((a, b) => Number(a.gap) - Number(b.gap))
    .slice(0, 3)
    .map((r) => ({
      name: r.restaurant.name,
      gap: Math.abs(Number(r.gap)),
      verdict: shortenVerdict(r.verdict),
    }));

  // Headline
  const sliceLabel = occasion
    ? OCCASION_LABELS[occasion]
    : cuisine
    ? CUISINE_LABELS[cuisine]
    : neighborhood ?? "";

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
        {/* Masthead */}
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
          <span style={{ display: "flex" }}>Issue №{issue.number}</span>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", padding: "28px 56px 0", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              fontSize: 56,
              fontWeight: 900,
              color: OG_COLORS.ink,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            <span style={{ display: "flex" }}>{sliceLabel},</span>
            <span
              style={{
                display: "flex",
                fontStyle: "italic",
                fontWeight: 400,
                color: OG_COLORS.red,
                marginLeft: 16,
              }}
            >
              ranked by data
            </span>
            <span style={{ display: "flex" }}>.</span>
          </div>
        </div>

        {/* Two columns: red (over) | gold (under) */}
        <div
          style={{
            display: "flex",
            flex: 1,
            padding: "28px 56px 0",
            gap: 36,
          }}
        >
          <Column
            label="↑ Most Overrated"
            accent={OG_COLORS.red}
            entries={overrated}
            sign="+"
          />
          <div
            style={{ display: "flex", width: 1, background: OG_COLORS.hairline }}
          />
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
          <span style={{ display: "flex" }}>
            A weekly autopsy of NYC restaurant hype
          </span>
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        gap: 14,
      }}
    >
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
      {entries.length === 0 ? (
        <div
          style={{
            display: "flex",
            fontSize: 16,
            color: OG_COLORS.muted,
            fontStyle: "italic",
          }}
        >
          None this week.
        </div>
      ) : (
        entries.map((e, i) => <Row key={i} entry={e} sign={sign} accent={accent} />)
      )}
    </div>
  );
}

function Row({
  entry,
  sign,
  accent,
}: {
  entry: Entry;
  sign: string;
  accent: string;
}) {
  // Trim name to one line at this scale
  const name = entry.name.length > 24 ? entry.name.slice(0, 23) + "…" : entry.name;

  return (
    <div
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
          {entry.gap.toFixed(0)}
        </div>
      </div>
      {entry.verdict && (
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
          {entry.verdict}
        </div>
      )}
    </div>
  );
}

function shortenVerdict(v: string | null): string {
  if (!v) return "";
  // Keep them short for the spread layout — two lines max
  if (v.length > 90) return v.slice(0, 87).trimEnd() + "…";
  return v;
}