import { NextRequest } from "next/server";
import {
  MAX_PROMPT_LENGTH,
  RATE_LIMIT_GENERATE_DAYTONA,
  RATE_LIMIT_WINDOW_MS,
  REQUIRE_AUTH_FOR_GENERATION,
} from "@/lib/server/config";
import { getAuthUser } from "@/lib/server/auth";
import { getClientIp, isAllowedOrigin } from "@/lib/server/request";
import { applyRateLimitHeaders, rateLimit } from "@/lib/server/rate-limit";
import { generateWebsiteInDaytona } from "@/lib/server/daytona/generate-website";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const gatewayApiKey =
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_AI_GATEWAY_API_KEY;

    if (!isAllowedOrigin(req)) {
      return new Response(JSON.stringify({ error: "Origin not allowed" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response(
        JSON.stringify({ error: "Content-Type must be application/json" }),
        { status: 415, headers: { "Content-Type": "application/json" } },
      );
    }

    const ip = getClientIp(req);
    const limitResult = rateLimit(`generate-daytona:${ip}`, {
      limit: RATE_LIMIT_GENERATE_DAYTONA,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (limitResult.limited) {
      const headers = new Headers({ "Content-Type": "application/json" });
      applyRateLimitHeaders(headers, limitResult);
      headers.set(
        "Retry-After",
        Math.ceil((limitResult.resetAt - Date.now()) / 1000).toString(),
      );
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { status: 429, headers },
      );
    }

    let body: { prompt?: unknown };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return new Response(
        JSON.stringify({
          error: `Prompt must be ${MAX_PROMPT_LENGTH} characters or less`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    if (REQUIRE_AUTH_FOR_GENERATION && !getAuthUser(req)) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }

    if (
      !process.env.DAYTONA_API_KEY ||
      !gatewayApiKey
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Missing API keys (DAYTONA_API_KEY and AI_GATEWAY_API_KEY or VERCEL_AI_GATEWAY_API_KEY)",
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    console.log("[API] Starting Daytona generation for prompt:", prompt);

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Start the async generation
    (async () => {
      try {
        let sandboxId = "";
        const generationResult = await generateWebsiteInDaytona({
          prompt,
          onProgress: async (message) => {
            const text = message.trim();
            if (!text) return;

            const sandboxMatch = text.match(/Sandbox created: ([a-f0-9-]+)/i);
            if (sandboxMatch?.[1]) {
              sandboxId = sandboxMatch[1];
            }

            await writer.write(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "progress",
                  message: text,
                })}\n\n`,
              ),
            );
          },
        });
        const previewUrl = generationResult.previewUrl;
        sandboxId = generationResult.sandboxId || sandboxId;
        const usePreviewProxy = process.env.DAYTONA_PREVIEW_PROXY === "1";
        const clientPreviewUrl =
          usePreviewProxy && sandboxId ? `/preview/${sandboxId}` : previewUrl;

        // Send completion with preview URL
        if (previewUrl) {
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "complete",
                sandboxId,
                previewUrl: clientPreviewUrl,
              })}\n\n`,
            ),
          );
          console.log(`[API] Generation complete. Preview URL: ${previewUrl}`);
        } else {
          throw new Error("Failed to get preview URL");
        }

        // Send done signal
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (error: any) {
        console.error("[API] Error during generation:", error);
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({
              type: "error",
              message: error.message,
            })}\n\n`,
          ),
        );
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } finally {
        await writer.close();
      }
    })();

    const headers = new Headers({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    applyRateLimitHeaders(headers, limitResult);

    return new Response(stream.readable, { headers });
  } catch (error: any) {
    console.error("[API] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
