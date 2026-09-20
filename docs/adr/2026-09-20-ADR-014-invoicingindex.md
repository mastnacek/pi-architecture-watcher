# ADR-014: "../invoicing/index",
- **Date:** 2026-09-20 21:03:34
- **Status:** active
- **Context:** counts: { error: 1, warning: 0, hint: 0 },
    findings: [
      {
        rule: "cross-slice-deep-import",
        severity: "error",
        file: "src/slices/billing/index.ts",
        title: "x",
- **Decision:** "violation" : "drift",
    score,
    findings,
    counts: {
      error: findings.filter((f) => f.severity === "error").length,
      warning: findings.filter((f) => f.severity === "warning").length
- **Consequences:** Maintain this implementation to prevent regressions across environments.
