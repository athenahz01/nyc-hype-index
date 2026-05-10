import { fetchOccasionLeaderboard } from "@/lib/queries";
import OccasionLeaderboard from "@/components/OccasionLeaderboard";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  OCCASIONS,
  OCCASION_LABELS,
  OCCASION_TAGLINES,
  type Occasion,
  type Cuisine,
} from "@/lib/types";

export const revalidate = 3600;

export async function generateStaticParams() {
  return OCCASIONS.map((o) => ({ slug: o }));
}

export default async function OccasionPage({ params }: { params: { slug: string } }) {
  const occasion = params.slug as Occasion;
  if (!OCCASIONS.includes(occasion)) notFound();

  const data = await fetchOccasionLeaderboard(occasion);
  if (!data) {
    return (
      <main>
        <Masthead occasion={occasion} issueNumber={null} publishedAt={null} />
        <NoIssueYet />
      </main>
    );
  }

  // Compute available cuisines from this occasion's restaurants for the filter chips
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
        occasion={occasion}
        issueNumber={data.issue.number}
        publishedAt={data.issue.published_at}
      />
      <Hero occasion={occasion} />

      <OccasionLeaderboard scores={data.scores} availableCuisines={availableCuisines} />

      <OtherOccasions current={occasion} />

      <Footer />
    </main>
  );
}

// ============================================================
function Masthead({
  occasion,
  issueNumber,
  publishedAt,
}: {
  occasion: Occasion;
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
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted max-md:order-2">
        <Link href="/" className="hover:text-red transition-colors">
          ← All occasions
        </Link>
        {issueNumber !== null && <span className="ml-3 opacity-70">Issue №{issueNumber}</span>}
      </div>
      <div className="font-display font-black text-[28px] tracking-tight text-center max-md:order-1 max-md:text-left max-md:text-[22px]">
        <span className="italic font-normal text-lg mr-1 text-muted">The</span>
        NYC Hype Index
      </div>
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted text-right max-md:order-3 max-md:text-left">
        {dateLabel}
      </div>
    </header>
  );
}

function Hero({ occasion }: { occasion: Occasion }) {
  return (
    <section className="hero py-20 px-7 border-b border-ink text-center relative overflow-hidden max-md:py-14 max-md:px-5">
      <span className="inline-block font-mono text-[11px] uppercase tracking-widest text-red mb-7 border border-red px-3.5 py-1.5 rounded-full bg-red/5 max-md:text-[10px] max-md:px-3 max-md:py-1.5 max-md:mb-6">
        The Index for {OCCASION_LABELS[occasion]}
      </span>
      <h1 className="font-display font-black text-[clamp(54px,9vw,132px)] leading-[0.92] tracking-tighter mx-auto max-w-[14ch]">
        <em className="italic font-normal text-red">{OCCASION_LABELS[occasion]}</em>, ranked by data.
      </h1>
      <p className="mt-9 mx-auto max-w-[56ch] text-[18px] leading-relaxed text-ink-soft">
        {OCCASION_TAGLINES[occasion]}
      </p>
    </section>
  );
}

function OtherOccasions({ current }: { current: Occasion }) {
  const others = OCCASIONS.filter((o) => o !== current);
  return (
    <section className="border-t border-ink px-7 py-16 max-md:px-5 max-md:py-12">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-6">
        Other indexes
      </div>
      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-2">
        {others.map((o) => (
          <Link
            key={o}
            href={`/occasion/${o}`}
            className="block border border-ink/30 px-5 py-4 hover:bg-ink hover:text-paper transition-colors group"
          >
            <div className="font-display font-bold text-xl tracking-tight max-md:text-lg">
              {OCCASION_LABELS[o]}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted group-hover:text-paper/70 mt-1">
              View leaderboard →
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="px-7 py-9 border-t border-ink flex justify-between items-center flex-wrap gap-4 font-mono text-[11px] uppercase tracking-wider text-muted max-md:px-5">
      <Link href="/" className="hover:text-red transition-colors">
        ← Home
      </Link>
      <Link href="/archive" className="hover:text-red transition-colors">
        All issues →
      </Link>
    </footer>
  );
}

function NoIssueYet() {
  return (
    <section className="px-7 py-32 text-center max-md:px-5 max-md:py-20">
      <div className="font-display text-7xl text-muted opacity-40 mb-6">∅</div>
      <h2 className="font-display italic text-3xl text-ink-soft mb-3 max-md:text-2xl">
        First issue dropping soon.
      </h2>
    </section>
  );
}
