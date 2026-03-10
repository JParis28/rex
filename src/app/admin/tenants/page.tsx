"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Tenant = {
  id: string;
  companyName: string;
  ghlLocationId: string;
  ghlApiKey: string;
  serviceAreas: string[] | null;
  timezone: string;
  calendarId: string | null;
  pipelineId: string | null;
  agentType: string;
  createdAt: string;
};

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/tenants")
      .then((r) => r.json())
      .then(setTenants)
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      companyName: form.get("companyName"),
      ghlLocationId: form.get("ghlLocationId"),
      ghlApiKey: form.get("ghlApiKey"),
      timezone: form.get("timezone") || "America/New_York",
      calendarId: form.get("calendarId") || undefined,
      pipelineId: form.get("pipelineId") || undefined,
      agentType: form.get("agentType") || "rex",
      serviceAreas: (form.get("serviceAreas") as string)
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };

    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const tenant = await res.json();
      setTenants((prev) => [...prev, tenant]);
      setShowForm(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clients</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "Add Client"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New Roofing Company</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="companyName">Company Name</Label>
                  <Input
                    id="companyName"
                    name="companyName"
                    placeholder="ABC Roofing"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="ghlLocationId">GHL Location ID</Label>
                  <Input
                    id="ghlLocationId"
                    name="ghlLocationId"
                    placeholder="loc_..."
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="ghlApiKey">GHL API Key</Label>
                  <Input
                    id="ghlApiKey"
                    name="ghlApiKey"
                    type="password"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input
                    id="timezone"
                    name="timezone"
                    defaultValue="America/New_York"
                  />
                </div>
                <div>
                  <Label htmlFor="serviceAreas">
                    Service Areas (comma-separated)
                  </Label>
                  <Input
                    id="serviceAreas"
                    name="serviceAreas"
                    placeholder="St. Pete, Tampa, Clearwater"
                  />
                </div>
                <div>
                  <Label htmlFor="calendarId">GHL Calendar ID</Label>
                  <Input
                    id="calendarId"
                    name="calendarId"
                    placeholder="cal_..."
                  />
                </div>
                <div>
                  <Label htmlFor="pipelineId">GHL Pipeline ID</Label>
                  <Input
                    id="pipelineId"
                    name="pipelineId"
                    placeholder="pipe_..."
                  />
                </div>
                <div>
                  <Label htmlFor="agentType">Agent</Label>
                  <select
                    id="agentType"
                    name="agentType"
                    className="w-full border rounded-md px-3 py-2 text-sm"
                    defaultValue="rex"
                  >
                    <option value="rex">Rex (Sales Rep)</option>
                    <option value="randy">Randy (Dead Lead Digger)</option>
                  </select>
                </div>
              </div>
              <Button type="submit">Add Company</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : tenants.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            No clients yet. Add your first roofing company.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {tenants.map((tenant) => (
            <Card key={tenant.id}>
              <CardContent className="py-4 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">{tenant.companyName}</h3>
                  <p className="text-sm text-gray-500">
                    Location: {tenant.ghlLocationId}
                  </p>
                  {tenant.serviceAreas && (
                    <div className="flex gap-1 mt-1">
                      {tenant.serviceAreas.map((area) => (
                        <Badge key={area} variant="secondary">
                          {area}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right text-sm text-gray-500 space-y-1">
                  <Badge
                    className={
                      tenant.agentType === "randy"
                        ? "bg-orange-100 text-orange-800"
                        : "bg-blue-100 text-blue-800"
                    }
                  >
                    {tenant.agentType === "randy" ? "Randy" : "Rex"}
                  </Badge>
                  <p>{tenant.timezone}</p>
                  <p>
                    Webhook:{" "}
                    <code className="bg-gray-100 px-1 rounded text-xs">
                      /api/webhooks/ghl
                    </code>
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
