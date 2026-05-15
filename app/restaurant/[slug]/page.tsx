import { fetchRestaurantDetail } from "@/lib/queries";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import SearchBar from "@/components/SearchBar";
import { OCCASION_LABELS, CUISINE_LABELS, type Cuisine, type Occasion } from "@/lib/types";

// Live-calculated restaurants need fresh data, can't pre-render
export const dynamic = "force-dynamic";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nyc-hype-index.vercel.app";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const detail = await fetchRestaurantDetail(params.slug);
  if (!detail) {
    return { title: "Restaurant — The NYC Hype Index" };
  }
  const { restaurant, display } = detail;
  const isUnderrated = display?.is_underrated ?? false;
  const verdict = isUnderrated ? "Underrated" : "Overrated";
  const gap = display ? Math.abs(display.gap).toFixed(0) : "";

  const title = display
    ? `${restaurant.name}: ${verdict} ${isUnderrated ? "−" : "+"}${gap} — The NYC Hype Index`
    : `${restaurant.name} — The NYC Hype Index`;

  const description = display
    ? `${restaurant.name} (${restaurant.neighborhood}) scored ${verdict.toLowerCase()} by ${isUnderrated ? "−" : "+"}${gap} this week. See the verdict.`
    : `Track ${restaurant.name}'s hype gap on The NYC Hype Index.`;

  const ogImage = `${SITE_URL}/api/og/restaurant?slug=${encodeURIComponent(params.slug)}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `${SITE_URL}/restaurant/${params.slug}`,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function RestaurantPage({ params }: { params: { slug: string } }) {
  console.log(`[RestaurantPage] params=${JSON.stringify(params)}, typeof slug=${typeof params.slug}, slug.length=${params.slug?.length}`);
  const detail = await fetchRestaurantDetail(params.slug);
  if (!detail) {
    console.log(`[RestaurantPage] detail is null, calling notFound() for slug="${params.slug}"`);
    notFound();
  }

  const { restaurant, latest, display, occasionRankings } = detail;
  const hasScores = !!latest && !!display;

  return (
    <main>
      <Masthead />

      <section className="px-7 pt-16 pb-10 max-md:px-5 max-md:pt-10 max-md:pb-8">
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-wider text-muted hover:text-red transition-colors"
        >
          ← Back to home
        </Link>

        {/* HERO: name + meta */}
        <div className="mt-7 mb-3 flex items-end justify-between flex-wrap gap-3">
          <h1 className="font-display font-black text-[clamp(56px,9vw,110px)] leading-[0.95] tracking-tighter">
            {restaurant.name}
          </h1>
          {restaurant.price_tier && (
            <div className="font-display font-bold text-3xl text-muted max-md:text-2xl">
              {restaurant.price_tier}
            </div>
          )}
        </div>

        <div className="font-mono text-[12px] uppercase tracking-widest text-muted mb-12 flex flex-wrap gap-3 items-center max-md:text-[10px] max-md:mb-8">
          <span>{restaurant.neighborhood}</span>
          <span className="opacity-40">·</span>
          <span>{capitalize(restaurant.borough)}</span>
          {restaurant.cuisines.length > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="text-gold">
                {restaurant.cuisines.map((c) => CUISINE_LABELS[c as Cuisine] ?? c).join(" / ")}
              </span>
            </>
          )}
          {!restaurant.active && (
            <>
              <span className="opacity-40">·</span>
              <span className="text-red">Live-calculated (not in editor's index)</span>
            </>
          )}
        </div>

        {hasScores ? (
          <ScoreCard display={display} latest={latest} />
        ) : (
          <NoScoreYet name={restaurant.name} />
        )}
      </section>

      {/* Per-occasion rankings, if any */}
      {hasScores && occasionRankings.length > 0 && (
        <OccasionRankings rankings={occasionRankings} />
      )}

      {hasScores && latest && <SignalDetails latest={latest} />}

      {/* Try another search */}
      <section className="border-t border-ink px-7 py-16 max-md:px-5 max-md:py-12">
        <h3 className="font-display italic font-normal text-3xl tracking-tight mb-6 max-md:text-2xl">
          Look up another spot.
        </h3>
        <SearchBar variant="hero" />
      </section>

      <Footer />
    </main>
  );
}

// ============================================================
function Masthead() {
  return (
    <header className="border-b-2 border-ink py-4 px-7 grid items-end gap-6 [grid-template-columns:1fr_auto_1fr] max-md:[grid-template-columns:1fr] max-md:gap-2 max-md:px-5">
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted max-md:order-2">
        <Link href="/" className="hover:text-red transition-colors">
          ← Home
        </Link>
      </div>
      <Link
        href="/"
        className="font-display font-black text-[28px] tracking-tight text-center max-md:order-1 max-md:text-left max-md:text-[22px]"
      >
        <span className="italic font-normal text-lg mr-1 text-muted">The</span>
        NYC Hype Index
      </Link>
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted text-right max-md:order-3 max-md:text-left" />
    </header>
  );
}

function ScoreCard({ display, latest }: { display: NonNullable<Awaited<ReturnType<typeof fetchRestaurantDetail>>>["display"]; latest: any }) {
  if (!display || !latest) return null;
  const verdictTag = display.is_calibrated
    ? { label: "Calibrated", color: "text-muted", subtitle: "Algorithm and locals agree" }
    : display.is_underrated
    ? { label: "Quietly Underrated", color: "text-gold", subtitle: "Locals know · TikTok hasn't found it" }
    : { label: "Overrated", color: "text-red", subtitle: "Hype outpacing reality" };

  return (
    <>
      <div className="mb-10 inline-block">
        <span className={`font-mono text-[11px] uppercase tracking-widest ${verdictTag.color}`}>
          {verdictTag.label}
        </span>
        <div className="font-display italic text-xl text-ink-soft mt-1 max-md:text-lg">
          {verdictTag.subtitle}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 max-md:grid-cols-1 max-md:gap-3">
        <Score label="Hype" value={display.hype} color="ink" bar />
        <Score label="Reality" value={display.reality} color="gold" bar />
        <Score
          label="Gap"
          value={Math.abs(display.gap)}
          sign={display.is_underrated ? "−" : ""}
          arrow={display.is_underrated ? "↓" : "↑"}
          color={display.is_underrated ? "gold" : display.is_calibrated ? "ink" : "red"}
        />
      </div>
    </>
  );
}

function Score({
  label,
  value,
  color,
  sign = "",
  arrow,
  bar = false,
}: {
  label: string;
  value: number;
  color: "ink" | "gold" | "red";
  sign?: string;
  arrow?: string;
  bar?: boolean;
}) {
  const colorClass =
    color === "red" ? "text-red" : color === "gold" ? "text-gold" : "text-ink";
  const barColor = color === "red" ? "bg-red" : color === "gold" ? "bg-gold" : "bg-ink";

  return (
    <div className="border border-ink/30 p-7 max-md:p-5">
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted mb-3">
        {label}
      </div>
      <div className={`font-display font-black text-[64px] leading-none tracking-tighter ${colorClass} max-md:text-5xl`}>
        {sign}
        {value.toFixed(0)}
        {arrow && <span className="text-2xl ml-2 font-mono font-normal align-middle">{arrow}</span>}
      </div>
      {bar && (
        <div className="h-1 bg-ink/10 mt-5 relative overflow-hidden">
          <div className={`absolute inset-y-0 left-0 ${barColor}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
        </div>
      )}
    </div>
  );
}

function OccasionRankings({
  rankings,
}: {
  rankings: NonNullable<Awaited<ReturnType<typeof fetchRestaurantDetail>>>["occasionRankings"];
}) {
  return (
    <section className="border-t border-ink px-7 py-14 max-md:px-5 max-md:py-10">
      <h2 className="font-display italic font-normal text-4xl tracking-tight mb-7 max-md:text-3xl">
        Rankings in this week's issue.
      </h2>
      <div className="space-y-3">
        {rankings.map((r) => (
          <Link
            key={r.occasion}
            href={`/occasion/${r.occasion}`}
            className="block border border-ink/30 p-5 hover:bg-ink hover:text-paper transition-colors group max-md:p-4"
          >
            <div className="flex justify-between items-baseline mb-2 flex-wrap gap-2">
              <div>
                <span
                  className={`font-mono text-[11px] uppercase tracking-widest mb-1 inline-block ${
                    r.is_underrated ? "text-gold group-hover:text-gold" : "text-red group-hover:text-red"
                  }`}
                >
                  {r.is_underrated ? "Underrated" : "Overrated"} · Rank #{r.rank}
                </span>
                <div className="font-display font-bold text-2xl tracking-tight max-md:text-xl">
                  {OCCASION_LABELS[r.occasion as Occasion]}
                </div>
              </div>
              <div className={`font-display font-black text-3xl ${r.is_underrated ? "text-gold" : "text-red"} max-md:text-2xl`}>
                {r.is_underrated ? "−" : ""}
                {Math.abs(r.gap).toFixed(0)}
                <span className="text-sm ml-1 font-mono font-normal">
                  {r.is_underrated ? "↓" : "↑"}
                </span>
              </div>
            </div>
            {r.verdict && (
              <div className="font-display italic text-base text-ink-soft group-hover:text-paper/80 max-md:text-sm">
                "{r.verdict}"
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

function SignalDetails({ latest }: { latest: any }) {
  return (
    <section className="border-t border-ink bg-paper-2 px-7 py-14 max-md:px-5 max-md:py-10">
      <h2 className="font-display italic font-normal text-4xl tracking-tight mb-7 max-md:text-3xl">
        The raw signals.
      </h2>
      <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <Signal label="TikTok views" value={fmt(latest.tiktok_views)} />
        <Signal label="Peak single video" value={fmt(latest.tiktok_peak_views)} />
        <Signal label="Google rating" value={latest.google_rating ? `${latest.google_rating}★` : "—"} />
        <Signal label="Google reviews" value={fmt(latest.google_reviews)} />
        <Signal label="Reddit mentions" value={String(latest.reddit_mentions)} />
        <Signal label="IG posts" value={String(latest.ig_posts)} />
        <Signal
          label="TikTok sentiment"
          value={latest.tiktok_caption_sentiment != null ? Math.round(latest.tiktok_caption_sentiment).toString() : "—"}
        />
        <Signal
          label="Google sentiment"
          value={latest.google_sentiment != null ? Math.round(latest.google_sentiment).toString() : "—"}
        />
      </div>
      <div className="mt-7 font-mono text-[10px] uppercase tracking-widest text-muted">
        Scored {new Date(latest.scored_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
        {latest.source === "live_search" && " · via live calculation"}
      </div>
    </section>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-ink/20 bg-paper p-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">{label}</div>
      <div className="font-display font-bold text-2xl tracking-tight max-md:text-xl">{value}</div>
    </div>
  );
}

function NoScoreYet({ name }: { name: string }) {
  return (
    <div className="border border-ink/30 p-10 text-center max-md:p-6">
      <div className="font-display text-6xl text-muted opacity-40 mb-4">∅</div>
      <h2 className="font-display italic text-2xl text-ink-soft">
        We haven't scored {name} yet.
      </h2>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted mt-3">
        Search again to trigger a live calculation
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink px-7 py-9 flex justify-between items-center flex-wrap gap-4 font-mono text-[11px] uppercase tracking-wider text-muted max-md:px-5">
      <Link href="/" className="hover:text-red transition-colors">
        ← All occasions
      </Link>
      <Link href="/archive" className="hover:text-red transition-colors">
        Archive →
      </Link>
    </footer>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}