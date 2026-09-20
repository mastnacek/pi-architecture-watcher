/**
 * Clean Architecture rules — layers: domain → application → infrastructure/adapters.
 *
 * Deep module: dependencies must point inward. Domain has zero deps, application
 * depends only on domain, infrastructure adapts outward.
 */

import { baseName, relPosix, stripExtension } from "../../../shared/paths.js";
import type { EnrichedFacts } from "../enrich.js";
import type { Rule, ArchitectureRuleSet } from "./types.js";
import type { Finding } from "../../../shared/types.js";

const LAYER_ORDER = ["domain", "application", "use-cases", "adapters", "infrastructure", "interfaces", "presenters", "controllers", "gateways", "repositories"] as const;
type LayerName = typeof LAYER_ORDER[number] | string; // allow unknown layers

function layerOf(path: string, _roots: string[]): LayerName | null {
  const rel = path.split("/")[0] ?? "";
  return (LAYER_ORDER.find((l) => rel.startsWith(l)) ?? rel) as LayerName;
}

function layerRank(layer: LayerName | null): number {
  if (!layer) return 99;
  const idx = LAYER_ORDER.indexOf(layer as typeof LAYER_ORDER[number]);
  return idx >= 0 ? idx : 50; // unknown layers in the middle
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

// R1 — outward dependency (inner layer imports outer layer)
function outwardDependency(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = layerOf(facts.file.rel, facts.config.roots);
  if (!fileLayer) return out;

  const myRank = layerRank(fileLayer);

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = layerOf(relPosix(facts.projectRoot, dep.target), facts.config.roots);
    if (!targetLayer) continue;
    const targetRank = layerRank(targetLayer);

    if (targetRank > myRank) {
      out.push(
        finding(
          "clean-outward-dependency",
          "error",
          facts,
          `Vrstva \`${fileLayer}\` závisí na vnější vrstvě \`${targetLayer}\``,
          `\`${facts.file.rel}\` (${fileLayer}) importuje \`${dep.edge.specifier}\` z \`${targetLayer}\` (řádek ${dep.edge.line}). `
            + `Clean Architecture: závislosti směřují jen dovnitř (domain ← application ← infrastructure).`,
          `Přesuň abstrakci (interface/port) do vnitřní vrstvy a implementuj ji venku.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R2 — domain layer imports anything external
function domainImportsExternal(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = layerOf(facts.file.rel, facts.config.roots);
  if (fileLayer !== "domain") return out;

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    // Allow imports from other domain files
    const targetLayer = layerOf(relPosix(facts.projectRoot, dep.target), facts.config.roots);
    if (targetLayer && targetLayer !== "domain") {
      out.push(
        finding(
          "clean-domain-imports-external",
          "error",
          facts,
          `Doménová vrstva importuje zvenčí: \`${targetLayer}\``,
          `\`${facts.file.rel}\` (domain) importuje \`${dep.edge.specifier}\` z \`${targetLayer}\` (řádek ${dep.edge.line}). `
            + `Doména nesmí mít žádné závislosti venku.`,
          `Vytáhni závislost do rozhraní v doméně, implementaci nechej v application/infrastructure.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R3 — application imports infrastructure directly
function applicationImportsInfrastructure(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = layerOf(facts.file.rel, facts.config.roots);
  if (fileLayer !== "application" && fileLayer !== "use-cases") return out;

  for (const dep of facts.dependencies) {
    if (!dep.target) continue;
    const targetLayer = layerOf(relPosix(facts.projectRoot, dep.target), facts.config.roots);
    if (targetLayer === "infrastructure" || targetLayer === "adapters" || targetLayer === "gateways" || targetLayer === "repositories") {
      out.push(
        finding(
          "clean-application-imports-infra",
          "error",
          facts,
          `Aplikační vrstva importuje infrastrukturu přímo: \`${targetLayer}\``,
          `\`${facts.file.rel}\` (application) importuje \`${dep.edge.specifier}\` z \`${targetLayer}\` (řádek ${dep.edge.line}). `
            + `Use-cases musí záviset jen na portech (rozhraních), ne na konkrétních adaptérech.`,
          `Definuj port (interface) v application, implementuj ho v infrastructure, injektuj přes DI.`,
          dep.edge.line,
        ),
      );
    }
  }
  return out;
}

// R4 — missing port/interface for infrastructure
function missingPortForInfrastructure(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = layerOf(facts.file.rel, facts.config.roots);
  if (fileLayer !== "infrastructure" && fileLayer !== "adapters" && fileLayer !== "gateways") return out;

  // Check if this file implements something but no corresponding interface in application
  const name = stripExtension(baseName(facts.file.rel));
  const isImpl = /^(.*?)(Impl|Adapter|Gateway|Repository|Client|Service)$/i.test(name);
  if (!isImpl) return out;

  // Look for corresponding interface in application layer
  const interfaceName = name.replace(/(Impl|Adapter|Gateway|Repository|Client|Service)$/i, "");
  let found = false;

  const appLayer = facts.lookup.slices().find(s => layerOf(s.id, facts.config.roots) === "application");
  if (appLayer) {
    for (const ext of facts.config.sourceExtensions) {
      const candidate = `${appLayer.dir}/${interfaceName}${ext}`;
      if (facts.importsOf(candidate).length > 0) {
        found = true;
        break;
      }
    }
  }

  if (!found) {
    out.push(
      finding(
        "clean-missing-port",
        "warning",
        facts,
        `Implementace \`${name}\` nemá port v aplikační vrstvě`,
        `Infrastrukturní soubor \`${facts.file.rel}\` vypadá jako implementace (${name}), `
          + `ale nenalezen odpovídající port/interface v application vrstvě.`,
        `Vytvoř \`application/ports/${interfaceName}.ts\` s rozhraním, pak ho implementuj zde.`,
      ),
    );
  }
  return out;
}

// R5 — entity bleeds into outer layer
function entityInOuterLayer(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = layerOf(facts.file.rel, facts.config.roots);
  if (fileLayer === "domain") return out;

  // Heuristic: file looks like an entity (class with ID, no behavior, or "Entity" suffix)
  const content = facts.file.content;
  const isEntityLike = /\bclass\s+\w+Entity\b/.test(content)
    || /\binterface\s+\w+Entity\b/.test(content)
    || (/\bclass\s+\w+\b/.test(content) && /\bid\s*[:=]\s*["'`]\w+["'`]/.test(content) && !/\bmethod\b|\bfunction\b/i.test(content));

  if (isEntityLike && fileLayer !== "domain") {
    out.push(
      finding(
        "clean-entity-in-outer-layer",
        "warning",
        facts,
        `Entita vně doménové vrstvy: \`${fileLayer}\``,
        `\`${facts.file.rel}\` vypadá jako doménová entita, ale leží v \`${fileLayer}\`. `
          + `Entity patří do domain, ne do application/infrastructure.`,
        `Přesuň entitu do \`domain/\`, nech outer vrstvy záviset na ní přes porty.`,
      ),
    );
  }
  return out;
}

// R6 — use-case in wrong layer
function useCaseInWrongLayer(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = layerOf(facts.file.rel, facts.config.roots);
  if (fileLayer === "application" || fileLayer === "use-cases") return out;

  const content = facts.file.content;
  const isUseCase = /\bclass\s+\w+(UseCase|Command|Handler)\b/.test(content)
    || /\bexecute\s*\(/.test(content)
    || /\bhandle\s*\(/.test(content);

  if (isUseCase && fileLayer !== "application") {
    out.push(
      finding(
        "clean-usecase-in-wrong-layer",
        "warning",
        facts,
        `Use-case v nesprávné vrstvě: \`${fileLayer}\``,
        `\`${facts.file.rel}\` vypadá jako use-case/command/handler, ale leží v \`${fileLayer}\`. `
          + `Aplikační logika patří do application/use-cases.`,
        `Přesuň do \`application/\` nebo \`use-cases/\`, závislosti nechej směřovat dovnitř.`,
      ),
    );
  }
  return out;
}

// R7 — repository interface in infrastructure
function repositoryInterfaceInInfra(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  const fileLayer = layerOf(facts.file.rel, facts.config.roots);
  if (fileLayer !== "infrastructure" && fileLayer !== "adapters" && fileLayer !== "gateways") return out;

  const content = facts.file.content;
  const isRepositoryInterface = /\binterface\s+\w+Repository\b/.test(content)
    && !/\bimplements\b/.test(content);

  if (isRepositoryInterface) {
    out.push(
      finding(
        "clean-repository-interface-in-infra",
        "error",
        facts,
        `Rozhraní repozitáře v infrastruktuře`,
        `\`${facts.file.rel}\` definuje \`Repository\` interface v \`${fileLayer}\`. `
          + `Repository porty patří do application, implementace do infrastructure.`,
        `Přesuň interface do \`application/ports/\` nebo \`domain/repositories/\`, zde nech jen implementaci.`,
      ),
    );
  }
  return out;
}

export const CLEAN_RULES: Rule[] = [
  { id: "clean-outward-dependency", severity: "error", description: "Vnitřní vrstva závisí na vnější — porušuje pravidlo závislostí dovnitř.", run: outwardDependency },
  { id: "clean-domain-imports-external", severity: "error", description: "Doménová vrstva importuje cokoliv zvenčí — doména musí být čistá.", run: domainImportsExternal },
  { id: "clean-application-imports-infra", severity: "error", description: "Aplikační vrstva importuje infrastrukturu přímo — musí záviset na portech.", run: applicationImportsInfrastructure },
  { id: "clean-missing-port", severity: "warning", description: "Implementace v infrastruktuře nemá port v aplikační vrstvě.", run: missingPortForInfrastructure },
  { id: "clean-entity-in-outer-layer", severity: "warning", description: "Doménová entita umístěna vnější vrstvě místo do domain.", run: entityInOuterLayer },
  { id: "clean-usecase-in-wrong-layer", severity: "warning", description: "Use-case/command/handler neleží v aplikační vrstvě.", run: useCaseInWrongLayer },
  { id: "clean-repository-interface-in-infra", severity: "error", description: "Repository interface definován v infrastruktuře místo v aplikaci.", run: repositoryInterfaceInInfra },
];

export const CLEAN_RULE_SET: ArchitectureRuleSet = {
  architecture: "clean",
  rules: CLEAN_RULES,
};