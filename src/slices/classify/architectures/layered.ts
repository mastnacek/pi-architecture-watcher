/**
 * Layered / N-tier rules — strict horizontal tiers.
 *
 * Deep module: each layer imports ONLY the layer directly below.
 * controller → service → repository → data
 * Skipping layers is forbidden. Cycles are forbidden.
 */

import { relPosix } from "../../../shared/paths.js";
import type { EnrichedFacts } from "../enrich.js";
import type { Rule, ArchitectureRuleSet } from "./types.js";
import type { Finding } from "../../../shared/types.js";

const TIER_ORDER = ["controllers", "presentation", "services", "use-cases", "repositories", "data", "models", "entities"] as const;
type TierName = typeof TIER_ORDER[number] | string;

function tierOf(path: string): TierName {
  const rel = path.split("/")[0] ?? "";
  return (TIER_ORDER.find((t) => rel.startsWith(t)) ?? rel) as TierName;
}

function tierRank(tier: TierName): number {
  const idx = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number]);
  return idx >= 0 ? idx : 50;
}

function finding(
  rule: string,
  severity: Finding["severity"],
  facts: EnrichedFacts,
  title: string,
  detail: string,
  suggestion: string,
  line?: number,
): Finding {
  const out: Finding = { rule, severity, file: facts.file.rel, title, detail, suggestion };
  if (line !== undefined) out.line = line;
  return out;
}

// R1 — skip layer (import non-adjacent lower tier)
function layerSkip(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileTier = tierOf(facts.file.rel);
  const myRank = tierRank(fileTier);

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetTier = tierOf(relPosix(facts.projectRoot, dep.target));
    const targetRank = tierRank(targetTier);

    if (targetRank > myRank + 1) {
      out.push(
        finding(
          "layered-skip-tier",
          "error",
          facts,
          `Přeskočená vrstva: \`${fileTier}\` → \`${targetTier}\``,
          `\`${facts.file.rel}\` (${fileTier}) importuje \`${dep.edge.specifier}\` z \`${targetTier}\` (řádek ${dep.edge.line}). `
            + `Vrstvy smí záviset JEN na přímé vrstvě pod sebou (${fileTier} → ${TIER_ORDER[myRank + 1] ?? "?"}).`,
          `Přidej chybějící vrstvu, nebo přesuň logiku do správné vrstvy.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R2 — upward dependency (lower tier imports upper)
function upwardDependency(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileTier = tierOf(facts.file.rel);
  const myRank = tierRank(fileTier);

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetTier = tierOf(relPosix(facts.projectRoot, dep.target));
    const targetRank = tierRank(targetTier);

    if (targetRank < myRank) {
      out.push(
        finding(
          "layered-upward-dependency",
          "error",
          facts,
          `Závislost nahoru: \`${fileTier}\` → \`${targetTier}\``,
          `\`${facts.file.rel}\` (${fileTier}) importuje \`${dep.edge.specifier}\` z \`${targetTier}\` (řádek ${dep.edge.line}). `
            + `Závislosti směřují jen DOLŮ (controller → service → repository).`,
          `Obrať závislost: přesuň rozhraní dolů, nebo použij callback/event.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R3 — cycle within same tier
function sameTierCycle(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileTier = tierOf(facts.file.rel);

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetTier = tierOf(relPosix(facts.projectRoot, dep.target));
    if (targetTier !== fileTier) continue;

    const backEdges = facts
      .importsOf(dep.target)
      .filter((edge) => {
        const resolved = facts.resolve(edge);
        if (!resolved) return false;
        return tierOf(relPosix(facts.projectRoot, resolved)) === fileTier;
      });

    if (backEdges.length > 0) {
      out.push(
        finding(
          "layered-same-tier-cycle",
          "error",
          facts,
          `Cyklická závislost ve vrstvě \`${fileTier}\``,
          `\`${facts.file.rel}\` a \`${dep.edge.specifier}\` se v \`${fileTier}\` importují navzájem. `
            + `Stejná vrstva nesmí mít cykly.`,
          `Extrahuj sdílený kód do společného modulu ve vrstvě, nebo použij události.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R4 — controller imports repository directly (skip service)
function controllerImportsRepository(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileTier = tierOf(facts.file.rel);
  if (fileTier !== "controllers" && fileTier !== "presentation") return out;

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetTier = tierOf(relPosix(facts.projectRoot, dep.target));
    if (targetTier === "repositories" || targetTier === "data") {
      out.push(
        finding(
          "layered-controller-to-repo",
          "error",
          facts,
          `Kontroler volá repozitář přímo: \`${targetTier}\``,
          `\`${facts.file.rel}\` (${fileTier}) importuje \`${dep.edge.specifier}\` z \`${targetTier}\` (řádek ${dep.edge.line}). `
            + `Kontroler → Service → Repository. Přímý skok zakázán.`,
          `Přidej service vrstvu mezi kontroler a repozitář.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R5 — data layer has business logic
function logicInDataLayer(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileTier = tierOf(facts.file.rel);
  if (fileTier !== "data" && fileTier !== "repositories" && fileTier !== "models") return out;

  const content = facts.file.content;
  const hasLogic = /\bfunction\s+\w+\([^)]*\)\s*\{[^}]{100,}/.test(content)
    || /\bif\s*\([^)]*\)\s*\{[^}]{50,}/.test(content)
    || /\bfor\s*\([^)]*\)\s*\{[^}]{50,}/.test(content);

  if (hasLogic) {
    out.push(
      finding(
        "layered-logic-in-data",
        "warning",
        facts,
        `Business logika ve vrstvě dat: \`${fileTier}\``,
        `\`${facts.file.rel}\` v \`${fileTier}\` obsahuje netriviální logiku. `
          + `Vrstva dat by měla být jen CRUD/perzistence.`,
        `Přesuň logiku do \`services/\` nebo \`use-cases/\`.`,
      ),
    );
  }
  return out;
}

// R6 — shared kernel imports from tiers (inverted)
function sharedImportsTier(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.shared) return out;

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetTier = tierOf(relPosix(facts.projectRoot, dep.target));
    if (TIER_ORDER.includes(targetTier as typeof TIER_ORDER[number])) {
      out.push(
        finding(
          "layered-shared-imports-tier",
          "error",
          facts,
          `Sdílené jádro importuje z vrstvy: \`${targetTier}\``,
          `\`${facts.file.rel}\` (shared) importuje \`${dep.edge.specifier}\` z \`${targetTier}\` (řádek ${dep.edge.line}). `
            + `Shared kernel nesmí záviset na aplikačních vrstvách.`,
          `Přesuň sdílenou abstrakci do shared, nebo obrať závislost.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

export const LAYERED_RULES: Rule[] = [
  { id: "layered-skip-tier", severity: "error", description: "Import přeskočí vrstvu — závislosti jen na přímém následníku.", run: layerSkip },
  { id: "layered-upward-dependency", severity: "error", description: "Nižší vrstva importuje vyšší — závislosti směřují jen dolů.", run: upwardDependency },
  { id: "layered-same-tier-cycle", severity: "error", description: "Cyklická závislost uvnitř jedné vrstvy.", run: sameTierCycle },
  { id: "layered-controller-to-repo", severity: "error", description: "Kontroler volá repozitář přímo, přeskočí service vrstvu.", run: controllerImportsRepository },
  { id: "layered-logic-in-data", severity: "warning", description: "Business logika ve vrstvě dat/repozitářů místo v service.", run: logicInDataLayer },
  { id: "layered-shared-imports-tier", severity: "error", description: "Sdílené jádro importuje z aplikačních vrstev.", run: sharedImportsTier },
];

export const LAYERED_RULE_SET: ArchitectureRuleSet = {
  architecture: "layered",
  rules: LAYERED_RULES,
};