/**
 * Import extraction — internal to the `scan` slice.
 *
 * Deep module: `scanImports(source)` returns every dependency edge (static,
 * side-effect, type-only, re-export, dynamic and `require`) with exact line
 * positions. It sits on top of `maskSource`, so comments and strings never
 * produce false edges.
 */

import { maskSource } from "./mask.js";
import type { ImportEdge, ImportKind } from "../../shared/types.js";

const PLACEHOLDER = /\u0000(\d+)\u0001/g;

/** Find the first literal placeholder inside a masked window. */
function firstPlaceholder(window: string): { index: number; literalIndex: number } | null {
  PLACEHOLDER.lastIndex = 0;
  const m = PLACEHOLDER.exec(window);
  if (!m) return null;
  return { index: m.index, literalIndex: Number(m[1]) };
}

/** Slice a statement window: ends at a depth-0 `;` or a depth-0 newline. */
function statementWindow(masked: string, from: number): string {
  const limit = Math.min(masked.length, from + 2000);
  let depth = 0;
  let end = from;
  for (let i = from; i < limit; i += 1) {
    const c = masked[i]!;
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") depth = Math.max(0, depth - 1);
    if (c === ";" && depth === 0) {
      end = i + 1;
      break;
    }
    if (c === "\n" && depth === 0) {
      end = i;
      break;
    }
    end = i + 1;
  }
  return masked.slice(from, end);
}

/** Decide what kind of edge a keyword introduces, or `null` for non-edges. */
function kindOf(
  word: string,
  window: string,
  placeholderIndex: number,
): ImportKind | null {
  const head = window.slice(0, placeholderIndex);
  const lead = window.replace(/^\s+/, "");

  if (word === "require") {
    return lead.startsWith("(") || lead.startsWith(".require(") ? "require" : null;
  }

  if (word === "import") {
    if (lead.startsWith("(")) return "dynamic";
    if (/\bfrom\b/.test(head)) return /^\s*type\b/.test(window) ? "type" : "static";
    return "side-effect";
  }

  // export
  if (word === "export") {
    return /\bfrom\b/.test(head) ? "export" : null;
  }

  return null;
}

/**
 * Scan a TypeScript/JavaScript source for import edges.
 * Pure function — no filesystem access, no configuration.
 */
export function scanImports(source: string): ImportEdge[] {
  const { masked, literals } = maskSource(source);
  const edges: ImportEdge[] = [];
  const keyword = /\b(import|export|require)\b/g;

  let match: RegExpExecArray | null;
  while ((match = keyword.exec(masked)) !== null) {
    const word = match[1]!;
    const start = match.index;
    const prev = start > 0 ? masked[start - 1]! : "";

    // `obj.require(...)` and `import.meta` are not module edges
    if (prev === ".") continue;
    if (word === "import" && masked[start + word.length] === ".") continue;

    const window = statementWindow(masked, start + word.length);
    const placeholder = firstPlaceholder(window);
    if (!placeholder) continue;

    const kind = kindOf(word, window, placeholder.index);
    if (!kind) continue;

    const literal = literals[placeholder.literalIndex];
    if (!literal || literal.value.length === 0) continue;

    edges.push({
      specifier: literal.value,
      kind,
      line: literal.line,
      column: literal.column,
    });
  }

  edges.sort((a, b) => a.line - b.line || a.column - b.column);
  return edges;
}
