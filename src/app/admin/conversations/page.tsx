"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ConversationRow = {
  conversation: {
    id: string;
    channel: string;
    status: string;
    createdAt: string;
  };
  lead: {
    id: string;
    name: string | null;
    phone: string | null;
    status: string;
    issueType: string | null;
    address: string | null;
  };
  tenant: {
    companyName: string;
  };
};

type Message = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then(setConversations)
      .finally(() => setLoading(false));
  }, []);

  async function loadMessages(conversationId: string) {
    setSelectedId(conversationId);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });
    const msgs = await res.json();
    setMessages(msgs);
  }

  const statusColor: Record<string, string> = {
    new: "bg-blue-100 text-blue-800",
    qualifying: "bg-yellow-100 text-yellow-800",
    qualified: "bg-green-100 text-green-800",
    inspection_scheduled: "bg-purple-100 text-purple-800",
    estimate_sent: "bg-orange-100 text-orange-800",
    closed_won: "bg-emerald-100 text-emerald-800",
    closed_lost: "bg-red-100 text-red-800",
  };

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Conversations</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Conversation list */}
        <div className="lg:col-span-1 space-y-2 max-h-[70vh] overflow-y-auto">
          {conversations.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-gray-500">
                No conversations yet. Rex is waiting for leads.
              </CardContent>
            </Card>
          ) : (
            conversations.map((row) => (
              <Card
                key={row.conversation.id}
                className={`cursor-pointer transition-shadow hover:shadow-md ${
                  selectedId === row.conversation.id
                    ? "ring-2 ring-blue-500"
                    : ""
                }`}
                onClick={() => loadMessages(row.conversation.id)}
              >
                <CardContent className="py-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">
                      {row.lead.name || row.lead.phone || "Unknown"}
                    </span>
                    <Badge
                      className={
                        statusColor[row.lead.status] || "bg-gray-100"
                      }
                    >
                      {row.lead.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {row.tenant.companyName} &middot;{" "}
                    {new Date(row.conversation.createdAt).toLocaleDateString()}
                  </p>
                  {row.lead.issueType && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {row.lead.issueType}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Message thread */}
        <div className="lg:col-span-2">
          {selectedId ? (
            <Card className="h-[70vh] flex flex-col">
              <CardContent className="flex-1 overflow-y-auto py-4 space-y-3">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${
                      msg.role === "rex" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === "rex"
                          ? "bg-blue-500 text-white"
                          : msg.role === "system"
                          ? "bg-gray-200 text-gray-600 italic text-xs"
                          : "bg-gray-100 text-gray-900"
                      }`}
                    >
                      <p>{msg.content}</p>
                      <p
                        className={`text-xs mt-1 ${
                          msg.role === "rex"
                            ? "text-blue-200"
                            : "text-gray-400"
                        }`}
                      >
                        {msg.role === "rex" ? "Rex" : msg.role === "system" ? "System" : "Lead"}{" "}
                        &middot;{" "}
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <p className="text-center text-gray-400 py-8">
                    No messages in this conversation yet.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="h-[70vh] flex items-center justify-center">
              <p className="text-gray-400">
                Select a conversation to view the thread
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
