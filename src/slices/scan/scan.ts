/**
 * Language dispatcher — public entry of the `scan` slice.
 *
 * Deep module: `scanImports(source, language)` picks the right per-language
 * scanner so callers never branch on language themselves. TypeScript/JavaScript
 * remain the default, keeping every existing call site unchanged.
 */

import { scanTsImports } from "./imports.js";
import { scanPythonImports } from "./python.js";
import { scanRustImports } from "./rust.js";
import { scanJvmImports } from "./jvm.js";
import { scanGoImports } from "./golang.js";
import type { ImportEdge } from "../../shared/types.js";
import type { SourceLanguage } from "../../shared/languages.js";

export function scanImports(
  source: string,
  language: SourceLanguage = "typescript",
): ImportEdge[] {
  switch (language) {
    case "typescript":
    case "javascript":
      return scanTsImports(source);
    case "python":
      return scanPythonImports(source);
    case "rust":
      return scanRustImports(source);
    case "java":
    case "kotlin":
      return scanJvmImports(source, language);
    case "go":
      return scanGoImports(source);
    case "unknown":
      return [];
  }
}
