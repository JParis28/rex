import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants, leads, conversations, messages } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  processConversation,
  findOrCreateConversation,
  findOrCreateLead,
  addInboundMessage,
  addSystemMessage,
  type ConversationTrigger,
  type AgentType,
} from "@/lib/conversation/engine";
import {
  buildMissedCallContext,
  buildFormSubmissionContext,
  buildReEngageContext,
  buildStormReEngageContext,
  buildRandyInboundContext,
} from "@/lib/conversation/prompts";

// Increase timeout — Claude API + DB calls can take 15-30s
export const maxDuration = 60;

/**
 * Simulation API — test Rex without GHL.
 *
 * POST /api/simulate
 * { "tenantId": "...", "trigger": "missed_call" | "inbound_sms" | "form_submission", "message": "...", "phone": "..." }
 *
 * Returns Rex's response, pacing info, and lead status.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, trigger, message, phone, formData, agentType: agentOverride } = body as {
      tenantId: string;
      trigger: ConversationTrigger;
      message?: string;
      phone?: string;
      formData?: Record<string, string>;
      agentType?: AgentType;
    };

    // Find tenant
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const simPhone = phone || "+15551234567";

    // Find or create lead and conversation
    const lead = await findOrCreateLead(tenant.id, simPhone, undefined, formData?.name);
    const conversation = await findOrCreateConversation(tenant.id, lead.id, "sms");

    const agent: AgentType = agentOverride || (tenant.agentType as AgentType) || "rex";

    let contextMessage: string | undefined;

    if (trigger === "missed_call") {
      await addSystemMessage(conversation.id, "Missed call — text-back triggered.");
      contextMessage = buildMissedCallContext();
    } else if (trigger === "form_submission") {
      const data = formData || { name: "Test Homeowner", phone: simPhone };
      await addSystemMessage(conversation.id, `Form submitted: ${JSON.stringify(data)}`);
      contextMessage = buildFormSubmissionContext(data);
    } else if (trigger === "inbound_sms" && message) {
      await addInboundMessage(conversation.id, message);
      // If Randy is handling an inbound response, add context
      if (agent === "randy") {
        contextMessage = buildRandyInboundContext();
      }
    } else if (trigger === "re_engage") {
      const touchNumber = body.touchNumber || 1;
      await addSystemMessage(conversation.id, `Randy re-engagement — Touch ${touchNumber} of 3`);
      contextMessage = buildReEngageContext(touchNumber);
    } else if (trigger === "storm_event") {
      const stormInfo = body.stormInfo || "Significant storm reported in the service area";
      await addSystemMessage(conversation.id, `Storm event triggered: ${stormInfo}`);
      contextMessage = buildStormReEngageContext(stormInfo);
    }

    // Record the start time so we can measure total response time
    const startTime = Date.now();

    // Process through the selected agent — skip pacing delay and actual SMS for simulator
    const result = await processConversation({
      tenant,
      lead,
      conversation,
      trigger,
      agentType: agent,
      contextMessage,
      skipPacing: true,
      skipSms: true,
    });

    const totalTime = Date.now() - startTime;

    // Reload lead to get latest status
    const [updatedLead] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, lead.id));

    // Load full message history
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id))
      .orderBy(messages.createdAt);

    return NextResponse.json({
      smsMessage: result.smsMessage,
      pacing: {
        ...result.pacing,
        delayFormatted: formatDelay(result.pacing.delayMs),
        totalResponseMs: totalTime,
      },
      lead: {
        status: updatedLead.status,
        issueType: updatedLead.issueType,
        roofAge: updatedLead.roofAge,
        insuranceOrOop: updatedLead.insuranceOrOop,
        address: updatedLead.address,
        urgency: updatedLead.urgency,
      },
      conversationId: conversation.id,
      messageCount: history.length,
    });
  } catch (err) {
    console.error("[simulate] Error:", err);
    return NextResponse.json(
      { error: String(err) },
      { status: 500 }
    );
  }
}

function formatDelay(ms: number): string {
  if (ms === 0) return "instant";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}
