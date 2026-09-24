// Extracted from rules.ts to keep modules focused.
/**
 * Rule engine — internal to the `classify` slice.
 *
 * Deep module: a rule is `(facts) => Finding[]`. Adding a detection means
 * adding one pure function to `RULES`, nothing else. Rules never mutate inputs,
 * never touch the network and never call a model.
 */

import { dirname } from "node:path";
import {
	type Dependency,
	type EnrichedFacts,
} from "./enrich.js";
import type { Finding } from "../../shared/types.js";

/** Slice-internal filenames that hint at an anaemic, non-vertical design. */
export const GENERIC_SLICE_NAMES = [
  "utils",
  "helpers",
  "common",
  "shared",
  "types",
  "constants",
  "service",
  "manager",
  "index",
];

export function finding(
  rule: string,
  severity: Finding["severity"],
  facts: EnrichedFacts,
  title: string,
  detail: string,
  suggestion: string,
  line?: number,
  fix?: string,
): Finding {
  const out: Finding = {
    rule,
    severity,
    file: facts.file.rel,
    title,
    detail,
    suggestion,
  };
  if (line !== undefined) out.line = line;
  if (fix !== undefined) out.fix = fix;
  return out;
}

/** The public entry a cross-slice import *should* have used. */
export function publicTarget(facts: EnrichedFacts, dep: Dependency): string | null {
  if (!dep.targetSlice) return null;
  return facts.lookup.publicEntryPath(dep.targetSlice);
}
