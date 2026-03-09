import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center gap-6">
          <Link href="/admin" className="text-lg font-bold">
            Rex
          </Link>
          <Link
            href="/admin/conversations"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Conversations
          </Link>
          <Link
            href="/admin/tenants"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Clients
          </Link>
          <Link
            href="/admin/simulate"
            className="text-sm text-green-600 hover:text-green-800 font-medium"
          >
            Test Rex
          </Link>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
