import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import {
  MAX_PROMPT_LENGTH,
  RATE_LIMIT_GENERATE_DAYTONA,
  RATE_LIMIT_WINDOW_MS,
  REQUIRE_AUTH_FOR_GENERATION,
} from "@/lib/server/config";
import { getAuthUser } from "@/lib/server/auth";
import { getClientIp, isAllowedOrigin } from "@/lib/server/request";
import { applyRateLimitHeaders, rateLimit } from "@/lib/server/rate-limit";

export async function POST(req: NextRequest) {
  try {
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
      !process.env.VERCEL_AI_GATEWAY_API_KEY
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Missing API keys (DAYTONA_API_KEY or VERCEL_AI_GATEWAY_API_KEY)",
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
        // Use the generate-in-daytona.ts script
        const scriptPath = path.join(
          process.cwd(),
          "scripts",
          "generate-in-daytona.ts",
        );

        // On Windows with shell:true, we need to properly quote paths with spaces
        // Escape any double quotes in the prompt to prevent injection
        const safePrompt = prompt.replace(/"/g, '\\"').replace(/\r?\n/g, " ");

        const child = spawn(
          "npx",
          ["tsx", `"${scriptPath}"`, `"${safePrompt}"`],
          {
            shell: true,
            env: {
              ...process.env,
              DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
              VERCEL_AI_GATEWAY_API_KEY: process.env.VERCEL_AI_GATEWAY_API_KEY,
            },
            cwd: process.cwd(),
          },
        );

        let sandboxId = "";
        let previewUrl = "";
        let buffer = "";

        // Capture stdout
        child.stdout.on("data", async (data) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;

            // Parse AI messages
            if (line.includes("__AI_MESSAGE__")) {
              const jsonStart =
                line.indexOf("__AI_MESSAGE__") + "__AI_MESSAGE__".length;
              try {
                const message = JSON.parse(line.substring(jsonStart).trim());
                await writer.write(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "ai_message",
                      content: message.content,
                    })}\n\n`,
                  ),
                );
              } catch (e) {
                // Ignore parse errors
              }
            }
            // Regular progress messages
            else {
              const output = line.trim();

              // Filter out internal logs
              if (
                output &&
                !output.includes("[AI]:") &&
                !output.includes("__")
              ) {
                // Send as progress
                await writer.write(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "progress",
                      message: output,
                    })}\n\n`,
                  ),
                );

                // Extract sandbox ID
                const sandboxMatch = output.match(
                  /Sandbox created: ([a-f0-9-]+)/,
                );
                if (sandboxMatch) {
                  sandboxId = sandboxMatch[1];
                }

                // Extract preview URL
                const previewMatch = output.match(
                  /Preview URL: (https:\/\/[^\s]+)/,
                );
                if (previewMatch) {
                  previewUrl = previewMatch[1];
                }
              }
            }
          }
        });

        // Capture stderr
        child.stderr.on("data", async (data) => {
          const error = data.toString();
          console.error("[Daytona Error]:", error);

          // Only send actual errors, not debug info
          if (error.includes("Error") || error.includes("Failed")) {
            await writer.write(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "error",
                  message: error.trim(),
                })}\n\n`,
              ),
            );
          }
        });

        // Wait for process to complete
        await new Promise((resolve, reject) => {
          child.on("exit", (code) => {
            if (code === 0) {
              resolve(code);
            } else {
              reject(new Error(`Process exited with code ${code}`));
            }
          });

          child.on("error", reject);
        });

        // Send completion with preview URL
        if (previewUrl) {
          await writer.write(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "complete",
                sandboxId,
                previewUrl,
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
