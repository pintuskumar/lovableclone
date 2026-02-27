export interface SseParserState {
  buffer: string;
}

export function createSseParserState(): SseParserState {
  return { buffer: "" };
}

function normalizeChunk(chunk: string): string {
  // Normalize CRLF so delimiter detection works consistently.
  return chunk.replace(/\r\n/g, "\n");
}

export function consumeSseDataFrames(
  state: SseParserState,
  chunk: string,
): string[] {
  state.buffer += normalizeChunk(chunk);

  const frames: string[] = [];

  while (true) {
    const delimiterIndex = state.buffer.indexOf("\n\n");
    if (delimiterIndex === -1) break;

    const rawEvent = state.buffer.slice(0, delimiterIndex);
    state.buffer = state.buffer.slice(delimiterIndex + 2);

    const dataLines = rawEvent
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length > 0) {
      frames.push(dataLines.join("\n"));
    }
  }

  return frames;
}

export function flushSseDataFrames(state: SseParserState): string[] {
  if (!state.buffer.trim()) {
    state.buffer = "";
    return [];
  }

  // Treat any trailing complete-ish payload as a final frame if it contains data lines.
  const dataLines = state.buffer
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  state.buffer = "";
  return dataLines.length > 0 ? [dataLines.join("\n")] : [];
}
