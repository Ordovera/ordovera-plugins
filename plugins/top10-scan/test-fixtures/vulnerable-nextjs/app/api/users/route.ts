import { NextRequest, NextResponse } from "next/server";

// VULNERABILITY [A01]: No authentication check - any user can access this endpoint.
// VULNERABILITY [A01]: IDOR - user ID taken directly from query param without ownership verification.
export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("id");

  try {
    // VULNERABILITY [A05]: SQL string concatenation instead of parameterized query.
    const query = "SELECT * FROM users WHERE id = '" + userId + "'";

    // Simulated database call
    const db = { execute: async (q: string) => ({ rows: [{ id: userId, name: "Test User" }] }) };
    const result = await db.execute(query);

    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    // VULNERABILITY [A10]: Fail-open - returns 200 on error and leaks internal error details.
    return NextResponse.json(
      { status: "ok", debug: error.message, stack: error.stack },
      { status: 200 }
    );
  }
}
