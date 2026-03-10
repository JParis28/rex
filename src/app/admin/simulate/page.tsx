"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type AgentType = "rex" | "randy";

type Tenant = {
  id: string;
  companyName: string;
  agentType?: AgentType;
};

type Message = {
  role: "lead" | "rex" | "randy" | "system";
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

function newSessionPhone() {
  return "+1555" + String(Math.floor(Math.random() * 9000000) + 1000000);
}

export default function SimulatePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string>("");
  const [selectedAgent, setSelectedAgent] = useState<AgentType>("rex");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [waitingLabel, setWaitingLabel] = useState("");
  const [leadStatus, setLeadStatus] = useState<LeadStatus | null>(null);
  const [started, setStarted] = useState(false);
  const [sessionPhone, setSessionPhone] = useState<string>(newSessionPhone);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/tenants")
      .then((r) => r.json())
      .then((data) => {
        setTenants(data);
        if (data.length > 0) {
          setSelectedTenant(data[0].id);
          setSelectedAgent(data[0].agentType || "rex");
        }
      });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const agentName = selectedAgent === "randy" ? "Randy" : "Rex";
  const agentColor = selectedAgent === "randy" ? "orange" : "blue";

  async function simulate(
    trigger: string,
    message?: string,
    extra?: Record<string, unknown>
  ) {
    if (!selectedTenant) return;
    setLoading(true);

    const labels: Record<string, string> = {
      missed_call: `${agentName} is composing a text-back...`,
      form_submission: `${agentName} is drafting outreach...`,
      inbound_sms: `${agentName} is typing...`,
      re_engage: `${agentName} is crafting a re-engagement...`,
      storm_event: `${agentName} is firing storm outreach...`,
    };
    setWaitingLabel(labels[trigger] || `${agentName} is typing...`);

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
          content: `Missed call — ${agentName} is texting back...`,
          timestamp: new Date(),
        },
      ]);
    } else if (trigger === "form_submission") {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Web form submitted — ${agentName} is reaching out...`,
          timestamp: new Date(),
        },
      ]);
    } else if (trigger === "re_engage") {
      const touchNum = (extra?.touchNumber as number) || 1;
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `30-day re-engagement — Touch ${touchNum} of 3`,
          timestamp: new Date(),
        },
      ]);
    } else if (trigger === "storm_event") {
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: "Storm event detected — Randy firing emergency outreach...",
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
          phone: sessionPhone,
          agentType: selectedAgent,
          formData:
            trigger === "form_submission"
              ? { name: "John Smith", phone: sessionPhone, address: "123 Main St, St Pete FL" }
              : undefined,
          ...extra,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${res.status})`);
      }

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.smsMessage) {
        setMessages((prev) => [
          ...prev,
          {
            role: selectedAgent,
            content: data.smsMessage,
            timestamp: new Date(),
            pacing: data.pacing,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: `${agentName} processed the message but didn't generate a reply.`,
            timestamp: new Date(),
          },
        ]);
      }

      if (data.lead) {
        setLeadStatus(data.lead);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Error: ${errorMsg}. Try sending your message again.`,
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

  function resetChat() {
    setMessages([]);
    setLeadStatus(null);
    setStarted(false);
    setInput("");
    setSessionPhone(newSessionPhone());
  }

  const statusColors: Record<string, string> = {
    new: "bg-blue-100 text-blue-800",
    qualifying: "bg-yellow-100 text-yellow-800",
    qualified: "bg-green-100 text-green-800",
    inspection_scheduled: "bg-purple-100 text-purple-800",
    estimate_sent: "bg-orange-100 text-orange-800",
    closed_won: "bg-emerald-100 text-emerald-800",
    closed_lost: "bg-red-100 text-red-800",
  };

  const msgBubbleClass = (role: string) => {
    if (role === "rex") return "bg-blue-500 text-white";
    if (role === "randy") return "bg-orange-500 text-white";
    if (role === "system") return "bg-gray-100 text-gray-500 italic text-xs";
    return "bg-gray-200 text-gray-900";
  };

  const msgLabelColor = (role: string) => {
    if (role === "rex") return "text-blue-200";
    if (role === "randy") return "text-orange-200";
    return "text-gray-400";
  };

  const msgPacingBg = (role: string) => {
    if (role === "rex") return "bg-blue-600 text-blue-100";
    if (role === "randy") return "bg-orange-600 text-orange-100";
    return "bg-gray-200";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Test {agentName}</h1>
          <p className="text-sm text-gray-500">
            Chat with {agentName} as a homeowner. Real AI, real pacing, no SMS sent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Agent selector */}
          <div className="flex rounded-lg border overflow-hidden">
            <button
              className={`px-3 py-1 text-sm font-medium transition-colors ${
                selectedAgent === "rex"
                  ? "bg-blue-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => {
                setSelectedAgent("rex");
                resetChat();
              }}
            >
              Rex
            </button>
            <button
              className={`px-3 py-1 text-sm font-medium transition-colors ${
                selectedAgent === "randy"
                  ? "bg-orange-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => {
                setSelectedAgent("randy");
                resetChat();
              }}
            >
              Randy
            </button>
          </div>

          {tenants.length > 1 && (
            <select
              className="border rounded px-2 py-1 text-sm"
              value={selectedTenant}
              onChange={(e) => {
                setSelectedTenant(e.target.value);
                resetChat();
              }}
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.companyName}
                </option>
              ))}
            </select>
          )}
          {started && (
            <Button
              variant="outline"
              size="sm"
              onClick={resetChat}
              disabled={loading}
            >
              Reset
            </Button>
          )}
        </div>
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
                    {selectedAgent === "rex" ? (
                      <>
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
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setStarted(true);
                            simulate("re_engage", undefined, { touchNumber: 1 });
                          }}
                          disabled={loading || !selectedTenant}
                        >
                          30-day re-engage (SMS)
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setStarted(true);
                            simulate("re_engage", undefined, { touchNumber: 2 });
                          }}
                          disabled={loading || !selectedTenant}
                        >
                          Re-engage Touch 2 (Email)
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setStarted(true);
                            simulate("storm_event", undefined, {
                              stormInfo: "Severe hailstorm reported in St. Petersburg, FL area — widespread damage expected",
                            });
                          }}
                          disabled={loading || !selectedTenant}
                        >
                          Storm event
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${
                    msg.role === "rex" || msg.role === "randy"
                      ? "justify-end"
                      : msg.role === "system"
                      ? "justify-center"
                      : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${msgBubbleClass(msg.role)}`}
                  >
                    <p>{msg.content}</p>
                    <div
                      className={`text-xs mt-1 flex items-center gap-2 ${msgLabelColor(msg.role)}`}
                    >
                      <span>
                        {msg.role === "rex"
                          ? "Rex"
                          : msg.role === "randy"
                          ? "Randy"
                          : msg.role === "system"
                          ? ""
                          : "You (homeowner)"}
                      </span>
                      {msg.pacing && (
                        <span
                          className={`${msgPacingBg(msg.role)} px-1.5 py-0.5 rounded text-[10px] font-mono`}
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
                  <div
                    className={`${
                      selectedAgent === "randy"
                        ? "bg-orange-100 text-orange-600"
                        : "bg-blue-100 text-blue-600"
                    } rounded-lg px-3 py-2 text-sm italic`}
                  >
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
                  Start a conversation to see {agentName} work the lead.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {selectedAgent === "randy" ? "About Randy" : "How it works"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-gray-500 space-y-1">
              {selectedAgent === "randy" ? (
                <>
                  <p>
                    <strong>Randy</strong> is the Dead Lead Digger. He re-engages
                    cold leads that went silent.
                  </p>
                  <p>
                    3-touch sequence: SMS (Day 1) → Email (Day 3) → Final
                    attempt (Day 5). Any positive response gets handed to Rex
                    immediately.
                  </p>
                  <p>
                    Storm events trigger emergency outreach to the entire cold
                    lead list within 2 hours.
                  </p>
                </>
              ) : (
                <>
                  <p>This uses the real Rex conversation engine and Claude API.</p>
                  <p>
                    The pacing delay is calculated but <strong>skipped</strong> in
                    the UI for speed. The tag on each message shows what the delay
                    <em> would be</em> in production.
                  </p>
                  <p>No SMS is actually sent. GHL is not contacted.</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
