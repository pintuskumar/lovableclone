import { readFile } from "fs/promises";
import path from "path";

type ProgressCallback = (message: string) => Promise<void> | void;

interface GenerateWebsiteOptions {
  prompt: string;
  onProgress?: ProgressCallback;
}

interface GenerateWebsiteResult {
  sandboxId: string;
  previewUrl: string;
  previewToken?: string | null;
}

interface ProcessResult {
  exitCode?: number;
  result?: string;
}

const PROJECT_DIR_NAME = "website-project";

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function emitProgress(
  onProgress: ProgressCallback | undefined,
  message: string,
) {
  if (!onProgress) return;
  await onProgress(message);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function summarizeOutput(output: string, maxChars = 600) {
  const trimmed = output.trim();
  if (!trimmed) return "(no output)";
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}...`;
}

function isRetryableError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");
  const lower = message.toLowerCase();
  return (
    lower.includes("504") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("429") ||
    lower.includes("gateway") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("connection error") ||
    lower.includes("network error") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up") ||
    lower.includes("eai_again") ||
    lower.includes("enotfound") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset")
  );
}

async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  onProgress: ProgressCallback | undefined,
  maxRetries = 3,
  initialDelayMs = 2000,
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (!retryable || attempt === maxRetries) {
        throw error;
      }

      const delayMs = initialDelayMs * 2 ** (attempt - 1);
      await emitProgress(
        onProgress,
        `${operationName} failed (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(
          delayMs / 1000,
        )}s...`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Operation failed unexpectedly");
}

async function runCommandOrThrow(
  sandbox: any,
  command: string,
  cwd: string,
  env?: Record<string, string>,
  timeoutMs?: number,
) {
  const result: ProcessResult = await sandbox.process.executeCommand(
    command,
    cwd,
    env,
    timeoutMs,
  );

  if ((result.exitCode ?? 0) !== 0) {
    const summary = summarizeOutput(result.result || "");
    throw new Error(`Command failed: ${command}\n${summary}`);
  }

  return result;
}

export async function generateWebsiteInDaytona({
  prompt,
  onProgress,
}: GenerateWebsiteOptions): Promise<GenerateWebsiteResult> {
  const daytonaApiKey = process.env.DAYTONA_API_KEY;
  const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;

  if (!daytonaApiKey || !gatewayApiKey) {
    throw new Error("DAYTONA_API_KEY and AI_GATEWAY_API_KEY must be set");
  }

  await emitProgress(onProgress, "Creating new Daytona sandbox...");

  const { Daytona } = await import("@daytonaio/sdk");
  const daytona = new Daytona({ apiKey: daytonaApiKey });

  const sandbox = await withRetry(
    () =>
      daytona.create({
        public: true,
        image: "node:20",
      }),
    "Create sandbox",
    onProgress,
  );

  const sandboxId = sandbox.id;
  await emitProgress(onProgress, `Sandbox created: ${sandboxId}`);

  const rootDirValue = await sandbox.getUserRootDir();
  const rootDir = typeof rootDirValue === "string" ? rootDirValue : "";
  if (!rootDir) {
    throw new Error("Failed to resolve sandbox root directory");
  }
  const projectDir = path.posix.join(rootDir, PROJECT_DIR_NAME);

  await emitProgress(onProgress, `Working directory: ${projectDir}`);

  await withRetry(
    () => runCommandOrThrow(sandbox, `mkdir -p ${projectDir}`, rootDir),
    "Create project directory",
    onProgress,
  );

  await emitProgress(onProgress, "Initializing npm project...");
  await withRetry(
    () => runCommandOrThrow(sandbox, "npm init -y", projectDir),
    "Initialize npm project",
    onProgress,
  );

  await emitProgress(onProgress, "Installing OpenAI SDK...");
  await withRetry(
    () =>
      runCommandOrThrow(
        sandbox,
        "npm install openai",
        projectDir,
        undefined,
        180000,
      ),
    "Install OpenAI SDK",
    onProgress,
  );

  await emitProgress(onProgress, "Copying generation script...");
  const scriptPath = path.join(process.cwd(), "scripts", "sandbox-generate.js");
  const scriptContent = await readFile(scriptPath, "utf-8");
  const scriptBase64 = Buffer.from(scriptContent, "utf-8").toString("base64");

  await withRetry(
    () =>
      runCommandOrThrow(
        sandbox,
        `printf %s ${shellQuote(scriptBase64)} | base64 -d > generate.js`,
        projectDir,
      ),
    "Copy generation script",
    onProgress,
  );

  await emitProgress(onProgress, "Running Vercel AI Gateway generation...");
  const generationResult = await withRetry(
    () =>
      runCommandOrThrow(
        sandbox,
        "node generate.js",
        projectDir,
        {
          AI_GATEWAY_API_KEY: gatewayApiKey,
          DAYTONA_API_KEY: daytonaApiKey,
          ...(process.env.AI_GATEWAY_MODEL
            ? { AI_GATEWAY_MODEL: process.env.AI_GATEWAY_MODEL }
            : {}),
          ...(process.env.AI_GATEWAY_FALLBACK_MODELS
            ? { AI_GATEWAY_FALLBACK_MODELS: process.env.AI_GATEWAY_FALLBACK_MODELS }
            : {}),
          ...(process.env.AI_GATEWAY_GENERATION_RETRIES
            ? { AI_GATEWAY_GENERATION_RETRIES: process.env.AI_GATEWAY_GENERATION_RETRIES }
            : {}),
          ...(process.env.AI_GATEWAY_RETRY_BASE_DELAY_MS
            ? { AI_GATEWAY_RETRY_BASE_DELAY_MS: process.env.AI_GATEWAY_RETRY_BASE_DELAY_MS }
            : {}),
          USER_PROMPT: prompt,
          NODE_PATH: `${projectDir}/node_modules`,
        },
        600000,
      ),
    "Run Vercel AI Gateway generation",
    onProgress,
    3,
    5000,
  );

  await emitProgress(
    onProgress,
    `Generation output: ${summarizeOutput(generationResult.result || "", 400)}`,
  );

  const hasNextJs = await sandbox.process.executeCommand(
    "test -f package.json && grep -q next package.json && echo yes || echo no",
    projectDir,
  );

  if (hasNextJs.result?.trim() === "yes") {
    await emitProgress(onProgress, "Installing project dependencies...");
    await runCommandOrThrow(
      sandbox,
      "npm install",
      projectDir,
      undefined,
      300000,
    );
    await emitProgress(onProgress, "Dependencies installed");

    await emitProgress(onProgress, "Starting development server...");
    await runCommandOrThrow(
      sandbox,
      "nohup npm run dev > dev-server.log 2>&1 &",
      projectDir,
      {
        PORT: "3000",
        DAYTONA_API_KEY: daytonaApiKey,
        AI_GATEWAY_API_KEY: gatewayApiKey,
        ...(process.env.AI_GATEWAY_MODEL
          ? { AI_GATEWAY_MODEL: process.env.AI_GATEWAY_MODEL }
          : {}),
      },
    );

    await emitProgress(onProgress, "Waiting for server to start...");
    const maxRetries = 12;
    for (let i = 0; i < maxRetries; i += 1) {
      await sleep(5000);

      const checkServer = await sandbox.process.executeCommand(
        "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null || echo 'failed'",
        projectDir,
      );

      const statusCode = checkServer.result?.trim() || "unknown";
      await emitProgress(
        onProgress,
        `Server status check ${i + 1}/${maxRetries}: ${statusCode}`,
      );

      if (statusCode === "200" || statusCode === "304") {
        break;
      }
    }
  }

  await emitProgress(onProgress, "Getting preview URL...");
  const preview = await sandbox.getPreviewLink(3000);
  const preferredPreviewUrl =
    typeof preview.legacyProxyUrl === "string" && preview.legacyProxyUrl.trim()
      ? preview.legacyProxyUrl.trim()
      : preview.url;
  const previewToken =
    typeof preview.token === "string" && preview.token.trim()
      ? preview.token.trim()
      : null;

  await emitProgress(onProgress, `Preview URL: ${preferredPreviewUrl}`);

  return {
    sandboxId,
    previewUrl: preferredPreviewUrl,
    previewToken,
  };
}
