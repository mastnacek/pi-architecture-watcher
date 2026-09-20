/**
 * Language kernel — maps file extensions to a coarse `SourceLanguage`.
 *
 * Deep module: callers ask `languageOf(path)` and get a stable id used to pick
 * a scanner and a status-line mascot. No slice imports, no I/O.
 */

export type SourceLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "rust"
  | "java"
  | "kotlin"
  | "go"
  | "unknown";

/** Every source extension the watcher understands, per language. */
export const LANGUAGE_EXTENSIONS: Readonly<Record<SourceLanguage, readonly string[]>> = {
  typescript: [".ts", ".tsx", ".mts", ".cts"],
  javascript: [".js", ".jsx", ".mjs", ".cjs"],
  python: [".py", ".pyi"],
  rust: [".rs"],
  java: [".java"],
  kotlin: [".kt", ".kts"],
  go: [".go"],
  unknown: [],
};

/** Extensions the scan/topology pipeline treats as source, in probe order. */
export const ALL_SOURCE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".pyi",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".go",
];

/** Longest-suffix match wins, so `.d.ts`-like overlaps never misclassify. */
export function languageOf(file: string): SourceLanguage {
  const lower = file.toLowerCase();
  let best: SourceLanguage = "unknown";
  let bestLen = 0;
  for (const [language, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
    for (const ext of extensions) {
      if (lower.endsWith(ext) && ext.length > bestLen) {
        best = language as SourceLanguage;
        bestLen = ext.length;
      }
    }
  }
  return best;
}
