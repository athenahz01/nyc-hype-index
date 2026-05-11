/**
 * Batched scoring — score N restaurants and persist to corpus.
 *
 *   npm run refresh-batch -- --offset=0 --limit=20
 *   npm run refresh-batch -- --offset=20 --limit=20
 *   npm run refresh-batch -- --limit=20 --stale-only    # only re-score stale entries (>7 days)
 *
 * Does NOT publish an issue. Just updates restaurant_latest_scores.
 * Use `npm run publish-issue` separately to build a leaderboard from the corpus.
 */

import { runBatch } from "../lib/corpus";

const args = process.argv.slice(2);

function arg(name: string): string | undefined {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : undefined;
}

const offset = parseInt(arg("offset") ?? "0", 10);
const limit = parseInt(arg("limit") ?? "20", 10);
const staleOnly = args.includes("--stale-only");

if (isNaN(offset) || offset < 0) {
  console.error("Invalid --offset");
  process.exit(1);
}
if (isNaN(limit) || limit < 1) {
  console.error("Invalid --limit");
  process.exit(1);
}

runBatch({ offset, limit, staleOnly })
  .then((r) => {
    console.log("\n✓ Batch complete");
    console.log(`  Attempted: ${r.attempted}`);
    console.log(`  Succeeded: ${r.succeeded}`);
    console.log(`  Failed:    ${r.failed}`);
    if (r.failures.length > 0) {
      console.log("\n  Failures:");
      r.failures.forEach((f) => console.log(`    - ${f.name}: ${f.error}`));
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error("✗ Batch failed:", e);
    process.exit(1);
  });
