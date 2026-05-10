/**
 * Seed the restaurants table.
 * Run after creating the Supabase project AND running migrations:
 *   npm run seed
 *
 * Idempotent — safe to re-run; upserts on `slug`.
 *
 * Auto-tagging: any restaurant with price_tier='$' is automatically added
 * to the "under-25" occasion if not already tagged. This keeps the seed
 * data clean (one tag implies the other).
 */

import "dotenv/config";
import { createAdminClient } from "../lib/supabase";
import { SEED_RESTAURANTS } from "../lib/seed-data";

async function main() {
  const supabase = createAdminClient();
  console.log(`[seed] uploading ${SEED_RESTAURANTS.length} restaurants...`);

  const rows = SEED_RESTAURANTS.map((r) => {
    // Auto-add under-25 for $ tier
    const occasions = [...r.occasions];
    if (r.price_tier === "$" && !occasions.includes("under-25")) {
      occasions.push("under-25");
    }

    return {
      slug: r.slug,
      name: r.name,
      neighborhood: r.neighborhood,
      borough: r.borough,
      search_terms: r.search_terms,
      cuisines: r.cuisines,
      occasions,
      price_tier: r.price_tier,
      notes: r.notes ?? null,
      active: true,
    };
  });

  const { data, error } = await supabase
    .from("restaurants")
    .upsert(rows, { onConflict: "slug" })
    .select();

  if (error) {
    console.error("[seed] failed:", error);
    process.exit(1);
  }

  console.log(`[seed] ok, upserted ${data?.length ?? 0} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
