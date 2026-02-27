import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
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
    const limitResult = rateLimit(`auth-register:${ip}`, {
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
        { error: "Too many attempts. Please try again later." },
        { status: 429, headers }
      );
    }

    let body: { name?: unknown; email?: unknown; password?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    // Validate input
    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    if (email.length > 254 || password.length > 128) {
      return NextResponse.json(
        { error: "Invalid input" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 },
      );
    }

    // Hash password
    const hashedPassword = await hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        name: name || null,
        email,
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    // Generate JWT token
    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name || undefined,
    });

    // Create response with user data
    const response = NextResponse.json(
      {
        message: "User created successfully",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );

    // Set the auth cookie
    const cookie = setTokenCookie(token);
    response.cookies.set(cookie.name, cookie.value, cookie.options as any);

    applyRateLimitHeaders(response.headers, limitResult);

    return response;
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 },
    );
  }
}
