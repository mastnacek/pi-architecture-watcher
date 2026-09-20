/**
 * Scoring — internal to the `classify` slice.
 *
 * Deep module: `scoreFindings` collapses an arbitrary finding list into the
 * single 0-100 number that answers *"to what extent does this violate VSA?"*.
 */

import type { Finding, Severity, Verdict } from "../../shared/types.js";

const WEIGHTS: Record<Severity, number> = {
  error: 40,
  warning: 15,
  hint: 5,
};

const RANK: Record<Severity, number> = { hint: 0, warning: 1, error: 2 };

/** Sum of weights, capped at 100. */
export function scoreFindings(findings: readonly Finding[]): number {
  const total = findings.reduce((sum, f) => sum + WEIGHTS[f.severity], 0);
  return Math.min(100, total);
}

/** Strongest severity present, or `"clean"`. */
export function strongest(findings: readonly Finding[]): Severity | "clean" {
  let best: Severity | "clean" = "clean";
  for (const f of findings) {
    if (best === "clean" || RANK[f.severity] > RANK[best]) best = f.severity;
  }
  return best;
}

/** Coarse verdict for UI and gating. */
export function verdictOf(findings: readonly Finding[], score: number): Verdict {
  const top = strongest(findings);
  if (top === "clean") return "clean";
  if (top === "error") return score >= 60 ? "severe" : "violation";
  if (top === "warning") return "violation";
  return "drift";
}

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { hint: 0, warning: 0, error: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/** Compare two severities on the hint < warning < error scale. */
export function atLeast(value: Severity, threshold: Severity): boolean {
  return RANK[value] >= RANK[threshold];
}
