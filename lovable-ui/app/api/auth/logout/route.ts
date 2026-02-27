import { NextRequest, NextResponse } from "next/server";
import { clearTokenCookie } from "@/lib/auth";
import { getClientIp, isAllowedOrigin } from "@/lib/server/request";
import { applyRateLimitHeaders, rateLimit } from "@/lib/server/rate-limit";
import { RATE_LIMIT_AUTH, RATE_LIMIT_WINDOW_MS } from "@/lib/server/config";

export async function POST(req: NextRequest) {
  try {
    if (!isAllowedOrigin(req)) {
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403 }
      );
    }

    const ip = getClientIp(req);
    const limitResult = rateLimit(`auth-logout:${ip}`, {
      limit: RATE_LIMIT_AUTH,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (limitResult.limited) {
      const headers = new Headers();
      applyRateLimitHeaders(headers, limitResult);
      headers.set(
        "Retry-After",
        Math.ceil((limitResult.resetAt - Date.now()) / 1000).toString()
      );
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers }
      );
    }

    const response = NextResponse.json(
      { message: "Logged out successfully" },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );

    // Clear the auth cookie
    const cookie = clearTokenCookie();
    response.cookies.set(cookie.name, cookie.value, cookie.options as any);

    applyRateLimitHeaders(response.headers, limitResult);

    return response;
  } catch (error: any) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "An error occurred during logout" },
      { status: 500 }
    );
  }
}
