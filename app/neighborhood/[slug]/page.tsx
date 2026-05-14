import { fetchNeighborhoodLeaderboard, fetchBrowseFacets } from "@/lib/queries";
import OccasionLeaderboard from "@/components/OccasionLeaderboard";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Cuisine } from "@/lib/types";

// Neighborhoods are data-driven, so we re-validate hourly rather than
// generating static params (the corpus may add neighborhoods over time).
export const revalidate = 3600;

// Neighborhoods are stored as freeform strings in restaurants.neighborhood.
// The URL slug is the URL-encoded version, but in the DB it's the
// display string. We decode and lookup directly.
function decodeNeighborhood(slug: string): string {
  return decodeURIComponent(slug).replace(/-/g, " ");
}

function encodeNeighborhood(name: string): string {
  return encodeURIComponent(name.replace(/\s+/g, "-"));
}

export default async function NeighborhoodPage({ params }: { params: { slug: string } }) {
  const neighborhoodName = decodeNeighborhood(params.slug);

  const data = await fetchNeighborhoodLeaderboard(neighborhoodName);
  if (!data || data.scores.length === 0) {
    notFound();
  }

  // Available cuisines in THIS neighborhood for filter chips
  const cuisineSet = new Set<Cuisine>();
  for (const s of data.scores) {
    for (const c of s.restaurant.cuisines) {
      cuisineSet.add(c as Cuisine);
    }
  }
  const availableCuisines = Array.from(cuisineSet).sort();

  return (
    <main>
      <Masthead
        neighborhood={neighborhoodName}
        issueNumber={data.issue.number}
        publishedAt={data.issue.published_at}
      />
      <Hero neighborhood={neighborhoodName} count={data.scores.length} />

      <OccasionLeaderboard scores={data.scores} availableCuisines={availableCuisines} />

      <OtherNeighborhoods current={neighborhoodName} />

      <Footer />
    </main>
  );
}

// ============================================================
function Masthead({
  neighborhood,
  issueNumber,
  publishedAt,
}: {
  neighborhood: string;
  issueNumber: number | null;
  publishedAt: string | null;
}) {
  const dateLabel = publishedAt
    ? new Date(publishedAt).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  return (
    <header className="border-b-2 border-ink py-4 px-7 grid items-end gap-6 [grid-template-columns:1fr_auto_1fr] max-md:[grid-template-columns:1fr] max-md:gap-2 max-md:px-5">
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted flex items-center gap-3 max-md:text-[10px]">
        <Link href="/" className="hover:underline">
          ← All neighborhoods
        </Link>
        {issueNumber !== null && <span>Issue №{issueNumber}</span>}
      </div>

      <Link
        href="/"
        className="font-display text-2xl font-extrabold tracking-tight leading-none justify-self-center max-md:text-xl max-md:justify-self-start"
      >
        <em className="italic font-normal text-base text-muted mr-1 max-md:text-sm">The</em>
        NYC Hype Index
      </Link>

      <div className="font-mono text-[10px] uppercase tracking-widest text-muted text-right max-md:text-[9px] max-md:text-left">
        {dateLabel ? <>{dateLabel} · </> : null}The Index for {neighborhood}
      </div>
    </header>
  );
}

function Hero({ neighborhood, count }: { neighborhood: string; count: number }) {
  return (
    <section className="px-7 pt-14 pb-10 max-md:px-5 max-md:pt-10 max-md:pb-8">
      <h1 className="font-display font-extrabold text-[88px] leading-[0.95] tracking-[-0.02em] max-md:text-5xl">
        <em className="italic font-normal text-red">{neighborhood}</em>, ranked by data.
      </h1>
      <p className="font-display italic mt-5 text-ink-soft text-xl leading-snug max-w-[60ch] max-md:text-lg">
        Every spot in {neighborhood} we track — sorted by the gap between online hype and ground-truth.
      </p>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted mt-6 max-md:text-[10px]">
        {count} {count === 1 ? "restaurant" : "restaurants"} ranked
      </p>
    </section>
  );
}

async function OtherNeighborhoods({ current }: { current: string }) {
  const { neighborhoods } = await fetchBrowseFacets();
  const others = neighborhoods.filter((n) => n.label !== current).slice(0, 12);
  if (others.length === 0) return null;

  return (
    <section className="border-t-2 border-ink px-7 py-16 max-md:px-5 max-md:py-10">
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted mb-6 max-md:text-[10px]">
        Other neighborhoods
      </div>
      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-2">
        {others.map((n) => (
          <Link
            key={n.slug}
            href={`/neighborhood/${encodeNeighborhood(n.slug)}`}
            className="font-display text-xl font-extrabold hover:text-red transition-colors max-md:text-lg"
          >
            {n.label} →
          </Link>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t-2 border-ink px-7 py-10 flex justify-between items-center max-md:px-5 max-md:py-8 max-md:flex-col max-md:gap-3">
      <Link
        href="/"
        className="font-mono text-[11px] uppercase tracking-widest hover:underline max-md:text-[10px]"
      >
        ← Home
      </Link>
      <Link
        href="/archive"
        className="font-mono text-[11px] uppercase tracking-widest hover:underline max-md:text-[10px]"
      >
        All issues →
      </Link>
    </footer>
  );
}