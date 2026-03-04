import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREVIEW_PORT = 3000;
const PREVIEW_CACHE_TTL_MS = 15_000;

type PreviewCacheEntry = {
  url: string;
  token: string | null;
  expiresAt: number;
};

const previewCache = new Map<string, PreviewCacheEntry>();

function resolvePreviewUrl(baseUrl: string, pathSegments: string[] | undefined, search: string) {
  const upstream = new URL(baseUrl);
  const normalizedPath =
    Array.isArray(pathSegments) && pathSegments.length > 0
      ? `/${pathSegments.join("/")}`
      : "/";

  upstream.pathname = normalizedPath;
  upstream.search = search;
  return upstream;
}

function rewriteRedirectLocation(
  sandboxId: string,
  upstreamBaseUrl: string,
  upstreamUrl: URL,
  locationHeader: string | null,
) {
  if (!locationHeader) return null;

  try {
    const upstreamBase = new URL(upstreamBaseUrl);
    const resolved = new URL(locationHeader, upstreamUrl);

    if (resolved.origin !== upstreamBase.origin) {
      return locationHeader;
    }

    return `/preview/${sandboxId}${resolved.pathname}${resolved.search}`;
  } catch {
    return locationHeader;
  }
}

function createUpstreamHeaders(req: NextRequest, token: string | null) {
  const headers = new Headers();

  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "keep-alive" ||
      lower === "proxy-authenticate" ||
      lower === "proxy-authorization" ||
      lower === "te" ||
      lower === "trailers" ||
      lower === "transfer-encoding" ||
      lower === "upgrade"
    ) {
      return;
    }

    headers.set(key, value);
  });

  headers.set("X-Daytona-Skip-Preview-Warning", "true");
  if (token) {
    headers.set("X-Daytona-Preview-Token", token);
  }

  return headers;
}

async function getPreviewTarget(sandboxId: string): Promise<PreviewCacheEntry> {
  const now = Date.now();
  const cached = previewCache.get(sandboxId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) {
    throw new Error("DAYTONA_API_KEY is not configured");
  }

  const { Daytona } = await import("@daytonaio/sdk");
  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.get(sandboxId);
  const preview = await sandbox.getPreviewLink(PREVIEW_PORT);

  const preferredUrl =
    typeof preview.legacyProxyUrl === "string" && preview.legacyProxyUrl.trim()
      ? preview.legacyProxyUrl.trim()
      : preview.url;
  const token =
    typeof preview.token === "string" && preview.token.trim()
      ? preview.token.trim()
      : null;

  const entry: PreviewCacheEntry = {
    url: preferredUrl,
    token,
    expiresAt: now + PREVIEW_CACHE_TTL_MS,
  };

  previewCache.set(sandboxId, entry);
  return entry;
}

async function proxyPreviewRequest(
  req: NextRequest,
  { params }: { params: { sandboxId: string; path?: string[] } },
) {
  const sandboxId = params.sandboxId;
  if (!sandboxId) {
    return new Response("Missing sandbox id", { status: 400 });
  }

  let previewTarget: PreviewCacheEntry;
  try {
    previewTarget = await getPreviewTarget(sandboxId);
  } catch (error: any) {
    const message = error?.message || "Failed to resolve sandbox preview target";
    const status = message.toLowerCase().includes("not found") ? 404 : 500;
    return new Response(message, { status });
  }

  const upstreamUrl = resolvePreviewUrl(
    previewTarget.url,
    params.path,
    req.nextUrl.search,
  );
  const upstreamHeaders = createUpstreamHeaders(req, previewTarget.token);
  const method = req.method.toUpperCase();
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await req.arrayBuffer();

  const upstreamResponse = await fetch(upstreamUrl, {
    method,
    headers: upstreamHeaders,
    body,
    cache: "no-store",
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "connection" ||
      lower === "keep-alive" ||
      lower === "proxy-authenticate" ||
      lower === "proxy-authorization" ||
      lower === "te" ||
      lower === "trailers" ||
      lower === "transfer-encoding" ||
      lower === "upgrade"
    ) {
      return;
    }

    responseHeaders.append(key, value);
  });

  const rewrittenLocation = rewriteRedirectLocation(
    sandboxId,
    previewTarget.url,
    upstreamUrl,
    upstreamResponse.headers.get("location"),
  );
  if (rewrittenLocation) {
    responseHeaders.set("location", rewrittenLocation);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

export {
  proxyPreviewRequest as GET,
  proxyPreviewRequest as HEAD,
  proxyPreviewRequest as OPTIONS,
  proxyPreviewRequest as POST,
  proxyPreviewRequest as PUT,
  proxyPreviewRequest as PATCH,
  proxyPreviewRequest as DELETE,
};
