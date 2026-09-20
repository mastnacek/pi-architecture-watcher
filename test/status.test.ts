/**
 * `report` slice — status-line rendering: theme colors, mode emoji, language emoji.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatStatus,
  formatWatching,
  languageEmoji,
  type StatusTheme,
} from "../src/slices/report/index.js";
import type { Report } from "../src/shared/types.js";

const theme: StatusTheme = {
  fg: (color, text) => `[${color}]${text}[/]`,
  bold: (text) => `*${text}*`,
};

function report(over: Partial<Report> = {}): Report {
  return {
    file: "src/slices/billing/index.ts",
    abs: "/proj/src/slices/billing/index.ts",
    slice: "billing",
    shared: null,
    verdict: "violation",
    score: 42,
    counts: { error: 1, warning: 0, hint: 0 },
    findings: [
      {
        rule: "cross-slice-deep-import",
        severity: "error",
        file: "src/slices/billing/index.ts",
        title: "x",
        detail: "y",
        suggestion: "z",
      },
    ],
    generatedBy: "test",
    timestamp: 0,
    ...over,
  };
}

test("languageEmoji maps extensions to mascots", () => {
  assert.equal(languageEmoji("a/foo.py"), "🐍");
  assert.equal(languageEmoji("a/foo.pyi"), "🐍");
  assert.equal(languageEmoji("a/foo.rs"), "🦀");
  assert.equal(languageEmoji("a/foo.tsx"), "🔷");
  assert.equal(languageEmoji("a/foo.js"), "🟨");
  assert.equal(languageEmoji("a/foo.rb"), "📄");
});

test("formatStatus is empty without a report", () => {
  assert.equal(formatStatus(null), "");
});

test("formatStatus colors a clean report green with mode and language emoji", () => {
  const out = formatStatus(
    report({
      verdict: "clean",
      score: 0,
      counts: { error: 0, warning: 0, hint: 0 },
      findings: [],
    }),
    { mode: "auto", theme },
  );
  assert.match(out, /🚗/);
  assert.match(out, /🔷/);
  assert.match(out, /v pořádku/);
  assert.match(out, /\[success\]/);
});

test("formatStatus colors a violation red and shows counts", () => {
  const out = formatStatus(report(), { mode: "human", theme });
  assert.match(out, /🧑/);
  assert.match(out, /\[error\]/);
  assert.match(out, /1 chyb/);
});

test("formatWatching shows the slice count and mode emoji", () => {
  const out = formatWatching(12, "off", theme);
  assert.match(out, /12 řezů/);
  assert.match(out, /💤/);
  assert.match(out, /\[accent\]/);
});