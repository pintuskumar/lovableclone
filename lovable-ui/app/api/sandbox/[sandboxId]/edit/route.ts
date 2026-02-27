import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getAiClient } from "@/lib/perplexity";
import { getAuthUser } from "@/lib/server/auth";
import {
  MAX_PROMPT_LENGTH,
  RATE_LIMIT_SANDBOX_EDIT,
  RATE_LIMIT_WINDOW_MS,
  REQUIRE_AUTH_FOR_GENERATION,
} from "@/lib/server/config";
import { getClientIp, isAllowedOrigin } from "@/lib/server/request";
import { applyRateLimitHeaders, rateLimit } from "@/lib/server/rate-limit";

const DEFAULT_AI_GATEWAY_MODEL = "anthropic/claude-sonnet-4.5";
const MAX_CONTEXT_FILES = 14;
const MAX_CONTEXT_CHARS = 140_000;
const MAX_FILE_CHARS = 30_000;
const MAX_APPLY_EDITS = 20;
const DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 220;

type EditMode = "preview" | "apply";

interface AIEditFile {
  path: string;
  content: string;
}

interface AIEditCandidate {
  path?: unknown;
  content?: unknown;
  delete?: unknown;
}

interface AIEditResponse {
  summary?: string;
  edits?: AIEditCandidate[];
  notes?: string[];
}

type NormalizedEdit =
  | { path: string; delete: true }
  | { path: string; content: string; delete?: false };

interface FileEditPreview {
  path: string;
  additions: number;
  deletions: number;
  changed: boolean;
  isNewFile: boolean;
  isDeleted: boolean;
  diff: string;
}

function jsonError(message: string, status: number, headers?: Headers) {
  return NextResponse.json({ error: message }, { status, headers });
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeRelativeSandboxPath(input: string) {
  if (typeof input !== "string") {
    throw new Error("Path must be a string");
  }

  if (input.includes("\0")) {
    throw new Error("Path contains invalid characters");
  }

  const normalizedInput = input.replace(/\\/g, "/").trim();
  if (!normalizedInput) return "";
  if (normalizedInput.startsWith("/")) {
    throw new Error("Absolute paths are not allowed");
  }

  const normalized = path.posix.normalize(normalizedInput).replace(/^\.\/+/, "");

  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Path traversal is not allowed");
  }

  return normalized === "." ? "" : normalized;
}

function resolveProjectPath(projectDir: string, relativePath: string) {
  const root = path.posix.normalize(projectDir);
  const fullPath = relativePath
    ? path.posix.normalize(path.posix.join(root, relativePath))
    : root;

  if (fullPath !== root && !fullPath.startsWith(`${root}/`)) {
    throw new Error("Resolved path is outside project root");
  }

  return fullPath;
}

function filePriority(filePath: string) {
  if (filePath === "app/page.tsx") return 0;
  if (filePath === "app/layout.tsx") return 1;
  if (filePath === "app/globals.css") return 2;
  if (filePath.startsWith("components/")) return 3;
  if (filePath.startsWith("app/")) return 4;
  if (filePath.startsWith("lib/")) return 5;
  return 8;
}

function looksBinary(content: string) {
  return content.includes("\u0000");
}

function extractJsonObject(raw: string) {
  try {
    return JSON.parse(raw) as AIEditResponse;
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Model response was not valid JSON");
    }
    const candidate = raw.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate) as AIEditResponse;
  }
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n");
}

function trimDiffLines(lines: string[]) {
  if (lines.length <= MAX_DIFF_LINES) return lines;

  const keepStart = Math.floor(MAX_DIFF_LINES * 0.6);
  const keepEnd = MAX_DIFF_LINES - keepStart - 1;

  return [
    ...lines.slice(0, keepStart),
    "... diff truncated ...",
    ...lines.slice(Math.max(lines.length - keepEnd, keepStart)),
  ];
}

function createUnifiedDiff(filePath: string, previousContent: string, nextContent: string) {
  const beforeLines = normalizeLineEndings(previousContent).split("\n");
  const afterLines = normalizeLineEndings(nextContent).split("\n");

  if (previousContent === nextContent) {
    return {
      changed: false,
      additions: 0,
      deletions: 0,
      diff: `--- a/${filePath}\n+++ b/${filePath}\n(No changes)`,
    };
  }

  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= start &&
    afterEnd >= start &&
    beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const removed = beforeEnd >= start ? beforeLines.slice(start, beforeEnd + 1) : [];
  const added = afterEnd >= start ? afterLines.slice(start, afterEnd + 1) : [];

  const preStart = Math.max(0, start - DIFF_CONTEXT_LINES);
  const preContext = beforeLines.slice(preStart, start);
  const postContext = beforeLines.slice(
    Math.max(beforeEnd + 1, start),
    Math.max(beforeEnd + 1, start) + DIFF_CONTEXT_LINES,
  );

  const hunkOldStart = preStart + 1;
  const hunkNewStart = preStart + 1;
  const hunkOldCount = preContext.length + removed.length + postContext.length;
  const hunkNewCount = preContext.length + added.length + postContext.length;

  const diffLines = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${hunkOldStart},${hunkOldCount} +${hunkNewStart},${hunkNewCount} @@`,
    ...preContext.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...postContext.map((line) => ` ${line}`),
  ];

  return {
    changed: true,
    additions: added.length,
    deletions: removed.length,
    diff: trimDiffLines(diffLines).join("\n"),
  };
}

function createDeletedFileDiff(filePath: string, previousContent: string) {
  const beforeLines = normalizeLineEndings(previousContent).split("\n");
  const diffLines = [
    `--- a/${filePath}`,
    "+++ /dev/null",
    `@@ -1,${beforeLines.length} +0,0 @@`,
    ...beforeLines.map((line) => `-${line}`),
  ];

  return {
    changed: true,
    additions: 0,
    deletions: beforeLines.length,
    diff: trimDiffLines(diffLines).join("\n"),
  };
}

function normalizeCandidateEdits(
  candidateEdits: AIEditCandidate[],
) {
  const normalizedEdits: NormalizedEdit[] = [];
  const seenPaths = new Set<string>();

  for (const edit of candidateEdits) {
    if (normalizedEdits.length >= MAX_APPLY_EDITS) break;

    const rawPath = typeof edit.path === "string" ? edit.path : "";
    const hasStringContent = typeof edit.content === "string";
    const isDelete = edit.delete === true;
    if (!rawPath || (!hasStringContent && !isDelete)) continue;

    let normalizedPath = "";
    try {
      normalizedPath = normalizeRelativeSandboxPath(rawPath);
    } catch {
      continue;
    }

    if (!normalizedPath || seenPaths.has(normalizedPath)) continue;

    seenPaths.add(normalizedPath);
    if (isDelete) {
      normalizedEdits.push({
        path: normalizedPath,
        delete: true,
      });
    } else {
      normalizedEdits.push({
        path: normalizedPath,
        content: edit.content as string,
      });
    }
  }

  return normalizedEdits;
}

async function getDaytonaSdk() {
  const { Daytona } = await import("@daytonaio/sdk");
  return Daytona;
}

async function createDaytonaClient() {
  if (!process.env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY not configured");
  }

  const Daytona = await getDaytonaSdk();
  return new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
  });
}

async function getSandboxById(daytona: any, sandboxId: string) {
  const sandboxes = await daytona.list();
  return sandboxes.find((sandbox: any) => sandbox.id === sandboxId) || null;
}

async function listProjectFiles(sandbox: any, projectDir: string) {
  const result = await sandbox.process.executeCommand(
    "find . -type f -not -path './node_modules/*' -not -path './.next/*' -not -path './.git/*' -not -path './.vercel/*' | sed 's|^./||'",
    projectDir,
  );

  if (result.exitCode !== 0 || !result.result) {
    return [] as string[];
  }

  return result.result
    .split("\n")
    .map((line: string) => line.trim())
    .filter(Boolean)
    .sort((a: string, b: string) => {
      const priorityDiff = filePriority(a) - filePriority(b);
      if (priorityDiff !== 0) return priorityDiff;
      return a.localeCompare(b);
    });
}

async function readProjectFile(
  sandbox: any,
  projectDir: string,
  filePath: string,
): Promise<string | null> {
  const fullPath = resolveProjectPath(projectDir, filePath);
  const result = await sandbox.process.executeCommand(
    `cat ${shellQuote(fullPath)} 2>/dev/null`,
    projectDir,
  );

  if (result.exitCode !== 0) {
    return null;
  }

  return result.result || "";
}

async function writeProjectFile(
  sandbox: any,
  projectDir: string,
  filePath: string,
  content: string,
) {
  const fullPath = resolveProjectPath(projectDir, filePath);
  const dirPath = path.posix.dirname(filePath);

  if (dirPath && dirPath !== ".") {
    const fullDirPath = resolveProjectPath(projectDir, dirPath);
    await sandbox.process.executeCommand(
      `mkdir -p ${shellQuote(fullDirPath)}`,
      projectDir,
    );
  }

  const base64Content = Buffer.from(content, "utf-8").toString("base64");
  const result = await sandbox.process.executeCommand(
    `printf %s ${shellQuote(base64Content)} | base64 -d > ${shellQuote(fullPath)}`,
    projectDir,
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to write ${filePath}`);
  }
}

async function deleteProjectFile(sandbox: any, projectDir: string, filePath: string) {
  const fullPath = resolveProjectPath(projectDir, filePath);
  const result = await sandbox.process.executeCommand(
    `if [ -d ${shellQuote(fullPath)} ]; then exit 3; fi; rm -f -- ${shellQuote(fullPath)}`,
    projectDir,
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to delete ${filePath}`);
  }
}

function uniquePaths(input: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawPath of input) {
    try {
      const normalized = normalizeRelativeSandboxPath(rawPath);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      result.push(normalized);
    } catch {
      // ignore invalid paths from input
    }
  }

  return result;
}

async function generateEditsFromModel(
  instruction: string,
  contextFiles: AIEditFile[],
) {
  const model = process.env.AI_GATEWAY_MODEL || DEFAULT_AI_GATEWAY_MODEL;
  const aiClient = getAiClient();

  const aiResponse = await aiClient.chat.completions.create({
    model,
    temperature: 0.2,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content:
          "You are an expert Next.js 14 + TypeScript refactoring assistant.\n" +
          "You receive project files and an edit instruction.\n" +
          "Return STRICT JSON only, no markdown fences:\n" +
          '{"summary":"short summary","edits":[{"path":"relative/path.ext","content":"full file content"}],"notes":["optional note"]}\n' +
          "Rules:\n" +
          "- Update existing files when possible.\n" +
          "- Keep framework/tooling compatibility with Next.js 14 App Router and Tailwind.\n" +
          '- For file deletions, emit {"path":"relative/path.ext","delete":true}.\n' +
          "- Output complete content for each non-deleted edited file.\n" +
          "- Do not include explanations outside JSON.\n",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            instruction,
            files: contextFiles,
          },
          null,
          2,
        ),
      },
    ],
  });

  const rawContent = aiResponse.choices[0]?.message?.content || "";
  const parsed = extractJsonObject(rawContent);
  const candidateEdits = Array.isArray(parsed.edits) ? parsed.edits : [];
  const normalizedEdits = normalizeCandidateEdits(candidateEdits);

  return {
    parsed,
    normalizedEdits,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { sandboxId: string } },
) {
  if (!isAllowedOrigin(req)) {
    return jsonError("Origin not allowed", 403);
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return jsonError("Content-Type must be application/json", 415);
  }

  const ip = getClientIp(req);
  const limitResult = rateLimit(`sandbox-edit:${ip}`, {
    limit: RATE_LIMIT_SANDBOX_EDIT,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  if (limitResult.limited) {
    const headers = new Headers({ "Content-Type": "application/json" });
    applyRateLimitHeaders(headers, limitResult);
    headers.set(
      "Retry-After",
      Math.ceil((limitResult.resetAt - Date.now()) / 1000).toString(),
    );
    return jsonError(
      "Too many edit requests. Please try again later.",
      429,
      headers,
    );
  }

  if (REQUIRE_AUTH_FOR_GENERATION && !getAuthUser(req)) {
    return jsonError("Authentication required", 401);
  }

  if (!process.env.DAYTONA_API_KEY || !process.env.VERCEL_AI_GATEWAY_API_KEY) {
    return jsonError(
      "Missing API keys (DAYTONA_API_KEY or VERCEL_AI_GATEWAY_API_KEY)",
      500,
    );
  }

  let body: {
    instruction?: unknown;
    filePaths?: unknown;
    mode?: unknown;
    proposedEdits?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const instruction =
    typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction) {
    return jsonError("Instruction is required", 400);
  }

  if (instruction.length > MAX_PROMPT_LENGTH) {
    return jsonError(
      `Instruction must be ${MAX_PROMPT_LENGTH} characters or less`,
      400,
    );
  }

  const mode: EditMode = body.mode === "preview" ? "preview" : "apply";
  const sandboxId = params.sandboxId;
  const requestedPaths = Array.isArray(body.filePaths)
    ? body.filePaths.filter((value): value is string => typeof value === "string")
    : [];

  const proposedEditsInput = Array.isArray(body.proposedEdits)
    ? (body.proposedEdits as AIEditCandidate[])
    : [];

  const headers = new Headers({ "Content-Type": "application/json" });
  applyRateLimitHeaders(headers, limitResult);

  try {
    const daytona = await createDaytonaClient();
    const sandbox = await getSandboxById(daytona, sandboxId);

    if (!sandbox) {
      return jsonError("Sandbox not found", 404, headers);
    }

    const rootDir = await sandbox.getUserRootDir();
    const projectDir = path.posix.join(rootDir, "website-project");

    let summary = "";
    let notes: string[] = [];
    let contextFilePaths: string[] = [];

    let normalizedEdits: NormalizedEdit[] = [];

    if (mode === "apply" && proposedEditsInput.length > 0) {
      normalizedEdits = normalizeCandidateEdits(proposedEditsInput);
      summary = `Applying ${normalizedEdits.length} prepared edit${normalizedEdits.length === 1 ? "" : "s"}`;
    } else {
      const allFiles = await listProjectFiles(sandbox, projectDir);
      const selectedPaths = uniquePaths(
        requestedPaths.length > 0 ? requestedPaths : allFiles,
      ).slice(0, MAX_CONTEXT_FILES);

      if (selectedPaths.length === 0) {
        return jsonError("No project files available for edit context", 422, headers);
      }

      const contextFiles: AIEditFile[] = [];
      let contextChars = 0;

      for (const filePath of selectedPaths) {
        const content = await readProjectFile(sandbox, projectDir, filePath);
        if (content === null || looksBinary(content)) continue;

        const boundedContent =
          content.length > MAX_FILE_CHARS
            ? `${content.slice(0, MAX_FILE_CHARS)}\n/* truncated */`
            : content;

        if (contextChars + boundedContent.length > MAX_CONTEXT_CHARS) {
          break;
        }

        contextChars += boundedContent.length;
        contextFiles.push({ path: filePath, content: boundedContent });
      }

      if (contextFiles.length === 0) {
        return jsonError("No readable text files available for edit context", 422, headers);
      }

      const modelResult = await generateEditsFromModel(instruction, contextFiles);
      normalizedEdits = modelResult.normalizedEdits;
      summary = typeof modelResult.parsed.summary === "string" ? modelResult.parsed.summary : "";
      notes = Array.isArray(modelResult.parsed.notes)
        ? modelResult.parsed.notes.slice(0, 5)
        : [];
      contextFilePaths = contextFiles.map((file) => file.path);
    }

    if (normalizedEdits.length === 0) {
      return jsonError("Model did not return any applicable file edits", 422, headers);
    }

    const previews: FileEditPreview[] = [];
    const effectiveEdits: NormalizedEdit[] = [];

    for (const edit of normalizedEdits) {
      const previousContentOrNull = await readProjectFile(
        sandbox,
        projectDir,
        edit.path,
      );
      const previousContent = previousContentOrNull ?? "";
      const isDelete = edit.delete === true;

      if (isDelete && previousContentOrNull === null) {
        continue;
      }

      const isNewFile = previousContentOrNull === null && !isDelete;
      const diffInfo = isDelete
        ? createDeletedFileDiff(edit.path, previousContent)
        : createUnifiedDiff(edit.path, previousContent, edit.content);

      previews.push({
        path: edit.path,
        additions: diffInfo.additions,
        deletions: diffInfo.deletions,
        changed: diffInfo.changed || isNewFile,
        isNewFile,
        isDeleted: isDelete,
        diff: diffInfo.diff,
      });

      if (isDelete || diffInfo.changed || isNewFile) {
        effectiveEdits.push(edit);
      }
    }

    if (effectiveEdits.length === 0) {
      return jsonError("No file changes detected from instruction", 422, headers);
    }

    if (mode === "preview") {
      return NextResponse.json(
        {
          success: true,
          mode: "preview",
          summary:
            summary ||
            `Prepared ${effectiveEdits.length} change${effectiveEdits.length === 1 ? "" : "s"}`,
          notes,
          proposedEdits: effectiveEdits,
          previews,
          contextFiles: contextFilePaths,
        },
        { headers },
      );
    }

    const applied: string[] = [];
    const failed: Array<{ path: string; reason: string }> = [];

    for (const edit of effectiveEdits) {
      try {
        if (edit.delete) {
          await deleteProjectFile(sandbox, projectDir, edit.path);
        } else {
          await writeProjectFile(sandbox, projectDir, edit.path, edit.content);
        }
        applied.push(edit.path);
      } catch (error: any) {
        failed.push({
          path: edit.path,
          reason: error?.message || "apply failed",
        });
      }
    }

    if (applied.length === 0) {
      return jsonError("No edits were applied", 500, headers);
    }

    return NextResponse.json(
      {
        success: true,
        mode: "apply",
        summary:
          summary ||
          `Applied ${applied.length} file edit${applied.length === 1 ? "" : "s"}`,
        notes,
        applied,
        failed,
        previews,
        contextFiles: contextFilePaths,
      },
      { headers },
    );
  } catch (error: any) {
    console.error("Error applying sandbox edit:", error);
    return jsonError(error?.message || "Failed to apply sandbox edit", 500, headers);
  }
}
