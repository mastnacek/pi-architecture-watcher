/**
 * Dependency enrichment — internal to the `classify` slice.
 *
 * Deep module: turns raw `ImportEdge`s plus the topology view into
 * `Dependency` facts (resolved target, owning slice, public/internals status)
 * and hands the rules cached, read-only `readSource` / `importsOf` accessors so
 * no rule ever performs its own I/O bookkeeping.
 */

import { dirname, relative } from "node:path";
import { scanImports } from "../scan/index.js";
import { readTextSafe, toPosix } from "../../shared/paths.js";
import type {
  FileFacts,
  ImportEdge,
  SliceRef,
} from "../../shared/types.js";

export interface Dependency {
  edge: ImportEdge;
  /** absolute resolved path, or null for packages/built-ins */
  target: string | null;
  targetSlice: SliceRef | null;
  shared: string | null;
  isPublicEntry: boolean;
  /** true when the target sits in `internal/`, `lib/`, `utils/`, … */
  isInternal: boolean;
}

export interface EnrichedFacts extends FileFacts {
  dependencies: Dependency[];
  readSource: (absPath: string) => string | null;
  importsOf: (absPath: string) => ImportEdge[];
}

/** Rewrite an import specifier so it points at `toFile`, keeping the caller's style. */
export function retargetSpecifier(
  original: string,
  fromFileAbs: string,
  toFileAbs: string,
): string {
  const extension = /(\.[cm]?[jt]sx?)$/.exec(original)?.[1] ?? "";
  let rel = toPosix(relative(dirname(fromFileAbs), toFileAbs));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return `${rel.replace(/\.[cm]?[jt]sx?$/, "")}${extension}`;
}

export function enrich(facts: FileFacts): EnrichedFacts {
  const { lookup, file, config } = facts;

  const sourceCache = new Map<string, string | null>();
  const importsCache = new Map<string, ImportEdge[]>();

  const readSource = (absPath: string): string | null => {
    if (!sourceCache.has(absPath)) sourceCache.set(absPath, readTextSafe(absPath));
    return sourceCache.get(absPath) ?? null;
  };

  const importsOf = (absPath: string): ImportEdge[] => {
    const cached = importsCache.get(absPath);
    if (cached) return cached;
    const content = readSource(absPath);
    const parsed = content === null ? [] : scanImports(content);
    importsCache.set(absPath, parsed);
    return parsed;
  };

  const dependencies: Dependency[] = facts.imports.map((edge) => {
    const target = facts.resolve(edge);
    const targetSlice = target ? lookup.sliceOf(target) : null;
    const isPublicEntry =
      target !== null && targetSlice !== null
        ? lookup.isPublicEntry(target, targetSlice)
        : false;
    const isInternal =
      target !== null && targetSlice !== null
        ? target
            .slice(targetSlice.dir.length + 1)
            .split("/")
            .slice(0, -1)
            .some((segment) => config.internalsDirNames.includes(segment))
        : false;

    return {
      edge,
      target,
      targetSlice,
      shared: target ? lookup.sharedOf(target) : null,
      isPublicEntry,
      isInternal,
    };
  });

  return { ...facts, dependencies, readSource, importsOf };
}
