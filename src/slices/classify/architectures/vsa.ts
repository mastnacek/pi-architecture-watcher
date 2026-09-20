/**
 * VSA (Vertical Slice Architecture) rules — the default architecture rule set.
 *
 * Deep module: each rule is a pure function. Rules are registered with the
 * architecture registry so they can be overridden or extended by other
 * architectures.
 */

import { dirname } from "node:path";
import { baseName, relPosix, stripExtension } from "../../../shared/paths.js";
import type { EnrichedFacts } from "../enrich.js";
import { retargetSpecifier } from "../enrich.js";
import type { Rule, ArchitectureRuleSet } from "./types.js";
import type { Finding } from "../../../shared/types.js";

const GENERIC_SLICE_NAMES = [
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

function publicTarget(facts: EnrichedFacts, dep: EnrichedFacts["dependencies"][0]): string | null {
  if (!dep.targetSlice) return null;
  return facts.lookup.publicEntryPath(dep.targetSlice);
}

// R1 — cross-slice deep import
function crossSliceDeepImport(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice) return out;

  for (const dep of facts.dependencies) {
    const target = dep.targetSlice;
    if (!target || target.id === facts.slice.id) continue;
    if (dep.isPublicEntry) continue;

    const strict = facts.config.publicEntryMode === "entry-only";
    const severity = strict || dep.isInternal ? "error" : "warning";
    const entry = publicTarget(facts, dep);
    const entryRel = entry ? relPosix(facts.projectRoot, entry) : null;

    const detail = entryRel
      ? `\`${facts.file.rel}\` žije v řezu \`${facts.slice.id}\`, ale sahá do vnitřku `
        + `\`${target.id}\` přes \`${dep.edge.specifier}\` (řádek ${dep.edge.line}). `
        + `Řezy jsou vertikální: mohou záviset jen na veřejném rozhraní ostatních.`
      : `\`${facts.file.rel}\` (řez \`${facts.slice.id}\`) importuje \`${dep.edge.specifier}\` `
        + `z řezu \`${target.id}\`, který nemá veřejný vstup. Řezy mohou záviset jen `
        + `na veřejném rozhraní ostatních.`;

    const suggestion = entryRel
      ? `Importuj místo toho \`${entryRel}\`, nebo přesuň sdílenou logiku do modulu sdíleného jádra.`
      : `Vytvoř \`${target.id}/${facts.config.publicEntries[0]}.ts\`, které re-exportuje jen to, `
        + `co spotřebitelé potřebují, a importuj to.`;

    const fix = entry ? retargetSpecifier(dep.edge.specifier, facts.file.path, entry) : undefined;

    out.push(
      finding(
        "cross-slice-deep-import",
        severity,
        facts,
        `Cross-slice deep import into \`${target.id}\``,
        detail,
        suggestion,
        dep.edge.line,
        fix,
      ),
    );
  }
  return out;
}

// R2 — cross-slice cycle (A -> B and B -> A)
function crossSliceCycle(facts: EnrichedFacts): Finding[] {
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
        "cross-slice-cycle",
        "error",
        facts,
        `Cyklická závislost řezů \`${home.id}\` <-> \`${target.id}\``,
        `\`${home.id}\` závisí na \`${target.id}\` (řádek ${dep.edge.line}) a `
          + `\`${target.id}\` závisí zpět na \`${home.id}\` přes `
          + `\`${backEdges[0]!.specifier}\`. Řezy musí tvořit orientovaný graf.`,
        `Přeruš smyčku: vytáhni sdílený kontrakt do sdíleného jádra, nebo obrať jednu `
          + `stranu za událost/port vlastněný řezem \`${home.id}\`.`,
        dep.edge.line,
      ),
    );
  }
  return out;
}

// R3 — shared kernel depends on a slice (inverted layering)
function sharedDependsOnSlice(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (facts.slice || !facts.shared) return out;

  for (const dep of facts.dependencies) {
    if (!dep.targetSlice) continue;
    out.push(
      finding(
        "shared-depends-on-slice",
        "error",
        facts,
        `Sdílené jádro závisí na řezu \`${dep.targetSlice.id}\``,
        `\`${facts.file.rel}\` je součást sdíleného jádra (\`${facts.shared}\`), ale importuje `
          + `\`${dep.edge.specifier}\` z řezu \`${dep.targetSlice.id}\` (řádek ${dep.edge.line}). `
          + `Jádro nesmí znát feature řezy.`,
        `Obrať závislost: nech řez předat data dovnitř, nebo přesuň abstrakci dolů `
          + `do \`${facts.shared}\`.`,
        dep.edge.line,
      ),
    );
  }
  return out;
}

// R4 — domain logic placed outside its slice
function orphanDomainFile(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (facts.slice || facts.shared) return out;

  const name = stripExtension(baseName(facts.file.rel));
  const tokens = name.split(/[._-]/);
  const sliceIds = facts.lookup.slices().map((s) => s.id);

  const named = sliceIds.find(
    (id) => tokens.includes(id) || name.startsWith(`${id}-`) || name.startsWith(`${id}.`),
  );

  if (named) {
    out.push(
      finding(
        "orphan-domain-file",
        "warning",
        facts,
        `Logika řezu \`${named}\` žije mimo řez`,
        `\`${facts.file.rel}\` není uvnitř žádného řezu, ale jeho název nese `
          + `doménu \`${named}\`. Vertikální řezy vlastní své soubory od začátku do konce.`,
        `Přesuň ho pod \`${facts.config.roots[0]}/${named}/\`, nebo ho přejmenuj, pokud je opravdu `
          + `generický a patří do sdíleného jádra.`,
      ),
    );
    return out;
  }

  const content = facts.file.content;
  const mentions = sliceIds.filter((id) => {
    if (id.length < 3) return false;
    const re = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    return (content.match(re)?.length ?? 0) >= 3;
  });

  if (mentions.length > 0) {
    out.push(
      finding(
        "orphan-domain-file",
        "hint",
        facts,
        `Generický soubor nese slovník domény řezu`,
        `\`${facts.file.rel}\` leží mimo všechny řezy, ale opakovaně odkazuje na `
          + `${mentions.map((m) => `\`${m}\``).join(", ")}.`,
        `Pokud tento modul slouží ${mentions.length > 1 ? "těmto řezům" : "tomuto řezu"}, umísti ho `
          + `do řezu; ve sdíleném jádru nech jen skutečně průřezový kód.`,
      ),
    );
  }
  return out;
}

// R5 — slice fan-out
function sliceFanOut(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice) return out;

  const others = new Set(
    facts.dependencies
      .filter((d) => d.targetSlice && d.targetSlice.id !== facts.slice!.id)
      .map((d) => d.targetSlice!.id),
  );

  if (others.size > facts.config.maxSliceFanOut) {
    out.push(
      finding(
        "slice-fan-out",
        "warning",
        facts,
        `Řez \`${facts.slice.id}\` sahá na ${others.size} dalších řezů`,
        `Řez by měl orchestrovat nejvýše ${facts.config.maxSliceFanOut} sousedů; tento soubor sám `
          + `se dotýká ${[...others].map((o) => `\`${o}\``).join(", ")}.`,
        `Zvaž sloučení spolupracujících řezů, nebo zaveď aplikační `
          + `koordinátor, který je skládá mimo řez.`,
      ),
    );
  }
  return out;
}

// R6 — public entry re-exports internals
function barrelLeak(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice || !facts.lookup.isPublicEntry(facts.file.path, facts.slice)) return out;

  for (const dep of facts.dependencies) {
    if (dep.edge.kind !== "export") continue;
    if (!dep.targetSlice || dep.targetSlice.id !== facts.slice.id) continue;
    if (dep.isPublicEntry) continue;

    out.push(
      finding(
        "barrel-leak",
        "hint",
        facts,
        `Veřejný vstup uniká vnitřek řezu \`${facts.slice.id}\``,
        `\`${facts.file.rel}\` re-exportuje \`${dep.edge.specifier}\` (řádek ${dep.edge.line}) `
          + `a vystavuje vnitřek jako součást veřejného rozhraní řezu.`,
        `Exportuj jen use-casy a DTO řezu, implementační moduly nech soukromé.`,
        dep.edge.line,
      ),
    );
  }
  return out;
}

// R7 — shared kernel inflation
function sharedAbuse(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice) return out;

  const fromShared = facts.dependencies.filter((d) => d.shared !== null);
  if (fromShared.length <= facts.config.maxSharedImports) return out;

  const roots = [...new Set(fromShared.map((d) => d.shared!))].join(", ");
  out.push(
    finding(
      "shared-abuse",
      "hint",
      facts,
      `Silná závislost na sdíleném jádru`,
      `\`${facts.file.rel}\` importuje ${fromShared.length} modulů z ${roots} `
        + `(limit ${facts.config.maxSharedImports}). Rostoucí jádro je skrytá horizontální `
        + `vrstva.`,
      `Preferuj modul v rámci řezu; kód povyš do jádra jen když ho skutečně potřebují alespoň `
        + `dva řezy.`,
    ),
  );
  return out;
}

// R8 — misplaced or generic file inside a slice
function looseSliceFile(facts: EnrichedFacts): Finding[] {
  const out: Finding[] = [];
  if (!facts.slice) return out;

  const home = facts.slice.id;
  const rel = relPosix(facts.slice.dir, facts.file.path);
  const atSliceRoot = dirname(rel) === ".";
  const name = stripExtension(baseName(rel));

  const foreign = facts
    .lookup.slices()
    .map((s) => s.id)
    .find(
      (id) =>
        id !== home &&
        (name === id || name.startsWith(`${id}-`) || name.startsWith(`${id}.`)),
    );

  if (foreign) {
    out.push(
      finding(
        "loose-slice-file",
        "warning",
        facts,
        `Doména \`${foreign}\` je uvnitř řezu \`${home}\``,
        `\`${facts.file.rel}\` patří podle názvu řezu \`${foreign}\`, ale leží v \`${home}\`.`,
        `Přesuň ho do \`${facts.config.roots[0]}/${foreign}/\` spolu se zbytkem řezu.`,
      ),
    );
    return out;
  }

  if (atSliceRoot && GENERIC_SLICE_NAMES.includes(name) && name !== "index") {
    out.push(
      finding(
        "loose-slice-file",
        "hint",
        facts,
        `Generický modul uvnitř řezu \`${home}\``,
        `\`${facts.file.rel}\` je sbírka bez významu podle názvu. Vertikální řezy pojmenovávají `
          + `soubory podle schopnosti, kterou implementují.`,
        `Pojmenuj ho podle use-casu (např. \`cancel-subscription.ts\`), aby řez zůstal `
          + `čitelný, nebo ho přesuň do sdíleného jádra, pokud je opravdu generický.`,
      ),
    );
  }
  return out;
}

// R9 — slice without a public entry
function missingPublicEntry(facts: EnrichedFacts): Finding[] {
  if (!facts.slice || facts.slice.hasPublicEntry) return [];
  return [
    finding(
      "slice-missing-entry",
      "hint",
      facts,
      `Řez \`${facts.slice.id}\` nemá veřejný vstup`,
      `Soubory v \`${facts.slice.id}\` nelze bezpečně použít bez deklarovaného rozhraní, takže `
        + `spotřebitelé jsou nuceni k hlubokým importům.`,
      `Přidej \`${facts.slice.id}/${facts.config.publicEntries[0]}.ts\` exportující jen use-casy `
        + `a DTO řezu.`,
    ),
  ];
}

// R10 — file dropped directly into a slice root folder
function fileInSliceRoot(facts: EnrichedFacts): Finding[] {
  if (facts.slice || facts.shared) return [];
  const parent = dirname(facts.file.path);
  const parentRel = relPosix(facts.projectRoot, parent);
  if (!facts.config.roots.includes(parentRel)) return [];

  return [
    finding(
      "file-in-slice-root",
      "hint",
      facts,
      `Soubor leží přímo v kořeni řezů`,
      `\`${facts.file.rel}\` je uvnitř \`${parentRel}\`, což je kontejner pro řezy, ne `
        + `samotný řez.`,
      `Přesuň ho do řezu, kterému slouží, nebo mimo \`${parentRel}\`, pokud je sdílený.`,
    ),
  ];
}

export const VSA_RULES: Rule[] = [
  { id: "cross-slice-deep-import", severity: "error", description: "Řez sahá do vnitřku jiného řezu místo na jeho veřejný vstup.", run: crossSliceDeepImport },
  { id: "cross-slice-cycle", severity: "error", description: "Dva řezy se importují navzájem, tvoří cyklus v grafu řezů.", run: crossSliceCycle },
  { id: "shared-depends-on-slice", severity: "error", description: "Sdílené jádro importuje feature řez, obrací zamýšlené vrstvení.", run: sharedDependsOnSlice },
  { id: "orphan-domain-file", severity: "warning", description: "Soubor mimo všechny řezy nese slovník nebo pojmenování domény řezu.", run: orphanDomainFile },
  { id: "slice-fan-out", severity: "warning", description: "Řez závisí na více sousedních řezech, než je nastavený rozpočet.", run: sliceFanOut },
  { id: "barrel-leak", severity: "hint", description: "Veřejný vstup řezu re-exportuje vnitřky a rozšiřuje tak své rozhraní.", run: barrelLeak },
  { id: "shared-abuse", severity: "hint", description: "Soubor táhne mnoho modulů ze sdíleného jádra — skrytá horizontální vrstva.", run: sharedAbuse },
  { id: "loose-slice-file", severity: "warning", description: "Generický nebo cizí doménový modul žije ve špatném řezu.", run: looseSliceFile },
  { id: "slice-missing-entry", severity: "hint", description: "Adresář řezu nemá veřejný vstup, nutí spotřebitele k hlubokým importům.", run: missingPublicEntry },
  { id: "file-in-slice-root", severity: "hint", description: "Soubor leží přímo v kontejneru řezů místo v řezu.", run: fileInSliceRoot },
];

export const VSA_RULE_SET: ArchitectureRuleSet = {
  architecture: "vsa",
  rules: VSA_RULES,
};