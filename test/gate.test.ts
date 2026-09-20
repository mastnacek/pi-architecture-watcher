import { test } from "node:test";
import assert from "node:assert/strict";
import { decideGate } from "../src/slices/enforce/index.js";
import { DEFAULT_CONFIG, mergeConfig } from "../src/shared/config.js";
import type { Finding, WatcherConfig } from "../src/shared/types.js";
import type { Report } from "../src/shared/types.js";

function reportWith(findings: Finding[], score = 50): Report {
  return {
    file: "src/features/billing/charge.ts",
    abs: "/tmp/project/src/features/billing/charge.ts",
    slice: "billing",
    shared: null,
    verdict: findings.some((f) => f.severity === "error") ? "violation" : "drift",
    score,
    findings,
    counts: {
      error: findings.filter((f) => f.severity === "error").length,
      warning: findings.filter((f) => f.severity === "warning").length,
      hint: findings.filter((f) => f.severity === "hint").length,
    },
    generatedBy: "test",
    timestamp: 0,
  };
}

const ERROR_FINDING: Finding = {
  rule: "cross-slice-deep-import",
  severity: "error",
  file: "src/features/billing/charge.ts",
  line: 1,
  title: "deep import",
  detail: "detail",
  suggestion: "use the public entry",
  fix: "../invoicing/index",
};

const config = (overrides: Partial<WatcherConfig> = {}): WatcherConfig =>
  mergeConfig(DEFAULT_CONFIG, overrides as Record<string, unknown>);

test("gate: clean report always passes", () => {
  const decision = decideGate({ report: reportWith([]), config: config(), hasUI: true });
  assert.equal(decision.action, "pass");
});

test("gate: disabled watcher passes", () => {
  const decision = decideGate({
    report: reportWith([ERROR_FINDING]),
    config: config({ enabled: false }),
    hasUI: true,
  });
  assert.equal(decision.action, "pass");
});

test("gate: auto mode advises and injects fix advice", () => {
  const decision = decideGate({
    report: reportWith([ERROR_FINDING]),
    config: config({ mode: "auto" }),
    hasUI: false,
  });
  assert.equal(decision.action, "advise");
  assert.match(decision.injection ?? "", /pi-architecture-watcher/);
  assert.match(decision.injection ?? "", /cross-slice-deep-import/);
});

test("gate: human mode without UI blocks at the configured severity", () => {
  const decision = decideGate({
    report: reportWith([ERROR_FINDING]),
    config: config({ mode: "human", blockAt: "error" }),
    hasUI: false,
  });
  assert.equal(decision.action, "block");
});

test("gate: human mode with UI confirms at the configured severity", () => {
  const decision = decideGate({
    report: reportWith([ERROR_FINDING]),
    config: config({ mode: "human", blockAt: "error" }),
    hasUI: true,
  });
  assert.equal(decision.action, "confirm");
});

test("gate: human mode notifies below the block threshold", () => {
  const warning: Finding = { ...ERROR_FINDING, severity: "warning", rule: "slice-fan-out" };
  const decision = decideGate({
    report: reportWith([warning], 15),
    config: config({ mode: "human", blockAt: "error" }),
    hasUI: true,
  });
  assert.equal(decision.action, "notify");
});

test("gate: auto mode never blocks by default", () => {
  const decision = decideGate({
    report: reportWith([ERROR_FINDING]),
    config: config({ mode: "auto", blockAt: "never" }),
    hasUI: false,
  });
  assert.equal(decision.action, "advise");
});
