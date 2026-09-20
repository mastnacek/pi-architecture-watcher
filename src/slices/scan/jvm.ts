/**
 * JVM import extraction — internal to the `scan` slice.
 *
 * Deep module: `scanJvmImports(source, language)` handles Java `import [static]
 * a.b.C;` and Kotlin `import a.b.C` (no semicolon, optional `as` alias, `.*`
 * wildcards). Specifiers stay dotted; the resolver maps them to `.java` / `.kt`
 * files under the usual source roots.
 */

import { maskCLike } from "./c-mask.js";
import { lineAt } from "./positions.js";
import type { ImportEdge } from "../../shared/types.js";
import type { SourceLanguage } from "../../shared/languages.js";

const JAVA = /(^|\n)[ \t]*import[ \t]+(?:static[ \t]+)?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w*]*)+)[ \t]*;/g;
const KOTLIN = /(^|\n)[ \t]*import[ \t]+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w*]*)+)/g;

export function scanJvmImports(source: string, language: SourceLanguage = "java"): ImportEdge[] {
  const { masked } = maskCLike(source, { tripleQuote: true });
  const pattern = language === "kotlin" ? KOTLIN : JAVA;
  const edges: ImportEdge[] = [];

  for (const match of masked.matchAll(pattern)) {
    let specifier = match[2] ?? "";
    if (specifier.endsWith(".*")) specifier = specifier.slice(0, -2);
    if (specifier.length === 0) continue;
    const index = (match.index ?? 0) + (match[1]?.length ?? 0);
    edges.push({ specifier, kind: "static", line: lineAt(masked, index), column: 1 });
  }

  edges.sort((a, b) => a.line - b.line || a.column - b.column);
  return edges;
}