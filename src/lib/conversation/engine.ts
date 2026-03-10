import Anthropic from "@anthropic-ai/sdk";
import { db } from "../db";
import { conversations, messages, leads, followUps, tenants } from "../db/schema";
import type { Tenant, Lead, Message, Conversation } from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { GHLClient } from "../ghl/client";
import { buildRexSystemPrompt, buildRandySystemPrompt } from "./prompts";
import { calculateDelay, sleep } from "./pacing";

export type AgentType = "rex" | "randy";

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

// Tools Randy can use during re-engagement
const RANDY_TOOLS: Anthropic.Messages.Tool[] = [
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
            "The text message to send. Keep it short and natural — 1-2 sentences.",
        },
      },
      required: ["message"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email to the homeowner. Use for Touch 2 in the re-engagement sequence or storm follow-up emails.",
    input_schema: {
      type: "object" as const,
      properties: {
        subject: {
          type: "string",
          description: "The email subject line. Keep it personal and specific.",
        },
        body: {
          type: "string",
          description:
            "The email body. Keep it brief — 2-4 sentences max. Professional but warm.",
        },
      },
      required: ["subject", "body"],
    },
  },
  {
    name: "flag_warm_lead",
    description:
      "Flag this lead as warm for immediate handoff to Rex. Use when the homeowner responds positively or asks questions showing interest.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description:
            "Why this lead is warm (e.g. 'Homeowner asked about updated pricing', 'Wants to reschedule inspection').",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "archive_lead",
    description:
      "Archive this lead after the re-engagement sequence is complete with no response, or if the homeowner explicitly declines.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description:
            "Why the lead is being archived (e.g. 'No response after 3 touches', 'Homeowner went with competitor').",
        },
      },
      required: ["reason"],
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
];

export type ConversationTrigger = "missed_call" | "inbound_sms" | "form_submission" | "follow_up" | "re_engage" | "storm_event";

export type ConversationContext = {
  tenant: Tenant;
  lead: Lead;
  conversation: Conversation;
  trigger: ConversationTrigger;
  agentType?: AgentType;     // Which agent handles this — defaults to tenant.agentType
  contextMessage?: string;   // e.g. "This is a missed call text-back"
  skipPacing?: boolean;      // Skip the delay (for simulator / testing)
  skipSms?: boolean;         // Skip actual GHL SMS send (for simulator)
};

export async function processConversation(ctx: ConversationContext): Promise<{
  smsMessage?: string;
  actions: ToolAction[];
  pacing: { delayMs: number; reason: string };
}> {
  const { tenant, lead, conversation, trigger, contextMessage } = ctx;
  const agent: AgentType = ctx.agentType || (tenant.agentType as AgentType) || "rex";

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

  // Convert conversation history to Claude format.
  // IMPORTANT: Claude API requires strictly alternating user/assistant messages.
  // When a lead sends multiple texts before Rex replies (e.g. "123 Main St" then "FL"
  // then "hello?"), we merge them into one user message.
  for (const msg of history) {
    const role: "user" | "assistant" =
      msg.role === "rex" || msg.role === "randy" ? "assistant" : "user";
    const content =
      msg.role === "system" ? `[SYSTEM] ${msg.content}` : msg.content;

    const lastMsg = claudeMessages[claudeMessages.length - 1];

    if (lastMsg && lastMsg.role === role) {
      // Same role as previous — merge into one message
      lastMsg.content = `${lastMsg.content}\n${content}`;
    } else {
      claudeMessages.push({ role, content });
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

  // Fetch available slots if tenant has a calendar configured (Rex only — Randy doesn't book)
  let availableSlots: string[] | undefined;
  if (agent === "rex" && tenant.calendarId) {
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

  // Build system prompt and select tools based on agent type
  const systemPrompt = agent === "randy"
    ? buildRandySystemPrompt(tenant, lead)
    : buildRexSystemPrompt(tenant, lead, availableSlots);

  const tools = agent === "randy" ? RANDY_TOOLS : REX_TOOLS;

  // Call Claude
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: systemPrompt,
    tools,
    messages: claudeMessages,
  });

  // Process response — extract tool calls and text
  const actions: ToolAction[] = [];
  let smsMessage: string | undefined;

  // First pass: collect what Rex wants to do (but don't send SMS yet)
  const toolBlocks = response.content.filter(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
  );

  // Extract the outbound message — could be SMS or email (Randy uses both)
  const smsBlock = toolBlocks.find((b) => b.name === "send_sms");
  const emailBlock = toolBlocks.find((b) => b.name === "send_email");

  if (smsBlock) {
    smsMessage = (smsBlock.input as { message: string }).message;
  } else if (emailBlock) {
    // For email, use the body as the display message
    const emailInput = emailBlock.input as { subject: string; body: string };
    smsMessage = `[Email: ${emailInput.subject}] ${emailInput.body}`;
  }

  // Execute non-outbound tools immediately (status updates, bookings, flagging, etc.)
  for (const block of toolBlocks) {
    if (block.name !== "send_sms" && block.name !== "send_email") {
      const action = await executeToolAction(block, ctx);
      actions.push(action);
    }
  }

  // --- PACING: Calculate and apply human-like delay before sending ---
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

  // NOW send the outbound message after the delay (skip if in simulator mode)
  if (smsBlock && !ctx.skipSms) {
    const action = await executeToolAction(smsBlock, ctx);
    actions.push(action);
  } else if (smsBlock && ctx.skipSms) {
    actions.push({ tool: "send_sms", input: smsBlock.input as Record<string, unknown>, result: "simulated" });
  }

  if (emailBlock && !ctx.skipSms) {
    const action = await executeToolAction(emailBlock, ctx);
    actions.push(action);
  } else if (emailBlock && ctx.skipSms) {
    actions.push({ tool: "send_email", input: emailBlock.input as Record<string, unknown>, result: "simulated" });
  }

  // Save agent's response as a message in the conversation
  if (smsMessage) {
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: agent,
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

    // -- Randy-specific tools --

    case "send_email": {
      // Email sending would go through SendGrid/Gmail API in production.
      // For now, log it and return success.
      console.log(
        `[randy] Email to ${lead.email || lead.phone}: Subject: ${input.subject}`
      );
      return { tool: "send_email", input, result: "sent" };
    }

    case "flag_warm_lead": {
      // Update lead status to qualifying and log the handoff
      await db
        .update(leads)
        .set({ status: "qualifying", updatedAt: new Date() })
        .where(eq(leads.id, lead.id));

      // Add a system message noting the handoff
      await db.insert(messages).values({
        conversationId: conversation.id,
        role: "system",
        content: `Randy flagged as warm lead: ${input.reason}. Handing off to Rex.`,
      });

      console.log(`[randy] Warm lead flagged: ${input.reason}`);
      return { tool: "flag_warm_lead", input, result: "flagged" };
    }

    case "archive_lead": {
      await db
        .update(leads)
        .set({ status: "closed_lost", updatedAt: new Date() })
        .where(eq(leads.id, lead.id));

      // Complete the conversation
      await db
        .update(conversations)
        .set({ status: "completed" })
        .where(eq(conversations.id, conversation.id));

      console.log(`[randy] Lead archived: ${input.reason}`);
      return { tool: "archive_lead", input, result: "archived" };
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
