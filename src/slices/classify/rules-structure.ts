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
	GENERIC_SLICE_NAMES,
	finding,
} from "./rules-support.js";
import {
	type EnrichedFacts,
} from "./enrich.js";
import { baseName, relPosix, stripExtension } from "../../shared/paths.js";
import type { Finding } from "../../shared/types.js";

// ---------------------------------------------------------------------------
// R4 — domain logic placed outside its slice
// ---------------------------------------------------------------------------
export function orphanDomainFile(facts: EnrichedFacts): Finding[] {
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

  // Fall back to identifier vocabulary in the content.
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

// ---------------------------------------------------------------------------
// R6 — public entry re-exports internals
// ---------------------------------------------------------------------------
export function barrelLeak(facts: EnrichedFacts): Finding[] {
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

// ---------------------------------------------------------------------------
// R8 — misplaced or generic file inside a slice
// ---------------------------------------------------------------------------
export function looseSliceFile(facts: EnrichedFacts): Finding[] {
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

// ---------------------------------------------------------------------------
// R9 — slice without a public entry
// ---------------------------------------------------------------------------
export function missingPublicEntry(facts: EnrichedFacts): Finding[] {
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

// ---------------------------------------------------------------------------
// R10 — file dropped directly into a slice root folder
// ---------------------------------------------------------------------------
export function fileInSliceRoot(facts: EnrichedFacts): Finding[] {
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
