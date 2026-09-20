/**
 * Rendering — internal to the `report` slice.
 *
 * Deep module: every way a `Report` is presented to a human or a model is a
 * pure string function here. Nothing else in the plugin formats output.
 */

import { baseName } from "../../shared/paths.js";
import type { Finding, Mode, Report, Severity } from "../../shared/types.js";

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

/**
 * Minimal view of the terminal theme the status line needs.
 *
 * Structural on purpose: the `report` slice stays Pi-free, while Pi's `Theme`
 * satisfies it as-is (`ctx.ui.theme`).
 */
export interface StatusTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/** Mode emoji shown at the head of the status line. */
const MODE_EMOJI: Record<Mode, string> = {
  auto: "🚗",
  human: "🧑",
  off: "💤",
};

/** Color per verdict — tuned against the eldritch palette. */
const VERDICT_COLOR: Record<Report["verdict"], string> = {
  clean: "success",
  drift: "warning",
  violation: "error",
  severe: "error",
};

/** Extension → mascot. Longest extension wins (`.pyi` before `.py`). */
const LANGUAGE_EMOJI: ReadonlyArray<readonly [string, string]> = [
  [".pyi", "🐍"],
  [".py", "🐍"],
  [".rs", "🦀"],
  [".tsx", "🔷"],
  [".mts", "🔷"],
  [".cts", "🔷"],
  [".ts", "🔷"],
  [".jsx", "🟨"],
  [".mjs", "🟨"],
  [".cjs", "🟨"],
  [".js", "🟨"],
  [".go", "🐹"],
];

/** Mascot for a file path; a generic page when the language is unknown. */
export function languageEmoji(file: string): string {
  const lower = file.toLowerCase();
  return LANGUAGE_EMOJI.find(([ext]) => lower.endsWith(ext))?.[1] ?? "📄";
}

function painter(theme?: StatusTheme): (color: string, text: string) => string {
  return theme ? (color, text) => theme.fg(color, text) : (_color, text) => text;
}

function emboldener(theme?: StatusTheme): (text: string) => string {
  return theme ? (text) => theme.bold(text) : (text) => text;
}

/** `VSA sleduje 12 řezů · 🚗 auto` — shown before anything is analyzed. */
export function formatWatching(sliceCount: number, mode: Mode, theme?: StatusTheme): string {
  const paint = painter(theme);
  return paint("accent", "VSA")
    + paint("dim", " sleduje ")
    + paint("text", `${sliceCount} řezů`)
    + paint("dim", " · ")
    + `${MODE_EMOJI[mode]} ${paint("accent", mode)}`;
}

/** Compact, always-safe one-liner used by the status line. */
export function formatStatus(
  report: Report | null,
  options: { mode?: Mode; theme?: StatusTheme } = {},
): string {
  if (!report) return "";
  const paint = painter(options.theme);
  const bold = emboldener(options.theme);
  const prefix = options.mode ? `${MODE_EMOJI[options.mode]} ` : "";
  const name = `${languageEmoji(report.file)} ${paint("dim", baseName(report.file))}`;

  if (report.findings.length === 0) {
    return `${prefix}${paint("success", bold("VSA v pořádku"))} ${name}`;
  }

  const color = VERDICT_COLOR[report.verdict];
  const head = paint(color, bold(`VSA ${VERDICT_LABEL[report.verdict]} ${report.score}/100`));
  const counts = paint("error", `${report.counts.error} chyb`)
    + paint("dim", " · ")
    + paint("warning", `${report.counts.warning} varov`)
    + paint("dim", " · ")
    + paint("dim", `${report.counts.hint} tip`);
  return `${prefix}${head} (${counts}) ${name}`;
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
  void options;
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
