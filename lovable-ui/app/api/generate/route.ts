import { NextRequest } from "next/server";
import { streamGenerateCodeWithPerplexity } from "@/lib/perplexity";
import {
  MAX_PROMPT_LENGTH,
  RATE_LIMIT_GENERATE,
  RATE_LIMIT_WINDOW_MS,
  REQUIRE_AUTH_FOR_GENERATION,
} from "@/lib/server/config";
import { getAuthUser } from "@/lib/server/auth";
import { getClientIp, isAllowedOrigin } from "@/lib/server/request";
import { applyRateLimitHeaders, rateLimit } from "@/lib/server/rate-limit";

export async function POST(req: NextRequest) {
  try {
    if (!isAllowedOrigin(req)) {
      return new Response(
        JSON.stringify({ error: "Origin not allowed" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return new Response(
        JSON.stringify({ error: "Content-Type must be application/json" }),
        { status: 415, headers: { "Content-Type": "application/json" } }
      );
    }

    const ip = getClientIp(req);
    const limitResult = rateLimit(`generate:${ip}`, {
      limit: RATE_LIMIT_GENERATE,
      windowMs: RATE_LIMIT_WINDOW_MS,
    });

    if (limitResult.limited) {
      const headers = new Headers({ "Content-Type": "application/json" });
      applyRateLimitHeaders(headers, limitResult);
      headers.set(
        "Retry-After",
        Math.ceil((limitResult.resetAt - Date.now()) / 1000).toString()
      );
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { status: 429, headers }
      );
    }

    let body: { prompt?: unknown };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (prompt.length > MAX_PROMPT_LENGTH) {
      return new Response(
        JSON.stringify({
          error: `Prompt must be ${MAX_PROMPT_LENGTH} characters or less`,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (REQUIRE_AUTH_FOR_GENERATION && !getAuthUser(req)) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!process.env.VERCEL_AI_GATEWAY_API_KEY) {
      return new Response(
        JSON.stringify({ error: "VERCEL_AI_GATEWAY_API_KEY is not configured" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("[API] Starting code generation for prompt:", prompt);

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Start the async generation
    (async () => {
      try {
        let fullContent = "";

        for await (const chunk of streamGenerateCodeWithPerplexity(prompt)) {
          if (chunk.type === "text" && chunk.content) {
            fullContent += chunk.content;

            // Send text chunk to client
            await writer.write(
              encoder.encode(`data: ${JSON.stringify({
                type: "text",
                content: chunk.content
              })}\n\n`)
            );
          } else if (chunk.type === "complete") {
            // Send completion with full content
            await writer.write(
              encoder.encode(`data: ${JSON.stringify({
                type: "result",
                subtype: "success",
                content: fullContent
              })}\n\n`)
            );
            console.log("[API] Generation complete");
          } else if (chunk.type === "error") {
            await writer.write(
              encoder.encode(`data: ${JSON.stringify({
                type: "error",
                message: chunk.error
              })}\n\n`)
            );
          }
        }

        // Send done signal
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (error: any) {
        console.error("[API] Error during generation:", error);
        await writer.write(
          encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`)
        );
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
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
