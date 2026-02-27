"use client";

import { useEffect, useRef, useState } from "react";
import Editor, { OnMount, OnChange } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

interface FileTab {
  path: string;
  content: string;
  language: string;
  isDirty: boolean;
}

interface CodeEditorProps {
  files: FileTab[];
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  onFileChange: (path: string, content: string) => void;
  onFileSave: (path: string) => void | Promise<void>;
  onFileSaveAll?: () => void | Promise<void>;
  onFileClose: (path: string) => void;
  readOnly?: boolean;
  dirtyCount?: number;
  isSavingAll?: boolean;
}

const getLanguageFromPath = (path: string): string => {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    html: "html",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    env: "plaintext",
    gitignore: "plaintext",
    dockerfile: "dockerfile",
    prisma: "prisma",
  };
  return languageMap[ext] || "plaintext";
};

const getFileIcon = (path: string): string => {
  const fileName = path.split("/").pop() || path;
  const lowerName = fileName.toLowerCase();
  const ext = lowerName.split(".").pop() || "";

  if (lowerName === "dockerfile") return "DOCKER";
  if (lowerName === ".gitignore") return "GIT";
  if (lowerName === ".env") return "ENV";

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

  return iconMap[ext] || fileName.toUpperCase().slice(0, 5);
};

export default function CodeEditor({
  files,
  activeFile,
  onFileSelect,
  onFileChange,
  onFileSave,
  onFileSaveAll,
  onFileClose,
  readOnly = false,
  dirtyCount,
  isSavingAll = false,
}: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const activeFileRef = useRef<string | null>(activeFile);
  const onFileSaveRef = useRef(onFileSave);
  const [isEditorReady, setIsEditorReady] = useState(false);

  const activeFileData = files.find((f) => f.path === activeFile);
  const dirtyFileCount =
    dirtyCount ?? files.filter((file) => file.isDirty).length;

  useEffect(() => {
    activeFileRef.current = activeFile;
  }, [activeFile]);

  useEffect(() => {
    onFileSaveRef.current = onFileSave;
  }, [onFileSave]);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    setIsEditorReady(true);

    // Configure TypeScript/JavaScript
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.Latest,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: "React",
      allowJs: true,
      typeRoots: ["node_modules/@types"],
    });

    // Add keyboard shortcut for save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activeFileRef.current) {
        void onFileSaveRef.current(activeFileRef.current);
      }
    });

    // Set editor theme
    monaco.editor.defineTheme("lovable-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6A9955" },
        { token: "keyword", foreground: "C586C0" },
        { token: "string", foreground: "CE9178" },
        { token: "number", foreground: "B5CEA8" },
        { token: "type", foreground: "4EC9B0" },
      ],
      colors: {
        "editor.background": "#0d0d0d",
        "editor.foreground": "#D4D4D4",
        "editor.lineHighlightBackground": "#1a1a1a",
        "editor.selectionBackground": "#264F78",
        "editorCursor.foreground": "#AEAFAD",
        "editorWhitespace.foreground": "#3B3B3B",
        "editorIndentGuide.background": "#404040",
        "editor.selectionHighlightBackground": "#ADD6FF26",
      },
    });
    monaco.editor.setTheme("lovable-dark");
  };

  const handleEditorChange: OnChange = (value) => {
    if (activeFile && value !== undefined) {
      onFileChange(activeFile, value);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d]">
      {/* File Tabs */}
      <div
        className="flex items-center bg-[#1a1a1a]/95 border-b border-white/10 overflow-x-auto min-h-[42px] ui-divider-bottom"
        role="tablist"
        aria-label="Open files"
      >
        {files.map((file) => (
          <div
            key={file.path}
            role="tab"
            tabIndex={activeFile === file.path ? 0 : -1}
            aria-selected={activeFile === file.path}
            className={`flex items-center gap-2 px-4 py-2 text-sm cursor-pointer border-r border-white/5 min-w-0 transition-colors duration-150 ${
              activeFile === file.path
                ? "bg-[#0d0d0d] text-white shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]"
                : "bg-[#1a1a1a] text-gray-400 hover:bg-[#252525] hover:text-gray-200"
            }`}
            onClick={() => onFileSelect(file.path)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onFileSelect(file.path);
              }
            }}
          >
            <span className="flex-shrink-0 text-[10px] font-mono text-gray-500 border border-gray-700/80 rounded px-1 py-0.5 bg-black/20">
              {getFileIcon(file.path)}
            </span>
            <span className="truncate max-w-[150px]">
              {file.path.split("/").pop()}
            </span>
            {file.isDirty && (
              <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
            )}
            <button
              type="button"
              aria-label={`Close ${file.path.split("/").pop()}`}
              onClick={(e) => {
                e.stopPropagation();
                onFileClose(file.path);
              }}
              className="ml-1 ui-btn ui-btn-ghost p-0.5 rounded-md flex-shrink-0"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Breadcrumb */}
      {activeFile && (
        <div className="px-4 py-1 text-xs text-gray-500 bg-[#0d0d0d] border-b border-white/10 ui-divider-bottom">
          {activeFile.split("/").map((part, index, arr) => (
            <span key={index}>
              {index > 0 && <span className="mx-1">/</span>}
              <span className={index === arr.length - 1 ? "text-gray-300" : ""}>
                {part}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {activeFileData ? (
          <Editor
            height="100%"
            language={activeFileData.language}
            value={activeFileData.content}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            options={{
              readOnly,
              minimap: { enabled: true, scale: 0.75 },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
              fontLigatures: true,
              lineNumbers: "on",
              renderLineHighlight: "all",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: "on",
              padding: { top: 16 },
              smoothScrolling: true,
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              bracketPairColorization: { enabled: true },
              guides: {
                bracketPairs: true,
                indentation: true,
              },
              suggest: {
                showKeywords: true,
                showSnippets: true,
              },
            }}
            loading={
              <div className="flex items-center justify-center h-full">
                <div className="flex items-center gap-2 text-gray-400">
                  <svg
                    className="animate-spin h-5 w-5"
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
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Loading editor...
                </div>
              </div>
            }
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <svg
                className="w-16 h-16 mx-auto mb-4 opacity-50"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p>Select a file to edit</p>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 sm:px-4 py-1.5 text-xs text-gray-500 bg-[#1a1a1a]/95 border-t border-white/10 ui-divider-top">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
          {activeFileData && (
            <>
              <span>{activeFileData.language}</span>
              <span>UTF-8</span>
              <span>LF</span>
            </>
          )}
          {dirtyFileCount > 0 && (
            <span className="text-yellow-500">{dirtyFileCount} unsaved</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {onFileSaveAll && dirtyFileCount > 0 && (
            <button
              type="button"
              onClick={() => {
                void onFileSaveAll();
              }}
              disabled={isSavingAll}
              className="ui-btn ui-btn-accent px-2 py-0.5 text-blue-200 hover:text-blue-100 disabled:opacity-50 disabled:cursor-not-allowed rounded"
            >
              {isSavingAll ? "Saving..." : "Save all"}
            </button>
          )}
          {isEditorReady && <span className="text-green-500">Ready</span>}
          {activeFileData?.isDirty && (
            <span className="text-yellow-500">Modified</span>
          )}
          <span className="hidden sm:inline">Ctrl+S to save</span>
        </div>
      </div>
    </div>
  );
}

export { getLanguageFromPath, getFileIcon };
export type { FileTab };
