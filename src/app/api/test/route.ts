import { NextRequest, NextResponse } from "next/server";

/**
 * Test endpoint for simulating GHL webhooks during development.
 *
 * Usage:
 *   POST /api/test?type=missed_call
 *   POST /api/test?type=inbound_sms
 *   POST /api/test?type=form_submission
 *
 * Requires a tenant to exist in the database with the matching locationId.
 */
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 });
  }

  const type = req.nextUrl.searchParams.get("type") || "missed_call";
  const body = await req.json().catch(() => ({}));
  const locationId = body.locationId || "test-location-001";
  const phone = body.phone || "+15551234567";

  const payloads: Record<string, object> = {
    missed_call: {
      type: "MissedCall",
      locationId,
      phone,
      contactId: "test-contact-001",
      name: "John Smith",
    },
    inbound_sms: {
      type: "InboundMessage",
      locationId,
      phone,
      contactId: "test-contact-001",
      name: "John Smith",
      message: body.message || "Hey, I need someone to look at my roof",
    },
    form_submission: {
      type: "FormSubmission",
      locationId,
      phone,
      firstName: "John",
      lastName: "Smith",
      email: "john@example.com",
      address: "123 Main St, St. Pete, FL",
    },
  };

  const payload = payloads[type];
  if (!payload) {
    return NextResponse.json(
      { error: `Unknown type: ${type}. Use: ${Object.keys(payloads).join(", ")}` },
      { status: 400 }
    );
  }

  // Forward to the actual webhook handler
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/webhooks/ghl`;
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  return NextResponse.json({ simulatedType: type, payload, result });
}
