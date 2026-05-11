/**
 * Full refresh — score every active restaurant, then publish an issue.
 * Equivalent to:
 *   npm run refresh-batch -- --offset=0 --limit=9999
 *   npm run publish-issue -- --publish
 *
 *   npm run refresh                       # draft issue
 *   npm run refresh -- --publish          # publish immediately
 *   npm run refresh -- --limit=10         # cheap test on first 10 restaurants
 *
 * For large corpora (200+), prefer running multiple smaller refresh-batch
 * calls across days, then publish-issue once at the end.
 */

import { runBatch, publishIssue } from "../lib/corpus";

const args = process.argv.slice(2);
const shouldPublish = args.includes("--publish");

function arg(name: string): string | undefined {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : undefined;
}

const limitArg = arg("limit");
const limit = limitArg ? parseInt(limitArg, 10) : 9999;

if (isNaN(limit) || limit < 1) {
  console.error("Invalid --limit value. Must be a positive integer.");
  process.exit(1);
}

(async () => {
  try {
    console.log(`[refresh] starting full refresh (limit=${limit})\n`);
    const batchResult = await runBatch({ offset: 0, limit });
    console.log(`\n[refresh] batch done: ${batchResult.succeeded} scored, ${batchResult.failed} failed`);

    if (batchResult.succeeded === 0) {
      throw new Error("no restaurants scored — nothing to publish");
    }

    console.log(`\n[refresh] publishing issue...`);
    const pub = await publishIssue({ publish: shouldPublish });

    console.log("\n✓ Done");
    console.log(`  Issue #${pub.issueNumber}`);
    console.log(`  Corpus size:     ${pub.corpusSize}`);
    console.log(`  Restaurants scored this run: ${batchResult.succeeded}`);
    console.log(`  Failures:        ${batchResult.failed}`);
    console.log(`  Occasions built: ${pub.occasionsBuilt}`);
    console.log(`  Total rankings:  ${pub.totalRankings}`);
    console.log(`  Status: ${shouldPublish ? "published" : "draft (re-run with --publish to publish)"}`);
    process.exit(0);
  } catch (e) {
    console.error("✗ Refresh failed:", e);
    process.exit(1);
  }
})();
