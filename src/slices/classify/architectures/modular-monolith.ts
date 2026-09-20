/**
 * Modular Monolith rules — strongly separated internal modules with narrow public APIs.
 *
 * Deep module: modules are like mini-VSA slices but with stricter boundaries.
 * Each module has a clear public API (index.ts), internals are private.
 * Modules communicate only via public APIs or events.
 */

import { dirname, relative } from "node:path";
import { baseName, relPosix, stripExtension } from "../../../shared/paths.js";
import type { EnrichedFacts } from "../enrich.js";
import { retargetSpecifier } from "../enrich.js";
import type { Rule, ArchitectureRuleSet } from "./types.js";
import type { Finding } from "../../../shared/types.js";

const GENERIC_MODULE_NAMES = [
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

function finding(
  rule: string,
  severity: Finding["severity"],
  facts: EnrichedFacts,
  title: string,
  detail: string,
  suggestion: string,
  line?: number,
  fix?: string,
): Finding {
  const out: Finding = { rule, severity, file: facts.file.rel, title, detail, suggestion };
  if (line !== undefined) out.line = line;
  if (fix !== undefined) out.fix = fix;
  return out;
}

function publicTarget(facts: EnrichedFacts, dep: EnrichedFacts["dependencies"][0]): string | null {
  if (!dep.targetSlice) return null;
  return facts.lookup.publicEntryPath(dep.targetSlice);
}

// R1 — cross-module deep import (like VSA but modules are top-level)
function crossModuleDeepImport(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice) return out;

  for (const dep of facts.dependencies) {
    const target = dep.targetSlice;
    if (!target || target.id === facts.slice.id) continue;
    if (dep.isPublicEntry) continue;

    const entry = publicTarget(facts, dep);
    const entryRel = entry ? relPosix(facts.projectRoot, entry) : null;

    const detail = entryRel
      ? `\`${facts.file.rel}\` v modulu \`${facts.slice.id}\` sahá do vnitřku `
        + `\`${target.id}\` přes \`${dep.edge.specifier}\` (řádek ${dep.edge.line}). `
        + `Moduly komunikují jen přes veřejná API.`
      : `\`${facts.file.rel}\` (modul \`${facts.slice.id}\`) importuje \`${dep.edge.specifier}\` `
        + `z modulu \`${target.id}\`, který nemá veřejný vstup.`;

    const suggestion = entryRel
      ? `Importuj \`${entryRel}\`, nebo přesuň sdílenou logiku do \`shared/\`.`
      : `Vytvoř \`${target.id}/index.ts\` exportující veřejné API modulu.`;

    const fix = entry ? retargetSpecifier(dep.edge.specifier, facts.file.path, entry) : undefined;

    out.push(
      finding(
        "modular-cross-module-deep-import",
        "error",
        facts,
        `Cross-module deep import do \`${target.id}\``,
        detail,
        suggestion,
        dep.edge.line,
        fix,
      ),
    );
  }
  return out;
}

// R2 — module cycle
function moduleCycle(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice) return out;
  const home = facts.slice;

  for (const dep of facts.dependencies) {
    const target = dep.targetSlice;
    if (!target || target.id === home.id || !dep.target) continue;

    const backEdges = facts
      .importsOf(dep.target)
      .filter((edge) => {
        const resolved = facts.resolve(edge);
        if (!resolved) return false;
        const owner = facts.lookup.sliceOf(resolved);
        return owner !== null && owner.id === home.id;
      });

    if (backEdges.length === 0) continue;

    out.push(
      finding(
        "modular-module-cycle",
        "error",
        facts,
        `Cyklická závislost modulů \`${home.id}\` <-> \`${target.id}\``,
        `\`${home.id}\` závisí na \`${target.id}\` (řádek ${dep.edge.line}) a `
          + `\`${target.id}\` závisí zpět na \`${home.id}\` přes `
          + `\`${backEdges[0]!.specifier}\`. Moduly musí tvořit DAG.`,
        `Přeruš smyčku: sdílený kontrakt do \`shared/\`, nebo event-driven komunikace.`,
        dep.edge.line,
      ),
    );
  }
  return out;
}

// R3 — shared kernel depends on module
function sharedDependsOnModule(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (facts.slice || !facts.shared) return out;

  for (const dep of facts.dependencies) {
    if (!dep.targetSlice) continue;
    out.push(
      finding(
        "modular-shared-depends-on-module",
        "error",
        facts,
        `Sdílené jádro závisí na modulu \`${dep.targetSlice.id}\``,
        `\`${facts.file.rel}\` (shared) importuje \`${dep.edge.specifier}\` z modulu \`${dep.targetSlice.id}\` (řádek ${dep.edge.line}). `
          + `Shared nesmí znát moduly.`,
        `Obrať závislost: modul předá data do shared, nebo přesuň abstrakci do shared.`,
        dep.edge.line,
      ),
    );
  }
  return out;
}

// R4 — module missing public API (index.ts)
function moduleMissingPublicApi(facts: EnrichedFacts): Finding[] {
  if (!facts.slice || facts.slice.hasPublicEntry) return [];
  return [
    finding(
      "modular-missing-public-api",
      "error",
      facts,
      `Modul \`${facts.slice.id}\` nemá veřejné API (index.ts)`,
      `Modul v \`${facts.slice.dir}\` nemá \`index.ts\`. Bez veřejného rozhraní `
        + `jsou spotřebitelé nuceni k deep importům.`,
      `Přidej \`${facts.slice.id}/index.ts\` exportující jen use-casy, DTO a porty modulu.`,
    ),
  ];
}

// R5 — module re-exports internals from public API
function publicApiLeaksInternals(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice || !facts.lookup.isPublicEntry(facts.file.path, facts.slice)) return out;

  for (const dep of facts.dependencies) {
    if (dep.edge.kind !== "export") continue;
    if (!dep.targetSlice || dep.targetSlice.id !== facts.slice.id) continue;
    if (dep.isPublicEntry) continue;

    out.push(
      finding(
        "modular-public-api-leak",
        "warning",
        facts,
        `Veřejné API modulu \`${facts.slice.id}\` uniká interny`,
        `\`${facts.file.rel}\` re-exportuje \`${dep.edge.specifier}\` (řádek ${dep.edge.line}) `
          + `a vystavuje implementaci jako součást API.`,
        `Exportuj z index.ts jen typy, porty a use-casy. Implementační moduly nech soukromé.`,
        dep.edge.line,
      ),
    );
  }
  return out;
}

// R6 — generic module file inside a module
function genericModuleFile(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice) return out;

  const rel = relPosix(facts.slice.dir, facts.file.path);
  const atModuleRoot = dirname(rel) === ".";
  const name = stripExtension(baseName(rel));

  if (atModuleRoot && GENERIC_MODULE_NAMES.includes(name) && name !== "index") {
    out.push(
      finding(
        "modular-generic-file",
        "hint",
        facts,
        `Generický soubor v modulu \`${facts.slice.id}\``,
        `\`${facts.file.rel}\` je sbírka bez významu. Moduly pojmenovávají soubory podle schopnosti.`,
        `Pojmenuj podle use-casu (např. \`process-order.ts\`), nebo přesuň do \`shared/\`.`,
      ),
    );
  }
  return out;
}

// R7 — module imports too many other modules (fan-out)
function moduleFanOut(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice) return out;

  const others = new Set(
    facts.dependencies
      .filter((d) => d.targetSlice && d.targetSlice.id !== facts.slice!.id)
      .map((d) => d.targetSlice!.id),
  );

  const maxFanOut = Math.min(facts.config.maxSliceFanOut, 5); // stricter for modular monolith
  if (others.size > maxFanOut) {
    out.push(
      finding(
        "modular-fan-out",
        "warning",
        facts,
        `Modul \`${facts.slice.id}\` sahá na ${others.size} jiných modulů`,
        `Modul by měl být samostatný; tento soubor dotýká ${[...others].map((o) => `\`${o}\``).join(", ")}. `
          + `Doporučený limit: ${maxFanOut}.`,
        `Zvaž sloučení souvisejících modulů, nebo orchestrace přes event bus / aplikaci.`,
      ),
    );
  }
  return out;
}

// R8 — logic outside module but named like module
function orphanModuleLogic(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (facts.slice || facts.shared) return out;

  const name = stripExtension(baseName(facts.file.rel));
  const tokens = name.split(/[._-]/);
  const moduleIds = facts.lookup.slices().map((s) => s.id);

  const named = moduleIds.find(
    (id) => tokens.includes(id) || name.startsWith(`${id}-`) || name.startsWith(`${id}.`),
  );

  if (named) {
    out.push(
      finding(
        "modular-orphan-logic",
        "warning",
        facts,
        `Logika modulu \`${named}\` žije mimo modul`,
        `\`${facts.file.rel}\` není v žádném modulu, ale název nese doménu \`${named}\`.`
          + ` Moduly vlastní své soubory plně.`,
        `Přesuň do \`${facts.config.roots[0]}/${named}/\` nebo do \`shared/\` pokud je generický.`,
      ),
    );
    return out;
  }

  const content = facts.file.content;
  const mentions = moduleIds.filter((id) => {
    if (id.length < 3) return false;
    const re = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    return (content.match(re)?.length ?? 0) >= 3;
  });

  if (mentions.length > 0) {
    out.push(
      finding(
        "modular-orphan-logic",
        "hint",
        facts,
        `Soubor mimo moduly nese slovník modulů`,
        `\`${facts.file.rel}\` opakovaně odkazuje na ${mentions.map((m) => `\`${m}\``).join(", ")}.`,
        `Pokud slouží těmto modulům, přesuň ho do příslušného modulu.`,
      ),
    );
  }
  return out;
}

// R9 — file directly in modules root
function fileInModulesRoot(facts: EnrichedFacts): Finding[] {
  if (facts.slice || facts.shared) return [];
  const parent = dirname(facts.file.path);
  const parentRel = relPosix(facts.projectRoot, parent);
  if (!facts.config.roots.includes(parentRel)) return [];

  return [
    finding(
      "modular-file-in-root",
      "hint",
      facts,
      `Soubor leží přímo v kořeni modulů`,
      `\`${facts.file.rel}\` je uvnitř \`${parentRel}\`, což je kontejner pro moduly.`,
      `Přesuň ho do modulu, kterému slouží, nebo mimo \`${parentRel}\`.`,
    ),
  ];
}

export const MODULAR_MONOLITH_RULES: Rule[] = [
  { id: "modular-cross-module-deep-import", severity: "error", description: "Modul sahá do vnitřku jiného modulu místo na jeho veřejné API.", run: crossModuleDeepImport },
  { id: "modular-module-cycle", severity: "error", description: "Dva moduly se importují navzájem, tvoří cyklus.", run: moduleCycle },
  { id: "modular-shared-depends-on-module", severity: "error", description: "Sdílené jádro importuje modul, obrací zamýšlené vrstvení.", run: sharedDependsOnModule },
  { id: "modular-missing-public-api", severity: "error", description: "Modul nemá index.ts — spotřebitelé nuceni k deep importům.", run: moduleMissingPublicApi },
  { id: "modular-public-api-leak", severity: "warning", description: "Veřejné API modulu re-exportuje interny.", run: publicApiLeaksInternals },
  { id: "modular-generic-file", severity: "hint", description: "Generický soubor uvnitř modulu.", run: genericModuleFile },
  { id: "modular-fan-out", severity: "warning", description: "Modul závisí na příliš mnoha jiných modulech.", run: moduleFanOut },
  { id: "modular-orphan-logic", severity: "warning", description: "Logika modulu umístěna mimo modul.", run: orphanModuleLogic },
  { id: "modular-file-in-root", severity: "hint", description: "Soubor leží přímo v kontejneru modulů.", run: fileInModulesRoot },
];

export const MODULAR_MONOLITH_RULE_SET: ArchitectureRuleSet = {
  architecture: "modular-monolith",
  rules: MODULAR_MONOLITH_RULES,
};