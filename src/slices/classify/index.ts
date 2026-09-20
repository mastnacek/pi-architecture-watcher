/**
 * Public boundary of the `classify` slice.
 *
 * `classifyFile(facts)` is the whole API: facts in, `Report` out.
 */

import { enrich } from "./enrich.js";
import { runRules } from "./rules.js";
import { countBySeverity, scoreFindings, verdictOf } from "./score.js";
import { getRulesForArchitecture, buildRuleCatalogue } from "./architectures/index.js";
import type { FileFacts, Report } from "../../shared/types.js";

/** Classify one prospective file write and score its architecture adherence. */
export function classifyFile(facts: FileFacts): Report {
  const enriched = enrich(facts);
  const architectureRules = getRulesForArchitecture(facts.config.architecture);
  const findings = runRules(enriched, architectureRules);
  const score = scoreFindings(findings);

  return {
    file: facts.file.rel,
    abs: facts.file.path,
    slice: facts.slice?.id ?? null,
    shared: facts.shared,
    verdict: verdictOf(findings, score),
    score,
    findings,
    counts: countBySeverity(findings),
    generatedBy: "pi-architecture-watcher",
    timestamp: Date.now(),
  };
}

export { atLeast, countBySeverity, scoreFindings, strongest, verdictOf } from "./score.js";
export { enrich, retargetSpecifier } from "./enrich.js";
export { buildRuleCatalogue } from "./architectures/index.js";
export type { Dependency, EnrichedFacts } from "./enrich.js";
