import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function getSandboxIdFromPreviewReferer(request: NextRequest): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;

  let refererUrl: URL;
  try {
    refererUrl = new URL(referer);
  } catch {
    return null;
  }

  if (refererUrl.origin !== request.nextUrl.origin) {
    return null;
  }

  const match = refererUrl.pathname.match(
    /^\/preview\/([a-f0-9-]+)(?:\/.*)?$/i,
  );
  return match?.[1] || null;
}

export function middleware(request: NextRequest) {
  // Allow disabling proxy rewrite behavior from environment if needed.
  if (process.env.DAYTONA_PREVIEW_PROXY === "0") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/preview/")) {
    return NextResponse.next();
  }

  const sandboxId = getSandboxIdFromPreviewReferer(request);
  if (!sandboxId) {
    return NextResponse.next();
  }

  const rewritten = request.nextUrl.clone();
  rewritten.pathname = `/preview/${sandboxId}${pathname}`;

  return NextResponse.rewrite(rewritten);
}

export const config = {
  // Exclude Vercel internals; include _next, route paths, and API calls so preview apps work.
  matcher: ["/((?!_vercel).*)"],
};

