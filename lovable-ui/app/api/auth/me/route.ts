import { NextRequest, NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { getClientIp, isAllowedOrigin } from "@/lib/server/request";
import { applyRateLimitHeaders, rateLimit } from "@/lib/server/rate-limit";
import { RATE_LIMIT_AUTH, RATE_LIMIT_WINDOW_MS } from "@/lib/server/config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!isAllowedOrigin(req)) {
      return NextResponse.json(
        { error: "Origin not allowed" },
        { status: 403 }
      );
    }

    const ip = getClientIp(req);
    const limitResult = rateLimit(`auth-me:${ip}`, {
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

    const respond = (body: any, status: number) => {
      const response = NextResponse.json(body, {
        status,
        headers: { "Cache-Control": "no-store" },
      });
      applyRateLimitHeaders(response.headers, limitResult);
      return response;
    };

    // Get token from cookie
    const token = req.cookies.get(COOKIE_NAME)?.value;

    if (!token) {
      return respond({ error: "Not authenticated" }, 401);
    }

    // Verify token
    const decoded = verifyToken(token);

    if (!decoded) {
      return respond({ error: "Invalid or expired token" }, 401);
    }

    // Get fresh user data from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        createdAt: true,
      },
    });

    if (!user) {
      return respond({ error: "User not found" }, 404);
    }

    return respond(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          createdAt: user.createdAt,
        },
      },
      200
    );
  } catch (error: any) {
    console.error("Get current user error:", error);
    return NextResponse.json(
      { error: "An error occurred" },
      { status: 500 }
    );
  }
}
