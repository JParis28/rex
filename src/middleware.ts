import { NextRequest, NextResponse } from "next/server";

/**
 * Protects /admin routes with a simple password gate.
 * Set ADMIN_SECRET in your environment variables.
 * Login by visiting /admin?secret=your-password (sets a cookie).
 * Or pass it as a header: Authorization: Bearer your-password
 */
export function middleware(req: NextRequest) {
  // Only protect /admin routes
  if (!req.nextUrl.pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    // No secret configured — allow access (dev mode)
    return NextResponse.next();
  }

  // Check cookie first (persistent login)
  const cookieAuth = req.cookies.get("rex_admin_auth")?.value;
  if (cookieAuth === secret) {
    return NextResponse.next();
  }

  // Check query param (one-time login that sets cookie)
  const querySecret = req.nextUrl.searchParams.get("secret");
  if (querySecret === secret) {
    // Set auth cookie and redirect to clean URL
    const cleanUrl = new URL(req.nextUrl.pathname, req.url);
    const response = NextResponse.redirect(cleanUrl);
    response.cookies.set("rex_admin_auth", secret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return response;
  }

  // Check Authorization header (for API access)
  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) {
    return NextResponse.next();
  }

  // Not authenticated — show a simple login page
  return new NextResponse(
    `<!DOCTYPE html>
<html>
<head><title>Rex — Login</title>
<style>
  body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f9fafb; }
  .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 2rem; width: 320px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
  p { color: #6b7280; font-size: 0.875rem; margin: 0 0 1.5rem; }
  input { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 8px; font-size: 0.875rem; box-sizing: border-box; }
  button { width: 100%; padding: 0.5rem; background: #111; color: white; border: none; border-radius: 8px; font-size: 0.875rem; cursor: pointer; margin-top: 0.75rem; }
  button:hover { background: #333; }
</style>
</head>
<body>
<div class="card">
  <h1>Rex Dashboard</h1>
  <p>Enter your admin password to continue.</p>
  <form onsubmit="window.location.href=window.location.pathname+'?secret='+document.getElementById('pw').value;return false;">
    <input id="pw" type="password" placeholder="Password" autofocus />
    <button type="submit">Log in</button>
  </form>
</div>
</body>
</html>`,
    {
      status: 401,
      headers: { "Content-Type": "text/html" },
    }
  );
}

export const config = {
  matcher: ["/admin/:path*"],
};
