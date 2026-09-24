// Extracted from ArchDetectModal.ts to keep modules focused.
/**
 * Architecture Detection Modal — TUI component for the detection flow.
 *
 * Shows: engine selection → download progress → detection progress → result → confirm
 * Comparison mode: engine select → compare both → side-by-side results
 */

import {
  matchesKey,
  Key,
  visibleWidth,
  type Component,
  Container,
  Text,
  Spacer,
  SelectList,
  type SelectItem,
} from "@earendil-works/pi-tui";

import { BorderedLoader, DynamicBorder } from "@earendil-works/pi-coding-agent";

/** Color helpers for consistent theming */
export function title(theme: any, text: string) {
  return theme.fg("accent", theme.bold(text));
}

export function muted(theme: any, text: string) {
  return theme.fg("muted", text);
}

export function error(theme: any, text: string) {
  return theme.fg("error", text);
}

export function dim(theme: any, text: string) {
  return theme.fg("dim", text);
}

/** Progress bar rendering */
export function renderProgressBar(theme: any, width: number, progress: number, label: string): string {
  const barWidth = Math.max(10, width - visibleWidth(label) - 4);
  const filled = Math.round(barWidth * progress);
  const empty = barWidth - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pct = Math.round(progress * 100);
  return `${label} [${theme.fg("accent", bar)}] ${pct}%`;
}

/** Simple word wrap preserving ANSI codes */
export function wrapText(_theme: any, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? current + " " + word : word;
    if (visibleWidth(test) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}
