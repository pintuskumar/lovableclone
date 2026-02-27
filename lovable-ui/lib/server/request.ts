import type { NextRequest } from "next/server";
import { APP_URL, IS_PROD } from "./config";

export const getClientIp = (req: NextRequest): string => {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  const realIp =
    req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip");
  return realIp || "unknown";
};

const getAllowedOrigins = () => {
  const allowed = new Set<string>();

  if (APP_URL) {
    allowed.add(APP_URL);
  }

  if (!IS_PROD) {
    allowed.add("http://localhost:3000");
    allowed.add("http://127.0.0.1:3000");
  }

  return allowed;
};

export const isAllowedOrigin = (req: NextRequest) => {
  const origin = req.headers.get("origin");
  if (!origin) return true;

  const allowed = getAllowedOrigins();
  return allowed.has(origin);
};
