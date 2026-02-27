"use client";

import { useState } from "react";

interface FileNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  isLoaded?: boolean;
}

interface FileExplorerProps {
  files: FileNode[];
  onFileSelect: (path: string) => void;
  selectedFile: string | null;
  onRefresh?: () => void;
  onFolderExpand?: (path: string) => Promise<void> | void;
  isLoading?: boolean;
}

const getFileIcon = (name: string, isFolder: boolean): string => {
  const lowerName = name.toLowerCase();

  if (isFolder) return "DIR";
  if (lowerName === "dockerfile") return "DOCKER";
  if (lowerName === ".gitignore") return "GIT";
  if (lowerName === ".env") return "ENV";

  const ext = lowerName.split(".").pop() || "";
  const iconMap: Record<string, string> = {
    ts: "TS",
    tsx: "TSX",
    js: "JS",
    jsx: "JSX",
    json: "JSON",
    css: "CSS",
    scss: "SCSS",
    html: "HTML",
    md: "MD",
    py: "PY",
    rs: "RS",
    go: "GO",
    prisma: "PRISMA",
    env: "ENV",
    gitignore: "GIT",
    lock: "LOCK",
    yaml: "YAML",
    yml: "YML",
    svg: "IMG",
    png: "IMG",
    jpg: "IMG",
    jpeg: "IMG",
    gif: "IMG",
    ico: "IMG",
  };

  return iconMap[ext] || name.toUpperCase().slice(0, 5);
};

function FileTreeNode({
  node,
  depth,
  onFileSelect,
  selectedFile,
  expandedFolders,
  toggleFolder,
  onFolderExpand,
  loadingFolders,
}: {
  node: FileNode;
  depth: number;
  onFileSelect: (path: string) => void;
  selectedFile: string | null;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  onFolderExpand?: (path: string) => Promise<void> | void;
  loadingFolders: Set<string>;
}) {
  const isFolder = node.type === "folder";
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedFile === node.path;
  const isFolderLoading = loadingFolders.has(node.path);

  const handleClick = async () => {
    if (isFolder) {
      const willExpand = !isExpanded;
      if (willExpand && onFolderExpand && node.children === undefined) {
        await onFolderExpand(node.path);
      }
      toggleFolder(node.path);
    } else {
      onFileSelect(node.path);
    }
  };

  return (
    <div>
      <button
        type="button"
        className={`flex w-full items-center gap-1 py-1 px-2 rounded-lg text-sm border transition-colors duration-150 ${
          isSelected
            ? "bg-gray-800/90 border-white/10 text-white shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
            : "text-gray-300 border-transparent hover:bg-gray-800/60 hover:border-white/5"
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          void handleClick();
        }}
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-current={isSelected ? "true" : undefined}
      >
        {isFolder && (
          <span className="w-4 h-4 flex items-center justify-center text-gray-500">
            <svg
              className={`w-3 h-3 transition-transform ${
                isExpanded ? "rotate-90" : ""
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
          </span>
        )}
        <span className="flex-shrink-0 text-[10px] font-mono text-gray-500 border border-gray-700/80 rounded px-1 py-0.5 bg-black/20">
          {getFileIcon(node.name, isFolder)}
        </span>
        <span className="truncate">{node.name}</span>
        {isFolder && isFolderLoading && (
          <svg
            className="w-3 h-3 ml-auto text-gray-500 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
          >
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
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
      </button>

      {isFolder && isExpanded && node.children && (
        <div>
          {node.children
            .sort((a, b) => {
              // Folders first, then files
              if (a.type !== b.type) {
                return a.type === "folder" ? -1 : 1;
              }
              return a.name.localeCompare(b.name);
            })
            .map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                onFileSelect={onFileSelect}
                selectedFile={selectedFile}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                onFolderExpand={onFolderExpand}
                loadingFolders={loadingFolders}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export default function FileExplorer({
  files,
  onFileSelect,
  selectedFile,
  onRefresh,
  onFolderExpand,
  isLoading = false,
}: FileExplorerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["app", "components", "lib"])
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const handleFolderExpand = async (path: string) => {
    if (!onFolderExpand) return;

    setLoadingFolders((prev) => new Set(prev).add(path));
    try {
      await onFolderExpand(path);
    } finally {
      setLoadingFolders((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  };

  const filterFiles = (nodes: FileNode[], query: string): FileNode[] => {
    if (!query) return nodes;

    return nodes.reduce<FileNode[]>((acc, node) => {
      if (node.type === "file") {
        if (node.name.toLowerCase().includes(query.toLowerCase())) {
          acc.push(node);
        }
      } else if (node.children) {
        const filteredChildren = filterFiles(node.children, query);
        if (filteredChildren.length > 0) {
          acc.push({
            ...node,
            children: filteredChildren,
          });
        }
      }
      return acc;
    }, []);
  };

  const filteredFiles = filterFiles(files, searchQuery);

  return (
    <div className="flex flex-col h-full bg-[#111]/95 backdrop-blur border-r border-white/10">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#111]/95 backdrop-blur border-b border-gray-800">
        <div className="flex items-center justify-between px-3 py-2">
          <div>
            <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              Explorer
            </span>
            <div className="text-[10px] text-gray-500 mt-0.5">
              {files.length > 0 ? `${countFiles(files)} files loaded` : "Sandbox files"}
            </div>
          </div>
          <div className="flex items-center gap-1">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              aria-label="Refresh file list"
              className="ui-btn ui-btn-ghost p-1 text-gray-400 hover:text-white disabled:opacity-50"
              title="Refresh files"
            >
              <svg
                className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}
          </div>
        </div>

        {/* Search */}
        <div className="px-2 py-2 border-t border-gray-800">
          <div className="relative">
            <svg
              className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
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
              type="text"
              placeholder="Search files..."
              aria-label="Search files"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-8 py-1.5 text-sm bg-gray-900/80 text-white rounded-xl border border-white/10 focus:outline-none focus:border-white/20 placeholder-gray-500 shadow-inner shadow-black/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear file search"
                className="absolute right-1 top-1/2 -translate-y-1/2 ui-btn ui-btn-ghost p-1 text-gray-500 hover:text-gray-300"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto py-2" aria-label="File tree">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="flex items-center gap-2 text-gray-500">
              <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
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
              <span className="text-sm">Loading files...</span>
            </div>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex items-center justify-center h-32 px-4 text-center text-gray-500 text-sm">
            {searchQuery
              ? "No matching files. Try a shorter query."
              : "No files loaded yet."}
          </div>
        ) : (
          filteredFiles
            .sort((a, b) => {
              if (a.type !== b.type) {
                return a.type === "folder" ? -1 : 1;
              }
              return a.name.localeCompare(b.name);
            })
            .map((node) => (
              <FileTreeNode
                key={node.path}
                node={node}
                depth={0}
                onFileSelect={onFileSelect}
                selectedFile={selectedFile}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                onFolderExpand={handleFolderExpand}
                loadingFolders={loadingFolders}
              />
            ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/10 text-xs text-gray-500 bg-[#121212]/90 ui-divider-top">
        <span>
          {searchQuery
            ? `Filtered by "${searchQuery}"`
            : "Tip: use Ctrl/Cmd+P for quick open, or expand folders to lazy-load children"}
        </span>
      </div>
    </div>
  );
}

function countFiles(nodes: FileNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.type === "file") {
      return count + 1;
    }
    return count + (node.children ? countFiles(node.children) : 0);
  }, 0);
}

export type { FileNode };
