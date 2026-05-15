/**
 * GET /api/og/restaurant?slug=<slug>&occasion=<occasion>
 *
 * Returns a 1200×630 PNG share card for a restaurant. If `occasion` is
 * provided, uses THAT occasion's rank + verdict. Otherwise picks the
 * restaurant's strongest signal (max |gap|) from the latest published
 * issue.
 *
 * Wired into restaurant detail pages as the og:image. Also used by the
 * in-app Share modal.
 */

import { ImageResponse } from "next/og";
import { createAdminClient } from "@/lib/supabase";
import { OG_COLORS, OG_SIZE } from "@/lib/og-tokens";
import { ogFontDescriptors } from "@/lib/og-fonts";
import { OCCASION_LABELS, type Occasion } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug")?.trim();
  const occasionParam = url.searchParams.get("occasion")?.trim() as Occasion | null;

  if (!slug) {
    return new Response("slug required", { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("id, slug, name, neighborhood, borough, cuisines, price_tier")
    .eq("slug", slug)
    .maybeSingle();

  if (!restaurant) {
    return new Response("not found", { status: 404 });
  }

  const { data: issue } = await supabase
    .from("issues")
    .select("id, number")
    .eq("is_published", true)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Pick the strongest occasion_score for this restaurant
  type ScoreRow = {
    occasion: Occasion;
    rank: number;
    is_underrated: boolean;
    gap: number;
    hype_score: number;
    reality_score: number;
    verdict: string | null;
  };
  let occasionScore: ScoreRow | null = null;

  if (issue) {
    let q = supabase
      .from("occasion_scores")
      .select("occasion, rank, is_underrated, gap, hype_score, reality_score, verdict")
      .eq("issue_id", issue.id)
      .eq("restaurant_id", restaurant.id);
    if (occasionParam) q = q.eq("occasion", occasionParam);
    const { data: rows } = await q;
    if (rows && rows.length > 0) {
      const sorted = [...rows].sort(
        (a, b) => Math.abs(Number(b.gap)) - Math.abs(Number(a.gap))
      );
      occasionScore = sorted[0] as unknown as ScoreRow;
    }
  }

  const fonts = await ogFontDescriptors();

  // Pre-compute display values — using a const+early-bind so TS inference
  // doesn't get confused by the conditional null-or-shape later.
  const score = occasionScore;
  const hasScore = !!score;
  const isUnderrated = score?.is_underrated ?? false;
  const gap = score ? Math.abs(Number(score.gap)) : 0;
  const accent = isUnderrated ? OG_COLORS.gold : OG_COLORS.red;
  const arrow = isUnderrated ? "↓" : "↑";
  const verdictLabel = isUnderrated ? "UNDERRATED" : "OVERRATED";

  let verdict = score?.verdict ?? "";
  if (verdict.length > 140) verdict = verdict.slice(0, 137).trimEnd() + "…";

  const displayName = restaurant.name.length > 22
    ? restaurant.name.slice(0, 21) + "…"
    : restaurant.name;

  const neighborhood = (restaurant.neighborhood ?? "").toUpperCase();
  const cuisine = ((restaurant.cuisines as string[])?.[0] ?? "");
  const priceTier = restaurant.price_tier ?? "";

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
          position: "relative",
        }}
      >
        {/* Top hairline + masthead */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "32px 56px 20px",
            borderBottom: `1px solid ${OG_COLORS.hairline}`,
            fontSize: 16,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: OG_COLORS.muted,
          }}
        >
          <div style={{ display: "flex", gap: 16 }}>
            <span
              style={{
                display: "flex",
                fontStyle: "italic",
                textTransform: "none",
                letterSpacing: 0,
                fontSize: 18,
                color: OG_COLORS.ink,
              }}
            >
              The
            </span>
            <span style={{ display: "flex", color: OG_COLORS.ink, fontWeight: 900 }}>
              NYC HYPE INDEX
            </span>
          </div>
          {issue?.number !== undefined && (
            <span style={{ display: "flex" }}>Issue №{issue.number}</span>
          )}
        </div>

        {/* Main: left (name + verdict) vs right (big gap number) */}
        <div style={{ display: "flex", flex: 1, padding: "44px 56px 0", gap: 40 }}>
          {/* LEFT */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1.4,
              paddingRight: 16,
            }}
          >
            {hasScore && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 24,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    background: accent,
                    color: OG_COLORS.paper,
                    padding: "6px 14px",
                    fontSize: 16,
                    letterSpacing: "0.18em",
                    fontWeight: 700,
                  }}
                >
                  {verdictLabel}
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 16,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: OG_COLORS.muted,
                  }}
                >
                  #{score!.rank} · {OCCASION_LABELS[score!.occasion]}
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                fontSize: displayName.length > 14 ? 100 : 124,
                fontWeight: 900,
                color: OG_COLORS.ink,
                lineHeight: 0.95,
                letterSpacing: "-0.02em",
                marginBottom: 18,
              }}
            >
              {displayName}
            </div>

            <div
              style={{
                display: "flex",
                gap: 14,
                alignItems: "center",
                fontSize: 18,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: OG_COLORS.muted,
                marginBottom: 32,
              }}
            >
              {neighborhood && <span style={{ display: "flex" }}>{neighborhood}</span>}
              {cuisine && (
                <>
                  <span style={{ display: "flex" }}>·</span>
                  <span style={{ display: "flex", color: accent }}>{cuisine}</span>
                </>
              )}
              {priceTier && (
                <>
                  <span style={{ display: "flex" }}>·</span>
                  <span style={{ display: "flex" }}>{priceTier}</span>
                </>
              )}
            </div>

            {verdict && (
              <div
                style={{
                  display: "flex",
                  fontSize: 30,
                  fontStyle: "italic",
                  lineHeight: 1.35,
                  color: OG_COLORS.inkSoft,
                  paddingLeft: 24,
                  borderLeft: `4px solid ${accent}`,
                }}
              >
                {verdict}
              </div>
            )}
          </div>

          {/* RIGHT — only when there's a score */}
          {hasScore && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                justifyContent: "flex-start",
                flex: 1,
                paddingTop: 4,
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 18,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: OG_COLORS.muted,
                  marginBottom: 8,
                }}
              >
                Hype Gap
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: 320,
                  fontWeight: 900,
                  color: accent,
                  lineHeight: 0.85,
                  letterSpacing: "-0.04em",
                  alignItems: "flex-start",
                }}
              >
                <span style={{ display: "flex" }}>{gap.toFixed(0)}</span>
                <span
                  style={{ display: "flex", fontSize: 140, marginLeft: 8, marginTop: 24 }}
                >
                  {arrow}
                </span>
              </div>
              <div style={{ display: "flex", gap: 28, marginTop: 24 }}>
                <Stat label="Hype" value={Number(score!.hype_score)} />
                <Stat label="Reality" value={Number(score!.reality_score)} />
              </div>
            </div>
          )}
        </div>

        {/* Bottom band */}
        <div
          style={{
            marginTop: "auto",
            padding: "20px 56px",
            borderTop: `1px solid ${OG_COLORS.hairline}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 15,
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
    {
      ...OG_SIZE,
      fonts,
    }
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 14,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: OG_COLORS.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 42,
          fontWeight: 900,
          color: OG_COLORS.ink,
          lineHeight: 1,
        }}
      >
        {Math.round(value)}
      </div>
    </div>
  );
}