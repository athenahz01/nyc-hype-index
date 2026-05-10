import { fetchOccasionHighlights } from "@/lib/queries";
import SubmitTip from "@/components/SubmitTip";
import SubscribeForm from "@/components/SubscribeForm";
import Link from "next/link";
import {
  OCCASIONS,
  OCCASION_LABELS,
  OCCASION_TAGLINES,
  type Occasion,
  type OccasionScoreWithRestaurant,
} from "@/lib/types";

export const revalidate = 3600;

export default async function HomePage() {
  const { issue, highlights } = await fetchOccasionHighlights(3);
  const hasData = !!issue && Object.keys(highlights).length > 0;

  return (
    <main>
      <Masthead issueNumber={issue?.number ?? null} publishedAt={issue?.published_at ?? null} />
      <Hero />

      {hasData && issue ? (
        <>
          <StatBar
            occasionsTracked={Object.keys(highlights).length}
            tiktokViews={issue.total_tiktok_views}
            reviews={issue.total_reviews}
          />
          <OccasionGrid highlights={highlights} />
        </>
      ) : (
        <NoIssueYet />
      )}

      <Methodology />
      <Footer />
    </main>
  );
}

// ============================================================
function Masthead({ issueNumber, publishedAt }: { issueNumber: number | null; publishedAt: string | null }) {
  const dateLabel = publishedAt
    ? new Date(publishedAt).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

  return (
    <header className="border-b-2 border-ink py-4 px-7 grid items-end gap-6 [grid-template-columns:1fr_auto_1fr] max-md:[grid-template-columns:1fr] max-md:gap-2 max-md:px-5">
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted max-md:order-2">
        <span className="live-dot" />
        {issueNumber !== null ? <>Updated weekly · Issue №{issueNumber}</> : <>Loading first issue…</>}
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

function Hero() {
  return (
    <section className="hero py-20 px-7 border-b border-ink text-center relative overflow-hidden max-md:py-14 max-md:px-5">
      <span className="inline-block font-mono text-[11px] uppercase tracking-widest text-red mb-7 border border-red px-3.5 py-1.5 rounded-full bg-red/5 max-md:text-[10px] max-md:px-3 max-md:py-1.5 max-md:mb-6">
        A weekly autopsy of NYC restaurant hype
      </span>
      <h1 className="font-display font-black text-[clamp(54px,9vw,132px)] leading-[0.92] tracking-tighter mx-auto max-w-[14ch]">
        Which spots are <em className="italic font-normal text-red">overrated</em>, ranked by data.
      </h1>
      <p className="mt-9 mx-auto max-w-[56ch] text-[18px] leading-relaxed text-ink-soft">
        Every week, we measure the gap between how viral a NYC restaurant is on TikTok and Instagram, and what people who actually eat there say.{" "}
        <strong className="font-semibold text-ink">The bigger the gap, the bigger the hype.</strong>{" "}
        Pick your occasion below.
      </p>
    </section>
  );
}

function StatBar({
  occasionsTracked,
  tiktokViews,
  reviews,
}: {
  occasionsTracked: number;
  tiktokViews: number;
  reviews: number;
}) {
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
    return n.toLocaleString();
  };

  const stats = [
    { num: occasionsTracked.toString(), label: "Occasions ranked", red: true },
    { num: fmt(tiktokViews), label: "TikTok views analyzed" },
    { num: fmt(reviews), label: "Local reviews parsed" },
    { num: "7d", label: "Until next update" },
  ];

  return (
    <div className="grid grid-cols-4 border-b border-ink bg-paper-2 max-md:grid-cols-2">
      {stats.map((s, i) => (
        <div
          key={i}
          className={`p-6 border-r border-ink last:border-r-0 max-md:border-b ${
            i % 2 === 1 ? "max-md:border-r-0" : ""
          } ${i >= 2 ? "max-md:border-b-0" : ""}`}
        >
          <div className={`font-display font-semibold text-4xl leading-none tracking-tight ${s.red ? "text-red" : ""}`}>
            {s.num}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted mt-2">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// THE BIG GRID
// ============================================================
function OccasionGrid({ highlights }: { highlights: Record<string, OccasionScoreWithRestaurant[]> }) {
  return (
    <section className="px-7 py-16 max-md:px-5 max-md:py-12">
      <div className="flex justify-between items-baseline pb-8 max-md:flex-col max-md:items-start max-md:gap-2">
        <h2 className="font-display font-extrabold text-5xl tracking-tight max-md:text-3xl">
          Pick your <em className="italic font-normal">occasion</em>.
        </h2>
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted max-md:text-[10px]">
          Top 3 most overrated · Click to see full ranking
        </div>
      </div>
      <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1 max-md:gap-4">
        {OCCASIONS.map((o) => (
          <OccasionCard key={o} occasion={o} top={highlights[o] ?? []} />
        ))}
      </div>
    </section>
  );
}

function OccasionCard({ occasion, top }: { occasion: Occasion; top: OccasionScoreWithRestaurant[] }) {
  return (
    <Link
      href={`/occasion/${occasion}`}
      className="block border border-ink p-7 transition-all hover:bg-ink hover:text-paper group max-md:p-5"
    >
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-display font-extrabold text-3xl tracking-tight max-md:text-2xl">
          {OCCASION_LABELS[occasion]}
        </h3>
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted group-hover:text-paper/60 max-md:text-[10px]">
          View →
        </span>
      </div>
      <p className="font-display italic text-base leading-snug text-ink-soft group-hover:text-paper/80 mb-5 max-md:text-sm">
        {OCCASION_TAGLINES[occasion]}
      </p>
      {top.length > 0 ? (
        <ol className="space-y-2">
          {top.slice(0, 3).map((s, i) => (
            <li key={s.id} className="flex items-baseline gap-3">
              <span className="font-display font-bold text-lg text-red group-hover:text-paper w-5 max-md:text-base">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="flex-1 font-display font-bold text-lg leading-tight max-md:text-base">
                {s.restaurant.name}
                {s.restaurant.price_tier && (
                  <span className="ml-2 font-mono text-[11px] text-muted group-hover:text-paper/60 max-md:text-[10px]">
                    {s.restaurant.price_tier}
                  </span>
                )}
              </span>
              <span className="font-mono text-[12px] text-red group-hover:text-paper max-md:text-[11px]">
                {Math.abs(s.gap).toFixed(0)}↑
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted">
          Coming this week
        </div>
      )}
    </Link>
  );
}

// ============================================================
function Methodology() {
  return (
    <section className="border-t-2 border-ink bg-ink text-paper py-20 px-7 max-md:py-14 max-md:px-5">
      <div className="max-w-[880px] mx-auto">
        <h2 className="font-display italic font-normal text-5xl tracking-tight leading-none mb-8 max-md:text-3xl">
          How we <span className="border-b-2 border-red pb-1">measure hype</span>.
        </h2>
        <p className="text-[18px] leading-relaxed text-paper/90 max-w-[60ch]">
          The Hype Index isn't an opinion. It's a number. Every week we pull five signals for every restaurant we track, score the diner sentiment from each, and z-score the gap between social hype and ground truth across the entire issue. Restaurants where the algorithm and locals roughly agree don't appear at all — only the ones where the gap is real.
        </p>
        <div className="bg-paper/5 border-l-[3px] border-red px-7 py-6 my-9 font-mono text-sm leading-loose max-md:px-5 max-md:py-5 max-md:text-xs">
          <span className="text-red">Hype</span> = TikTok peak views × caption sentiment + Instagram engagement
          <br />
          <span className="text-red">Reality</span> = Google reviews (volume-weighted) + Reddit (when ≥3 mentions) + IG comments
          <br />
          <span className="text-red">Gap</span> = Hype − Reality, both z-scored against the issue
          <br />
          <em className="text-paper/70">|gap| &lt; 10 is "calibrated" — algorithm and locals agree, hidden from leaderboards.</em>
        </div>
        <div className="grid grid-cols-3 gap-9 mt-12 max-md:grid-cols-1 max-md:gap-7">
          <Method
            num="01"
            title="Hype Signal"
            body="TikTok peak views and Instagram engagement, dampened by caption sentiment — viral roasts of overpriced spots count as agreement-with-thesis, not as hype. We're measuring 'algorithm loves it,' not 'algorithm is loud.'"
          />
          <Method
            num="02"
            title="Reality Signal"
            body="Long-form Google reviews from local guides, weighted by review count (a 4.7★ on 8K reviews beats a 4.7★ on 80). Reddit threads from r/AskNYC and r/nyc when there are enough to be meaningful. Tourist content deweighted."
          />
          <Method
            num="03"
            title="Z-Scored Gap"
            body="Hype and Reality are both z-scored across the entire issue, so a +50 gap on Date Night means the same as a +50 gap on Brunch. Restaurants where the gap is small (within ±10) don't appear — they're calibrated, not interesting."
          />
        </div>
      </div>
    </section>
  );
}

function Method({ num, title, body }: { num: string; title: string; body: string }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-red mb-3.5">
        {num} · {title}
      </div>
      <p className="text-[15px] leading-relaxed text-paper/85">{body}</p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="px-7 py-9 border-t border-ink flex justify-between items-start flex-wrap gap-6 font-mono text-[11px] uppercase tracking-wider text-muted max-md:px-5 max-md:flex-col">
      <div className="flex flex-col gap-2">
        <div>© {new Date().getFullYear()} The NYC Hype Index · Made for screenshots</div>
        <div className="text-muted/70">Not affiliated with any of the restaurants listed.</div>
      </div>
      <SubscribeForm />
      <SubmitTip />
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
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted max-w-md mx-auto leading-loose">
        We're crunching this week's numbers. Subscribe below to get notified when the first leaderboards go live.
      </p>
    </section>
  );
}
