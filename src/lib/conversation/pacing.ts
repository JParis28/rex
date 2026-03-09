import type { Message } from "../db/schema";

type PacingContext = {
  trigger: "missed_call" | "inbound_sms" | "form_submission" | "follow_up";
  messages: Message[];        // Full conversation history
  leadMessageContent?: string; // The message we're responding to
};

type PacingResult = {
  delayMs: number;
  reason: string;
};

/**
 * Calculates a human-like delay before Rex responds.
 *
 * Core philosophy: PACE AND LEAD.
 * - Pace: Match the lead's energy and reply speed.
 * - Lead: Once rapport is built and momentum is flowing, subtly
 *   tighten the rhythm to keep urgency high and guide toward booking.
 *
 * Rules:
 * - MINIMUM 15 seconds. Always. No human texts back in 3 seconds.
 * - First touches (missed call, form): 1-4 minutes. Fast for a business,
 *   but not suspiciously instant.
 * - Match the lead's rhythm proportionally. If they take 5 minutes,
 *   Rex takes 1.5-3 minutes — faster than them (leading), but not
 *   so fast it breaks the vibe.
 * - Hot momentum is the exception: when both sides are rapid-firing,
 *   Rex can go 15-30 seconds. That's a real texting flow.
 */
export function calculateDelay(ctx: PacingContext): PacingResult {
  const { trigger, messages, leadMessageContent } = ctx;

  // Follow-ups are scheduled — no artificial delay needed
  if (trigger === "follow_up") {
    return { delayMs: 0, reason: "scheduled_follow_up" };
  }

  // ── First touches ──────────────────────────────────────────────
  // These are the first time Rex reaches out. Should feel like a
  // real person saw the notification and picked up their phone.

  if (trigger === "missed_call") {
    const delay = jitter(45_000, 180_000); // 45s – 3 min
    return { delayMs: delay, reason: "missed_call_textback" };
  }

  if (trigger === "form_submission") {
    const delay = jitter(60_000, 240_000); // 1 – 4 min
    return { delayMs: delay, reason: "form_first_touch" };
  }

  // ── Inbound SMS: pace-and-lead logic ───────────────────────────

  const rexMessages = messages.filter((m) => m.role === "rex");

  // First reply in a brand-new SMS conversation
  if (rexMessages.length === 0) {
    const delay = jitter(30_000, 90_000); // 30s – 1.5 min
    return { delayMs: delay, reason: "first_reply" };
  }

  // Measure the lead's pace
  const leadPace = getLeadPaceMs(messages);

  // Detect momentum
  const momentum = detectMomentum(messages);

  // Reading time for their message
  const readingTime = estimateReadingTimeMs(leadMessageContent || "");

  // Conversation depth — deeper = slightly faster (rapport built)
  const depth = Math.min(rexMessages.length, 10);

  let baseDelay: number;
  let reason: string;

  if (momentum === "hot") {
    // ── HOT: Real-time back-and-forth. Both sides locked in. ──
    // This is the only time Rex goes below 30s. The lead is
    // rapid-firing and the energy is high. Keep it going.
    baseDelay = jitter(15_000, 35_000); // 15-35s
    reason = "hot_momentum";

  } else if (momentum === "warm") {
    // ── WARM: Steady flow, replies within a couple minutes. ──
    // Match their energy, slightly faster to pull them in.
    baseDelay = jitter(30_000, 75_000); // 30s – 1.25 min
    reason = "warm_momentum";

  } else if (leadPace !== null && leadPace < 60_000) {
    // ── Lead replied under 1 minute — they're engaged. ──
    // Rex matches: quick but not instant.
    baseDelay = jitter(20_000, 50_000); // 20-50s
    reason = "engaged_lead";

  } else if (leadPace !== null && leadPace < 180_000) {
    // ── Lead took 1-3 minutes — normal texting. ──
    // Rex replies in roughly 30-60% of their time.
    baseDelay = jitter(35_000, 100_000); // 35s – 1.5 min
    reason = "normal_pace";

  } else if (leadPace !== null && leadPace < 600_000) {
    // ── Lead took 3-10 minutes — casual / distracted. ──
    // Rex takes 1.5-4 minutes. Proportional. Not desperate.
    baseDelay = jitter(90_000, 240_000); // 1.5 – 4 min
    reason = "slow_pace";

  } else if (leadPace !== null && leadPace < 3_600_000) {
    // ── Lead took 10-60 minutes — they went away and came back. ──
    // Rex waits a few minutes. Shows he's not just sitting there.
    baseDelay = jitter(120_000, 300_000); // 2 – 5 min
    reason = "came_back";

  } else {
    // ── Lead took 1hr+ or unknown. They've re-engaged after a break. ──
    // Respond within a few minutes — glad to hear from them, not frantic.
    baseDelay = jitter(60_000, 180_000); // 1 – 3 min
    reason = "re_engagement";
  }

  // ── Adjustments ────────────────────────────────────────────────

  // Reading time: longer messages get a bit more "thinking" time
  const readingAdjustment = Math.min(readingTime, 15_000); // cap at 15s

  // Depth discount: deeper convos = slightly faster (rapport is built)
  // Max 20s off after 10+ exchanges
  const depthDiscount = Math.min(depth * 2_000, 20_000);

  const finalDelay = Math.max(
    15_000, // ABSOLUTE MINIMUM: 15 seconds. No exceptions.
    baseDelay + readingAdjustment - depthDiscount
  );

  return { delayMs: Math.round(finalDelay), reason };
}

/**
 * Detect conversational momentum by looking at recent exchange timing.
 * "Hot" = 3+ rapid exchanges under 90s each. Real-time texting flow.
 * "Warm" = steady back-and-forth, most gaps under 3 minutes.
 * "Cold" = gaps or not enough history.
 */
function detectMomentum(messages: Message[]): "hot" | "warm" | "cold" {
  if (messages.length < 4) return "cold";

  const recent = messages.slice(-6);
  const gaps: number[] = [];

  for (let i = 1; i < recent.length; i++) {
    const prev = new Date(recent[i - 1].createdAt).getTime();
    const curr = new Date(recent[i].createdAt).getTime();
    gaps.push(curr - prev);
  }

  // Hot: at least 3 gaps and ALL under 90 seconds
  if (gaps.length >= 3 && gaps.every((g) => g < 90_000)) {
    return "hot";
  }

  // Warm: most gaps under 3 minutes
  const quickGaps = gaps.filter((g) => g < 180_000);
  if (quickGaps.length >= gaps.length * 0.6) {
    return "warm";
  }

  return "cold";
}

/**
 * How fast did the lead reply to Rex's most recent message?
 * Returns null if we can't determine (e.g., first message).
 */
function getLeadPaceMs(messages: Message[]): number | null {
  for (let i = messages.length - 1; i >= 1; i--) {
    if (messages[i].role === "lead") {
      for (let j = i - 1; j >= 0; j--) {
        if (messages[j].role === "rex") {
          const rexTime = new Date(messages[j].createdAt).getTime();
          const leadTime = new Date(messages[i].createdAt).getTime();
          return leadTime - rexTime;
        }
      }
    }
  }
  return null;
}

/**
 * Estimate how long it takes to read a message.
 * Casual reading: ~250 wpm. Rex reads at 300 wpm (fast but not instant).
 */
function estimateReadingTimeMs(text: string): number {
  const words = text.split(/\s+/).length;
  const wordsPerMinute = 300;
  const minutes = words / wordsPerMinute;
  return Math.round(minutes * 60 * 1000);
}

/**
 * Returns a random value between min and max (inclusive).
 * Natural variation so timing never feels mechanical.
 */
function jitter(minMs: number, maxMs: number): number {
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
