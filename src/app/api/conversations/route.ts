import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations, messages, leads, tenants } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");

  // Get conversations with their lead info
  const query = db
    .select({
      conversation: conversations,
      lead: leads,
      tenant: tenants,
    })
    .from(conversations)
    .innerJoin(leads, eq(conversations.leadId, leads.id))
    .innerJoin(tenants, eq(conversations.tenantId, tenants.id))
    .orderBy(desc(conversations.createdAt))
    .limit(50);

  const results = tenantId
    ? await query.where(eq(conversations.tenantId, tenantId))
    : await query;

  return NextResponse.json(results);
}

// Get messages for a specific conversation
export async function POST(req: NextRequest) {
  const { conversationId } = await req.json();

  if (!conversationId) {
    return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);

  return NextResponse.json(msgs);
}
