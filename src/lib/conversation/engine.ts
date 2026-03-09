import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { conversations, messages, leads, followUps, tenants } from "../db/schema";
import type { Tenant, Lead, Message, Conversation } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { GHLClient } from "../ghl/client";
import { buildRexSystemPrompt } from "./prompts";
import { calculateDelay, sleep } from "./pacing";

const anthropic = new Anthropic();

// Tools Rex can use during a conversation
const REX_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "send_sms",
    description:
      "Send an SMS text message to the homeowner. This is your primary way of communicating.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description:
            "The text message to send. Keep it short and natural — 1-3 sentences.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "update_lead_status",
    description:
      "Update the lead's qualification info when you learn something new from the conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: [
            "new",
            "qualifying",
            "qualified",
            "inspection_scheduled",
            "estimate_sent",
            "closed_won",
            "closed_lost",
          ],
        },
        issueType: {
          type: "string",
          description: "The roofing issue: damage, leak, replacement, inspection, etc.",
        },
        roofAge: {
          type: "string",
          description: "Approximate age of the roof.",
        },
        insuranceOrOop: {
          type: "string",
          enum: ["insurance", "out_of_pocket"],
          description: "Whether they'll use insurance or pay out of pocket.",
        },
        address: {
          type: "string",
          description: "The property address.",
        },
        urgency: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "How urgent the issue is.",
        },
      },
      required: ["status"],
    },
  },
  {
    name: "book_appointment",
    description:
      "Book a free roof inspection appointment. Only call this when the homeowner has agreed to a specific time.",
    input_schema: {
      type: "object" as const,
      properties: {
        startTime: {
          type: "string",
          description: "ISO 8601 start time for the appointment.",
        },
        title: {
          type: "string",
          description: "Appointment title, e.g. 'Roof Inspection - Smith'.",
        },
        notes: {
          type: "string",
          description: "Any notes about the appointment (issue description, etc).",
        },
      },
      required: ["startTime", "title"],
    },
  },
  {
    name: "schedule_follow_up",
    description:
      "Schedule a follow-up message for later. Use when the conversation pauses or the homeowner says they need time.",
    input_schema: {
      type: "object" as const,
      properties: {
        delayHours: {
          type: "number",
          description: "Hours from now to send the follow-up.",
        },
        reason: {
          type: "string",
          description: "Why the follow-up is needed.",
        },
      },
      required: ["delayHours"],
    },
  },
];

export type ConversationTrigger = "missed_call" | "inbound_sms" | "form_submission" | "follow_up";

export type ConversationContext = {
  tenant: Tenant;
  lead: Lead;
  conversation: Conversation;
  trigger: ConversationTrigger;
  contextMessage?: string; // e.g. "This is a missed call text-back"
  skipPacing?: boolean;    // Skip the delay (for simulator / testing)
  skipSms?: boolean;       // Skip actual GHL SMS send (for simulator)
};

export async function processConversation(ctx: ConversationContext): Promise<{
  smsMessage?: string;
  actions: ToolAction[];
  pacing: { delayMs: number; reason: string };
}> {
  const { tenant, lead, conversation, trigger, contextMessage } = ctx;

  // Load conversation history
  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversation.id))
    .orderBy(messages.createdAt);

  // Build Claude messages from history
  const claudeMessages: Anthropic.Messages.MessageParam[] = [];

  // Add context as a system-level user message if present
  if (contextMessage && history.length === 0) {
    claudeMessages.push({
      role: "user",
      content: `[CONTEXT] ${contextMessage}`,
    });
  }

  // Convert conversation history to Claude format
  for (const msg of history) {
    if (msg.role === "lead") {
      claudeMessages.push({ role: "user", content: msg.content });
    } else if (msg.role === "rex") {
      claudeMessages.push({
        role: "assistant",
        content: msg.content,
      });
    } else if (msg.role === "system") {
      claudeMessages.push({ role: "user", content: `[SYSTEM] ${msg.content}` });
    }
  }

  // If no messages yet and we have context, it's already added above.
  // If there are messages but the last one isn't from the user, add a nudge
  if (claudeMessages.length === 0) {
    claudeMessages.push({
      role: "user",
      content: "[CONTEXT] New conversation started. Reach out to the homeowner.",
    });
  }

  // Fetch available slots if tenant has a calendar configured
  let availableSlots: string[] | undefined;
  if (tenant.calendarId) {
    try {
      const ghl = new GHLClient(tenant.ghlApiKey, tenant.ghlLocationId);
      const now = new Date();
      const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const slotsRes = await ghl.getAvailableSlots(
        tenant.calendarId,
        now.toISOString().split("T")[0],
        nextWeek.toISOString().split("T")[0]
      );
      availableSlots = slotsRes.slots;
    } catch {
      // Calendar not configured or API error — Rex will handle gracefully
    }
  }

  // Build system prompt
  const systemPrompt = buildRexSystemPrompt(tenant, lead, availableSlots);

  // Call Claude
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    tools: REX_TOOLS,
    messages: claudeMessages,
  });

  // Process response — extract tool calls and text
  const actions: ToolAction[] = [];
  let smsMessage: string | undefined;

  // First pass: collect what Rex wants to do (but don't send SMS yet)
  const toolBlocks = response.content.filter(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
  );

  // Extract the SMS message if Rex is sending one
  const smsBlock = toolBlocks.find((b) => b.name === "send_sms");
  if (smsBlock) {
    smsMessage = (smsBlock.input as { message: string }).message;
  }

  // Execute non-SMS tools immediately (status updates, bookings, etc.)
  for (const block of toolBlocks) {
    if (block.name !== "send_sms") {
      const action = await executeToolAction(block, ctx);
      actions.push(action);
    }
  }

  // --- PACING: Calculate and apply human-like delay before sending SMS ---
  const lastLeadMsg = history.filter((m) => m.role === "lead").pop();
  const pacing = calculateDelay({
    trigger,
    messages: history,
    leadMessageContent: lastLeadMsg?.content,
  });

  if (smsMessage && pacing.delayMs > 0 && !ctx.skipPacing) {
    console.log(
      `[pacing] Waiting ${pacing.delayMs}ms before sending (reason: ${pacing.reason})`
    );
    await sleep(pacing.delayMs);
  } else if (ctx.skipPacing) {
    console.log(
      `[pacing] SKIPPED ${pacing.delayMs}ms delay (reason: ${pacing.reason}) — simulator mode`
    );
  }

  // NOW send the SMS after the delay (skip if in simulator mode)
  if (smsBlock && !ctx.skipSms) {
    const action = await executeToolAction(smsBlock, ctx);
    actions.push(action);
  } else if (smsBlock && ctx.skipSms) {
    actions.push({ tool: "send_sms", input: smsBlock.input as Record<string, unknown>, result: "simulated" });
  }

  // Save Rex's SMS response as a message in the conversation
  if (smsMessage) {
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: "rex",
      content: smsMessage,
    });
  }

  return { smsMessage, actions, pacing };
}

// -- Tool execution --

export type ToolAction = {
  tool: string;
  input: Record<string, unknown>;
  result: string;
};

async function executeToolAction(
  block: Anthropic.Messages.ToolUseBlock,
  ctx: ConversationContext
): Promise<ToolAction> {
  const { tenant, lead, conversation } = ctx;
  const input = block.input as Record<string, unknown>;

  switch (block.name) {
    case "send_sms": {
      if (lead.ghlContactId) {
        try {
          const ghl = new GHLClient(tenant.ghlApiKey, tenant.ghlLocationId);
          await ghl.sendSMS(lead.ghlContactId, input.message as string);
          return { tool: "send_sms", input, result: "sent" };
        } catch (err) {
          console.error("Failed to send SMS via GHL:", err);
          return { tool: "send_sms", input, result: `error: ${err}` };
        }
      }
      return { tool: "send_sms", input, result: "no_ghl_contact" };
    }

    case "update_lead_status": {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.status) updates.status = input.status;
      if (input.issueType) updates.issueType = input.issueType;
      if (input.roofAge) updates.roofAge = input.roofAge;
      if (input.insuranceOrOop) updates.insuranceOrOop = input.insuranceOrOop;
      if (input.address) updates.address = input.address;
      if (input.urgency) updates.urgency = input.urgency;

      await db.update(leads).set(updates).where(eq(leads.id, lead.id));
      return { tool: "update_lead_status", input, result: "updated" };
    }

    case "book_appointment": {
      if (tenant.calendarId && lead.ghlContactId) {
        try {
          const ghl = new GHLClient(tenant.ghlApiKey, tenant.ghlLocationId);
          const startTime = input.startTime as string;
          // Default 1-hour appointment
          const endTime = new Date(
            new Date(startTime).getTime() + 60 * 60 * 1000
          ).toISOString();

          await ghl.bookAppointment(tenant.calendarId, {
            contactId: lead.ghlContactId,
            startTime,
            endTime,
            title: input.title as string,
            notes: (input.notes as string) || "",
          });

          // Update lead status
          await db
            .update(leads)
            .set({ status: "inspection_scheduled", updatedAt: new Date() })
            .where(eq(leads.id, lead.id));

          return { tool: "book_appointment", input, result: "booked" };
        } catch (err) {
          console.error("Failed to book appointment:", err);
          return { tool: "book_appointment", input, result: `error: ${err}` };
        }
      }
      return { tool: "book_appointment", input, result: "no_calendar_configured" };
    }

    case "schedule_follow_up": {
      const delayHours = (input.delayHours as number) || 24;
      const nextTouchAt = new Date(
        Date.now() + delayHours * 60 * 60 * 1000
      );

      await db.insert(followUps).values({
        leadId: lead.id,
        conversationId: conversation.id,
        type: "estimate",
        nextTouchAt,
        status: "pending",
      });

      return { tool: "schedule_follow_up", input, result: "scheduled" };
    }

    default:
      return { tool: block.name, input, result: "unknown_tool" };
  }
}

// -- Helpers for finding/creating conversations --

export async function findOrCreateConversation(
  tenantId: string,
  leadId: string,
  channel: "sms" | "email" | "voice" = "sms"
): Promise<Conversation> {
  // Find existing active conversation
  const existing = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.leadId, leadId),
        eq(conversations.status, "active")
      )
    )
    .limit(1);

  if (existing.length > 0) return existing[0];

  // Create new conversation
  const [conv] = await db
    .insert(conversations)
    .values({ tenantId, leadId, channel })
    .returning();

  return conv;
}

export async function findOrCreateLead(
  tenantId: string,
  phone: string,
  ghlContactId?: string,
  name?: string
): Promise<Lead> {
  // Find by phone
  if (phone) {
    const existing = await db
      .select()
      .from(leads)
      .where(and(eq(leads.tenantId, tenantId), eq(leads.phone, phone)))
      .limit(1);

    if (existing.length > 0) return existing[0];
  }

  // Create new lead
  const [lead] = await db
    .insert(leads)
    .values({ tenantId, phone, ghlContactId, name, status: "new" })
    .returning();

  return lead;
}

export async function addInboundMessage(
  conversationId: string,
  content: string
): Promise<Message> {
  const [msg] = await db
    .insert(messages)
    .values({ conversationId, role: "lead", content })
    .returning();
  return msg;
}

export async function addSystemMessage(
  conversationId: string,
  content: string
): Promise<Message> {
  const [msg] = await db
    .insert(messages)
    .values({ conversationId, role: "system", content })
    .returning();
  return msg;
}

export async function getTenantByLocationId(
  locationId: string
): Promise<Tenant | null> {
  const result = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ghlLocationId, locationId))
    .limit(1);
  return result[0] || null;
}
