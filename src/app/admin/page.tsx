import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Rex Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/admin/conversations">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="text-base">Conversations</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">
                View all active and past conversations Rex is handling.
              </p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/tenants">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="text-base">Clients</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500">
                Manage your roofing company clients and their connections.
              </p>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-green-600 font-medium">Rex is online</p>
            <p className="text-sm text-gray-500">Webhooks ready</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
