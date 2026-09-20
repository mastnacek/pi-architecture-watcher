/**
 * Feature-Sliced Design (FSD) rules — layers: app/processes/pages/features/entities/shared.
 *
 * Deep module: strict layer hierarchy. Lower layers cannot import higher layers.
 * shared -> entities -> features -> widgets -> pages -> processes -> app
 */

import { relPosix } from "../../../shared/paths.js";
import type { EnrichedFacts } from "../enrich.js";
import type { Rule, ArchitectureRuleSet } from "./types.js";
import type { Finding } from "../../../shared/types.js";

const FSD_LAYERS = ["shared", "entities", "features", "widgets", "pages", "processes", "app"] as const;
type FsdLayer = typeof FSD_LAYERS[number] | string;

function fsdLayerOf(path: string): FsdLayer {
  const rel = path.split("/")[0] ?? "";
  return (FSD_LAYERS.find((l) => rel.startsWith(l)) ?? rel) as FsdLayer;
}

function layerRank(layer: FsdLayer): number {
  const idx = FSD_LAYERS.indexOf(layer as typeof FSD_LAYERS[number]);
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

// R1 - import from higher layer
function importFromHigherLayer(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = fsdLayerOf(facts.file.rel);
  const myRank = layerRank(fileLayer);

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = fsdLayerOf(relPosix(facts.projectRoot, dep.target));
    const targetRank = layerRank(targetLayer);

    if (targetRank > myRank) {
      out.push(
        finding(
          "fsd-import-from-higher-layer",
          "error",
          facts,
          "Nizsi vrstva importuje z vyssi",
          `\${facts.file.rel} (${fileLayer}) importuje z \${targetLayer} (radek \${dep.edge.line}). Importy jen dolu.`,
          "Presun kod do nizsi vrstvy.",
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R2 - shared layer imports from app layers
function sharedImportsAppLayer(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = fsdLayerOf(facts.file.rel);
  if (fileLayer !== "shared") return out;

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = fsdLayerOf(relPosix(facts.projectRoot, dep.target));
    if (targetLayer !== "shared") {
      out.push(
        finding(
          "fsd-shared-imports-app",
          "error",
          facts,
          "Shared vrstva importuje z aplikacni vrstvy",
          `\${facts.file.rel} (shared) importuje z \${targetLayer} (radek \${dep.edge.line}). Shared musi byt nezavisle.`,
          "Presun kod do shared, nebo obrať zavislost.",
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R3 - entities imports features/widgets/pages
function entitiesImportsUpper(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = fsdLayerOf(facts.file.rel);
  if (fileLayer !== "entities") return out;

  const forbidden = ["features", "widgets", "pages", "processes", "app"];
  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = fsdLayerOf(relPosix(facts.projectRoot, dep.target));
    if (forbidden.includes(targetLayer)) {
      out.push(
        finding(
          "fsd-entities-imports-upper",
          "error",
          facts,
          "Entities importuje z features/widgets/pages",
          `\${facts.file.rel} (entities) importuje z \${targetLayer} (radek \${dep.edge.line}). Entities musi byt ciste.`,
          "Presun logiku do entities, nebo pouzij shared typy.",
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R4 - features imports pages/processes/app
function featuresImportsUpper(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = fsdLayerOf(facts.file.rel);
  if (fileLayer !== "features") return out;

  const forbidden = ["pages", "processes", "app"];
  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = fsdLayerOf(relPosix(facts.projectRoot, dep.target));
    if (forbidden.includes(targetLayer)) {
      out.push(
        finding(
          "fsd-features-imports-upper",
          "error",
          facts,
          "Features importuje z pages/processes/app",
          `\${facts.file.rel} (features) importuje z \${targetLayer} (radek \${dep.edge.line}). Features jen shared/entities.`,
          "Presun logiku do features/entities/shared.",
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R5 - widgets imports pages/processes/app
function widgetsImportsUpper(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = fsdLayerOf(facts.file.rel);
  if (fileLayer !== "widgets") return out;

  const forbidden = ["pages", "processes", "app"];
  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = fsdLayerOf(relPosix(facts.projectRoot, dep.target));
    if (forbidden.includes(targetLayer)) {
      out.push(
        finding(
          "fsd-widgets-imports-upper",
          "error",
          facts,
          "Widgets importuje z pages/processes/app",
          `\${facts.file.rel} (widgets) importuje z \${targetLayer} (radek \${dep.edge.line}). Widgets jen shared/entities/features.`,
          "Presun logiku do widgets/features/entities/shared.",
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R6 - pages imports processes/app
function pagesImportsUpper(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = fsdLayerOf(facts.file.rel);
  if (fileLayer !== "pages") return out;

  const forbidden = ["processes", "app"];
  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = fsdLayerOf(relPosix(facts.projectRoot, dep.target));
    if (forbidden.includes(targetLayer)) {
      out.push(
        finding(
          "fsd-pages-imports-upper",
          "error",
          facts,
          "Pages importuje z processes/app",
          `\${facts.file.rel} (pages) importuje z \${targetLayer} (radek \${dep.edge.line}). Pages skladaji widgets/features.`,
          "Presun orchestraci do processes, page jen renderuje.",
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R7 - segment rules within features
function featureSegmentViolation(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = fsdLayerOf(facts.file.rel);
  if (fileLayer !== "features") return out;

  const rel = relPosix(facts.projectRoot, facts.file.path);
  const segments = rel.split("/");
  if (segments.length < 3) return out;

  const segment = segments[2];
  if (!segment) return out;
  const validSegments = ["ui", "model", "api", "lib", "config"];
  if (!validSegments.includes(segment)) return out;

  const mySegment = segment;
  const forbiddenSegments: Record<string, string[]> = {
    ui: ["model"],
    api: [],
    lib: [],
    model: ["ui"],
    config: [],
  };

  const forbidden = forbiddenSegments[mySegment] ?? [];
  if (forbidden.length === 0) return out;

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetRel = relPosix(facts.projectRoot, dep.target);
    const targetSegments = targetRel.split("/");
    if (targetSegments.length < 3) continue;
    if (targetSegments[0] !== "features" || targetSegments[1] !== segments[1]) continue;
    const targetSegment = targetSegments[2];
    if (!targetSegment) continue;
    if (forbidden.includes(targetSegment)) {
      out.push(
        finding(
          "fsd-feature-segment-violation",
          "warning",
          facts,
          "Feature segment importuje zakazany segment",
          `\${facts.file.rel} (\${mySegment}) importuje z \${targetSegment} (radek \${dep.edge.line}).`,
          "Presun logiku do spravneho segmentu, nebo pouzij api.",
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R8 - feature has no public API
function featureMissingPublicApi(facts: EnrichedFacts): Finding[] {
  if (!facts.slice || fsdLayerOf(facts.slice.id) !== "features") return [];
  if (facts.slice.hasPublicEntry) return [];

  return [
    finding(
      "fsd-feature-missing-api",
      "warning",
      facts,
      "Feature nema public API (api.ts)",
      `Feature \${facts.slice.id} nema api.ts exportujici verejne rozhrani. Jine vrstvy pouzivaji feature pres api.ts.`,
      "Pridej api.ts re-exportujici jen to, co spotrebitelé potrebuji.",
    ),
  ];
}

// R9 - processes orchestrate but contain business logic
function processHasBusinessLogic(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = fsdLayerOf(facts.file.rel);
  if (fileLayer !== "processes") return out;

  const content = facts.file.content;
  const hasLogic = /if\s*\([^)]*\)\s*\{[^}]{80,}/.test(content)
    || /for\s*\([^)]*\)\s*\{[^}]{80,}/.test(content)
    || /\w+\s*[=+\-*/]=/.test(content);

  if (hasLogic) {
    out.push(
      finding(
        "fsd-process-business-logic",
        "warning",
        facts,
        "Business logika v process vrstve",
        `\${facts.file.rel} (processes) obsahuje business logiku. Processes jen orchestruji.`,
        "Presun logiku do features/<feature>/model nebo lib.",
      ),
    );
  }
  return out;
}

// R10 - app layer imports non-app
function appImportsNonWiring(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = fsdLayerOf(facts.file.rel);
  if (fileLayer !== "app") return out;

  const content = facts.file.content;
  const isWiring = /import.*from\s+["']\.\/(providers|styles|router|store)/.test(content)
    || /export.*providers|export.*router|export.*store/.test(content);

  if (!isWiring) {
    out.push(
      finding(
        "fsd-app-non-wiring",
        "hint",
        facts,
        "App vrstva obsahuje non-wiring kod",
        `\${facts.file.rel} (app) neobsahuje jen wiring (providers, router, store). App jen kompozicni koren.`,
        "Presun logiku do processes/pages/widgets/features.",
      ),
    );
  }
  return out;
}

export const FSD_RULES: Rule[] = [
  { id: "fsd-import-from-higher-layer", severity: "error", description: "Nizsi vrstva importuje z vyssi - importy jen dolu.", run: importFromHigherLayer },
  { id: "fsd-shared-imports-app", severity: "error", description: "Shared importuje z aplikacni vrstvy - shared musi byt nezavisle.", run: sharedImportsAppLayer },
  { id: "fsd-entities-imports-upper", severity: "error", description: "Entities importuje z features/widgets/pages - entities musi byt ciste.", run: entitiesImportsUpper },
  { id: "fsd-features-imports-upper", severity: "error", description: "Features importuje z pages/processes/app - features jen shared/entities.", run: featuresImportsUpper },
  { id: "fsd-widgets-imports-upper", severity: "error", description: "Widgets importuje z pages/processes/app - widgets jen shared/entities/features.", run: widgetsImportsUpper },
  { id: "fsd-pages-imports-upper", severity: "error", description: "Pages importuje z processes/app - pages skladaji widgets/features.", run: pagesImportsUpper },
  { id: "fsd-feature-segment-violation", severity: "warning", description: "Feature segment (ui/model/api/lib) importuje zakazany segment.", run: featureSegmentViolation },
  { id: "fsd-feature-missing-api", severity: "warning", description: "Feature nema api.ts jako verejne rozhrani.", run: featureMissingPublicApi },
  { id: "fsd-process-business-logic", severity: "warning", description: "Process vrstva obsahuje business logiku misto orchestrace.", run: processHasBusinessLogic },
  { id: "fsd-app-non-wiring", severity: "hint", description: "App vrstva obsahuje kod mimo wiring (providers/router/store).", run: appImportsNonWiring },
];

export const FSD_RULE_SET: ArchitectureRuleSet = {
  architecture: "fsd",
  rules: FSD_RULES,
};