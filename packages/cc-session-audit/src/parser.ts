/**
 * JSONL session file parser for Claude Code sessions.
 *
 * Reads line-delimited JSON from Claude Code session files and yields
 * typed SessionMessage objects. Handles malformed lines gracefully.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionMessage } from "./types.js";

const KNOWN_TYPES = new Set([
  "user",
  "assistant",
  "progress",
  "system",
  "file-history-snapshot",
  "last-prompt",
  "queue-operation",
]);

export async function* parseSessionFile(
  filePath: string
): AsyncGenerator<SessionMessage> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const msg = JSON.parse(trimmed) as SessionMessage;
      if (msg.type && KNOWN_TYPES.has(msg.type)) {
        yield msg;
      }
    } catch {
      // Skip malformed lines
    }
  }
}
