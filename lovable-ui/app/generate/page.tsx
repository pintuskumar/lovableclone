"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Navbar from "@/components/Navbar";
import FileExplorer, { FileNode } from "@/components/FileExplorer";
import { FileTab, getLanguageFromPath } from "@/components/CodeEditor";
import {
  type GenerationMessage,
  type GenerationStage,
  useGenerationSession,
} from "@/hooks/useGenerationSession";
import {
  type SandboxCheckpoint,
  collectProjectFilesFromSandbox,
  loadSandboxCheckpoints,
  persistSandboxCheckpoints,
  restoreProjectFilesToSandbox,
} from "@/lib/client/sandbox-checkpoints";

const CodeEditor = dynamic(() => import("@/components/CodeEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-[#0d0d0d]">
      <div className="flex items-center gap-2 text-gray-400">
        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        Loading editor...
      </div>
    </div>
  ),
});

type ViewMode = "preview" | "code";

const REFINE_SUGGESTIONS = [
  "Make the design feel more premium with stronger hierarchy and whitespace.",
  "Add smooth section reveal animations and hover interactions.",
  "Improve mobile navigation and make CTA buttons more prominent.",
  "Add trust sections: testimonials, logos, and FAQ.",
];

const STAGE_ORDER: GenerationStage[] = [
  "queued",
  "creating_sandbox",
  "generating_code",
  "installing_deps",
  "starting_preview",
  "ready",
];

const STAGE_LABELS: Record<GenerationStage, string> = {
  queued: "Queued",
  creating_sandbox: "Creating sandbox",
  generating_code: "Generating code",
  installing_deps: "Installing deps",
  starting_preview: "Starting preview",
  ready: "Ready",
};

interface ProposedFileEdit {
  path: string;
  content?: string;
  delete?: boolean;
}

interface EditPreviewItem {
  path: string;
  additions: number;
  deletions: number;
  changed: boolean;
  isNewFile: boolean;
  isDeleted: boolean;
  diff: string;
}

interface PendingEditPlan {
  instruction: string;
  summary: string;
  notes: string[];
  previews: EditPreviewItem[];
  proposedEdits: ProposedFileEdit[];
}

function updateFolderChildren(
  nodes: FileNode[],
  folderPath: string,
  children: FileNode[],
): FileNode[] {
  return nodes.map((node) => {
    if (node.path === folderPath && node.type === "folder") {
      return { ...node, children, isLoaded: true };
    }

    if (node.type === "folder" && node.children) {
      return {
        ...node,
        children: updateFolderChildren(node.children, folderPath, children),
      };
    }

    return node;
  });
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

  return paths;
}

function inferTimelineStatus(
  currentStage: GenerationStage,
  lifecycle: string,
  step: GenerationStage,
) {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  const stepIndex = STAGE_ORDER.indexOf(step);

  if (lifecycle === "failed") {
    if (stepIndex < currentIndex) return "done";
    if (stepIndex === currentIndex) return "error";
    return "pending";
  }

  if (lifecycle === "canceled") {
    if (stepIndex < currentIndex) return "done";
    if (stepIndex === currentIndex) return "canceled";
    return "pending";
  }

  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

function getQuickOpenResults(paths: string[], query: string) {
  const trimmedQuery = query.trim().toLowerCase();
  const filtered = trimmedQuery
    ? paths.filter((filePath) => {
        const fileName = filePath.split("/").pop()?.toLowerCase() || "";
        const normalizedPath = filePath.toLowerCase();
        return (
          fileName.includes(trimmedQuery) || normalizedPath.includes(trimmedQuery)
        );
      })
    : paths;

  return [...filtered]
    .sort((a, b) => {
      if (!trimmedQuery) {
        return a.localeCompare(b);
      }

      const aName = a.split("/").pop()?.toLowerCase() || "";
      const bName = b.split("/").pop()?.toLowerCase() || "";
      const aPath = a.toLowerCase();
      const bPath = b.toLowerCase();

      const aScore =
        (aName.startsWith(trimmedQuery) ? 0 : 2) +
        (aPath.includes(`/${trimmedQuery}`) ? 0 : 1);
      const bScore =
        (bName.startsWith(trimmedQuery) ? 0 : 2) +
        (bPath.includes(`/${trimmedQuery}`) ? 0 : 1);

      if (aScore !== bScore) {
        return aScore - bScore;
      }

      return a.localeCompare(b);
    })
    .slice(0, 40);
}

function GeneratePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialPrompt = searchParams.get("prompt") || "";

  const generation = useGenerationSession();
  const hasStartedRef = useRef(false);
  const lastSandboxIdRef = useRef<string | null>(null);
  const refineInputRef = useRef<HTMLInputElement | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const quickOpenInputRef = useRef<HTMLInputElement | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [showMobileExplorer, setShowMobileExplorer] = useState(false);
  const [showTechnicalLogs, setShowTechnicalLogs] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showEditPreview, setShowEditPreview] = useState(false);
  const [activePrompt, setActivePrompt] = useState(initialPrompt);
  const [refinePrompt, setRefinePrompt] = useState("");
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenPaths, setQuickOpenPaths] = useState<string[]>([]);
  const [selectedQuickOpenPath, setSelectedQuickOpenPath] = useState<string | null>(
    null,
  );
  const [runHistory, setRunHistory] = useState<string[]>([]);
  const [checkpoints, setCheckpoints] = useState<SandboxCheckpoint[]>([]);
  const [lastApplyCheckpointId, setLastApplyCheckpointId] = useState<string | null>(
    null,
  );
  const [isCreatingCheckpoint, setIsCreatingCheckpoint] = useState(false);
  const [restoringCheckpointId, setRestoringCheckpointId] = useState<string | null>(null);
  const [checkpointNotice, setCheckpointNotice] = useState<string | null>(null);
  const [isPreparingEditPreview, setIsPreparingEditPreview] = useState(false);
  const [isApplyingEdit, setIsApplyingEdit] = useState(false);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const [pendingEditPlan, setPendingEditPlan] = useState<PendingEditPlan | null>(
    null,
  );
  const [selectedPreviewPath, setSelectedPreviewPath] = useState<string | null>(
    null,
  );
  const [selectedEditPaths, setSelectedEditPaths] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const [previewFrameKey, setPreviewFrameKey] = useState(0);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewLoadError, setPreviewLoadError] = useState<string | null>(null);

  const [files, setFiles] = useState<FileNode[]>([]);
  const [openTabs, setOpenTabs] = useState<FileTab[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isLoadingQuickOpen, setIsLoadingQuickOpen] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dirtyTabsCount = openTabs.filter((tab) => tab.isDirty).length;
  const hasUnsavedChanges = dirtyTabsCount > 0;
  const openTabsCount = openTabs.length;

  const aiMessages = generation.messages.filter((message) => message.type !== "progress");
  const progressMessages = generation.messages.filter((message) => message.type === "progress");
  const selectedEditPreview =
    pendingEditPlan?.previews.find((preview) => preview.path === selectedPreviewPath) ||
    pendingEditPlan?.previews[0] ||
    null;
  const selectedEditCount = selectedEditPaths.length;
  const lastApplyCheckpoint = lastApplyCheckpointId
    ? checkpoints.find((checkpoint) => checkpoint.id === lastApplyCheckpointId) || null
    : null;
  const quickOpenResults = getQuickOpenResults(quickOpenPaths, quickOpenQuery);

  const resetWorkspaceState = () => {
    setFiles([]);
    setOpenTabs([]);
    setActiveFile(null);
    setPreviewLoadError(null);
    setIsPreviewLoading(false);
    setPreviewFrameKey((prev) => prev + 1);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [generation.messages, generation.error]);

  useEffect(() => {
    if (!initialPrompt) {
      router.push("/");
      return;
    }

    if (hasStartedRef.current) return;
    hasStartedRef.current = true;
    setActivePrompt(initialPrompt);
    setRunHistory([initialPrompt]);

    resetWorkspaceState();
    void generation.start(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt, router]);

  useEffect(() => {
    if (generation.previewUrl) {
      setIsPreviewLoading(true);
      setPreviewLoadError(null);
      setPreviewFrameKey((prev) => prev + 1);
    }
  }, [generation.previewUrl]);

  useEffect(() => {
    if (generation.sandboxId !== lastSandboxIdRef.current) {
      lastSandboxIdRef.current = generation.sandboxId;
      setFiles([]);
      setOpenTabs([]);
      setActiveFile(null);
      setShowMobileExplorer(false);
      setShowQuickOpen(false);
      setPendingEditPlan(null);
      setShowEditPreview(false);
      setSelectedPreviewPath(null);
      setQuickOpenQuery("");
      setQuickOpenPaths([]);
      setSelectedQuickOpenPath(null);
      setLastApplyCheckpointId(null);
    }
  }, [generation.sandboxId]);

  useEffect(() => {
    if (!generation.sandboxId) {
      setCheckpoints([]);
      return;
    }
    setCheckpoints(loadSandboxCheckpoints(generation.sandboxId));
  }, [generation.sandboxId]);

  useEffect(() => {
    if (viewMode !== "code") {
      setShowMobileExplorer(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if (generation.sandboxId && viewMode === "code" && files.length === 0) {
      void loadFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation.sandboxId, viewMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowQuickActions((prev) => !prev);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (!generation.sandboxId) return;
        void openQuickOpen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [generation.sandboxId]);

  useEffect(() => {
    if (!showQuickActions) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowQuickActions(false);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showQuickActions]);

  useEffect(() => {
    if (!showQuickOpen) return;

    quickOpenInputRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowQuickOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showQuickOpen]);

  useEffect(() => {
    if (!checkpointNotice) return;
    const timeout = window.setTimeout(() => setCheckpointNotice(null), 2500);
    return () => window.clearTimeout(timeout);
  }, [checkpointNotice]);

  useEffect(() => {
    if (!editNotice) return;
    const timeout = window.setTimeout(() => setEditNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [editNotice]);

  useEffect(() => {
    if (!pendingEditPlan || pendingEditPlan.previews.length === 0) {
      setSelectedPreviewPath(null);
      setSelectedEditPaths([]);
      return;
    }

    setSelectedPreviewPath(pendingEditPlan.previews[0].path);
    setSelectedEditPaths(pendingEditPlan.previews.map((preview) => preview.path));
  }, [pendingEditPlan]);

  useEffect(() => {
    if (!showQuickOpen) return;

    const nextResults = getQuickOpenResults(quickOpenPaths, quickOpenQuery);

    if (nextResults.length === 0) {
      if (selectedQuickOpenPath !== null) {
        setSelectedQuickOpenPath(null);
      }
      return;
    }

    if (
      !selectedQuickOpenPath ||
      !nextResults.includes(selectedQuickOpenPath)
    ) {
      setSelectedQuickOpenPath(nextResults[0]);
    }
  }, [showQuickOpen, quickOpenPaths, quickOpenQuery, selectedQuickOpenPath]);

  useEffect(() => {
    if (!showEditPreview) return;

    previewPanelRef.current?.focus();

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowEditPreview(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [showEditPreview]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  const loadFiles = async () => {
    if (!generation.sandboxId) return;

    setIsLoadingFiles(true);
    try {
      const response = await fetch(
        `/api/sandbox/${generation.sandboxId}/files?list=1&depth=0`,
      );
      if (!response.ok) {
        throw new Error("Failed to load files");
      }
      const data = await response.json();
      setFiles(data.files || []);
    } catch (err) {
      console.error("Error loading files:", err);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const loadFolderChildren = async (path: string) => {
    if (!generation.sandboxId) return;

    try {
      const response = await fetch(
        `/api/sandbox/${generation.sandboxId}/files?list=1&depth=0&path=${encodeURIComponent(path)}`,
      );
      if (!response.ok) {
        throw new Error("Failed to load folder");
      }
      const data = await response.json();
      setFiles((prev) => updateFolderChildren(prev, path, data.files || []));
    } catch (err) {
      console.error("Error loading folder:", err);
    }
  };

  const loadFileContent = async (path: string) => {
    if (!generation.sandboxId) return;

    const existingTab = openTabs.find((tab) => tab.path === path);
    if (existingTab) {
      setActiveFile(path);
      return;
    }

    try {
      const response = await fetch(
        `/api/sandbox/${generation.sandboxId}/files?path=${encodeURIComponent(path)}`,
      );
      if (!response.ok) {
        throw new Error("Failed to load file");
      }
      const data = await response.json();
      const newTab: FileTab = {
        path,
        content: data.content || "",
        language: getLanguageFromPath(path),
        isDirty: false,
      };
      setOpenTabs((prev) => [...prev, newTab]);
      setActiveFile(path);
    } catch (err) {
      console.error("Error loading file:", err);
    }
  };

  const handleFileChange = (path: string, content: string) => {
    setOpenTabs((prev) =>
      prev.map((tab) =>
        tab.path === path ? { ...tab, content, isDirty: true } : tab,
      ),
    );
  };

  const handleFileSave = async (path: string) => {
    if (!generation.sandboxId) return;

    const tab = openTabs.find((t) => t.path === path);
    if (!tab) return;

    try {
      const response = await fetch(`/api/sandbox/${generation.sandboxId}/files`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content: tab.content }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save file");
      }

      setOpenTabs((prev) =>
        prev.map((t) => (t.path === path ? { ...t, isDirty: false } : t)),
      );
    } catch (err) {
      console.error("Error saving file:", err);
    }
  };

  const handleSaveAll = async () => {
    const dirtyPaths = openTabs.filter((tab) => tab.isDirty).map((tab) => tab.path);
    if (dirtyPaths.length === 0) return;

    setIsSavingAll(true);
    try {
      for (const path of dirtyPaths) {
        await handleFileSave(path);
      }
    } finally {
      setIsSavingAll(false);
    }
  };

  const handleFileClose = (path: string) => {
    setOpenTabs((prev) => {
      const remaining = prev.filter((t) => t.path !== path);
      if (activeFile === path) {
        setActiveFile(remaining.length > 0 ? remaining[0].path : null);
      }
      return remaining;
    });
  };

  const handleFileSelect = (path: string) => {
    void loadFileContent(path);
    setShowMobileExplorer(false);
  };

  const openQuickOpen = async () => {
    if (!generation.sandboxId || isLoadingQuickOpen) return;

    setShowQuickActions(false);
    setShowQuickOpen(true);
    setQuickOpenQuery("");
    setIsLoadingQuickOpen(true);

    try {
      const response = await fetch(
        `/api/sandbox/${generation.sandboxId}/files?list=1&depth=8`,
      );
      if (!response.ok) {
        throw new Error("Failed to load project files");
      }

      const data = await response.json();
      const allPaths = flattenFilePaths(
        Array.isArray(data.files) ? data.files : [],
      ).sort((a, b) => a.localeCompare(b));

      setQuickOpenPaths(allPaths);
      setSelectedQuickOpenPath(allPaths[0] || null);
    } catch (error: any) {
      console.error("Failed to open file switcher:", error);
      setEditNotice(error?.message || "Failed to load project files");
      setShowQuickOpen(false);
    } finally {
      setIsLoadingQuickOpen(false);
    }
  };

  const handleOpenQuickOpenPath = (path: string) => {
    if (!path) return;
    setViewMode("code");
    setShowMobileExplorer(false);
    setShowQuickOpen(false);
    setQuickOpenQuery("");
    void loadFileContent(path);
  };

  const moveQuickOpenSelection = (direction: 1 | -1) => {
    if (quickOpenResults.length === 0) return;

    const currentIndex = selectedQuickOpenPath
      ? quickOpenResults.indexOf(selectedQuickOpenPath)
      : -1;
    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + direction + quickOpenResults.length) %
          quickOpenResults.length;

    setSelectedQuickOpenPath(quickOpenResults[nextIndex]);
  };

  const formatToolInput = (input: unknown) => {
    if (!input || typeof input !== "object") return "";
    const typedInput = input as Record<string, unknown>;

    if (typeof typedInput.file_path === "string") {
      return `File: ${typedInput.file_path}`;
    }
    if (typeof typedInput.command === "string") {
      return `Command: ${typedInput.command}`;
    }
    if (typeof typedInput.pattern === "string") {
      return `Pattern: ${typedInput.pattern}`;
    }
    if (typeof typedInput.prompt === "string") {
      return `Prompt: ${typedInput.prompt.substring(0, 100)}...`;
    }

    const keys = Object.keys(typedInput);
    if (keys.length > 0) {
      const firstKey = keys[0];
      const value = typedInput[firstKey];
      if (typeof value === "string" && value.length > 100) {
        return `${firstKey}: ${value.substring(0, 100)}...`;
      }
      return `${firstKey}: ${String(value)}`;
    }

    return JSON.stringify(typedInput).substring(0, 100) + "...";
  };

  const stageLabel = STAGE_LABELS[generation.stage];

  const handleRetry = async () => {
    setPendingEditPlan(null);
    setShowEditPreview(false);
    resetWorkspaceState();
    await generation.retry();
  };

  const handleCancel = () => {
    generation.cancel();
  };

  const handleReloadPreview = () => {
    if (!generation.previewUrl) return;
    setPreviewLoadError(null);
    setIsPreviewLoading(true);
    setPreviewFrameKey((prev) => prev + 1);
  };

  const handleReconnect = async () => {
    if (!generation.sandboxId) return;
    await loadFiles();
    if (generation.previewUrl) {
      handleReloadPreview();
    }
  };

  const handleCopySandboxId = async () => {
    if (!generation.sandboxId) return;
    try {
      await navigator.clipboard.writeText(generation.sandboxId);
      setCopyStatus("copied");
      setTimeout(() => setCopyStatus("idle"), 1500);
    } catch {
      setCopyStatus("failed");
      setTimeout(() => setCopyStatus("idle"), 1500);
    }
  };

  const runPrompt = async (nextPrompt: string) => {
    const trimmed = nextPrompt.trim();
    if (!trimmed || generation.isBusy) return;

    setActivePrompt(trimmed);
    setRefinePrompt("");
    setPendingEditPlan(null);
    setShowEditPreview(false);
    setRunHistory((prev) => [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 6));
    setShowQuickActions(false);
    resetWorkspaceState();
    await generation.start(trimmed);
    router.replace(`/generate?prompt=${encodeURIComponent(trimmed)}`);
  };

  const handleRefineSubmit = async () => {
    await runPrompt(refinePrompt || activePrompt);
  };

  const createCheckpointSnapshot = async (options?: {
    labelPrefix?: string;
    showNotice?: boolean;
    prompt?: string;
    ensureSaved?: boolean;
  }) => {
    if (!generation.sandboxId) {
      throw new Error("Sandbox not ready");
    }

    if (options?.ensureSaved !== false && hasUnsavedChanges) {
      await handleSaveAll();
    }

    const snapshot = await collectProjectFilesFromSandbox(
      generation.sandboxId,
      fetch,
      {
        maxFiles: 120,
        maxBytes: 2_000_000,
      },
    );

    if (snapshot.files.length === 0) {
      throw new Error("No files available for checkpoint");
    }

    const now = Date.now();
    const baseLabel = new Date(now).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const label = options?.labelPrefix
      ? `${options.labelPrefix} ${baseLabel}`
      : baseLabel;

    const checkpoint: SandboxCheckpoint = {
      id: `checkpoint-${now}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      createdAt: now,
      prompt: options?.prompt ?? activePrompt,
      files: snapshot.files,
      fileCount: snapshot.files.length,
      totalBytes: snapshot.totalBytes,
      truncated: snapshot.truncated,
    };

    setCheckpoints((prev) => {
      const next = [checkpoint, ...prev].slice(0, 8);
      persistSandboxCheckpoints(generation.sandboxId!, next);
      return next;
    });

    if (options?.showNotice !== false) {
      setCheckpointNotice(
        checkpoint.truncated
          ? `Saved version ${label} (truncated for size limits)`
          : `Saved version ${label}`,
      );
    }

    return checkpoint;
  };

  const handleCreateCheckpoint = async () => {
    if (!generation.sandboxId || generation.isBusy || isCreatingCheckpoint) return;

    setIsCreatingCheckpoint(true);
    try {
      await createCheckpointSnapshot();
    } catch (error: any) {
      console.error("Failed to create checkpoint:", error);
      setCheckpointNotice(error?.message || "Failed to create version checkpoint");
    } finally {
      setIsCreatingCheckpoint(false);
    }
  };

  const restoreCheckpoint = async (
    checkpoint: SandboxCheckpoint,
    options?: {
      skipConfirm?: boolean;
      successMessage?: string;
    },
  ) => {
    if (!generation.sandboxId || generation.isBusy) return false;

    if (!options?.skipConfirm) {
      const confirmed = window.confirm(
        `Restore version "${checkpoint.label}"? This will overwrite matching files in the sandbox.`,
      );
      if (!confirmed) return false;
    }

    setRestoringCheckpointId(checkpoint.id);
    try {
      if (hasUnsavedChanges) {
        await handleSaveAll();
      }

      const result = await restoreProjectFilesToSandbox(
        generation.sandboxId,
        checkpoint.files,
        fetch,
        { concurrency: 4 },
      );

      if (result.failedPaths.length > 0) {
        throw new Error(
          `Restored ${result.restoredCount}/${checkpoint.files.length} files`,
        );
      }

      setActivePrompt(checkpoint.prompt || activePrompt);
      setRefinePrompt(checkpoint.prompt || "");
      setOpenTabs([]);
      setActiveFile(null);
      await loadFiles();
      if (generation.previewUrl) {
        handleReloadPreview();
      }

      setCheckpointNotice(options?.successMessage || `Restored version ${checkpoint.label}`);
      setLastApplyCheckpointId(null);
      return true;
    } catch (error: any) {
      console.error("Failed to restore checkpoint:", error);
      setCheckpointNotice(error?.message || "Failed to restore version");
      return false;
    } finally {
      setRestoringCheckpointId(null);
    }
  };

  const handleRestoreCheckpoint = async (checkpoint: SandboxCheckpoint) => {
    await restoreCheckpoint(checkpoint);
  };

  const handleUndoLastApply = async () => {
    if (!lastApplyCheckpoint) {
      setEditNotice("No recent apply backup available");
      return;
    }

    const confirmed = window.confirm(
      `Undo last apply by restoring "${lastApplyCheckpoint.label}"?`,
    );
    if (!confirmed) return;

    const restored = await restoreCheckpoint(lastApplyCheckpoint, {
      skipConfirm: true,
      successMessage: `Undid last apply using ${lastApplyCheckpoint.label}`,
    });

    if (restored) {
      setPendingEditPlan(null);
      setShowEditPreview(false);
      setEditNotice("Restored previous state from backup");
    }
  };

  const getEditContextPaths = () => {
    const preferred = [
      "app/page.tsx",
      "app/layout.tsx",
      "app/globals.css",
      "components/Navbar.tsx",
    ];
    const fromTabs = openTabs.map((tab) => tab.path);
    const fromTree = flattenFilePaths(files);

    const merged = [...fromTabs, ...preferred, ...fromTree];
    const unique = Array.from(
      new Set(
        merged
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
    return unique.slice(0, 14);
  };

  const handleApplyEdit = async () => {
    const instruction = (refinePrompt || activePrompt).trim();
    if (
      !instruction ||
      generation.isBusy ||
      isPreparingEditPreview ||
      isApplyingEdit
    ) {
      return;
    }

    if (!generation.sandboxId) {
      await runPrompt(instruction);
      return;
    }

    setIsPreparingEditPreview(true);
    setEditNotice(null);
    setPendingEditPlan(null);
    setShowQuickActions(false);

    try {
      if (hasUnsavedChanges) {
        await handleSaveAll();
      }

      const response = await fetch(
        `/api/sandbox/${generation.sandboxId}/edit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            instruction,
            filePaths: getEditContextPaths(),
            mode: "preview",
          }),
        },
      );

      const payload = await response
        .json()
        .catch(() => ({ error: "Invalid server response" }));

      if (!response.ok) {
        throw new Error(payload.error || "Failed to prepare edit preview");
      }

      const proposedEdits = Array.isArray(payload.proposedEdits)
        ? payload.proposedEdits
            .filter(
              (edit: unknown): edit is ProposedFileEdit =>
                Boolean(edit) &&
                typeof (edit as ProposedFileEdit).path === "string" &&
                (typeof (edit as ProposedFileEdit).content === "string" ||
                  (edit as ProposedFileEdit).delete === true),
            )
            .map((edit: ProposedFileEdit) => ({
              path: edit.path,
              ...(typeof edit.content === "string" ? { content: edit.content } : {}),
              ...(edit.delete === true ? { delete: true } : {}),
            }))
        : [];

      const previews = Array.isArray(payload.previews)
        ? payload.previews
            .filter(
              (preview: unknown): preview is EditPreviewItem =>
                Boolean(preview) &&
                typeof (preview as EditPreviewItem).path === "string" &&
                typeof (preview as EditPreviewItem).diff === "string",
            )
            .map((preview: EditPreviewItem) => ({
              ...preview,
              additions:
                typeof preview.additions === "number" ? preview.additions : 0,
              deletions:
                typeof preview.deletions === "number" ? preview.deletions : 0,
              changed: preview.changed !== false,
              isNewFile: preview.isNewFile === true,
              isDeleted: preview.isDeleted === true,
            }))
        : [];

      if (proposedEdits.length === 0 || previews.length === 0) {
        throw new Error("No editable changes were proposed");
      }

      setPendingEditPlan({
        instruction,
        summary:
          typeof payload.summary === "string" && payload.summary.trim()
            ? payload.summary.trim()
            : `Prepared ${proposedEdits.length} change${proposedEdits.length === 1 ? "" : "s"}`,
        notes: Array.isArray(payload.notes)
          ? payload.notes.filter((note: unknown): note is string => typeof note === "string").slice(0, 5)
          : [],
        previews,
        proposedEdits,
      });

      setShowEditPreview(true);

      const changedCount = previews.filter(
        (preview: EditPreviewItem) => preview.changed,
      ).length;
      setEditNotice(
        `Prepared ${changedCount} file change${changedCount === 1 ? "" : "s"} for review`,
      );
    } catch (error: any) {
      console.error("Failed to prepare in-place edit:", error);
      setEditNotice(error?.message || "Failed to prepare edit preview");
    } finally {
      setIsPreparingEditPreview(false);
    }
  };

  const isEditPathSelected = (path: string) => selectedEditPaths.includes(path);

  const toggleEditPathSelection = (path: string) => {
    setSelectedEditPaths((prev) => {
      if (prev.includes(path)) {
        return prev.filter((item) => item !== path);
      }
      return [...prev, path];
    });
  };

  const handleSelectAllEdits = () => {
    if (!pendingEditPlan) return;
    setSelectedEditPaths(pendingEditPlan.previews.map((preview) => preview.path));
  };

  const handleClearSelectedEdits = () => {
    setSelectedEditPaths([]);
  };

  const handleApplyPreparedEdits = async () => {
    if (!pendingEditPlan || !generation.sandboxId || generation.isBusy || isApplyingEdit) {
      return;
    }

    const selectedPathSet = new Set(selectedEditPaths);
    const selectedProposedEdits = pendingEditPlan.proposedEdits.filter((edit) =>
      selectedPathSet.has(edit.path),
    );

    if (selectedProposedEdits.length === 0) {
      setEditNotice("Select at least one file in the preview to apply edits");
      return;
    }

    const selectedDeleteCount = selectedProposedEdits.filter(
      (edit) => edit.delete === true,
    ).length;
    if (selectedDeleteCount > 0) {
      const confirmed = window.confirm(
        `Apply selected edits and delete ${selectedDeleteCount} file${
          selectedDeleteCount === 1 ? "" : "s"
        }?`,
      );
      if (!confirmed) {
        return;
      }
    }

    setIsApplyingEdit(true);
    setEditNotice(null);

    try {
      if (hasUnsavedChanges) {
        await handleSaveAll();
      }

      const backupCheckpoint = await createCheckpointSnapshot({
        labelPrefix: "Before apply",
        showNotice: false,
        prompt: pendingEditPlan.instruction,
        ensureSaved: false,
      });
      setLastApplyCheckpointId(backupCheckpoint.id);

      const response = await fetch(`/api/sandbox/${generation.sandboxId}/edit`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instruction: pendingEditPlan.instruction,
          mode: "apply",
          proposedEdits: selectedProposedEdits,
        }),
      });

      const payload = await response
        .json()
        .catch(() => ({ error: "Invalid server response" }));

      if (!response.ok) {
        throw new Error(payload.error || "Failed to apply prepared edits");
      }

      const appliedCount = Array.isArray(payload.applied)
        ? payload.applied.length
        : selectedProposedEdits.length;
      const failedCount = Array.isArray(payload.failed)
        ? payload.failed.length
        : 0;

      setRefinePrompt("");
      setRunHistory((prev) =>
        [pendingEditPlan.instruction, ...prev.filter((entry) => entry !== pendingEditPlan.instruction)].slice(
          0,
          6,
        ),
      );

      setOpenTabs([]);
      setActiveFile(null);
      await loadFiles();
      if (generation.previewUrl) {
        handleReloadPreview();
      }

      const summary =
        typeof payload.summary === "string" && payload.summary.trim()
          ? payload.summary.trim()
          : `Applied ${appliedCount} edit${appliedCount === 1 ? "" : "s"}`;
      const failSuffix =
        failedCount > 0 ? ` (${failedCount} file${failedCount === 1 ? "" : "s"} failed)` : "";

      setEditNotice(`${summary}${failSuffix} | Undo available`);
      setPendingEditPlan(null);
      setShowEditPreview(false);
    } catch (error: any) {
      console.error("Failed to apply in-place edit:", error);
      setEditNotice(error?.message || "Failed to apply prepared edits");
    } finally {
      setIsApplyingEdit(false);
    }
  };

  const quickActions: Array<{
    id: string;
    label: string;
    hint?: string;
    onSelect: () => void | Promise<void>;
    disabled?: boolean;
  }> = [
    {
      id: "preview",
      label: "Switch to Preview",
      hint: "1",
      onSelect: () => setViewMode("preview"),
    },
    {
      id: "code",
      label: "Switch to Code",
      hint: "2",
      onSelect: () => setViewMode("code"),
    },
    {
      id: "logs",
      label: showTechnicalLogs ? "Hide Technical Logs" : "Show Technical Logs",
      hint: "3",
      onSelect: () => setShowTechnicalLogs((prev) => !prev),
    },
    {
      id: "reload",
      label: "Reload Preview",
      hint: "4",
      onSelect: handleReloadPreview,
      disabled: !generation.previewUrl,
    },
    {
      id: "quick-open",
      label: "Quick Open File",
      onSelect: () => {
        void openQuickOpen();
      },
      disabled: !generation.sandboxId || isLoadingQuickOpen,
    },
    {
      id: "retry",
      label: "Retry Generation",
      hint: "5",
      onSelect: () => {
        void handleRetry();
      },
      disabled: generation.isBusy,
    },
    {
      id: "apply-edit",
      label: generation.sandboxId ? "Preview Refine Edit" : "Run Prompt",
      hint: "6",
      onSelect: () => {
        void handleApplyEdit();
      },
      disabled:
        generation.isBusy ||
        isPreparingEditPreview ||
        isApplyingEdit ||
        !(refinePrompt.trim() || activePrompt.trim()),
    },
    {
      id: "apply-previewed",
      label: "Apply Previewed Edits",
      hint: "7",
      onSelect: () => {
        if (pendingEditPlan) {
          void handleApplyPreparedEdits();
          return;
        }
        setShowEditPreview(true);
      },
      disabled:
        generation.isBusy ||
        isPreparingEditPreview ||
        isApplyingEdit ||
        !pendingEditPlan ||
        selectedEditCount === 0,
    },
    {
      id: "save-version",
      label: "Save Version Checkpoint",
      hint: "8",
      onSelect: () => {
        void handleCreateCheckpoint();
      },
      disabled: generation.isBusy || isCreatingCheckpoint || !generation.sandboxId,
    },
    {
      id: "restore-latest",
      label: checkpoints[0]
        ? `Restore Latest (${checkpoints[0].label})`
        : "Restore Latest Version",
      hint: "9",
      onSelect: () => {
        if (!checkpoints[0]) return;
        void handleRestoreCheckpoint(checkpoints[0]);
      },
      disabled:
        generation.isBusy || !generation.sandboxId || checkpoints.length === 0,
    },
    {
      id: "undo-apply",
      label: lastApplyCheckpoint
        ? `Undo Last Apply (${lastApplyCheckpoint.label})`
        : "Undo Last Apply",
      onSelect: () => {
        void handleUndoLastApply();
      },
      disabled:
        generation.isBusy ||
        isApplyingEdit ||
        Boolean(restoringCheckpointId) ||
        !lastApplyCheckpoint,
    },
    {
      id: "focus-refine",
      label: "Focus Refine Prompt",
      hint: "0",
      onSelect: () => refineInputRef.current?.focus(),
    },
  ];

  return (
    <main className="h-screen bg-black flex flex-col overflow-hidden relative">
      <Navbar />
      <div className="h-16" />

      <div className="sr-only" aria-live="polite">
        Status: {stageLabel}
        {generation.error ? `. Error: ${generation.error}` : ""}
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden px-2 pb-2 sm:px-3 sm:pb-3 gap-2 sm:gap-3">
        <div className="w-full md:w-[35%] flex flex-col min-h-0 glass-panel ui-ring-frame rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-white/10 space-y-3 ui-divider-bottom">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-white font-semibold">Lovable</h2>
                <p className="text-gray-400 text-sm mt-1 break-words">{activePrompt}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`px-2 py-1 rounded-md text-xs font-medium ${
                    generation.lifecycle === "failed"
                      ? "ui-pill bg-red-900/30 border-red-400/20 text-red-300"
                      : generation.lifecycle === "canceled"
                        ? "ui-pill bg-yellow-900/20 border-yellow-300/20 text-yellow-300"
                        : generation.lifecycle === "ready"
                          ? "ui-pill bg-green-900/20 border-green-300/20 text-green-300"
                          : "ui-pill text-gray-300"
                  }`}
                >
                  {stageLabel}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {STAGE_ORDER.map((step) => {
                const status = inferTimelineStatus(
                  generation.stage,
                  generation.lifecycle,
                  step,
                );
                return (
                  <div
                    key={step}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors duration-150 ${
                      status === "done"
                        ? "border-green-700/50 bg-green-900/15 text-green-300 shadow-[0_0_0_1px_rgba(34,197,94,0.06)_inset]"
                        : status === "active"
                          ? "border-blue-600/50 bg-blue-900/20 text-blue-200 shadow-[0_0_0_1px_rgba(96,165,250,0.08)_inset]"
                          : status === "error"
                            ? "border-red-600/50 bg-red-900/20 text-red-300"
                            : status === "canceled"
                              ? "border-yellow-600/50 bg-yellow-900/20 text-yellow-300"
                              : "border-white/5 bg-white/[0.02] text-gray-500"
                    }`}
                  >
                    {STAGE_LABELS[step]}
                  </div>
                );
              })}
            </div>

            {generation.lastProgress && (
              <div className="text-xs text-gray-500 font-mono break-all">
                Last: {generation.lastProgress}
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {generation.isBusy && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="ui-btn ui-btn-warn px-3 py-1.5 text-xs"
                >
                  Cancel
                </button>
              )}
              {!generation.isBusy && (generation.error || generation.lifecycle === "canceled") && (
                <button
                  type="button"
                  onClick={() => void handleRetry()}
                  className="ui-btn ui-btn-accent px-3 py-1.5 text-xs"
                >
                  Retry
                </button>
              )}
              {generation.parseWarnings > 0 && (
                <span className="text-xs text-amber-300">
                  {generation.parseWarnings} parse warning
                  {generation.parseWarnings === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>

          <div className="border-b border-white/10 px-4 py-2 ui-divider-bottom">
            <button
              type="button"
              onClick={() => setShowTechnicalLogs((prev) => !prev)}
              className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
            >
              <svg
                className={`w-3 h-3 transition-transform ${
                  showTechnicalLogs ? "rotate-90" : ""
                }`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
              Technical logs ({progressMessages.length})
            </button>
            {showTechnicalLogs && (
              <div className="mt-2 max-h-40 overflow-y-auto space-y-1 pr-1">
                {progressMessages.length === 0 ? (
                  <div className="text-xs text-gray-500 ui-card px-2 py-1">No logs yet</div>
                ) : (
                  progressMessages.map((message) => (
                    <div
                      key={message.id}
                      className="text-[11px] text-gray-500 font-mono break-all"
                    >
                      {message.message}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="border-b border-white/10 px-4 py-2 ui-divider-bottom">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-gray-400">
                Versions ({checkpoints.length})
              </div>
              <div className="flex items-center gap-2">
                {lastApplyCheckpoint && (
                  <button
                    type="button"
                    onClick={() => void handleUndoLastApply()}
                    className="ui-btn ui-btn-warn px-2 py-1 text-[11px]"
                    disabled={
                      generation.isBusy ||
                      isApplyingEdit ||
                      Boolean(restoringCheckpointId)
                    }
                  >
                    Undo last apply
                  </button>
                )}
                {checkpoints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const latest = checkpoints[0];
                      if (!latest) return;
                      void handleRestoreCheckpoint(latest);
                    }}
                    className="ui-btn ui-btn-ghost px-2 py-1 text-[11px]"
                    disabled={generation.isBusy || Boolean(restoringCheckpointId)}
                  >
                    Restore latest
                  </button>
                )}
              </div>
            </div>

            {checkpointNotice && (
              <div className="mt-2 text-[11px] text-blue-200 bg-blue-950/20 border border-blue-800/30 rounded-md px-2 py-1">
                {checkpointNotice}
              </div>
            )}

            {checkpoints.length === 0 ? (
              <div className="mt-2 text-[11px] text-gray-500">
                No versions yet. Save a version from the top toolbar.
              </div>
            ) : (
              <div className="mt-2 space-y-1 max-h-36 overflow-y-auto pr-1">
                {checkpoints.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="ui-card px-2 py-1.5 text-[11px] flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-gray-200 truncate flex items-center gap-1">
                        <span className="truncate">{checkpoint.label}</span>
                        {checkpoint.id === lastApplyCheckpointId && (
                          <span className="ui-pill px-1.5 py-0.5 text-[10px] text-yellow-200">
                            Undo
                          </span>
                        )}
                      </div>
                      <div className="text-gray-500 truncate">
                        {checkpoint.fileCount} files
                        {checkpoint.truncated ? " (truncated)" : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRestoreCheckpoint(checkpoint)}
                      className="ui-btn ui-btn-ghost px-2 py-1"
                      disabled={
                        generation.isBusy ||
                        restoringCheckpointId === checkpoint.id
                      }
                    >
                      {restoringCheckpointId === checkpoint.id
                        ? "Restoring..."
                        : "Restore"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 overflow-x-hidden">
            {aiMessages.map((message: GenerationMessage) => (
              <div key={message.id}>
                {(message.type === "claude_message" || message.type === "ai_message") && (
                  <div className="ui-card ui-card-hover p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-fuchsia-500 rounded-full flex items-center justify-center shadow-[0_0_18px_rgba(168,85,247,0.18)]">
                        <span className="text-white text-xs">L</span>
                      </div>
                      <span className="text-white font-medium">Lovable</span>
                    </div>
                    <p className="text-gray-300 whitespace-pre-wrap break-words">
                      {message.content}
                    </p>
                  </div>
                )}

                {message.type === "tool_use" && (
                  <div className="rounded-lg p-3 border border-white/10 bg-white/[0.02] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
                    <div className="flex items-start gap-2 text-sm">
                      <span className="text-blue-400 flex-shrink-0">Tool: {message.name}</span>
                      <span className="text-gray-500 break-all">{formatToolInput(message.input)}</span>
                    </div>
                  </div>
                )}

                {message.type === "error" && (
                  <div className="bg-red-900/20 border border-red-700/60 rounded-lg p-4 shadow-[0_10px_24px_rgba(127,29,29,0.12)]">
                    <p className="text-red-400 break-words">
                      {message.message || "Generation failed"}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {generation.isBusy && (
              <div className="flex items-center gap-2 text-gray-400">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400" />
                <span>
                  {generation.lifecycle === "requesting"
                    ? "Submitting request..."
                    : "Working..."}
                </span>
              </div>
            )}

            {generation.error && (
              <div className="bg-red-900/20 border border-red-700/60 rounded-lg p-4 shadow-[0_10px_24px_rgba(127,29,29,0.12)]">
                <p className="text-red-400 break-words">{generation.error}</p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRetry()}
                    className="ui-btn ui-btn-danger px-3 py-1.5 text-sm"
                  >
                    Retry generation
                  </button>
                </div>
              </div>
            )}

            {generation.lifecycle === "canceled" && !generation.error && (
              <div className="bg-yellow-900/20 border border-yellow-700/60 rounded-lg p-4 shadow-[0_10px_24px_rgba(113,63,18,0.12)]">
                <p className="text-yellow-300">Generation canceled.</p>
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => void handleRetry()}
                    className="ui-btn ui-btn-warn px-3 py-1.5 text-sm"
                  >
                    Retry generation
                  </button>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 border-t border-white/10 ui-divider-top space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-gray-400">Refine and apply edits</div>
              <button
                type="button"
                onClick={() => setShowQuickActions(true)}
                className="ui-btn ui-btn-ghost px-2 py-1 text-[11px]"
                title="Quick actions (Ctrl/Cmd+K)"
              >
                Quick actions
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={refineInputRef}
                type="text"
                value={refinePrompt}
                onChange={(event) => setRefinePrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleApplyEdit();
                  }
                }}
                placeholder="Add a refinement: better typography, sticky nav, pricing table..."
                aria-label="Refine prompt"
                className="flex-1 px-4 py-2 bg-gray-900/70 text-white rounded-xl border border-white/10 focus:outline-none focus:border-white/20 shadow-inner shadow-black/20"
                disabled={generation.isBusy || isPreparingEditPreview || isApplyingEdit}
              />
              <button
                type="button"
                onClick={() => void handleApplyEdit()}
                className="ui-btn ui-btn-primary px-3 py-2 text-sm"
                disabled={
                  generation.isBusy ||
                  isPreparingEditPreview ||
                  isApplyingEdit ||
                  (!refinePrompt.trim() && !activePrompt.trim())
                }
                aria-label="Preview refinement edits"
                title="Preview file edits before applying"
              >
                {isPreparingEditPreview
                  ? "Previewing..."
                  : isApplyingEdit
                    ? "Applying..."
                  : generation.sandboxId
                    ? "Preview edits"
                    : "Run"}
              </button>
              {pendingEditPlan && (
                <button
                  type="button"
                  onClick={() => setShowEditPreview(true)}
                  className="ui-btn ui-btn-accent px-3 py-2 text-sm"
                  disabled={generation.isBusy || isPreparingEditPreview || isApplyingEdit}
                  aria-label="Open edit preview"
                  title="Open prepared edit preview"
                >
                  Review
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleRefineSubmit()}
                className="ui-btn ui-btn-ghost px-3 py-2 text-sm"
                disabled={
                  generation.isBusy ||
                  isPreparingEditPreview ||
                  isApplyingEdit ||
                  (!refinePrompt.trim() && !activePrompt.trim())
                }
                aria-label="Run full regeneration"
                title="Create a new full generation run"
              >
                New run
              </button>
            </div>

            {editNotice && (
              <div className="text-[11px] text-emerald-200 bg-emerald-950/20 border border-emerald-800/30 rounded-md px-2 py-1">
                {editNotice}
              </div>
            )}

            {pendingEditPlan && (
              <div className="text-[11px] text-blue-200 bg-blue-950/20 border border-blue-800/30 rounded-md px-2 py-1 flex items-center justify-between gap-2">
                <span className="truncate">
                  {pendingEditPlan.summary} ({pendingEditPlan.previews.length} file
                  {pendingEditPlan.previews.length === 1 ? "" : "s"})
                </span>
                <button
                  type="button"
                  onClick={() => setShowEditPreview(true)}
                  className="ui-btn ui-btn-ghost px-2 py-0.5 text-[11px]"
                  disabled={generation.isBusy || isPreparingEditPreview || isApplyingEdit}
                >
                  Open
                </button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {REFINE_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setRefinePrompt(suggestion)}
                  className="ui-chip px-2 py-1 text-[11px] text-left"
                  disabled={
                    generation.isBusy || isPreparingEditPreview || isApplyingEdit
                  }
                >
                  {suggestion}
                </button>
              ))}
            </div>

            {runHistory.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-gray-500">
                  Recent prompts
                </div>
                <div className="flex flex-wrap gap-2">
                  {runHistory.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => {
                        setRefinePrompt(entry);
                        refineInputRef.current?.focus();
                      }}
                      className="ui-chip px-2 py-1 text-[11px] max-w-full truncate"
                      title={entry}
                      disabled={
                        generation.isBusy || isPreparingEditPreview || isApplyingEdit
                      }
                    >
                      {entry}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="w-full md:w-[65%] bg-gray-950 flex flex-col min-h-0 glass-panel ui-ring-frame rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-3 sm:px-4 py-2 border-b border-white/10 bg-[#111]/80 backdrop-blur gap-2 sm:gap-3 flex-wrap ui-divider-bottom">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                aria-pressed={viewMode === "preview"}
                className={`px-4 py-1.5 text-sm font-medium ui-segment ${
                  viewMode === "preview"
                    ? "ui-segment-active"
                    : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                  Preview
                </span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode("code")}
                aria-pressed={viewMode === "code"}
                className={`px-4 py-1.5 text-sm font-medium ui-segment ${
                  viewMode === "code"
                    ? "ui-segment-active"
                    : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                    />
                  </svg>
                  Code
                </span>
              </button>

              {viewMode === "code" && (
                <button
                  type="button"
                  onClick={() => setShowMobileExplorer((prev) => !prev)}
                  className="md:hidden ui-btn ui-btn-ghost px-3 py-1.5 text-sm font-medium"
                  aria-expanded={showMobileExplorer}
                  aria-controls="mobile-file-explorer"
                >
                  {showMobileExplorer ? "Close files" : `Files (${files.length || openTabsCount})`}
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end ml-auto">
              {pendingEditPlan && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowEditPreview(true)}
                    className="ui-btn ui-btn-ghost px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm"
                    disabled={
                      generation.isBusy ||
                      isPreparingEditPreview ||
                      !pendingEditPlan
                    }
                    title="Open prepared edit preview"
                  >
                    Review edits
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleApplyPreparedEdits()}
                    className="ui-btn ui-btn-primary px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm"
                    disabled={
                      generation.isBusy ||
                      isPreparingEditPreview ||
                      isApplyingEdit ||
                      selectedEditCount === 0
                    }
                    title="Apply prepared edits"
                  >
                    {isApplyingEdit
                      ? "Applying..."
                      : `Apply ${selectedEditCount}`}
                  </button>
                </>
              )}

              {generation.sandboxId && (
                <button
                  type="button"
                  onClick={() => void handleCreateCheckpoint()}
                  className="ui-btn ui-btn-accent px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm"
                  disabled={generation.isBusy || isCreatingCheckpoint}
                  title="Save current version checkpoint"
                >
                  {isCreatingCheckpoint ? "Saving..." : "Save version"}
                </button>
              )}

              {generation.sandboxId && (
                <button
                  type="button"
                  onClick={() => void openQuickOpen()}
                  className="ui-btn ui-btn-ghost px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm"
                  disabled={isLoadingQuickOpen}
                  title="Quick open file (Ctrl/Cmd+P)"
                >
                  {isLoadingQuickOpen ? "Loading files..." : "Open file"}
                </button>
              )}

              {lastApplyCheckpoint && (
                <button
                  type="button"
                  onClick={() => void handleUndoLastApply()}
                  className="ui-btn ui-btn-warn px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm"
                  disabled={
                    generation.isBusy ||
                    isApplyingEdit ||
                    Boolean(restoringCheckpointId)
                  }
                  title={`Undo last apply using ${lastApplyCheckpoint.label}`}
                >
                  Undo apply
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowQuickActions(true)}
                className="ui-btn ui-btn-ghost px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm text-gray-400 hover:text-white"
                title="Quick actions (Ctrl/Cmd+K)"
              >
                Ctrl+K
              </button>

              {generation.previewUrl && (
                <>
                  <button
                    type="button"
                    onClick={handleReloadPreview}
                    className="ui-btn ui-btn-ghost px-2.5 sm:px-3 py-1.5 text-sm text-gray-400 hover:text-white flex items-center gap-1"
                    title="Reload preview"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h5M20 20v-5h-5M5.64 18.36A9 9 0 013 12m18 0a9 9 0 00-2.64-6.36M12 3a9 9 0 00-6.36 2.64M12 21a9 9 0 006.36-2.64"
                      />
                    </svg>
                    Reload
                  </button>
                  <a
                    href={generation.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ui-btn ui-btn-ghost px-2.5 sm:px-3 py-1.5 text-sm text-gray-400 hover:text-white flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                      />
                    </svg>
                    Open
                  </a>
                </>
              )}

              {generation.sandboxId && (
                <>
                  <button
                    type="button"
                    onClick={handleReconnect}
                    className="ui-btn ui-btn-ghost px-2.5 sm:px-3 py-1.5 text-sm text-gray-400 hover:text-white"
                    title="Reconnect files and refresh preview"
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCopySandboxId()}
                    className="ui-btn ui-btn-ghost px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm text-gray-400 hover:text-white font-mono"
                    title="Copy sandbox ID"
                  >
                    {copyStatus === "copied"
                      ? "Copied"
                      : copyStatus === "failed"
                        ? "Copy failed"
                        : `${generation.sandboxId.slice(0, 8)}...`}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            {viewMode === "preview" ? (
              <div className="h-full flex items-center justify-center relative bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.02),transparent_45%),linear-gradient(to_bottom,rgba(255,255,255,0.01),transparent)]">
                {!generation.previewUrl && generation.isBusy && (
                  <div className="text-center">
                    <div className="w-16 h-16 ui-card ui-card-hover rounded-2xl flex items-center justify-center mb-4 mx-auto">
                      <div className="w-12 h-12 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl animate-pulse" />
                    </div>
                    <p className="text-gray-400">Spinning up preview...</p>
                  </div>
                )}

                {generation.previewUrl && (
                  <>
                    <iframe
                      key={previewFrameKey}
                      src={generation.previewUrl}
                      className="w-full h-full bg-white rounded-none"
                      title="Website Preview"
                      onLoad={() => {
                        setIsPreviewLoading(false);
                        setPreviewLoadError(null);
                      }}
                      onError={() => {
                        setIsPreviewLoading(false);
                        setPreviewLoadError("Preview failed to load");
                      }}
                    />
                    {isPreviewLoading && (
                      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center">
                        <div className="ui-card px-4 py-2 text-gray-300 text-sm">
                          Loading preview...
                        </div>
                      </div>
                    )}
                  </>
                )}

                {previewLoadError && (
                  <div className="absolute bottom-4 left-4 right-4 bg-red-900/20 border border-red-700/60 rounded-lg p-3 flex items-center justify-between gap-3 shadow-[0_12px_28px_rgba(127,29,29,0.16)]">
                    <p className="text-red-300 text-sm">{previewLoadError}</p>
                    <button
                      type="button"
                      onClick={handleReloadPreview}
                      className="ui-btn ui-btn-danger px-3 py-1 text-sm"
                    >
                      Retry preview
                    </button>
                  </div>
                )}

                {!generation.previewUrl && !generation.isBusy && (
                  <div className="text-center ui-card px-5 py-4">
                    <p className="text-gray-400">Preview will appear here</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-full flex relative min-w-0">
                <div className="hidden md:block w-72 flex-shrink-0">
                  <FileExplorer
                    files={files}
                    onFileSelect={handleFileSelect}
                    selectedFile={activeFile}
                    onRefresh={() => void loadFiles()}
                    onFolderExpand={(path) => void loadFolderChildren(path)}
                    isLoading={isLoadingFiles}
                  />
                </div>

                {showMobileExplorer && (
                  <>
                    <button
                      type="button"
                      className="md:hidden absolute inset-0 z-10 bg-black/55 backdrop-blur-[2px]"
                      onClick={() => setShowMobileExplorer(false)}
                      aria-label="Close file explorer"
                    />
                    <div
                      id="mobile-file-explorer"
                      className="md:hidden absolute inset-y-0 left-0 z-20 w-[85vw] max-w-xs shadow-[0_18px_48px_rgba(0,0,0,0.45)]"
                    >
                      <FileExplorer
                        files={files}
                        onFileSelect={handleFileSelect}
                        selectedFile={activeFile}
                        onRefresh={() => void loadFiles()}
                        onFolderExpand={(path) => void loadFolderChildren(path)}
                        isLoading={isLoadingFiles}
                      />
                    </div>
                  </>
                )}

                <div className="flex-1 min-w-0">
                  <CodeEditor
                    files={openTabs}
                    activeFile={activeFile}
                    onFileSelect={setActiveFile}
                    onFileChange={handleFileChange}
                    onFileSave={handleFileSave}
                    onFileSaveAll={handleSaveAll}
                    onFileClose={handleFileClose}
                    dirtyCount={dirtyTabsCount}
                    isSavingAll={isSavingAll}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showEditPreview && pendingEditPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            aria-label="Close edit preview"
            onClick={() => setShowEditPreview(false)}
          />
          <div
            ref={previewPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Edit preview"
            tabIndex={-1}
            className="relative w-full max-w-6xl max-h-[90vh] glass-panel ui-ring-frame rounded-2xl p-3 sm:p-4 flex flex-col gap-3 outline-none"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-white">
                  Review proposed edits
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  {pendingEditPlan.summary}
                </p>
                <p className="text-[11px] text-gray-500 mt-1">
                  {selectedEditCount} of {pendingEditPlan.previews.length} file
                  {pendingEditPlan.previews.length === 1 ? "" : "s"} selected
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditPreview(false)}
                  className="ui-btn ui-btn-ghost px-3 py-1.5 text-xs sm:text-sm"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void handleApplyPreparedEdits()}
                  className="ui-btn ui-btn-primary px-3 py-1.5 text-xs sm:text-sm"
                  disabled={
                    generation.isBusy ||
                    isPreparingEditPreview ||
                    isApplyingEdit ||
                    selectedEditCount === 0
                  }
                >
                  {isApplyingEdit
                    ? "Applying..."
                    : `Apply ${selectedEditCount} edit${selectedEditCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>

            {pendingEditPlan.notes.length > 0 && (
              <div className="text-[11px] text-gray-300 ui-card px-2 py-1.5">
                {pendingEditPlan.notes.join(" | ")}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllEdits}
                className="ui-btn ui-btn-ghost px-2.5 py-1 text-[11px]"
                disabled={pendingEditPlan.previews.length === 0}
              >
                Select all
              </button>
              <button
                type="button"
                onClick={handleClearSelectedEdits}
                className="ui-btn ui-btn-ghost px-2.5 py-1 text-[11px]"
                disabled={selectedEditCount === 0}
              >
                Clear selection
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-3 min-h-0 flex-1">
              <div className="ui-card overflow-y-auto p-2 space-y-1 min-h-0">
                {pendingEditPlan.previews.map((preview) => (
                  <div
                    key={preview.path}
                    className={`w-full text-left rounded-lg px-2 py-1.5 border transition-colors ${
                      selectedEditPreview?.path === preview.path
                        ? "border-blue-500/40 bg-blue-900/20"
                        : "border-white/5 bg-white/[0.02] hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => toggleEditPathSelection(preview.path)}
                        className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center ${
                          isEditPathSelected(preview.path)
                            ? "bg-blue-500/70 border-blue-300/60"
                            : "bg-transparent border-white/20"
                        }`}
                        title={
                          isEditPathSelected(preview.path)
                            ? "Deselect file"
                            : "Select file"
                        }
                      >
                        {isEditPathSelected(preview.path) && (
                          <svg
                            className="w-3 h-3 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPreviewPath(preview.path)}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="text-xs text-white truncate">{preview.path}</div>
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-400">
                          <span className="text-emerald-300">+{preview.additions}</span>
                          <span className="text-red-300">-{preview.deletions}</span>
                          {preview.isNewFile && (
                            <span className="ui-pill px-1.5 py-0.5 text-[10px] text-blue-300">
                              New
                            </span>
                          )}
                          {preview.isDeleted && (
                            <span className="ui-pill px-1.5 py-0.5 text-[10px] text-red-300">
                              Delete
                            </span>
                          )}
                          {!isEditPathSelected(preview.path) && (
                            <span className="text-gray-500">(excluded)</span>
                          )}
                        </div>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="ui-card min-h-0 flex flex-col overflow-hidden">
                <div className="px-3 py-2 border-b border-white/10 text-xs text-gray-400 flex items-center justify-between">
                  <span className="truncate">{selectedEditPreview?.path || "No file selected"}</span>
                  <div className="flex items-center gap-2">
                    {selectedEditPreview?.isDeleted && (
                      <span className="ui-pill px-1.5 py-0.5 text-[10px] text-red-300">
                        Delete
                      </span>
                    )}
                    <span className="text-gray-500">
                      {selectedEditPreview
                        ? `+${selectedEditPreview.additions} / -${selectedEditPreview.deletions}`
                        : ""}
                    </span>
                  </div>
                </div>
                <pre className="flex-1 overflow-auto p-3 text-[11px] leading-relaxed text-gray-300 bg-black/25 font-mono whitespace-pre-wrap">
                  {selectedEditPreview?.diff || "No diff available"}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {showQuickOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            aria-label="Close quick open"
            onClick={() => setShowQuickOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Quick open file"
            className="relative w-full max-w-3xl glass-panel ui-ring-frame rounded-2xl p-3 sm:p-4 mt-10 sm:mt-16"
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Quick open</h3>
                <p className="text-xs text-gray-400 mt-1">
                  Search the full project and jump directly to a file
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowQuickOpen(false)}
                className="ui-btn ui-btn-ghost p-1.5"
                aria-label="Close quick open"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                ref={quickOpenInputRef}
                type="text"
                value={quickOpenQuery}
                onChange={(event) => setQuickOpenQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveQuickOpenSelection(1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveQuickOpenSelection(-1);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    if (selectedQuickOpenPath) {
                      handleOpenQuickOpenPath(selectedQuickOpenPath);
                    }
                  }
                }}
                placeholder="Search by file name or path..."
                aria-label="Search project files"
                className="w-full pl-10 pr-3 py-2.5 text-sm bg-gray-900/80 text-white rounded-xl border border-white/10 focus:outline-none focus:border-white/20 placeholder-gray-500 shadow-inner shadow-black/20"
              />
            </div>

            <div className="mt-3 ui-card overflow-hidden">
              <div className="px-3 py-2 border-b border-white/10 text-[11px] text-gray-500 flex items-center justify-between">
                <span>
                  {isLoadingQuickOpen
                    ? "Loading project files..."
                    : `${quickOpenResults.length} result${quickOpenResults.length === 1 ? "" : "s"}`}
                </span>
                <span className="text-gray-600">Enter to open</span>
              </div>

              <div className="max-h-[50vh] overflow-y-auto p-2 space-y-1">
                {isLoadingQuickOpen ? (
                  <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                    Loading files...
                  </div>
                ) : quickOpenResults.length === 0 ? (
                  <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                    No files match this search.
                  </div>
                ) : (
                  quickOpenResults.map((filePath) => {
                    const fileName = filePath.split("/").pop() || filePath;
                    const isActive = selectedQuickOpenPath === filePath;
                    const isOpen = openTabs.some((tab) => tab.path === filePath);

                    return (
                      <button
                        key={filePath}
                        type="button"
                        onMouseEnter={() => setSelectedQuickOpenPath(filePath)}
                        onClick={() => handleOpenQuickOpenPath(filePath)}
                        className={`w-full rounded-xl px-3 py-2 text-left border transition-colors ${
                          isActive
                            ? "border-blue-500/40 bg-blue-900/20"
                            : "border-white/5 bg-white/[0.02] hover:bg-white/[0.05]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm text-white truncate">{fileName}</div>
                            <div className="text-[11px] text-gray-500 truncate mt-0.5">
                              {filePath}
                            </div>
                          </div>
                          {isOpen && (
                            <span className="ui-pill px-1.5 py-0.5 text-[10px] text-blue-200">
                              Open
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showQuickActions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
            aria-label="Close quick actions"
            onClick={() => setShowQuickActions(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Quick actions"
            className="relative w-full max-w-lg glass-panel ui-ring-frame rounded-2xl p-3 sm:p-4"
          >
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Quick actions</h3>
                <p className="text-xs text-gray-400 mt-1">
                  Lovable-style shortcuts for faster iteration
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowQuickActions(false)}
                className="ui-btn ui-btn-ghost p-1.5"
                aria-label="Close quick actions"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={async () => {
                    if (action.disabled) return;
                    await action.onSelect();
                    setShowQuickActions(false);
                  }}
                  disabled={action.disabled}
                  className="ui-btn ui-btn-ghost w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left disabled:opacity-50"
                >
                  <span className="text-sm text-white">{action.label}</span>
                  {action.hint && (
                    <span className="ui-pill px-2 py-0.5 text-[11px] text-gray-400">
                      {action.hint}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <main className="h-screen bg-black flex items-center justify-center">
          <div className="text-gray-400">Loading...</div>
        </main>
      }
    >
      <GeneratePageContent />
    </Suspense>
  );
}
