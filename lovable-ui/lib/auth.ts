import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production");
  }
  jwtSecret = "dev-secret-change-me";
  if (process.env.NODE_ENV !== "test") {
    console.warn("Warning: JWT_SECRET is not set. Using a dev-only secret.");
  }
}

const JWT_SECRET = jwtSecret;
const TOKEN_EXPIRY = "7d"; // Token expires in 7 days
const COOKIE_NAME = "auth_token";

export interface UserPayload {
  id: string;
  email: string;
  name?: string;
}

export interface DecodedToken extends UserPayload {
  iat: number;
  exp: number;
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(user: UserPayload): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * Verify and decode a JWT token
 */
export function verifyToken(token: string): DecodedToken | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as DecodedToken;
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Get the auth token from cookies (server-side)
 */
export async function getTokenFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME);
  return token?.value || null;
}

/**
 * Get the current user from the auth token (server-side)
 */
export async function getCurrentUser(): Promise<DecodedToken | null> {
  const token = await getTokenFromCookies();
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Set the auth token in cookies (for API routes)
 */
export function setTokenCookie(token: string): { name: string; value: string; options: object } {
  return {
    name: COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 60 * 60 * 24 * 7, // 7 days in seconds
      path: "/",
    },
  };
}

/**
 * Clear the auth token cookie
 */
export function clearTokenCookie(): { name: string; value: string; options: object } {
  return {
    name: COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 0,
      path: "/",
    },
  };
}

/**
 * Middleware helper to verify authentication from request headers
 */
export function getTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
}

export { COOKIE_NAME };
