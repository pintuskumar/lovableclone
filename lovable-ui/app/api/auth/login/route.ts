import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import prisma from "@/lib/prisma";
import { generateToken, setTokenCookie } from "@/lib/auth";
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

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 415 }
      );
    }

    const ip = getClientIp(req);
    const limitResult = rateLimit(`auth-login:${ip}`, {
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
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers }
      );
    }

    let body: { email?: unknown; password?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    if (email.length > 254 || password.length > 128) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 400 }
      );
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Verify password
    const isPasswordValid = await compare(password, user.password);

    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Generate JWT token
    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name || undefined,
    });

    // Create response with user data
    const response = NextResponse.json(
      {
        message: "Login successful",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );

    // Set the auth cookie
    const cookie = setTokenCookie(token);
    response.cookies.set(cookie.name, cookie.value, cookie.options as any);

    applyRateLimitHeaders(response.headers, limitResult);

    return response;
  } catch (error: any) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "An error occurred during login" },
      { status: 500 }
    );
  }
}
