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
	finding,
	publicTarget,
} from "./rules-support.js";
import {
	retargetSpecifier,
	type EnrichedFacts,
} from "./enrich.js";
import { relPosix } from "../../shared/paths.js";
import type { Finding } from "../../shared/types.js";

// ---------------------------------------------------------------------------
// R1 — cross-slice deep import
// ---------------------------------------------------------------------------
export function crossSliceDeepImport(facts: EnrichedFacts): Finding[] {
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

    const fix = entry
      ? retargetSpecifier(dep.edge.specifier, facts.file.path, entry)
      : undefined;

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

// ---------------------------------------------------------------------------
// R2 — cross-slice cycle (A -> B and B -> A)
// ---------------------------------------------------------------------------
export function crossSliceCycle(facts: EnrichedFacts): Finding[] {
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

// ---------------------------------------------------------------------------
// R3 — shared kernel depends on a slice (inverted layering)
// ---------------------------------------------------------------------------
export function sharedDependsOnSlice(facts: EnrichedFacts): Finding[] {
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

// ---------------------------------------------------------------------------
// R5 — slice fan-out
// ---------------------------------------------------------------------------
export function sliceFanOut(facts: EnrichedFacts): Finding[] {
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

// ---------------------------------------------------------------------------
// R7 — shared kernel inflation
// ---------------------------------------------------------------------------
export function sharedAbuse(facts: EnrichedFacts): Finding[] {
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
