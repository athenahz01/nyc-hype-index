/**
 * Claude integration for sentiment scoring + verdict generation.
 *
 * Two jobs:
 *   1. scoreSentiment(textBlock) → 0-100 score
 *   2. generateVerdict(restaurant + signals) → 1-line editorial take
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const MODEL = "claude-haiku-4-5"; // cheap + fast for sentiment, fine for verdicts

/**
 * Score a block of review/comment text.
 * Returns a number 0-100 where:
 *   100 = unanimously positive, "best meal ever" energy
 *   70  = generally positive with some quibbles
 *   50  = mixed
 *   30  = generally negative
 *   0   = unanimously hostile, "do not eat here"
 */
export async function scoreSentiment(
  source: "google" | "reddit" | "instagram_comments" | "tiktok_captions",
  texts: string[]
): Promise<{ score: number; reasoning: string }> {
  if (texts.length === 0) return { score: 50, reasoning: "no texts to score" };

  // Cap input — we only need a representative sample.
  // sanitizeForJson strips unpaired Unicode surrogates that would otherwise
  // crash the Anthropic API with "invalid_request_error: no low surrogate"
  // (happens when text containing emojis gets sliced mid-character).
  const sample = texts
    .filter((t) => t && t.length > 10)
    .slice(0, 30)
    .map((t, i) => `[${i + 1}] ${sanitizeForJson(t).slice(0, 800)}`)
    .join("\n\n");

  const sourceLabel = {
    google: "Google reviews from diners",
    reddit: "Reddit posts and comments from NYC food subreddits",
    instagram_comments: "Instagram captions and comments about the restaurant",
    tiktok_captions: "TikTok video captions and comments about the restaurant",
  }[source];

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `You are scoring how positive or negative diner sentiment is for a NYC restaurant, based on a sample of ${sourceLabel}.

Score 0-100:
- 100 = unanimously raving, "best meal ever" energy
- 70-85 = mostly positive with minor complaints
- 50-65 = mixed reviews, real disagreement
- 30-50 = mostly negative
- 0-30 = unanimously hostile

Important guidelines:
- Filter out content that's clearly promotional / influencer-paid (overly enthusiastic with no specifics)
- Weight specific complaints (food, service, price, wait, value) heavily
- Ignore content about the restaurant's vibe alone — focus on actual eating experience
- Tourist-coded reviews ("amazing trip to NYC!") count less than local-coded ones

Return ONLY valid JSON in this exact format, no other text:
{"score": <number 0-100>, "reasoning": "<one sentence>"}

Sample:
${sample}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";

  // Be liberal in extracting JSON — Claude sometimes adds whitespace
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[sentiment] couldn't parse JSON from: ${text.slice(0, 200)}`);
    return { score: 50, reasoning: "parse error" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const score = Math.max(0, Math.min(100, Number(parsed.score)));
    return {
      score: isNaN(score) ? 50 : score,
      reasoning: String(parsed.reasoning ?? "").slice(0, 200),
    };
  } catch (e) {
    console.warn(`[sentiment] JSON parse failed: ${e}`);
    return { score: 50, reasoning: "parse error" };
  }
}

/**
 * Generate a 1-line verdict for the leaderboard, in the Hype Index voice:
 * specific, mildly petty, NYC-coded, ≤ 22 words.
 */
export async function generateVerdict(input: {
  name: string;
  neighborhood: string;
  hypeScore: number;
  realityScore: number;
  gap: number;
  isUnderrated: boolean;
  signals: {
    googleSummary?: string;
    redditSummary?: string;
    igSummary?: string;
    tiktokSummary?: string;
  };
}): Promise<string> {
  const { name, neighborhood, hypeScore, realityScore, gap, isUnderrated, signals } = input;

  const direction = isUnderrated
    ? "UNDERRATED — locals love it more than the algorithm"
    : "OVERRATED — the social hype outruns what diners actually say";

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 120,
    messages: [
      {
        role: "user",
        content: `You write the one-line verdict for The NYC Hype Index — a weekly leaderboard ranking NYC restaurants by the gap between social hype and what locals actually say.

Restaurant: ${name} (${neighborhood})
Hype Score: ${hypeScore}/100
Reality Score: ${realityScore}/100
Gap: ${gap >= 0 ? "+" : ""}${gap} (${direction})

Signals from this week's data:
- Google reviews: ${signals.googleSummary ?? "n/a"}
- Reddit chatter: ${signals.redditSummary ?? "n/a"}
- Instagram: ${signals.igSummary ?? "n/a"}
- TikTok: ${signals.tiktokSummary ?? "n/a"}

Write the verdict. Rules:
- 1 sentence, max 22 words
- Specific: mention a dish, a wait, a price, or a vibe. ONLY mention a dish if you can see it in the signal text above. Never invent menu items.
- NYC-coded, slightly petty, but never mean for the sake of it.
- If a place is genuinely good despite the hype, say so respectfully.
- If underrated, sound protective ("locals know") not gushing.
- No emoji. No hedging ("honestly", "tbh"). No exclamation marks.
- DON'T put quotes around it. Just the sentence.
- DON'T start with the restaurant's name.
- PROOFREAD: every word must be spelled correctly. "Fried" not "friend." "Cacio e pepe" not "cacchio." If unsure of a word, omit it.
- DON'T mention dishes that aren't on the actual restaurant's menu. If you can't see specific menu items in the signals, write about the wait, the price, the crowd, the neighborhood, or the vibe instead.

Examples of the voice:
"The lasagna pinwheel is genuinely good. The two-month wait isn't."
"An $80 spicy rigatoni vodka with a Las Vegas location. The marketing is the meal."
"Persian food doing the most. Earned every star without a TikTok in sight."
"Three-hour wait for a four-dollar slice. The math has stopped mathing."
"The dining room photographs better than it tastes. The cocktails compensate."

Return ONLY the sentence, nothing else.`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  return text.trim().replace(/^["']|["']$/g, "").slice(0, 200);
}

/**
 * Compact text summary of a signal for use in the verdict prompt.
 * Picks 2-3 representative excerpts.
 *
 * IMPORTANT: We sanitize Unicode here. JavaScript's `slice()` operates on
 * UTF-16 code units, so cutting text mid-emoji produces an unpaired
 * surrogate that breaks JSON encoding. The Anthropic API rejects requests
 * with these as "invalid_request_error: no low surrogate in string."
 *
 * The fix: strip any unpaired surrogates and replace them with spaces.
 * Also strips zero-width and other invisible chars that can confuse Claude.
 */
export function summarizeTexts(texts: string[], maxLen = 240): string {
  const cleaned = texts.filter((t) => t && t.length > 20);
  if (cleaned.length === 0) return "no data";
  const joined = cleaned.slice(0, 3).map((t) => sanitizeForJson(t).slice(0, 100)).join(" / ");
  return sanitizeForJson(joined).slice(0, maxLen);
}

/**
 * Strip lone Unicode surrogates and other JSON-hostile characters.
 * Safe to apply to any user-generated text before sending to an LLM API.
 */
function sanitizeForJson(s: string): string {
  return s
    // Replace any unpaired high surrogate (D800-DBFF not followed by DC00-DFFF)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, " ")
    // Replace any unpaired low surrogate (DC00-DFFF not preceded by D800-DBFF)
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1 ")
    // Strip zero-width joiners and other invisible Unicode that confuses LLMs
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Collapse repeated whitespace from our replacements
    .replace(/\s+/g, " ")
    .trim();
}
