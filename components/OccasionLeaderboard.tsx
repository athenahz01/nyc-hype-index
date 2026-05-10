"use client";

import { useState, useMemo } from "react";
import type {
  OccasionScoreWithRestaurant,
  Trend,
  Cuisine,
} from "@/lib/types";
import { CUISINE_LABELS } from "@/lib/types";

type Props = {
  scores: OccasionScoreWithRestaurant[];
  /** Which cuisines are present in this leaderboard (for chip rendering) */
  availableCuisines: Cuisine[];
};

export default function OccasionLeaderboard({ scores, availableCuisines }: Props) {
  // Multi-select cuisine filter. Empty set = show all.
  const [selected, setSelected] = useState<Set<Cuisine>>(new Set());

  function toggle(c: Cuisine) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  const filtered = useMemo(() => {
    if (selected.size === 0) return scores;
    return scores.filter((s) =>
      s.restaurant.cuisines.some((c) => selected.has(c as Cuisine))
    );
  }, [scores, selected]);

  const overrated = filtered.filter((s) => !s.is_underrated);
  const underrated = filtered.filter((s) => s.is_underrated);

  return (
    <>
      {/* CUISINE FILTER CHIPS */}
      {availableCuisines.length > 0 && (
        <div className="px-7 pt-12 pb-2 max-md:px-5 max-md:pt-8">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-3">
            Filter by cuisine {selected.size > 0 && `(${selected.size} selected)`}
          </div>
          <div className="flex flex-wrap gap-2">
            {availableCuisines.map((c) => {
              const active = selected.has(c);
              return (
                <button
                  key={c}
                  onClick={() => toggle(c)}
                  className={`px-3 py-1.5 border font-mono text-[11px] uppercase tracking-wider transition-all max-md:text-[10px] ${
                    active
                      ? "bg-ink text-paper border-ink"
                      : "border-ink/30 text-ink hover:border-ink hover:bg-ink/5"
                  }`}
                >
                  {CUISINE_LABELS[c]}
                </button>
              );
            })}
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-red hover:underline max-md:text-[10px]"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* MAIN LEADERBOARD */}
      <div className="px-7 pt-10 pb-5 flex justify-between items-baseline flex-wrap gap-4 max-md:px-5 max-md:pt-8">
        <h2 className="font-display font-extrabold text-4xl tracking-tight max-md:text-3xl">
          Most <em className="italic font-normal text-red">Overrated</em>
        </h2>
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted max-md:text-[10px]">
          {overrated.length} {overrated.length === 1 ? "spot" : "spots"}
        </div>
      </div>

      <section className="px-7 pb-16 max-md:px-5 max-md:pb-12">
        <RowHeaders />
        {overrated.length > 0 ? (
          <div>
            {overrated.map((s, i) => (
              <Row key={s.id} score={s} rank={i + 1} isUnderrated={false} idx={i} />
            ))}
          </div>
        ) : (
          <EmptyState message="No overrated spots match this filter." />
        )}
      </section>

      {/* UNDERRATED SECTION */}
      {underrated.length > 0 && (
        <section className="px-7 pb-20 max-md:px-5 max-md:pb-14">
          <div className="-mx-7 mt-6 px-7 border-t border-ink text-center relative max-md:-mx-5 max-md:px-5">
            <span className="inline-block bg-paper border border-gold text-gold rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-widest -translate-y-1/2">
              Bonus Round
            </span>
          </div>
          <div className="pt-2 pb-4 flex justify-between items-baseline flex-wrap gap-4">
            <h2 className="font-display font-extrabold text-4xl tracking-tight max-md:text-3xl">
              Quietly <em className="italic font-normal">Underrated</em>
            </h2>
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted max-md:text-[10px]">
              Locals know · TikTok hasn't found them yet
            </div>
          </div>
          <RowHeaders />
          <div>
            {underrated.map((s, i) => (
              <Row key={s.id} score={s} rank={i + 1} isUnderrated={true} idx={i} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function RowHeaders() {
  return (
    <div className="grid gap-6 py-3 border-b border-ink font-mono text-[10px] uppercase tracking-widest text-muted [grid-template-columns:60px_2.4fr_1fr_1fr_0.8fr] max-md:[grid-template-columns:40px_1fr_70px] max-md:gap-3">
      <div>Rank</div>
      <div>Restaurant</div>
      <div className="text-right max-md:hidden">Hype</div>
      <div className="text-right max-md:hidden">Reality</div>
      <div className="text-right">Gap</div>
    </div>
  );
}

function Row({
  score,
  rank,
  isUnderrated,
  idx,
}: {
  score: OccasionScoreWithRestaurant;
  rank: number;
  isUnderrated: boolean;
  idx: number;
}) {
  const isTop = !isUnderrated && rank <= 3;
  const gap = Math.abs(score.gap);
  // Drop the "+" sign on overrated — red color + ↑ arrow already convey "alarm"
  // Keep "−" on underrated — gold + ↓ + minus together signal "hidden gem locals know"
  const gapDisplay = isUnderrated ? `−${gap.toFixed(0)}` : gap.toFixed(0);
  const arrow = isUnderrated ? "↓" : "↑";
  const trendClass = trendColor(score.trend);

  return (
    <div
      className="row row-fade grid gap-6 py-7 border-b border-ink/15 items-center cursor-pointer [grid-template-columns:60px_2.4fr_1fr_1fr_0.8fr] max-md:[grid-template-columns:40px_1fr_70px] max-md:gap-3 max-md:py-4 max-md:items-start"
      style={{ animationDelay: `${idx * 0.05}s` }}
    >
      <div
        className={`font-display font-extrabold text-[56px] leading-none tracking-tighter max-md:text-3xl max-md:pt-1 ${
          isTop ? "text-red" : "text-ink"
        }`}
      >
        {String(rank).padStart(2, "0")}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="row-name flex items-baseline gap-2.5 flex-wrap">
          <span className="font-display font-bold text-2xl leading-tight tracking-tight transition-colors max-md:text-lg">
            {score.restaurant.name}
          </span>
          {score.restaurant.price_tier && (
            <span className="font-mono text-[12px] text-muted max-md:text-[10px]">
              {score.restaurant.price_tier}
            </span>
          )}
        </div>
        <div className="flex gap-3 items-center font-mono text-[11px] uppercase tracking-wide text-muted max-md:text-[10px] max-md:gap-2 flex-wrap">
          <span className="text-ink-soft">{score.restaurant.neighborhood}</span>
          <span className="opacity-40">·</span>
          <span>{capitalize(score.restaurant.borough)}</span>
          {score.restaurant.cuisines.length > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="text-gold">
                {score.restaurant.cuisines.map((c) => capitalize(c)).join(" / ")}
              </span>
            </>
          )}
        </div>
        {score.verdict && (
          <div className="verdict mt-1.5 italic font-display font-normal text-[15px] leading-snug text-ink-soft max-w-[52ch] max-md:text-[13px]">
            {score.verdict}
          </div>
        )}
      </div>

      <Scorecell value={score.hype_score} barColor="bg-ink" className="max-md:hidden" />
      <Scorecell value={score.reality_score} barColor="bg-gold" className="max-md:hidden" />

      <div className="text-right font-mono">
        <div
          className={`font-display font-extrabold text-[32px] tracking-tight leading-none max-md:text-2xl ${
            isUnderrated ? "text-gold" : "text-red"
          }`}
        >
          {gapDisplay}
          <span className="ml-1 text-lg align-middle font-mono font-normal max-md:text-sm">
            {arrow}
          </span>
        </div>
        <div className={`font-mono text-[10px] uppercase tracking-wide mt-1.5 max-md:text-[9px] ${trendClass}`}>
          {score.trend_label ?? ""}
        </div>
      </div>
    </div>
  );
}

function Scorecell({
  value,
  barColor,
  className = "",
}: {
  value: number;
  barColor: string;
  className?: string;
}) {
  return (
    <div className={`text-right font-mono ${className}`}>
      <div className="text-[22px] font-medium tracking-tight">{value.toFixed(0)}</div>
      <div className="h-1 bg-ink/10 mt-2 relative overflow-hidden">
        <div
          className={`bar-fill absolute inset-y-0 left-0 ${barColor}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-16 text-center border-b border-ink/15">
      <div className="font-display text-5xl text-muted opacity-40 mb-3">∅</div>
      <div className="font-display italic text-xl text-ink-soft">{message}</div>
    </div>
  );
}

function trendColor(trend: Trend): string {
  switch (trend) {
    case "up":
      return "text-red";
    case "down":
      return "text-gold";
    case "new":
      return "text-ink font-medium";
    default:
      return "text-muted";
  }
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
