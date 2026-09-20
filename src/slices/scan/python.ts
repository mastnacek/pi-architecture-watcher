/**
 * Python import extraction — internal to the `scan` slice.
 *
 * Deep module: `scanPythonImports(source)` returns `import` / `from … import`
 * edges with relative dots normalised to `./` / `../` specifiers that the
 * shared resolver already understands. Comments (`#`) and strings are masked
 * first, so a quoted `import` never becomes an edge.
 */

import { maskCLike } from "./c-mask.js";
import { lineAt } from "./positions.js";
import type { ImportEdge } from "../../shared/types.js";

const FROM = /(^|\n)[ \t]*from[ \t]+([.\w]+)[ \t]+import\b/g;
const PLAIN = /(^|\n)[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/g;

/** `from .pkg.mod import x` -> `../pkg/mod`, `from . import x` -> `./`. */
function relativeSpecifier(dots: number, module: string): string {
  const up = dots <= 1 ? "./" : "../".repeat(dots - 1);
  return module.length === 0 ? up : `${up}${module.replace(/\./g, "/")}`;
}

export function scanPythonImports(source: string): ImportEdge[] {
  const { masked } = maskCLike(source, { hashComment: true, tripleQuote: true });
  const edges: ImportEdge[] = [];

  for (const match of masked.matchAll(FROM)) {
    const raw = match[2] ?? "";
    if (raw.length === 0) continue;
    const index = (match.index ?? 0) + (match[1]?.length ?? 0);
    if (raw.startsWith(".")) {
      const dots = raw.match(/^\.+/)?.[0].length ?? 1;
      const module = raw.slice(dots);
      edges.push({ specifier: relativeSpecifier(dots, module), kind: "static", line: lineAt(masked, index), column: 1 });
    } else {
      edges.push({ specifier: raw, kind: "static", line: lineAt(masked, index), column: 1 });
    }
  }

  for (const match of masked.matchAll(PLAIN)) {
    const list = match[2] ?? "";
    const index = (match.index ?? 0) + (match[1]?.length ?? 0);
    const line = lineAt(masked, index);
    for (const part of list.split(",")) {
      const specifier = part.trim();
      if (specifier.length > 0) {
        edges.push({ specifier, kind: "static", line, column: 1 });
      }
    }
  }

  edges.sort((a, b) => a.line - b.line || a.column - b.column);
  return edges;
}