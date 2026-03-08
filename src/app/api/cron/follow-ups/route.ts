import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { followUps, leads, conversations, tenants } from "@/lib/db/schema";
import { eq, and, lte } from "drizzle-orm";
import {
  processConversation,
  addSystemMessage,
} from "@/lib/conversation/engine";
import {
  buildEstimateFollowUpContext,
  buildNoShowContext,
} from "@/lib/conversation/prompts";

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  console.log("[cron] Running follow-up check...");

  try {
    // Find all pending/active follow-ups that are due
    const dueFollowUps = await db
      .select()
      .from(followUps)
      .where(
        and(
          lte(followUps.nextTouchAt, new Date()),
          eq(followUps.status, "pending")
        )
      );

    console.log(`[cron] Found ${dueFollowUps.length} due follow-ups`);

    const results = [];

    for (const fu of dueFollowUps) {
      try {
        // Load related data
        const [lead] = await db
          .select()
          .from(leads)
          .where(eq(leads.id, fu.leadId));
        const [conversation] = await db
          .select()
          .from(conversations)
          .where(eq(conversations.id, fu.conversationId));
        const [tenant] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, lead.tenantId));

        if (!lead || !conversation || !tenant) {
          console.error(`[cron] Missing data for follow-up ${fu.id}`);
          continue;
        }

        // Build context based on follow-up type
        let contextMessage: string;
        if (fu.type === "no_show") {
          contextMessage = buildNoShowContext();
        } else {
          contextMessage = buildEstimateFollowUpContext(fu.touchCount);
        }

        // Add system message for context
        await addSystemMessage(conversation.id, contextMessage);

        // Process through Rex
        const result = await processConversation({
          tenant,
          lead,
          conversation,
          contextMessage,
        });

        // Update follow-up record
        const newTouchCount = fu.touchCount + 1;
        if (newTouchCount >= fu.maxTouches) {
          // Max touches reached — mark completed
          await db
            .update(followUps)
            .set({ status: "completed", touchCount: newTouchCount })
            .where(eq(followUps.id, fu.id));
        } else {
          // Schedule next touch
          const nextDelay = getNextTouchDelay(fu.type, newTouchCount);
          const nextTouchAt = new Date(Date.now() + nextDelay);
          await db
            .update(followUps)
            .set({ touchCount: newTouchCount, nextTouchAt })
            .where(eq(followUps.id, fu.id));
        }

        results.push({
          followUpId: fu.id,
          status: "processed",
          touchCount: newTouchCount,
          smsMessage: result.smsMessage,
        });
      } catch (err) {
        console.error(`[cron] Error processing follow-up ${fu.id}:`, err);
        results.push({ followUpId: fu.id, status: "error", error: String(err) });
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  } catch (err) {
    console.error("[cron] Fatal error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function getNextTouchDelay(type: string, touchCount: number): number {
  const HOUR = 60 * 60 * 1000;

  if (type === "estimate") {
    // 24hr → 48hr → 5 days
    if (touchCount === 1) return 24 * HOUR; // next touch at 48hrs
    return 3 * 24 * HOUR; // next touch at 5 days
  }

  if (type === "no_show") {
    // 30min → 24hr
    if (touchCount === 0) return 0.5 * HOUR;
    return 24 * HOUR;
  }

  // Default: 24hr between touches
  return 24 * HOUR;
}
