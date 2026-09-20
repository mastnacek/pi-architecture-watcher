/**
 * Architecture rule registry — internal to the `classify` slice.
 *
 * Deep module: central registry of all architecture-specific rule sets.
 * The classifier imports from here and dispatches to the active architecture.
 */

import { VSA_RULE_SET } from "./vsa.js";
import { CLEAN_RULE_SET } from "./clean.js";
import { HEXAGONAL_RULE_SET } from "./hexagonal.js";
import { LAYERED_RULE_SET } from "./layered.js";
import { MODULAR_MONOLITH_RULE_SET } from "./modular-monolith.js";
import { FSD_RULE_SET } from "./fsd.js";
import type { ArchitectureRuleSet, Rule } from "./types.js";

/** Registry of all architecture rule sets, keyed by architecture ID. */
export const ARCHITECTURE_RULE_SETS: Map<string, ArchitectureRuleSet> = new Map([
  ["vsa", VSA_RULE_SET],
  ["clean", CLEAN_RULE_SET],
  ["hexagonal", HEXAGONAL_RULE_SET],
  ["layered", LAYERED_RULE_SET],
  ["modular-monolith", MODULAR_MONOLITH_RULE_SET],
  ["fsd", FSD_RULE_SET],
]);

/** Get the rule set for an architecture, falling back to VSA. */
export function getRuleSet(architecture: string): ArchitectureRuleSet {
  return ARCHITECTURE_RULE_SETS.get(architecture) ?? VSA_RULE_SET;
}

/** Get all rules for an architecture as a flat array. */
export function getRulesForArchitecture(architecture: string): Rule[] {
  return getRuleSet(architecture).rules;
}

/** Build a flat rule catalogue for `/vsa rules` command, specific to an architecture. */
export function buildRuleCatalogue(architecture: string): ReadonlyArray<[string, Rule["severity"], string]> {
  const ruleSet = getRuleSet(architecture);
  return ruleSet.rules.map((r) => [r.id, r.severity, r.description]);
}

/** All available architecture IDs. */
export const SUPPORTED_ARCHITECTURES = [...ARCHITECTURE_RULE_SETS.keys()];