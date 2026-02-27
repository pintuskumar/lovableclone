"use client";

interface FileNode {
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
}

export interface SnapshotFile {
  path: string;
  content: string;
}

export interface SandboxCheckpoint {
  id: string;
  label: string;
  createdAt: number;
  prompt: string;
  files: SnapshotFile[];
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
}

interface CollectOptions {
  maxFiles?: number;
  maxBytes?: number;
}

interface RestoreOptions {
  concurrency?: number;
}

const CHECKPOINT_PREFIX = "lovable:sandbox-checkpoints:";
const MAX_CHECKPOINTS = 8;

function getCheckpointStorageKey(sandboxId: string) {
  return `${CHECKPOINT_PREFIX}${sandboxId}`;
}

function isSnapshotFile(value: unknown): value is SnapshotFile {
  if (!value || typeof value !== "object") return false;
  const typed = value as Record<string, unknown>;
  return typeof typed.path === "string" && typeof typed.content === "string";
}

function isSandboxCheckpoint(value: unknown): value is SandboxCheckpoint {
  if (!value || typeof value !== "object") return false;
  const typed = value as Record<string, unknown>;
  return (
    typeof typed.id === "string" &&
    typeof typed.label === "string" &&
    typeof typed.createdAt === "number" &&
    typeof typed.prompt === "string" &&
    Array.isArray(typed.files) &&
    typed.files.every(isSnapshotFile) &&
    typeof typed.fileCount === "number" &&
    typeof typed.totalBytes === "number" &&
    typeof typed.truncated === "boolean"
  );
}

function flattenFilePaths(nodes: FileNode[]): string[] {
  const paths: string[] = [];

  const visit = (node: FileNode) => {
    if (node.type === "file") {
      paths.push(node.path);
      return;
    }

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return paths.sort((a, b) => a.localeCompare(b));
}

export function loadSandboxCheckpoints(sandboxId: string): SandboxCheckpoint[] {
  if (!sandboxId || typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(getCheckpointStorageKey(sandboxId));
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isSandboxCheckpoint).slice(0, MAX_CHECKPOINTS);
  } catch (error) {
    console.warn("[Checkpoints] Failed to load checkpoints", error);
    return [];
  }
}

export function persistSandboxCheckpoints(
  sandboxId: string,
  checkpoints: SandboxCheckpoint[],
) {
  if (!sandboxId || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getCheckpointStorageKey(sandboxId),
      JSON.stringify(checkpoints.slice(0, MAX_CHECKPOINTS)),
    );
  } catch (error) {
    console.warn("[Checkpoints] Failed to persist checkpoints", error);
  }
}

export async function collectProjectFilesFromSandbox(
  sandboxId: string,
  fetchImpl: typeof fetch,
  options?: CollectOptions,
) {
  const maxFiles = options?.maxFiles ?? 120;
  const maxBytes = options?.maxBytes ?? 2_000_000;

  const listResponse = await fetchImpl(
    `/api/sandbox/${sandboxId}/files?list=1&depth=8`,
  );
  if (!listResponse.ok) {
    throw new Error("Failed to list project files for checkpoint");
  }

  const listData = (await listResponse.json()) as { files?: FileNode[] };
  const fileNodes = Array.isArray(listData.files) ? listData.files : [];
  const allPaths = flattenFilePaths(fileNodes);

  const targetPaths = allPaths.slice(0, maxFiles);
  const encoder = new TextEncoder();
  const files: SnapshotFile[] = [];
  let totalBytes = 0;
  let truncated = allPaths.length > targetPaths.length;

  for (const path of targetPaths) {
    const fileResponse = await fetchImpl(
      `/api/sandbox/${sandboxId}/files?path=${encodeURIComponent(path)}`,
    );
    if (!fileResponse.ok) {
      continue;
    }

    const fileData = (await fileResponse.json()) as { content?: string };
    const content = typeof fileData.content === "string" ? fileData.content : "";
    const fileBytes = encoder.encode(content).length;

    if (totalBytes + fileBytes > maxBytes) {
      truncated = true;
      break;
    }

    totalBytes += fileBytes;
    files.push({ path, content });
  }

  return {
    files,
    totalBytes,
    truncated,
    totalFiles: allPaths.length,
  };
}

async function withConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  if (items.length === 0) return;

  let index = 0;
  const safeLimit = Math.max(1, Math.min(limit, items.length));

  async function runWorker() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await worker(current);
    }
  }

  await Promise.all(Array.from({ length: safeLimit }, () => runWorker()));
}

export async function restoreProjectFilesToSandbox(
  sandboxId: string,
  files: SnapshotFile[],
  fetchImpl: typeof fetch,
  options?: RestoreOptions,
) {
  const failedPaths: string[] = [];
  const concurrency = options?.concurrency ?? 4;

  await withConcurrency(files, concurrency, async (file) => {
    const response = await fetchImpl(`/api/sandbox/${sandboxId}/files`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        path: file.path,
        content: file.content,
      }),
    });

    if (!response.ok) {
      failedPaths.push(file.path);
    }
  });

  return {
    failedPaths,
    restoredCount: files.length - failedPaths.length,
  };
}
