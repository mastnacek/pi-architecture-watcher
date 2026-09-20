/**
 * Go import extraction — internal to the `scan` slice.
 *
 * Deep module: `scanGoImports(source)` reads `import "path"`, aliased imports
 * and parenthesised blocks, returning the quoted module paths. Backtick raw
 * strings and comments are masked first, so a commented import is never an edge.
 */

import { maskCLike } from "./c-mask.js";
import type { ImportEdge } from "../../shared/types.js";

const PLACEHOLDER = /\u0000(\d+)\u0001/g;
const IMPORT_BLOCK = /\bimport\s*\(/g;

interface Literal {
  value: string;
  line: number;
  column: number;
}

function literalsIn(window: string, literals: readonly Literal[]): ImportEdge[] {
  const out: ImportEdge[] = [];
  PLACEHOLDER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER.exec(window)) !== null) {
    const literal = literals[Number(match[1])];
    if (literal && literal.value.length > 0) {
      out.push({
        specifier: literal.value,
        kind: "static",
        line: literal.line,
        column: literal.column,
      });
    }
  }
  return out;
}

/** Find the matching `)` for a block starting at `from`, ignoring nesting. */
function blockEnd(masked: string, from: number): number {
  let depth = 1;
  for (let i = from; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return masked.length;
}

export function scanGoImports(source: string): ImportEdge[] {
  const { masked, literals } = maskCLike(source, { backtickRaw: true });
  const edges: ImportEdge[] = [];

  for (const match of masked.matchAll(IMPORT_BLOCK)) {
    const close = blockEnd(masked, (match.index ?? 0) + match[0].length);
    const window = masked.slice((match.index ?? 0) + match[0].length, close);
    edges.push(...literalsIn(window, literals));
  }

  // Single imports: `import "x"` (placeholders left in the masked text).
  for (const match of masked.matchAll(/\bimport\s+/g)) {
    const after = masked.slice((match.index ?? 0) + match[0].length);
    if (after.startsWith("(")) continue;
    PLACEHOLDER.lastIndex = 0;
    const literalMatch = PLACEHOLDER.exec(after);
    if (!literalMatch || literalMatch.index > 0) continue;
    const literal = literals[Number(literalMatch[1])];
    if (literal && literal.value.length > 0) {
      edges.push({
        specifier: literal.value,
        kind: "static",
        line: literal.line,
        column: literal.column,
      });
    }
  }

  const seen = new Set<string>();
  return edges
    .filter((e) => (seen.has(`${e.line}:${e.specifier}`) ? false : (seen.add(`${e.line}:${e.specifier}`), true)))
    .sort((a, b) => a.line - b.line || a.column - b.column);
}