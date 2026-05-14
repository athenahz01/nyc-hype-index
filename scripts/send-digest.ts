/**
 * Send the digest email for the current published issue to all active subscribers.
 *
 *   npm run send-digest                  # dry-run, prints recipients
 *   npm run send-digest -- --send        # actually send
 *
 * Pulls the top 3 overrated + top 3 underrated from the LATEST published issue.
 * Throttles to avoid Resend rate limits (~10/sec on free tier).
 */

import { createAdminClient } from "../lib/supabase";
import { sendDigestEmail, type DigestData } from "../lib/email";

const args = process.argv.slice(2);
const SHOULD_SEND = args.includes("--send");

async function main() {
  const supabase = createAdminClient();

  // 1. Latest published issue
  const { data: issue } = await supabase
    .from("issues")
    .select("id, number")
    .eq("is_published", true)
    .order("number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!issue) {
    throw new Error("No published issue found");
  }
  console.log(`[digest] using Issue #${issue.number}`);

  // 2. Top 3 overrated + 3 underrated across ALL occasions (highest |gap|)
  const { data: scores, error: scoresErr } = await supabase
    .from("occasion_scores")
    .select(
      `
      gap, is_underrated, verdict, occasion, rank,
      restaurant:restaurants!inner ( name, slug )
    `
    )
    .eq("issue_id", issue.id)
    .order("gap", { ascending: false });

  if (scoresErr || !scores) {
    throw new Error(`Failed to read scores: ${scoresErr?.message}`);
  }

  // Dedupe by restaurant — only the highest-gap entry per restaurant per side
  function dedupeAndTake(rows: any[], n: number) {
    const seen = new Set<string>();
    const result: any[] = [];
    for (const r of rows) {
      const restName: string = r.restaurant.name;
      if (seen.has(restName)) continue;
      seen.add(restName);
      result.push({
        name: restName,
        slug: r.restaurant.slug,
        verdict: r.verdict ?? "",
        gap: Number(r.gap),
        occasion: r.occasion,
      });
      if (result.length >= n) break;
    }
    return result;
  }

  const overrated = scores.filter((s: any) => !s.is_underrated);
  const underrated = scores
    .filter((s: any) => s.is_underrated)
    .sort((a: any, b: any) => Number(a.gap) - Number(b.gap));

  const digest: DigestData = {
    issueNumber: issue.number,
    topOverrated: dedupeAndTake(overrated, 3),
    topUnderrated: dedupeAndTake(underrated, 3),
  };

  console.log(`\n[digest] preview:`);
  console.log(`  Top overrated:`);
  digest.topOverrated.forEach((e) =>
    console.log(`    +${Math.abs(e.gap).toFixed(0)} ${e.name} (${e.occasion}) — "${e.verdict.slice(0, 80)}"`)
  );
  console.log(`  Top underrated:`);
  digest.topUnderrated.forEach((e) =>
    console.log(`    −${Math.abs(e.gap).toFixed(0)} ${e.name} (${e.occasion}) — "${e.verdict.slice(0, 80)}"`)
  );

  // 3. Active subscribers
  const { data: subscribers, error: subErr } = await supabase
    .from("subscribers")
    .select("email, unsubscribe_token")
    .eq("is_active", true);

  if (subErr || !subscribers) {
    throw new Error(`Failed to read subscribers: ${subErr?.message}`);
  }

  console.log(`\n[digest] ${subscribers.length} active subscribers`);

  if (!SHOULD_SEND) {
    console.log("\n[digest] dry-run mode. Re-run with --send to actually send.");
    return;
  }

  // 4. Send with throttling (Resend free tier: ~10/sec)
  let sent = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const sub of subscribers) {
    const result = await sendDigestEmail({
      to: sub.email,
      unsubscribeToken: sub.unsubscribe_token,
      digest,
    });

    if (result.ok) {
      sent++;
      // Update last_digest_at
      await supabase
        .from("subscribers")
        .update({ last_digest_at: new Date().toISOString() })
        .eq("email", sub.email);
      console.log(`  ✓ ${sub.email}`);
    } else {
      failed++;
      failures.push(`${sub.email}: ${result.error}`);
      console.log(`  ✗ ${sub.email} (${result.error})`);
    }

    // Throttle: ~100ms between sends → 10/sec
    await new Promise((r) => setTimeout(r, 110));
  }

  console.log(`\n[digest] done. Sent: ${sent}. Failed: ${failed}.`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[digest] script failed:", e);
    process.exit(1);
  });