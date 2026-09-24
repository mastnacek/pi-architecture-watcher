import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import type { Report, SliceLookup, WatcherConfig } from "./types.js";

export const STATUS_KEY = "vsa";

export interface WatcherState {
  root: string;
  config: WatcherConfig;
  lookup: SliceLookup;
  pending: Map<string, Report>;
  last: Report | null;
}

export interface EditInput {
  path?: unknown;
  content?: unknown;
  edits?: unknown;
}

/**
 * Apply Pi's edit semantics: replace the first occurrence of each `oldText`
 * with its `newText`, in order. Returns the prospective file content.
 */
export function applyEdits(existing: string, edits: unknown): string | null {
  if (!Array.isArray(edits) || edits.length === 0) return null;
  let next = existing;
  for (const raw of edits) {
    if (!raw || typeof raw !== "object") return null;
    const { oldText, newText } = raw as { oldText?: unknown; newText?: unknown };
    if (typeof oldText !== "string" || typeof newText !== "string") return null;
    const at = next.indexOf(oldText);
    if (at === -1) return null;
    next = next.slice(0, at) + newText + next.slice(at + oldText.length);
  }
  return next;
}

/**
 * Resolve the OpenRouter key the same way Pi's own providers do: the
 * `OPENROUTER_API_KEY` env var first, then the OpenRouter OAuth credential
 * stored in `~/.pi/agent/auth.json` (its `access` field is the permanent API
 * key).
 */
export function resolveOpenRouterKey(): string | undefined {
  const env = process.env["OPENROUTER_API_KEY"];
  if (env && env.length > 0) return env;
  const cred = readStoredCredential("openrouter") as { access?: unknown } | undefined;
  if (cred && typeof cred.access === "string" && cred.access.length > 0) return cred.access;
  return undefined;
}
