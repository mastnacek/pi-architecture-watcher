/**
 * Rust import extraction — internal to the `scan` slice.
 *
 * Deep module: `scanRustImports(source)` returns `use` and `mod` edges as
 * `crate::` / `self::` / `super::` paths. The resolver walks those onto real
 * files; external crate paths resolve to `null` and are ignored.
 */

import { maskCLike } from "./c-mask.js";
import { lineAt } from "./positions.js";
import type { ImportEdge } from "../../shared/types.js";

const USE = /\buse\s+([^;]+);/g;
const MOD = /\bmod\s+([a-z_][\w]*)\s*;/g;

/** Collapse a `use` path: drop `as x`, flatten `a::b::{C, D}` to `a::b`. */
function normalizeUsePath(raw: string): string {
  let text = raw.replace(/\bas\b[^,}]*/g, "");
  const brace = text.indexOf("{");
  if (brace !== -1) text = text.slice(0, brace);
  text = text.replace(/\s+/g, "").replace(/::+$/g, "").replace(/^::/, "");
  return text;
}

export function scanRustImports(source: string): ImportEdge[] {
  const { masked } = maskCLike(source, { rustRaw: true });
  const edges: ImportEdge[] = [];

  for (const match of masked.matchAll(USE)) {
    const path = normalizeUsePath(match[1] ?? "");
    if (path.length === 0 || path.includes("*")) continue;
    const index = match.index ?? 0;
    edges.push({ specifier: path, kind: "static", line: lineAt(masked, index), column: 1 });
  }

  for (const match of masked.matchAll(MOD)) {
    const name = match[1] ?? "";
    if (name.length === 0) continue;
    const index = match.index ?? 0;
    edges.push({ specifier: `self::${name}`, kind: "static", line: lineAt(masked, index), column: 1 });
  }

  edges.sort((a, b) => a.line - b.line || a.column - b.column);
  return edges;
}