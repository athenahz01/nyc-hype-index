import { fetchCuisineLeaderboard } from "@/lib/queries";
import OccasionLeaderboard from "@/components/OccasionLeaderboard";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CUISINES, CUISINE_LABELS, type Cuisine } from "@/lib/types";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nyc-hype-index.vercel.app";

export const revalidate = 3600;

export async function generateStaticParams() {
  return CUISINES.map((c) => ({ slug: c }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const cuisine = params.slug as Cuisine;
  if (!CUISINES.includes(cuisine)) return { title: "The NYC Hype Index" };
  const label = CUISINE_LABELS[cuisine];
  const title = `${label}, ranked by data — The NYC Hype Index`;
  const description = `This week's most overrated and quietly underrated ${label} restaurants in NYC.`;
  const ogImage = `${SITE_URL}/api/og/leaderboard?cuisine=${encodeURIComponent(cuisine)}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      url: `${SITE_URL}/cuisine/${cuisine}`,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
  };
}

export default async function CuisinePage({ params }: { params: { slug: string } }) {
  const cuisine = params.slug as Cuisine;
  if (!CUISINES.includes(cuisine)) notFound();

  const data = await fetchCuisineLeaderboard(cuisine);
  if (!data) {
    return (
      <main>
        <Masthead cuisine={cuisine} issueNumber={null} publishedAt={null} />
        <NoIssueYet />
      </main>
    );
  }

  return (
    <main>
      <Masthead
        cuisine={cuisine}
        issueNumber={data.issue.number}
        publishedAt={data.issue.published_at}
      />
      <Hero cuisine={cuisine} count={data.scores.length} />

      {/* Reuse OccasionLeaderboard. Passing [] for cuisines hides the chips
          since every restaurant here shares the same cuisine. */}
      <OccasionLeaderboard scores={data.scores} availableCuisines={[]} />

      <OtherCuisines current={cuisine} />

      <Footer />
    </main>
  );
}

// ============================================================
function Masthead({
  cuisine,
  issueNumber,
  publishedAt,
}: {
  cuisine: Cuisine;
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
          ← All cuisines
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
        {dateLabel ? <>{dateLabel} · </> : null}The Index for {CUISINE_LABELS[cuisine]}
      </div>
    </header>
  );
}

function Hero({ cuisine, count }: { cuisine: Cuisine; count: number }) {
  return (
    <section className="px-7 pt-14 pb-10 max-md:px-5 max-md:pt-10 max-md:pb-8">
      <h1 className="font-display font-extrabold text-[88px] leading-[0.95] tracking-[-0.02em] max-md:text-5xl">
        <em className="italic font-normal text-red">{CUISINE_LABELS[cuisine]}</em>, ranked by data.
      </h1>
      <p className="font-display italic mt-5 text-ink-soft text-xl leading-snug max-w-[60ch] max-md:text-lg">
        {CUISINE_TAGLINES[cuisine] ?? "The most overrated and underrated spots in this corner of the corpus."}
      </p>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted mt-6 max-md:text-[10px]">
        {count} {count === 1 ? "restaurant" : "restaurants"} ranked
      </p>
    </section>
  );
}

function NoIssueYet() {
  return (
    <div className="px-7 py-32 text-center max-md:px-5 max-md:py-20">
      <div className="font-display italic text-2xl text-muted">No issue published yet.</div>
    </div>
  );
}

function OtherCuisines({ current }: { current: Cuisine }) {
  const others = CUISINES.filter((c) => c !== current);
  return (
    <section className="border-t-2 border-ink px-7 py-16 max-md:px-5 max-md:py-10">
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted mb-6 max-md:text-[10px]">
        Other cuisines
      </div>
      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-2">
        {others.map((c) => (
          <Link
            key={c}
            href={`/cuisine/${c}`}
            className="font-display text-xl font-extrabold hover:text-red transition-colors max-md:text-lg"
          >
            {CUISINE_LABELS[c]} →
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

// Cuisine-specific editorial taglines for the hero. Tone matches the
// occasion taglines — short, sharp, slightly sardonic.
const CUISINE_TAGLINES: Partial<Record<Cuisine, string>> = {
  italian: "Where reservation theater goes to die.",
  french: "The room is doing more work than the kitchen.",
  japanese: "Omakase pricing, omakase outcomes — sometimes.",
  korean: "Beyond the K-BBQ tabletops, ranked.",
  chinese: "The locals' canon vs. the algorithm's picks.",
  mexican: "Past the trendy taco shop, the real spots.",
  thai: "Where the spice level and the hype level don't match.",
  indian: "Michelin pedigree meets viral marketing.",
  mediterranean: "The aesthetic-forward genre.",
  pizza: "The slice that started the fight.",
  american: "Everything from diners to omakase, somehow.",
};