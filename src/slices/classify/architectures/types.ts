/**
 * Architecture-specific rule registry — internal to the `classify` slice.
 *
 * Deep module: each architecture gets its own ordered rule set. The classifier
 * dispatches to the active architecture's rules. VSA rules remain the default
 * and are registered under the "vsa" key.
 */

import type { EnrichedFacts } from "../enrich.js";
import type { Finding } from "../../../shared/types.js";

/** A named rule function that produces zero or more findings. */
export interface Rule {
  id: string;
  severity: Finding["severity"];
  description: string;
  run: (facts: EnrichedFacts) => Finding[];
}

/** All rules for one architecture. */
export interface ArchitectureRuleSet {
  architecture: string;
  rules: Rule[];
}

/** Merge multiple rule sets, later ones override earlier by rule id. */
export function mergeRuleSets(
  base: ArchitectureRuleSet,
  overrides: ArchitectureRuleSet[],
): ArchitectureRuleSet {
  const map = new Map<string, Rule>();
  for (const rule of base.rules) map.set(rule.id, rule);
  for (const override of overrides) {
    for (const rule of override.rules) map.set(rule.id, rule);
  }
  return { architecture: base.architecture, rules: [...map.values()] };
}

/** Filter rules by architecture — exact match. */
export function rulesForArchitecture(
  registry: Map<string, ArchitectureRuleSet>,
  architecture: string,
): Rule[] {
  const set = registry.get(architecture);
  if (set) return set.rules;
  // Fall back to VSA
  const vsa = registry.get("vsa");
  return vsa?.rules ?? [];
}