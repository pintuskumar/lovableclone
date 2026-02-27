"use client";

import { useCallback, useRef, useState } from "react";
import {
  consumeSseDataFrames,
  createSseParserState,
  flushSseDataFrames,
} from "@/lib/client/sse";

export type GenerationLifecycle =
  | "idle"
  | "requesting"
  | "streaming"
  | "provisioning_preview"
  | "ready"
  | "failed"
  | "canceled";

export type GenerationStage =
  | "queued"
  | "creating_sandbox"
  | "generating_code"
  | "installing_deps"
  | "starting_preview"
  | "ready";

export interface RawGenerationEvent {
  type:
    | "claude_message"
    | "tool_use"
    | "tool_result"
    | "progress"
    | "error"
    | "complete"
    | "ai_message";
  content?: string;
  name?: string;
  input?: unknown;
  result?: unknown;
  message?: string;
  previewUrl?: string;
  sandboxId?: string;
}

export interface GenerationMessage extends RawGenerationEvent {
  id: string;
  createdAt: number;
}

interface GenerationSessionState {
  messages: GenerationMessage[];
  previewUrl: string | null;
  sandboxId: string | null;
  lifecycle: GenerationLifecycle;
  stage: GenerationStage;
  error: string | null;
  lastProgress: string | null;
  parseWarnings: number;
}

const INITIAL_STATE: GenerationSessionState = {
  messages: [],
  previewUrl: null,
  sandboxId: null,
  lifecycle: "idle",
  stage: "queued",
  error: null,
  lastProgress: null,
  parseWarnings: 0,
};

function inferStageFromProgress(message: string, current: GenerationStage) {
  const text = message.toLowerCase();

  if (
    text.includes("creating new daytona sandbox") ||
    text.includes("using existing sandbox") ||
    text.includes("sandbox created") ||
    text.includes("connected to sandbox")
  ) {
    return "creating_sandbox" as const;
  }

  if (
    text.includes("running vercel ai gateway generation") ||
    text.includes("parsing generated code") ||
    text.includes("writing") ||
    text.includes("generation output")
  ) {
    return "generating_code" as const;
  }

  if (
    text.includes("installing project dependencies") ||
    text.includes("dependencies installed") ||
    text.includes("npm install")
  ) {
    return "installing_deps" as const;
  }

  if (
    text.includes("starting development server") ||
    text.includes("waiting for server to start") ||
    text.includes("getting preview url") ||
    text.includes("preview url:")
  ) {
    return "starting_preview" as const;
  }

  return current;
}

function createMessageId(counter: number) {
  return `gen-msg-${counter}`;
}

export function useGenerationSession() {
  const [state, setState] = useState<GenerationSessionState>(INITIAL_STATE);
  const abortControllerRef = useRef<AbortController | null>(null);
  const latestPromptRef = useRef<string>("");
  const parserStateRef = useRef(createSseParserState());
  const messageCounterRef = useRef(0);
  const requestIdRef = useRef(0);

  const isBusy =
    state.lifecycle === "requesting" ||
    state.lifecycle === "streaming" ||
    state.lifecycle === "provisioning_preview";

  const appendMessage = useCallback((message: RawGenerationEvent) => {
    messageCounterRef.current += 1;
    const enriched: GenerationMessage = {
      ...message,
      id: createMessageId(messageCounterRef.current),
      createdAt: Date.now(),
    };
    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, enriched],
    }));
  }, []);

  const cancel = useCallback(() => {
    if (!abortControllerRef.current) return;

    abortControllerRef.current.abort();
    abortControllerRef.current = null;
    setState((prev) => ({
      ...prev,
      lifecycle: "canceled",
      error: prev.error,
    }));
  }, []);

  const resetForRun = useCallback((prompt: string) => {
    latestPromptRef.current = prompt;
    parserStateRef.current = createSseParserState();
    setState({
      ...INITIAL_STATE,
      lifecycle: "requesting",
      stage: "queued",
    });
  }, []);

  const start = useCallback(
    async (prompt: string) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      resetForRun(trimmedPrompt);

      const requestId = ++requestIdRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch("/api/generate-daytona", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ prompt: trimmedPrompt }),
          signal: controller.signal,
        });

        if (requestId !== requestIdRef.current) return;

        if (!response.ok) {
          let errorMessage = "Failed to generate website";
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch {
            // Ignore JSON parse errors for error payloads.
          }
          throw new Error(errorMessage);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let receivedDone = false;

        setState((prev) => ({
          ...prev,
          lifecycle: "streaming",
          stage: "queued",
        }));

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunkText = decoder.decode(value, { stream: true });
          const frames = consumeSseDataFrames(parserStateRef.current, chunkText);

          for (const frame of frames) {
            if (frame === "[DONE]") {
              receivedDone = true;
              continue;
            }

            let parsedEvent: RawGenerationEvent | null = null;
            try {
              parsedEvent = JSON.parse(frame) as RawGenerationEvent;
            } catch (error) {
              console.warn("[Generate] SSE JSON parse warning", {
                error,
                frame: frame.slice(0, 300),
              });
              setState((prev) => ({
                ...prev,
                parseWarnings: prev.parseWarnings + 1,
              }));
              continue;
            }

            if (!parsedEvent || typeof parsedEvent.type !== "string") {
              continue;
            }

            if (parsedEvent.type === "error") {
              const errorMessage =
                parsedEvent.message || "Generation failed unexpectedly";
              setState((prev) => ({
                ...prev,
                lifecycle: "failed",
                error: errorMessage,
              }));
              appendMessage(parsedEvent);
              abortControllerRef.current = null;
              return;
            }

            if (parsedEvent.type === "complete") {
              setState((prev) => ({
                ...prev,
                previewUrl: parsedEvent.previewUrl || prev.previewUrl,
                sandboxId: parsedEvent.sandboxId || prev.sandboxId,
                lifecycle: "provisioning_preview",
                stage: "starting_preview",
              }));
              continue;
            }

            if (parsedEvent.type === "progress" && parsedEvent.message) {
              setState((prev) => ({
                ...prev,
                lastProgress: parsedEvent.message || null,
                stage: inferStageFromProgress(parsedEvent.message!, prev.stage),
              }));
            }

            appendMessage(parsedEvent);
          }
        }

        // Flush any trailing frame in case the stream ended without the final delimiter.
        const trailingFrames = flushSseDataFrames(parserStateRef.current);
        for (const frame of trailingFrames) {
          if (frame === "[DONE]") {
            receivedDone = true;
            continue;
          }
          try {
            const parsedEvent = JSON.parse(frame) as RawGenerationEvent;
            if (parsedEvent.type === "error") {
              setState((prev) => ({
                ...prev,
                lifecycle: "failed",
                error: parsedEvent.message || "Generation failed unexpectedly",
              }));
              appendMessage(parsedEvent);
              abortControllerRef.current = null;
              return;
            }
            if (parsedEvent.type === "complete") {
              setState((prev) => ({
                ...prev,
                previewUrl: parsedEvent.previewUrl || prev.previewUrl,
                sandboxId: parsedEvent.sandboxId || prev.sandboxId,
                lifecycle: "provisioning_preview",
                stage: "starting_preview",
              }));
            } else {
              appendMessage(parsedEvent);
            }
          } catch (error) {
            console.warn("[Generate] Trailing SSE parse warning", {
              error,
              frame: frame.slice(0, 300),
            });
            setState((prev) => ({
              ...prev,
              parseWarnings: prev.parseWarnings + 1,
            }));
          }
        }

        setState((prev) => {
          if (prev.lifecycle === "failed" || prev.lifecycle === "canceled") {
            return prev;
          }

          const hasPreview = Boolean(prev.previewUrl);
          return {
            ...prev,
            lifecycle: hasPreview ? "ready" : "failed",
            stage: hasPreview ? "ready" : prev.stage,
            error:
              hasPreview
                ? prev.error
                : prev.error ||
                  (receivedDone
                    ? "Generation finished but preview URL was not returned"
                    : "Generation stream ended before preview was ready"),
          };
        });
      } catch (error: any) {
        if (controller.signal.aborted) {
          setState((prev) => ({
            ...prev,
            lifecycle: "canceled",
          }));
          return;
        }

        console.error("Error generating website:", error);
        setState((prev) => ({
          ...prev,
          lifecycle: "failed",
          error: error?.message || "An error occurred",
        }));
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [appendMessage, resetForRun],
  );

  const retry = useCallback(async () => {
    const prompt = latestPromptRef.current;
    if (!prompt) return;
    await start(prompt);
  }, [start]);

  return {
    ...state,
    isBusy,
    start,
    retry,
    cancel,
  };
}

export type UseGenerationSessionReturn = ReturnType<typeof useGenerationSession>;
