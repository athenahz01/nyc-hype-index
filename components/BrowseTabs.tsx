"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export type BrowseTab = "occasion" | "cuisine" | "neighborhood";

const TABS: { id: BrowseTab; label: string }[] = [
  { id: "occasion", label: "Occasion" },
  { id: "cuisine", label: "Cuisine" },
  { id: "neighborhood", label: "Neighborhood" },
];

/**
 * Tab strip for switching between browse views on the home page.
 * State lives in the URL (?tab=cuisine) so it's bookmarkable + shareable.
 *
 * The actual content for each tab is rendered server-side and shown/hidden
 * based on the selected tab — this avoids re-fetching data on tab switch.
 */
export default function BrowseTabs({ defaultTab = "occasion" }: { defaultTab?: BrowseTab }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Hydrate active tab from URL — fall back to default if missing/invalid
  const urlTab = searchParams.get("tab") as BrowseTab | null;
  const [active, setActive] = useState<BrowseTab>(
    urlTab && TABS.some((t) => t.id === urlTab) ? urlTab : defaultTab
  );

  // Keep URL in sync with active state (without scroll-jump)
  useEffect(() => {
    const newTab = searchParams.get("tab");
    if (newTab !== active) {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (active === defaultTab) {
        params.delete("tab"); // keep URL clean for the default tab
      } else {
        params.set("tab", active);
      }
      const q = params.toString();
      router.replace(`${pathname}${q ? `?${q}` : ""}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Toggle visibility of the corresponding tab panels.
  // Each panel is wrapped in a `data-tab` element by the caller.
  useEffect(() => {
    const panels = document.querySelectorAll<HTMLElement>("[data-browse-panel]");
    panels.forEach((p) => {
      p.style.display = p.dataset.browsePanel === active ? "" : "none";
    });
  }, [active]);

  const select = useCallback((tab: BrowseTab) => {
    setActive(tab);
  }, []);

  return (
    <div
      className="flex items-end gap-0 border-b border-ink/15 px-7 pt-2 max-md:px-5 max-md:overflow-x-auto"
      role="tablist"
    >
      {TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => select(t.id)}
            className={`relative px-5 py-3 font-display font-bold text-base tracking-tight transition-colors whitespace-nowrap max-md:px-4 max-md:text-sm ${
              isActive
                ? "text-ink"
                : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {isActive && (
              <span
                aria-hidden
                className="absolute left-0 right-0 bottom-[-1px] h-[3px] bg-red"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}