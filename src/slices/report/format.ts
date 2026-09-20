/**
 * Rendering — internal to the `report` slice.
 *
 * Deep module: every way a `Report` is presented to a human or a model is a
 * pure string function here. Nothing else in the plugin formats output.
 */

import { baseName } from "../../shared/paths.js";
import type { Finding, Report, Severity } from "../../shared/types.js";

const MARK: Record<Severity, string> = {
  error: "error",
  warning: "warn ",
  hint: "hint ",
};

const VERDICT_LABEL: Record<Report["verdict"], string> = {
  clean: "clean",
  drift: "drift",
  violation: "violation",
  severe: "severe",
};

/** `1E 2W 1H` style counters. */
export function formatCounts(report: Report): string {
  return `${report.counts.error}E ${report.counts.warning}W ${report.counts.hint}H`;
}

/** Compact, always-safe one-liner used by the status line. */
export function formatStatus(report: Report | null): string {
  if (!report) return "";
  if (report.findings.length === 0) return `VSA ${baseName(report.file)}: clean`;
  return `VSA ${VERDICT_LABEL[report.verdict]} ${report.score}/100 (${formatCounts(report)})`;
}

/** Single line for notifications. */
export function formatOneLiner(report: Report): string {
  if (report.findings.length === 0) {
    return `${report.file} — VSA clean (0/100)`;
  }
  const top = report.findings[0]!;
  return `${report.file} — VSA ${VERDICT_LABEL[report.verdict]} ${report.score}/100 `
    + `(${formatCounts(report)}) · ${top.rule}`;
}

function formatFinding(finding: Finding, index: number): string {
  const where = finding.line !== undefined ? ` (line ${finding.line})` : "";
  const lines = [
    `### ${index + 1}. [${MARK[finding.severity].trim()}] ${finding.rule} — ${finding.title}${where}`,
    finding.detail,
    `→ ${finding.suggestion}`,
  ];
  if (finding.fix) lines.push(`fix: \`${finding.fix}\``);
  return lines.join("\n");
}

/** Full human-readable report (markdown). */
export function formatReport(report: Report, options?: { verbose?: boolean }): string {
  const verbose = options?.verbose ?? true;
  const header = [
    `## VSA report — \`${report.file}\``,
    `slice: ${report.slice ?? "—"} · shared: ${report.shared ?? "—"} · `
      + `verdict: ${VERDICT_LABEL[report.verdict]} · score: ${report.score}/100 · `
      + `findings: ${formatCounts(report)}`,
  ];

  if (report.findings.length === 0) {
    header.push("", "No vertical-slice violations detected.");
    return header.join("\n");
  }

  const body = report.findings.map((f, i) => formatFinding(f, i)).join("\n\n");
  return `${header.join("\n")}\n\n${body}`;
}

/**
 * Model-facing remediation block.
 *
 * Deep module: this is the *only* place that decides how advice is phrased for
 * the agent, so auto mode stays consistent no matter which rule fired.
 */
export function formatInjection(report: Report): string {
  const head =
    `[pi-architecture-watcher] This write scores ${report.score}/100 against the project's `
    + `vertical slice architecture (verdict: ${VERDICT_LABEL[report.verdict]}).`;

  const items = report.findings.map((f) => {
    const where = f.line !== undefined ? `L${f.line}: ` : "";
    const fix = f.fix ? ` Suggested import: \`${f.fix}\`.` : "";
    return `- ${where}[${f.severity}] ${f.rule}: ${f.suggestion}${fix}`;
  });

  return [
    head,
    "Apply these corrections now, without asking:",
    ...items,
    "If a correction would change behavior, say so and stop instead of guessing.",
  ].join("\n");
}

/**
 * Model-facing block message used when a human explicitly declined the write.
 *
 * Distinct from `formatInjection`: the model must not retry, because a person
 * has already made the decision.
 */
export function formatDeclined(report: Report): string {
  const head =
    `[pi-architecture-watcher] The user declined this write: it scores ${report.score}/100 `
    + `(${VERDICT_LABEL[report.verdict]}).`;
  const items = report.findings.map(
    (f) => `- [${f.severity}] ${f.rule}: ${f.suggestion}${f.fix ? ` (\`${f.fix}\`)` : ""}`,
  );
  return [
    head,
    "Do not retry the same change verbatim. Resolve these points first, then ask:",
    ...items,
  ].join("\n");
}

/** Rule catalogue rows, for `/vsa rules`. */
export function formatRuleCatalogue(descriptions: ReadonlyArray<[string, Severity, string]>): string {
  return descriptions
    .map(([rule, severity, text]) => `- \`${rule}\` (${severity}) — ${text}`)
    .join("\n");
}
