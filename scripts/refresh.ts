/**
 * Refresh script — runs the full scoring pipeline locally.
 *
 *   npm run refresh                       # creates a draft issue, all 30 restaurants
 *   npm run refresh -- --publish          # publishes the issue
 *   npm run refresh -- --limit=5          # cheaper test run, just 5 restaurants
 *   npm run refresh -- --limit=5 --publish
 */

import { runRefresh } from "../lib/pipeline";

const args = process.argv.slice(2);
const shouldPublish = args.includes("--publish");

const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;

if (limit !== undefined && (isNaN(limit) || limit < 1)) {
  console.error("Invalid --limit value. Must be a positive integer.");
  process.exit(1);
}

runRefresh({ publish: shouldPublish, limit })
  .then((result) => {
    console.log("\n✓ Done");
    console.log(`  Issue #${result.issueNumber}`);
    console.log(`  Restaurants scored: ${result.scored}`);
    console.log(`  Failures: ${result.failed}`);
    console.log(`  Status: ${shouldPublish ? "published" : "draft (re-run with --publish to publish)"}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("✗ Refresh failed:", e);
    process.exit(1);
  });