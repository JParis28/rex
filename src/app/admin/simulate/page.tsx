"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Tenant = {
  id: string;
  companyName: string;
};

type Message = {
  role: "lead" | "rex" | "system";
  content: string;
  timestamp: Date;
  pacing?: { delayMs: number; delayFormatted: string; reason: string };
};

type LeadStatus = {
  status: string;
  issueType?: string;
  roofAge?: string;
  insuranceOrOop?: string;
  address?: string;
  urgency?: string;
};

export default function SimulatePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [waitingLabel, setWaitingLabel] = useState("");
  const [leadStatus, setLeadStatus] = useState<LeadStatus | null>(null);
  const [started, setStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/tenants")
      .then((r) => r.json())
      .then((data) => {
        setTenants(data);
        if (data.length > 0) setSelectedTenant(data[0].id);
      });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function simulate(
    trigger: "missed_call" | "inbound_sms" | "form_submission",
    message?: string
  ) {
    if (!selectedTenant) return;
    setLoading(true);
    setWaitingLabel(
      trigger === "missed_call"
        ? "Rex is composing a text-back..."
        : trigger === "form_submission"
        ? "Rex is drafting outreach..."
        : "Rex is typing..."
    );

    if (trigger === "inbound_sms" && message) {
      setMessages((prev) => [
        ...prev,
        { role: "lead", content: message, timestamp: new Date() },
      ]);
    } else if (trigger === "missed_call") {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: "Missed call — Rex is texting back...",
          timestamp: new Date(),
        },
      ]);
    } else if (trigger === "form_submission") {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: "Web form submitted — Rex is reaching out...",
          timestamp: new Date(),
        },
      ]);
    }

    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenant,
          trigger,
          message,
          formData:
            trigger === "form_submission"
              ? { name: "John Smith", phone: "+15551234567", address: "123 Main St, St Pete FL" }
              : undefined,
        }),
      });

      const data = await res.json();

      if (data.smsMessage) {
        setMessages((prev) => [
          ...prev,
          {
            role: "rex",
            content: data.smsMessage,
            timestamp: new Date(),
            pacing: data.pacing,
          },
        ]);
      }

      if (data.lead) {
        setLeadStatus(data.lead);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Error: ${err}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      setWaitingLabel("");
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput("");
    setStarted(true);
    simulate("inbound_sms", msg);
  }

  const statusColors: Record<string, string> = {
    new: "bg-blue-100 text-blue-800",
    qualifying: "bg-yellow-100 text-yellow-800",
    qualified: "bg-green-100 text-green-800",
    inspection_scheduled: "bg-purple-100 text-purple-800",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Test Rex</h1>
          <p className="text-sm text-gray-500">
            Chat with Rex as a homeowner. Real AI, real pacing, no SMS sent.
          </p>
        </div>
        {tenants.length > 1 && (
          <select
            className="border rounded px-2 py-1 text-sm"
            value={selectedTenant}
            onChange={(e) => setSelectedTenant(e.target.value)}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.companyName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Chat window */}
        <div className="lg:col-span-3">
          <Card className="h-[70vh] flex flex-col">
            {/* Messages */}
            <CardContent className="flex-1 overflow-y-auto py-4 space-y-3">
              {!started && (
                <div className="text-center py-12 space-y-4">
                  <p className="text-gray-400 text-sm">
                    Choose a scenario to start, or just type a message.
                  </p>
                  <div className="flex gap-2 justify-center flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setStarted(true);
                        simulate("missed_call");
                      }}
                      disabled={loading || !selectedTenant}
                    >
                      Simulate missed call
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setStarted(true);
                        simulate("form_submission");
                      }}
                      disabled={loading || !selectedTenant}
                    >
                      Simulate form submission
                    </Button>
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${
                    msg.role === "rex"
                      ? "justify-end"
                      : msg.role === "system"
                      ? "justify-center"
                      : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                      msg.role === "rex"
                        ? "bg-blue-500 text-white"
                        : msg.role === "system"
                        ? "bg-gray-100 text-gray-500 italic text-xs"
                        : "bg-gray-200 text-gray-900"
                    }`}
                  >
                    <p>{msg.content}</p>
                    <div
                      className={`text-xs mt-1 flex items-center gap-2 ${
                        msg.role === "rex" ? "text-blue-200" : "text-gray-400"
                      }`}
                    >
                      <span>
                        {msg.role === "rex"
                          ? "Rex"
                          : msg.role === "system"
                          ? ""
                          : "You (homeowner)"}
                      </span>
                      {msg.pacing && (
                        <span
                          className={`${
                            msg.role === "rex"
                              ? "bg-blue-600 text-blue-100"
                              : "bg-gray-200"
                          } px-1.5 py-0.5 rounded text-[10px] font-mono`}
                        >
                          {msg.pacing.delayFormatted} delay ({msg.pacing.reason})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-end">
                  <div className="bg-blue-100 text-blue-600 rounded-lg px-3 py-2 text-sm italic">
                    {waitingLabel}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </CardContent>

            {/* Input */}
            <div className="border-t p-3">
              <form onSubmit={handleSend} className="flex gap-2">
                <Input
                  placeholder="Type as the homeowner..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={loading || !selectedTenant}
                  autoFocus
                />
                <Button type="submit" disabled={loading || !input.trim()}>
                  Send
                </Button>
              </form>
            </div>
          </Card>
        </div>

        {/* Lead status sidebar */}
        <div className="lg:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Lead Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {leadStatus ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Stage</span>
                    <Badge
                      className={statusColors[leadStatus.status] || "bg-gray-100"}
                    >
                      {leadStatus.status}
                    </Badge>
                  </div>
                  {leadStatus.issueType && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Issue</span>
                      <span>{leadStatus.issueType}</span>
                    </div>
                  )}
                  {leadStatus.roofAge && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Roof age</span>
                      <span>{leadStatus.roofAge}</span>
                    </div>
                  )}
                  {leadStatus.insuranceOrOop && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Payment</span>
                      <span>{leadStatus.insuranceOrOop}</span>
                    </div>
                  )}
                  {leadStatus.address && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Address</span>
                      <span className="text-right text-xs">
                        {leadStatus.address}
                      </span>
                    </div>
                  )}
                  {leadStatus.urgency && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Urgency</span>
                      <span>{leadStatus.urgency}</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-xs">
                  Start a conversation to see Rex qualify the lead.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">How it works</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-gray-500 space-y-1">
              <p>This uses the real Rex conversation engine and Claude API.</p>
              <p>
                The pacing delay is calculated but <strong>skipped</strong> in
                the UI for speed. The tag on each message shows what the delay
                <em> would be</em> in production.
              </p>
              <p>No SMS is actually sent. GHL is not contacted.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
