"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { SearchMatch } from "@/lib/queries";

type Props = {
  /** Visual size variant. "hero" for the homepage hero, "compact" for nav. */
  variant?: "hero" | "compact";
};

export default function SearchBar({ variant = "hero" }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search-as-you-type
  useEffect(() => {
    if (!query || query.length < 2) {
      setMatches([]);
      return;
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setMatches(data.matches ?? []);
        setIsOpen(true);
      } catch {
        // Silent fail; dropdown just stays empty
      }
    }, 200);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function selectMatch(m: SearchMatch) {
    setIsOpen(false);
    setQuery("");
    router.push(`/restaurant/${m.restaurant.slug}`);
  }

  async function calculateLive() {
    if (!query.trim() || isCalculating) return;
    setIsCalculating(true);
    setCalcError(null);
    setIsOpen(false);
    try {
      const res = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: query.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCalcError(data.error ?? "Couldn't calculate this one. Try a different name?");
        setIsCalculating(false);
        return;
      }
      router.push(`/restaurant/${data.restaurant.slug}`);
    } catch (e: any) {
      setCalcError(e?.message ?? "Network error. Try again.");
      setIsCalculating(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (!isOpen || matches.length === 0) {
      if (e.key === "Enter" && query.trim().length >= 2) {
        e.preventDefault();
        calculateLive();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(matches.length, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIdx >= 0 && focusedIdx < matches.length) {
        selectMatch(matches[focusedIdx]);
      } else {
        // user pressed Enter without selecting → live calc
        calculateLive();
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setFocusedIdx(-1);
    }
  }

  const heroStyles = variant === "hero";

  return (
    <div ref={wrapRef} className="relative w-full max-w-[640px] mx-auto">
      <div
        className={`flex items-center border-2 border-ink bg-paper transition-shadow ${
          heroStyles ? "h-16 max-md:h-14" : "h-11"
        } ${isOpen || query ? "shadow-[6px_6px_0_0_var(--color-ink)]" : ""}`}
      >
        <div
          className={`flex items-center justify-center text-muted ${
            heroStyles ? "pl-5 pr-3 text-2xl" : "pl-3 pr-2 text-base"
          }`}
        >
          🔍
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCalcError(null);
            setFocusedIdx(-1);
          }}
          onFocus={() => query.length >= 2 && setIsOpen(true)}
          onKeyDown={handleKey}
          disabled={isCalculating}
          placeholder={
            heroStyles ? "Search any NYC restaurant..." : "Search restaurants..."
          }
          className={`flex-1 bg-transparent outline-none font-display tracking-tight ${
            heroStyles ? "text-xl max-md:text-base" : "text-base"
          } placeholder:text-muted/60 disabled:opacity-50`}
          autoComplete="off"
        />
        {query && !isCalculating && (
          <button
            onClick={() => {
              setQuery("");
              setMatches([]);
              setIsOpen(false);
              setCalcError(null);
            }}
            className={`${heroStyles ? "px-4 text-2xl" : "px-3 text-base"} text-muted hover:text-ink`}
            aria-label="Clear"
          >
            ×
          </button>
        )}
        {isCalculating && (
          <div
            className={`${heroStyles ? "px-5 text-sm" : "px-3 text-xs"} font-mono uppercase tracking-wider text-red animate-pulse`}
          >
            calculating...
          </div>
        )}
      </div>

      {/* DROPDOWN */}
      {isOpen && matches.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-2 border-2 border-ink bg-paper shadow-[6px_6px_0_0_var(--color-ink)] max-h-[400px] overflow-y-auto">
          {matches.map((m, i) => (
            <button
              key={m.restaurant.id}
              onMouseEnter={() => setFocusedIdx(i)}
              onClick={() => selectMatch(m)}
              className={`w-full text-left px-5 py-3 border-b border-ink/15 last:border-b-0 transition-colors ${
                focusedIdx === i ? "bg-ink text-paper" : "hover:bg-ink/5"
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-display font-bold text-lg tracking-tight">{m.restaurant.name}</span>
                {m.restaurant.price_tier && (
                  <span className={`font-mono text-[11px] ${focusedIdx === i ? "text-paper/60" : "text-muted"}`}>
                    {m.restaurant.price_tier}
                  </span>
                )}
              </div>
              <div
                className={`font-mono text-[11px] uppercase tracking-wider ${
                  focusedIdx === i ? "text-paper/70" : "text-muted"
                }`}
              >
                {m.restaurant.neighborhood} · {capitalize(m.restaurant.borough)}
                {!m.hasScores && (
                  <span className={`ml-2 ${focusedIdx === i ? "text-paper" : "text-red"}`}>· not yet scored</span>
                )}
              </div>
            </button>
          ))}
          {/* "Couldn't find it?" CTA at bottom of dropdown */}
          <button
            onClick={calculateLive}
            className="w-full text-left px-5 py-3 bg-paper-2 hover:bg-ink hover:text-paper transition-colors group border-t border-ink"
          >
            <span className="font-mono text-[11px] uppercase tracking-wider text-red group-hover:text-paper">
              Not what you're looking for?
            </span>
            <div className="font-display italic text-base mt-0.5">
              Calculate "{query}" live →
            </div>
          </button>
        </div>
      )}

      {/* "No matches, do you want to calc live?" state */}
      {isOpen && matches.length === 0 && query.length >= 2 && !isCalculating && (
        <div className="absolute z-20 left-0 right-0 mt-2 border-2 border-ink bg-paper shadow-[6px_6px_0_0_var(--color-ink)] p-5">
          <div className="font-mono text-[11px] uppercase tracking-wider text-muted mb-1">
            No restaurant found in our index
          </div>
          <button onClick={calculateLive} className="font-display italic text-xl underline hover:text-red transition-colors">
            Calculate "{query}" live →
          </button>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted mt-3">
            Takes ~30 seconds. Limited to 3 calculations per hour.
          </div>
        </div>
      )}

      {calcError && (
        <div className="mt-3 px-4 py-3 bg-red/10 border border-red font-mono text-[12px] text-red">
          {calcError}
        </div>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
