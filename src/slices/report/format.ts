/**
 * Rendering — internal to the `report` slice.
 *
 * Deep module: every way a `Report` is presented to a human or a model is a
 * pure string function here. Nothing else in the plugin formats output.
 */

import { baseName } from "../../shared/paths.js";
import type { Finding, Report, Severity } from "../../shared/types.js";

const MARK: Record<Severity, string> = {
  error: "chyba",
  warning: "varov",
  hint: "tip",
};

const VERDICT_LABEL: Record<Report["verdict"], string> = {
  clean: "v pořádku",
  drift: "odchylka",
  violation: "porušení",
  severe: "závažné",
};

/** `1 chyb · 2 varov · 1 tip` style counters. */
export function formatCounts(report: Report): string {
  return `${report.counts.error} chyb · ${report.counts.warning} varov · ${report.counts.hint} tip`;
}

/** Compact, always-safe one-liner used by the status line. */
export function formatStatus(report: Report | null): string {
  if (!report) return "";
  if (report.findings.length === 0) return `VSA ${baseName(report.file)}: v pořádku`;
  return `VSA ${VERDICT_LABEL[report.verdict]} ${report.score}/100 (${formatCounts(report)})`;
}

/** Single line for notifications. */
export function formatOneLiner(report: Report): string {
  if (report.findings.length === 0) {
    return `${report.file} — VSA v pořádku (0/100)`;
  }
  const top = report.findings[0]!;
  return `${report.file} — VSA ${VERDICT_LABEL[report.verdict]} ${report.score}/100 `
    + `(${formatCounts(report)}) · ${top.rule}`;
}

function formatFinding(finding: Finding, index: number): string {
  const where = finding.line !== undefined ? ` (řádek ${finding.line})` : "";
  const lines = [
    `### ${index + 1}. [${MARK[finding.severity].trim()}] ${finding.rule} — ${finding.title}${where}`,
    finding.detail,
    `→ ${finding.suggestion}`,
  ];
  if (finding.fix) lines.push(`oprava: \`${finding.fix}\``);
  return lines.join("\n");
}

/** Full human-readable report (markdown). */
export function formatReport(report: Report, options?: { verbose?: boolean }): string {
  const verbose = options?.verbose ?? true;
  const header = [
    `## VSA report — \`${report.file}\``,
    `řez: ${report.slice ?? "—"} · sdílené: ${report.shared ?? "—"} · `
      + `verdikt: ${VERDICT_LABEL[report.verdict]} · skóre: ${report.score}/100 · `
      + `nálezy: ${formatCounts(report)}`,
  ];

  if (report.findings.length === 0) {
    header.push("", "Nebyla nalezena žádná porušení vertikálních řezů.");
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
    `[pi-architecture-watcher] Tento zápis skóruje ${report.score}/100 proti architektuře `
    + `vertikálních řezů projektu (verdikt: ${VERDICT_LABEL[report.verdict]}).`;

  const items = report.findings.map((f) => {
    const where = f.line !== undefined ? `L${f.line}: ` : "";
    const fix = f.fix ? ` Navrhovaný import: \`${f.fix}\`.` : "";
    return `- ${where}[${f.severity}] ${f.rule}: ${f.suggestion}${fix}`;
  });

  return [
    head,
    "Proveď tyto opravy nyní, bez dotazování:",
    ...items,
    "Pokud by oprava změnila chování, řekni to a přestaň, nehádej.",
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
    `[pi-architecture-watcher] Uživatel tento zápis odmítl: skóruje ${report.score}/100 `
    + `(${VERDICT_LABEL[report.verdict]}).`;
  const items = report.findings.map(
    (f) => `- [${f.severity}] ${f.rule}: ${f.suggestion}${f.fix ? ` (\`${f.fix}\`)` : ""}`,
  );
  return [
    head,
    "Nezkoušej stejnou změnu znovu doslova. Nejprve vyřeš tyto body, pak se zeptej:",
    ...items,
  ].join("\n");
}

/** Rule catalogue rows, for `/vsa rules`. */
export function formatRuleCatalogue(descriptions: ReadonlyArray<[string, Severity, string]>): string {
  return descriptions
    .map(([rule, severity, text]) => `- \`${rule}\` (${severity}) — ${text}`)
    .join("\n");
}
