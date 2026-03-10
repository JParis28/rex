import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";

// -- Enums --

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "qualifying",
  "qualified",
  "inspection_scheduled",
  "estimate_sent",
  "closed_won",
  "closed_lost",
]);

export const channelEnum = pgEnum("channel", ["sms", "email", "voice"]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "paused",
  "completed",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "lead",
  "rex",
  "randy",
  "system",
]);

export const agentTypeEnum = pgEnum("agent_type", ["rex", "randy"]);

export const followUpTypeEnum = pgEnum("follow_up_type", [
  "estimate",
  "no_show",
  "re_engage",
]);

export const followUpStatusEnum = pgEnum("follow_up_status", [
  "pending",
  "active",
  "completed",
  "cancelled",
]);

// -- Tables --

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyName: text("company_name").notNull(),
  ghlLocationId: text("ghl_location_id").notNull().unique(),
  ghlApiKey: text("ghl_api_key").notNull(),
  serviceAreas: text("service_areas").array(),
  timezone: text("timezone").notNull().default("America/New_York"),
  calendarId: text("calendar_id"), // GHL calendar ID for booking
  pipelineId: text("pipeline_id"), // GHL pipeline ID
  agentType: agentTypeEnum("agent_type").notNull().default("rex"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id)
    .notNull(),
  ghlContactId: text("ghl_contact_id"),
  name: text("name"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  status: leadStatusEnum("status").notNull().default("new"),
  issueType: text("issue_type"), // damage, leak, replacement, inspection
  roofAge: text("roof_age"),
  insuranceOrOop: text("insurance_or_oop"), // insurance, out_of_pocket
  urgency: text("urgency"), // low, medium, high
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  tenantId: uuid("tenant_id")
    .references(() => tenants.id)
    .notNull(),
  leadId: uuid("lead_id")
    .references(() => leads.id)
    .notNull(),
  channel: channelEnum("channel").notNull().default("sms"),
  status: conversationStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .references(() => conversations.id)
    .notNull(),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const followUps = pgTable("follow_ups", {
  id: uuid("id").defaultRandom().primaryKey(),
  leadId: uuid("lead_id")
    .references(() => leads.id)
    .notNull(),
  conversationId: uuid("conversation_id")
    .references(() => conversations.id)
    .notNull(),
  type: followUpTypeEnum("type").notNull(),
  nextTouchAt: timestamp("next_touch_at").notNull(),
  touchCount: integer("touch_count").notNull().default(0),
  maxTouches: integer("max_touches").notNull().default(3),
  status: followUpStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// -- Type exports --

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type FollowUp = typeof followUps.$inferSelect;
