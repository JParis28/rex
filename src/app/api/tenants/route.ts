import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { z } from "zod";

const createTenantSchema = z.object({
  companyName: z.string().min(1),
  ghlLocationId: z.string().min(1),
  ghlApiKey: z.string().min(1),
  serviceAreas: z.array(z.string()).optional(),
  timezone: z.string().default("America/New_York"),
  calendarId: z.string().optional(),
  pipelineId: z.string().optional(),
  agentType: z.enum(["rex", "randy"]).default("rex"),
});

export async function GET() {
  const allTenants = await db.select().from(tenants);
  return NextResponse.json(allTenants);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createTenantSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [tenant] = await db.insert(tenants).values(parsed.data).returning();
  return NextResponse.json(tenant, { status: 201 });
}
