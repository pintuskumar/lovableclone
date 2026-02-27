import type { NextRequest } from "next/server";
import {
  COOKIE_NAME,
  type DecodedToken,
  getTokenFromHeader,
  verifyToken,
} from "@/lib/auth";

export const getAuthUser = (req: NextRequest): DecodedToken | null => {
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value;
  const headerToken = getTokenFromHeader(req.headers.get("authorization"));
  const token = cookieToken || headerToken;

  if (!token) return null;
  return verifyToken(token);
};
