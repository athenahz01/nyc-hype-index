/**
 * Publish a new issue from the current corpus.
 *
 *   npm run publish-issue                # creates a draft issue
 *   npm run publish-issue -- --publish   # publishes immediately
 *
 * Reads from restaurant_latest_scores. Does NO scraping. Fast.
 */

import { publishIssue } from "../lib/corpus";

const args = process.argv.slice(2);
const shouldPublish = args.includes("--publish");

publishIssue({ publish: shouldPublish })
  .then((r) => {
    console.log("\n✓ Issue created");
    console.log(`  Issue #${r.issueNumber}`);
    console.log(`  Corpus size:     ${r.corpusSize}`);
    console.log(`  Occasions built: ${r.occasionsBuilt}`);
    console.log(`  Total rankings:  ${r.totalRankings}`);
    console.log(`  Status: ${shouldPublish ? "published" : "draft (re-run with --publish to publish)"}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error("✗ Publish failed:", e);
    process.exit(1);
  });
