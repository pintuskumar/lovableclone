import path from "path";
import { NextRequest, NextResponse } from "next/server";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  isLoaded?: boolean;
}

const PROJECT_DIR_NAME = "website-project";
const DEFAULT_TREE_DEPTH = 5;
const MAX_TREE_DEPTH = 8;

function parseBooleanParam(value: string | null, fallback = false) {
  if (value === null) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function parseDepthParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), MAX_TREE_DEPTH);
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
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

function parseFileList(
  output: string,
  basePath: string,
  includeHidden: boolean,
  foldersLoaded: boolean,
): FileNode[] {
  const lines = output.trim().split("\n").filter(Boolean);
  const nodes: FileNode[] = [];

  for (const line of lines) {
    if (
      !includeHidden &&
      (line.startsWith(".") || line === "node_modules" || line === ".next" || line === ".git")
    ) {
      continue;
    }

    const isDirectory = line.endsWith("/");
    const name = isDirectory ? line.slice(0, -1) : line;
    const nodePath = basePath ? `${basePath}/${name}` : name;

    nodes.push({
      name,
      path: nodePath,
      type: isDirectory ? "folder" : "file",
      children: isDirectory && foldersLoaded ? [] : undefined,
      isLoaded: isDirectory ? foldersLoaded : undefined,
    });
  }

  return nodes;
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

async function getSandboxContext(sandboxId: string) {
  const daytona = await createDaytonaClient();
  const sandbox = await getSandboxById(daytona, sandboxId);
  if (!sandbox) {
    return null;
  }

  const rootDir = await sandbox.getUserRootDir();
  const projectDir = path.posix.join(rootDir, PROJECT_DIR_NAME);

  return { daytona, sandbox, rootDir, projectDir };
}

async function listDirectory(
  sandbox: any,
  cwd: string,
  fullPath: string,
): Promise<string> {
  const result = await sandbox.process.executeCommand(
    `ls -F ${shellQuote(fullPath)} 2>/dev/null`,
    cwd,
  );
  return result.result || "";
}

async function getFilesRecursively(
  sandbox: any,
  projectDir: string,
  currentPath: string,
  remainingDepth: number,
  includeHidden: boolean,
): Promise<FileNode[]> {
  const fullPath = resolveProjectPath(projectDir, currentPath);

  try {
    const output = await listDirectory(sandbox, projectDir, fullPath);
    const shouldLoadChildren = remainingDepth > 0;
    const nodes = parseFileList(
      output,
      currentPath,
      includeHidden,
      shouldLoadChildren,
    );

    if (!shouldLoadChildren) {
      return nodes;
    }

    for (const node of nodes) {
      if (node.type === "folder") {
        node.children = await getFilesRecursively(
          sandbox,
          projectDir,
          node.path,
          remainingDepth - 1,
          includeHidden,
        );
        node.isLoaded = true;
      }
    }

    return nodes;
  } catch (error) {
    console.error(`Error listing files at ${fullPath}:`, error);
    return [];
  }
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { sandboxId: string } },
) {
  try {
    const { sandboxId } = params;
    const searchParams = req.nextUrl.searchParams;
    const filePathParam = searchParams.get("path");
    const listMode =
      searchParams.get("list") === "1" || searchParams.get("mode") === "list";
    const includeHidden = parseBooleanParam(
      searchParams.get("includeHidden"),
      false,
    );
    const depth = parseDepthParam(
      searchParams.get("depth"),
      listMode ? 0 : DEFAULT_TREE_DEPTH,
    );

    const sandboxContext = await getSandboxContext(sandboxId);
    if (!sandboxContext) {
      return jsonError("Sandbox not found", 404);
    }

    const { sandbox, projectDir } = sandboxContext;

    if (listMode) {
      const folderPath = filePathParam
        ? normalizeRelativeSandboxPath(filePathParam)
        : "";

      const files = await getFilesRecursively(
        sandbox,
        projectDir,
        folderPath,
        depth,
        includeHidden,
      );

      return NextResponse.json({
        files,
        path: folderPath,
        depth,
        includeHidden,
      });
    }

    if (filePathParam) {
      const filePath = normalizeRelativeSandboxPath(filePathParam);
      if (!filePath) {
        return jsonError("Path is required", 400);
      }

      const fullPath = resolveProjectPath(projectDir, filePath);
      const result = await sandbox.process.executeCommand(
        `cat ${shellQuote(fullPath)} 2>/dev/null`,
        projectDir,
      );

      if (result.exitCode !== 0) {
        return jsonError("File not found", 404);
      }

      return NextResponse.json({
        path: filePath,
        content: result.result || "",
      });
    }

    const files = await getFilesRecursively(
      sandbox,
      projectDir,
      "",
      DEFAULT_TREE_DEPTH,
      includeHidden,
    );

    return NextResponse.json({ files });
  } catch (error: any) {
    console.error("Error accessing sandbox files:", error);
    return jsonError(error.message || "Failed to access sandbox files", 500);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { sandboxId: string } },
) {
  try {
    const { sandboxId } = params;
    const body = await req.json();
    const filePathParam = body?.path;
    const content = body?.content;

    if (typeof filePathParam !== "string" || typeof content !== "string") {
      return jsonError("Path and string content are required", 400);
    }

    const filePath = normalizeRelativeSandboxPath(filePathParam);
    if (!filePath) {
      return jsonError("Path is required", 400);
    }

    const sandboxContext = await getSandboxContext(sandboxId);
    if (!sandboxContext) {
      return jsonError("Sandbox not found", 404);
    }

    const { sandbox, projectDir } = sandboxContext;
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
      throw new Error("Failed to write file");
    }

    return NextResponse.json({
      success: true,
      path: filePath,
    });
  } catch (error: any) {
    if (
      error.message?.includes("Path traversal") ||
      error.message?.includes("Absolute paths") ||
      error.message?.includes("outside project root") ||
      error.message?.includes("invalid characters")
    ) {
      return jsonError(error.message, 400);
    }

    console.error("Error writing to sandbox file:", error);
    return jsonError(error.message || "Failed to write file", 500);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { sandboxId: string } },
) {
  try {
    const { sandboxId } = params;
    const searchParams = req.nextUrl.searchParams;
    const filePathParam = searchParams.get("path");

    if (!filePathParam) {
      return jsonError("Path is required", 400);
    }

    const filePath = normalizeRelativeSandboxPath(filePathParam);
    if (!filePath) {
      return jsonError("Deleting project root is not allowed", 400);
    }

    const sandboxContext = await getSandboxContext(sandboxId);
    if (!sandboxContext) {
      return jsonError("Sandbox not found", 404);
    }

    const { sandbox, projectDir } = sandboxContext;
    const fullPath = resolveProjectPath(projectDir, filePath);

    const result = await sandbox.process.executeCommand(
      `rm -rf -- ${shellQuote(fullPath)}`,
      projectDir,
    );

    if (result.exitCode !== 0) {
      throw new Error("Failed to delete file");
    }

    return NextResponse.json({
      success: true,
      path: filePath,
    });
  } catch (error: any) {
    if (
      error.message?.includes("Path traversal") ||
      error.message?.includes("Absolute paths") ||
      error.message?.includes("outside project root") ||
      error.message?.includes("invalid characters")
    ) {
      return jsonError(error.message, 400);
    }

    console.error("Error deleting sandbox file:", error);
    return jsonError(error.message || "Failed to delete file", 500);
  }
}
