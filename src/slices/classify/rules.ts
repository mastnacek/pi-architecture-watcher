/**
 * Rule engine — internal to the `classify` slice.
 *
 * Deep module: a rule is `(facts) => Finding[]`. Adding a detection means
 * adding one pure function to `RULES`, nothing else. Rules never mutate inputs,
 * never touch the network and never call a model.
 */

import { dirname } from "node:path";
import { baseName, relPosix, stripExtension } from "../../shared/paths.js";
import type { Dependency, EnrichedFacts } from "./enrich.js";
import { retargetSpecifier } from "./enrich.js";
import type { Finding } from "../../shared/types.js";
import type { Rule } from "./architectures/types.js";
import {
	GENERIC_SLICE_NAMES,
	finding,
	publicTarget,
} from "./rules-support.js";

import {
	crossSliceDeepImport,
	crossSliceCycle,
	sharedDependsOnSlice,
	sliceFanOut,
	sharedAbuse,
} from "./rules-cross-slice.js";
import {
	orphanDomainFile,
	barrelLeak,
	looseSliceFile,
	missingPublicEntry,
	fileInSliceRoot,
} from "./rules-structure.js";

// Re-exported so existing consumers can keep importing from this module.
// Re-exported so existing consumers can keep importing from this module.
// Re-exported so existing consumers can keep importing from this module.
export * from "./rules-support.js";
export * from "./rules-cross-slice.js";
export * from "./rules-structure.js";

/** Ordered registry — order only affects presentation, not scoring. */
export const RULES: ReadonlyArray<(facts: EnrichedFacts) => Finding[]> = [
  crossSliceDeepImport,
  crossSliceCycle,
  sharedDependsOnSlice,
  orphanDomainFile,
  sliceFanOut,
  barrelLeak,
  sharedAbuse,
  looseSliceFile,
  missingPublicEntry,
  fileInSliceRoot,
];

/** Human-facing catalogue of every rule, used by `/vsa rules`. */
export const RULE_CATALOGUE: ReadonlyArray<[string, Finding["severity"], string]> = [
  [
    "cross-slice-deep-import",
    "error",
    "Řez sahá do vnitřku jiného řezu místo na jeho veřejný vstup.",
  ],
  [
    "cross-slice-cycle",
    "error",
    "Dva řezy se importují navzájem, tvoří cyklus v grafu řezů.",
  ],
  [
    "shared-depends-on-slice",
    "error",
    "Sdílené jádro importuje feature řez, obrací zamýšlené vrstvení.",
  ],
  [
    "orphan-domain-file",
    "warning",
    "Soubor mimo všechny řezy nese slovník nebo pojmenování domény řezu.",
  ],
  [
    "slice-fan-out",
    "warning",
    "Řez závisí na více sousedních řezech, než je nastavený rozpočet.",
  ],
  [
    "barrel-leak",
    "hint",
    "Veřejný vstup řezu re-exportuje vnitřky a rozšiřuje tak své rozhraní.",
  ],
  [
    "shared-abuse",
    "hint",
    "Soubor táhne mnoho modulů ze sdíleného jádra — skrytá horizontální vrstva.",
  ],
  [
    "loose-slice-file",
    "warning",
    "Generický nebo cizí doménový modul žije ve špatném řezu.",
  ],
  [
    "slice-missing-entry",
    "hint",
    "Adresář řezu nemá veřejný vstup, nutí spotřebitele k hlubokým importům.",
  ],
  [
    "file-in-slice-root",
    "hint",
    "Soubor leží přímo v kontejneru řezů místo v řezu.",
  ],
];

/** Run every rule and return findings sorted by severity, then line. */
export function runRules(facts: EnrichedFacts, architectureRules?: Rule[]): Finding[] {
  const rules = architectureRules ?? RULES;
  const rank = { error: 0, warning: 1, hint: 2 } as const;
  return rules.flatMap((rule) => {
    const fn = typeof rule === "function" ? rule : rule.run;
    return fn(facts);
  }).sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.line ?? 0) - (b.line ?? 0),
  );
}
