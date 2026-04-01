import { NextRequest, NextResponse } from "next/server";

// VULNERABILITY [A01]: No authentication middleware - admin endpoint is publicly accessible.
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name") || "";

  // VULNERABILITY [A05]: User input interpolated directly into HTML without sanitization (XSS).
  const html = `
    <html>
      <body>
        <h1>Admin Panel</h1>
        <div>${name}</div>
        <p>Welcome to the admin dashboard.</p>
      </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  // VULNERABILITY [A01]: No authorization check - anyone can modify admin settings.
  return NextResponse.json({ updated: true, settings: body });
}
