"use client";

import { useEffect, useState } from "react";

type Props = {
  restaurantId: string;
  occasion: string;
  /** Optional: initial count snapshot to avoid a network call on mount. */
  initialAgree?: number;
  initialDisagree?: number;
};

type VoteState = {
  agree: number;
  disagree: number;
  userVote: "agree" | "disagree" | null;
};

/**
 * Compact agree/disagree voting pill for leaderboard entries.
 *
 * Design intent:
 *   - Small enough not to dominate the verdict typography
 *   - Shows running count so readers see other people's signal
 *   - Lets user change their mind (re-vote)
 *   - One vote per IP per (restaurant, occasion) — enforced server-side
 *
 * UX:
 *   - Initial load: shows counts, neither selected
 *   - User clicks Agree → green-ish highlight, count increments
 *   - User clicks Disagree after Agree → switches, both counts update
 */
export default function VoteButtons({
  restaurantId,
  occasion,
  initialAgree = 0,
  initialDisagree = 0,
}: Props) {
  const [state, setState] = useState<VoteState>({
    agree: initialAgree,
    disagree: initialDisagree,
    userVote: null,
  });
  const [loading, setLoading] = useState(false);
  const [hasFetchedInitial, setHasFetchedInitial] = useState(false);

  // Fetch real state on mount (initial props are just a snapshot)
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/votes?restaurant_id=${encodeURIComponent(
            restaurantId
          )}&occasion=${encodeURIComponent(occasion)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setState({
          agree: data.agree ?? 0,
          disagree: data.disagree ?? 0,
          userVote: data.userVote ?? null,
        });
        setHasFetchedInitial(true);
      } catch {
        // silently fail — counts just stay at snapshot
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, occasion]);

  async function cast(vote: "agree" | "disagree") {
    if (loading || state.userVote === vote) return;
    setLoading(true);

    // Optimistic update
    setState((prev) => {
      const next = { ...prev };
      // Undo previous vote if any
      if (prev.userVote === "agree") next.agree = Math.max(0, prev.agree - 1);
      if (prev.userVote === "disagree") next.disagree = Math.max(0, prev.disagree - 1);
      // Apply new vote
      if (vote === "agree") next.agree += 1;
      else next.disagree += 1;
      next.userVote = vote;
      return next;
    });

    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurant_id: restaurantId, occasion, vote }),
      });
      if (res.ok) {
        const data = await res.json();
        setState({
          agree: data.agree ?? 0,
          disagree: data.disagree ?? 0,
          userVote: data.userVote ?? vote,
        });
      }
      // If failed, optimistic state still stands — user won't notice unless they reload
    } finally {
      setLoading(false);
    }
  }

  const total = state.agree + state.disagree;
  const agreePct = total === 0 ? 0 : Math.round((state.agree / total) * 100);

  return (
    <div className="flex items-center gap-2 max-md:gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-widest text-muted max-md:text-[9px]">
        Locals say:
      </span>
      <button
        onClick={() => cast("agree")}
        disabled={loading}
        aria-label="Agree with this verdict"
        className={`group inline-flex items-center gap-1.5 px-2.5 py-1 border border-ink/40 transition-all disabled:cursor-not-allowed max-md:px-2 max-md:py-0.5 ${
          state.userVote === "agree"
            ? "bg-ink text-paper border-ink"
            : "bg-paper hover:bg-ink/10"
        }`}
      >
        <span className="font-mono text-[11px] uppercase tracking-wider max-md:text-[10px]">
          ✓ Agree
        </span>
        <span
          className={`font-mono text-[11px] tabular-nums max-md:text-[10px] ${
            state.userVote === "agree" ? "text-paper/70" : "text-muted"
          }`}
        >
          {state.agree}
        </span>
      </button>
      <button
        onClick={() => cast("disagree")}
        disabled={loading}
        aria-label="Disagree with this verdict"
        className={`group inline-flex items-center gap-1.5 px-2.5 py-1 border border-ink/40 transition-all disabled:cursor-not-allowed max-md:px-2 max-md:py-0.5 ${
          state.userVote === "disagree"
            ? "bg-red text-paper border-red"
            : "bg-paper hover:bg-red/10"
        }`}
      >
        <span className="font-mono text-[11px] uppercase tracking-wider max-md:text-[10px]">
          ✗ Disagree
        </span>
        <span
          className={`font-mono text-[11px] tabular-nums max-md:text-[10px] ${
            state.userVote === "disagree" ? "text-paper/70" : "text-muted"
          }`}
        >
          {state.disagree}
        </span>
      </button>
      {total >= 3 && (
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted max-md:hidden">
          {agreePct}% agree
        </span>
      )}
    </div>
  );
}