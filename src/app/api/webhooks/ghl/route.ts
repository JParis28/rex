import { NextRequest, NextResponse } from "next/server";
import { ghlWebhookSchema } from "@/lib/ghl/client";
import {
  processConversation,
  findOrCreateConversation,
  findOrCreateLead,
  addInboundMessage,
  addSystemMessage,
  getTenantByLocationId,
} from "@/lib/conversation/engine";
import {
  buildMissedCallContext,
  buildFormSubmissionContext,
} from "@/lib/conversation/prompts";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("[webhook] Received GHL webhook:", JSON.stringify(body, null, 2));

    // Parse and validate
    const payload = ghlWebhookSchema.safeParse(body);
    if (!payload.success) {
      console.error("[webhook] Invalid payload:", payload.error);
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const data = payload.data;

    // Find tenant by GHL location ID
    const tenant = await getTenantByLocationId(data.locationId);
    if (!tenant) {
      console.error("[webhook] Unknown location:", data.locationId);
      return NextResponse.json({ error: "Unknown location" }, { status: 404 });
    }

    // Route by event type
    const eventType = data.type?.toLowerCase() || "";

    if (eventType.includes("inboundsms") || eventType.includes("inbound_message")) {
      return handleInboundSMS(tenant, data);
    }

    if (eventType.includes("missed") || eventType.includes("call")) {
      return handleMissedCall(tenant, data);
    }

    if (eventType.includes("form") || eventType.includes("submission")) {
      return handleFormSubmission(tenant, data);
    }

    console.log("[webhook] Unhandled event type:", eventType);
    return NextResponse.json({ status: "ignored", eventType });
  } catch (err) {
    console.error("[webhook] Error processing webhook:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// -- Handlers --

async function handleInboundSMS(
  tenant: typeof import("@/lib/db/schema").tenants.$inferSelect,
  data: ReturnType<typeof ghlWebhookSchema.parse>
) {
  const phone = data.phone;
  if (!phone || !data.message) {
    return NextResponse.json({ error: "Missing phone or message" }, { status: 400 });
  }

  console.log(`[webhook] Inbound SMS from ${phone}: ${data.message}`);

  // Find or create lead and conversation
  const lead = await findOrCreateLead(
    tenant.id,
    phone,
    data.contactId,
    data.name
  );
  const conversation = await findOrCreateConversation(tenant.id, lead.id, "sms");

  // Save the inbound message
  await addInboundMessage(conversation.id, data.message);

  // Process through Rex's brain (includes pacing delay before SMS send)
  const result = await processConversation({
    tenant,
    lead,
    conversation,
    trigger: "inbound_sms",
  });

  console.log(
    `[webhook] Rex responded (${result.pacing.delayMs}ms delay, ${result.pacing.reason}): ${result.smsMessage}`
  );

  return NextResponse.json({
    status: "processed",
    smsMessage: result.smsMessage,
    pacing: result.pacing,
    actions: result.actions.map((a) => ({ tool: a.tool, result: a.result })),
  });
}

async function handleMissedCall(
  tenant: typeof import("@/lib/db/schema").tenants.$inferSelect,
  data: ReturnType<typeof ghlWebhookSchema.parse>
) {
  const phone = data.phone;
  if (!phone) {
    return NextResponse.json({ error: "Missing phone" }, { status: 400 });
  }

  console.log(`[webhook] Missed call from ${phone}`);

  // Find or create lead and conversation
  const lead = await findOrCreateLead(
    tenant.id,
    phone,
    data.contactId,
    data.name
  );
  const conversation = await findOrCreateConversation(tenant.id, lead.id, "sms");

  // Add context message
  await addSystemMessage(conversation.id, "Missed call — text-back triggered.");

  // Process through Rex with missed call context (includes pacing delay)
  const result = await processConversation({
    tenant,
    lead,
    conversation,
    trigger: "missed_call",
    contextMessage: buildMissedCallContext(),
  });

  console.log(
    `[webhook] Rex text-back (${result.pacing.delayMs}ms delay, ${result.pacing.reason}): ${result.smsMessage}`
  );

  return NextResponse.json({
    status: "processed",
    smsMessage: result.smsMessage,
    pacing: result.pacing,
    actions: result.actions.map((a) => ({ tool: a.tool, result: a.result })),
  });
}

async function handleFormSubmission(
  tenant: typeof import("@/lib/db/schema").tenants.$inferSelect,
  data: ReturnType<typeof ghlWebhookSchema.parse>
) {
  const phone = data.phone;
  const name = data.firstName
    ? `${data.firstName} ${data.lastName || ""}`.trim()
    : data.name;

  if (!phone) {
    console.log("[webhook] Form submission without phone — skipping SMS");
    return NextResponse.json({ status: "skipped", reason: "no_phone" });
  }

  console.log(`[webhook] Form submission from ${name || phone}`);

  // Find or create lead and conversation
  const lead = await findOrCreateLead(tenant.id, phone, data.contactId, name);
  const conversation = await findOrCreateConversation(tenant.id, lead.id, "sms");

  // Build form data for context
  const formData: Record<string, string> = {};
  if (name) formData.name = name;
  if (data.email) formData.email = data.email;
  if (data.phone) formData.phone = data.phone;
  if (data.address) formData.address = data.address;

  await addSystemMessage(
    conversation.id,
    `Form submitted: ${JSON.stringify(formData)}`
  );

  // Process through Rex with form context (includes pacing delay)
  const result = await processConversation({
    tenant,
    lead,
    conversation,
    trigger: "form_submission",
    contextMessage: buildFormSubmissionContext(formData),
  });

  console.log(
    `[webhook] Rex outreach (${result.pacing.delayMs}ms delay, ${result.pacing.reason}): ${result.smsMessage}`
  );

  return NextResponse.json({
    status: "processed",
    smsMessage: result.smsMessage,
    pacing: result.pacing,
    actions: result.actions.map((a) => ({ tool: a.tool, result: a.result })),
  });
}
