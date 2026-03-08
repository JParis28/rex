import { z } from "zod";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";

type RequestOptions = {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
};

export class GHLClient {
  private apiKey: string;
  private locationId: string;

  constructor(apiKey: string, locationId: string) {
    this.apiKey = apiKey;
    this.locationId = locationId;
  }

  private async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(`${GHL_BASE_URL}${path}`);
    if (opts.params) {
      Object.entries(opts.params).forEach(([k, v]) => url.searchParams.set(k, v));
    }

    const res = await fetch(url.toString(), {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GHL API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  // -- Contacts --

  async getContact(contactId: string) {
    return this.request<{ contact: GHLContact }>(
      `/contacts/${contactId}`
    );
  }

  async createContact(data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    locationId: string;
  }) {
    return this.request<{ contact: GHLContact }>("/contacts/", {
      method: "POST",
      body: data,
    });
  }

  async findContactByPhone(phone: string) {
    const res = await this.request<{ contacts: GHLContact[] }>(
      `/contacts/search`,
      {
        method: "GET",
        params: {
          locationId: this.locationId,
          query: phone,
        },
      }
    );
    return res.contacts?.[0] || null;
  }

  // -- SMS --

  async sendSMS(contactId: string, message: string) {
    return this.request<{ messageId: string }>(
      `/conversations/messages`,
      {
        method: "POST",
        body: {
          type: "SMS",
          contactId,
          message,
        },
      }
    );
  }

  // -- Pipeline / Opportunities --

  async createOpportunity(data: {
    pipelineId: string;
    stageId: string;
    contactId: string;
    name: string;
    status?: string;
  }) {
    return this.request<{ opportunity: GHLOpportunity }>(
      `/opportunities/`,
      {
        method: "POST",
        body: { ...data, locationId: this.locationId },
      }
    );
  }

  async updateOpportunityStage(opportunityId: string, stageId: string) {
    return this.request<{ opportunity: GHLOpportunity }>(
      `/opportunities/${opportunityId}`,
      {
        method: "PUT",
        body: { stageId },
      }
    );
  }

  // -- Calendar / Appointments --

  async getAvailableSlots(calendarId: string, startDate: string, endDate: string) {
    return this.request<{ slots: string[] }>(
      `/calendars/${calendarId}/free-slots`,
      {
        params: {
          startDate,
          endDate,
          timezone: "America/New_York",
        },
      }
    );
  }

  async bookAppointment(calendarId: string, data: {
    contactId: string;
    startTime: string;
    endTime: string;
    title: string;
    notes?: string;
  }) {
    return this.request<{ event: GHLAppointment }>(
      `/calendars/events/appointments`,
      {
        method: "POST",
        body: {
          calendarId,
          locationId: this.locationId,
          ...data,
        },
      }
    );
  }
}

// -- GHL Types --

export type GHLContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  locationId: string;
};

export type GHLOpportunity = {
  id: string;
  name: string;
  pipelineId: string;
  stageId: string;
  contactId: string;
  status: string;
};

export type GHLAppointment = {
  id: string;
  calendarId: string;
  contactId: string;
  startTime: string;
  endTime: string;
  title: string;
};

// -- Webhook payload schema --

export const ghlWebhookSchema = z.object({
  type: z.string(),
  locationId: z.string(),
  contactId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  message: z.string().optional(),
  // Form submission fields
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  address: z.string().optional(),
  // Catch-all for additional fields GHL sends
}).passthrough();

export type GHLWebhookPayload = z.infer<typeof ghlWebhookSchema>;
