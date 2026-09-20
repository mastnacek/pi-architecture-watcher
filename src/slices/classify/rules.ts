/**
 * Rule engine — internal to the `classify` slice.
 *
 * Deep module: a rule is `(facts) => Finding[]`. Adding a detection means
 * adding one pure function to `RULES`, nothing else. Rules never mutate inputs,
 * never touch the network and never call a model.
 */

import { dirname } from "node:path";
import { baseName, relPosix, stripExtension } from "../../shared/paths.js";
import type { Dependency, EnrichedFacts } from "./enrich.js";
import { retargetSpecifier } from "./enrich.js";
import type { Finding } from "../../shared/types.js";

/** Slice-internal filenames that hint at an anaemic, non-vertical design. */
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

/** The public entry a cross-slice import *should* have used. */
function publicTarget(facts: EnrichedFacts, dep: Dependency): string | null {
  if (!dep.targetSlice) return null;
  return facts.lookup.publicEntryPath(dep.targetSlice);
}

// ---------------------------------------------------------------------------
// R1 — cross-slice deep import
// ---------------------------------------------------------------------------
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
      ? `\`${facts.file.rel}\` lives in slice \`${facts.slice.id}\` but reaches into `
        + `\`${target.id}\` internals via \`${dep.edge.specifier}\` (line ${dep.edge.line}). `
        + `Slices are vertical: they may only depend on each other's public surface.`
      : `\`${facts.file.rel}\` (slice \`${facts.slice.id}\`) imports \`${dep.edge.specifier}\` `
        + `from slice \`${target.id}\`, which has no public entry. Slices may only depend `
        + `on each other's public surface.`;

    const suggestion = entryRel
      ? `Import \`${entryRel}\` instead, or move the shared logic into a shared kernel module.`
      : `Create \`${target.id}/${facts.config.publicEntries[0]}.ts\` that re-exports only what `
        + `consumers need, then import that instead.`;

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
        `Slice cycle \`${home.id}\` <-> \`${target.id}\``,
        `\`${home.id}\` depends on \`${target.id}\` (line ${dep.edge.line}) and `
          + `\`${target.id}\` depends back on \`${home.id}\` via `
          + `\`${backEdges[0]!.specifier}\`. Slices must form a directed graph.`,
        `Break the loop: extract the shared contract into the shared kernel, or invert one `
          + `side behind an event/port owned by \`${home.id}\`.`,
        dep.edge.line,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// R3 — shared kernel depends on a slice (inverted layering)
// ---------------------------------------------------------------------------
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
        `Shared kernel depends on slice \`${dep.targetSlice.id}\``,
        `\`${facts.file.rel}\` is part of the shared kernel (\`${facts.shared}\`) but imports `
          + `\`${dep.edge.specifier}\` from slice \`${dep.targetSlice.id}\` (line ${dep.edge.line}). `
          + `The kernel must not know about feature slices.`,
        `Invert the dependency: let the slice pass the data in, or move the abstraction down `
          + `into \`${facts.shared}\`.`,
        dep.edge.line,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// R4 — domain logic placed outside its slice
// ---------------------------------------------------------------------------
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
        `Slice \`${named}\` logic lives outside the slice`,
        `\`${facts.file.rel}\` is not inside any slice directory yet its name carries the `
          + `\`${named}\` domain. Vertical slices own their files end to end.`,
        `Move it under \`${facts.config.roots[0]}/${named}/\`, or rename it if it is genuinely `
          + `generic and belongs in the shared kernel.`,
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
        `Generic file carries slice domain vocabulary`,
        `\`${facts.file.rel}\` sits outside every slice but references `
          + `${mentions.map((m) => `\`${m}\``).join(", ")} repeatedly.`,
        `If this module serves ${mentions.length > 1 ? "those slices" : "that slice"}, colocate it `
          + `inside the slice; keep only true cross-cutting code in the shared kernel.`,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// R5 — slice fan-out
// ---------------------------------------------------------------------------
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
        `Slice \`${facts.slice.id}\` reaches ${others.size} other slices`,
        `A slice should orchestrate at most ${facts.config.maxSliceFanOut} peers; this file alone `
          + `touches ${[...others].map((o) => `\`${o}\``).join(", ")}.`,
        `Consider merging the collaborating slices, or introduce an application-level `
          + `coordinator that composes them outside the slice.`,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// R6 — public entry re-exports internals
// ---------------------------------------------------------------------------
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
        `Public entry leaks internals of \`${facts.slice.id}\``,
        `\`${facts.file.rel}\` re-exports \`${dep.edge.specifier}\` (line ${dep.edge.line}), `
          + `exposing internals as part of the slice's public surface.`,
        `Export only the slice's use cases and DTOs, and keep implementation modules private.`,
        dep.edge.line,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// R7 — shared kernel inflation
// ---------------------------------------------------------------------------
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
      `Heavy reliance on the shared kernel`,
      `\`${facts.file.rel}\` imports ${fromShared.length} modules from ${roots} `
        + `(budget ${facts.config.maxSharedImports}). A growing kernel is a horizontal layer in `
        + `disguise.`,
      `Prefer a slice-local module; promote code to the kernel only when at least two slices `
        + `genuinely need it.`,
    ),
  );
  return out;
}

// ---------------------------------------------------------------------------
// R8 — misplaced or generic file inside a slice
// ---------------------------------------------------------------------------
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
        `\`${foreign}\` domain placed inside slice \`${home}\``,
        `\`${facts.file.rel}\` belongs to slice \`${foreign}\` by name but sits in \`${home}\`.`,
        `Move it to \`${facts.config.roots[0]}/${foreign}/\`, together with the rest of that slice.`,
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
        `Generic module inside slice \`${home}\``,
        `\`${facts.file.rel}\` is a name-based grab bag. Vertical slices name files after the `
          + `capability they implement.`,
        `Name it after the use case (for example \`cancel-subscription.ts\`) so the slice stays `
          + `navigable, or move it to the shared kernel if it is truly generic.`,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// R9 — slice without a public entry
// ---------------------------------------------------------------------------
function missingPublicEntry(facts: EnrichedFacts): Finding[] {
  if (!facts.slice || facts.slice.hasPublicEntry) return [];
  return [
    finding(
      "slice-missing-entry",
      "hint",
      facts,
      `Slice \`${facts.slice.id}\` has no public entry`,
      `Files in \`${facts.slice.id}\` cannot be consumed safely without a declared surface, so `
        + `consumers are forced into deep imports.`,
      `Add \`${facts.slice.id}/${facts.config.publicEntries[0]}.ts\` exporting only the slice's `
        + `use cases and DTOs.`,
    ),
  ];
}

// ---------------------------------------------------------------------------
// R10 — file dropped directly into a slice root folder
// ---------------------------------------------------------------------------
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
      `File sits directly in the slice root`,
      `\`${facts.file.rel}\` is inside \`${parentRel}\`, which is the container for slices, not a `
        + `slice itself.`,
      `Move it into the slice it serves, or outside \`${parentRel}\` if it is shared.`,
    ),
  ];
}

/** Ordered registry — order only affects presentation, not scoring. */
export const RULES: ReadonlyArray<(facts: EnrichedFacts) => Finding[]> = [
  crossSliceDeepImport,
  crossSliceCycle,
  sharedDependsOnSlice,
  orphanDomainFile,
  sliceFanOut,
  barrelLeak,
  sharedAbuse,
  looseSliceFile,
  missingPublicEntry,
  fileInSliceRoot,
];

/** Human-facing catalogue of every rule, used by `/vsa rules`. */
export const RULE_CATALOGUE: ReadonlyArray<[string, Finding["severity"], string]> = [
  [
    "cross-slice-deep-import",
    "error",
    "A slice reaches into another slice's internals instead of its public entry.",
  ],
  [
    "cross-slice-cycle",
    "error",
    "Two slices import each other, forming a cycle in the slice graph.",
  ],
  [
    "shared-depends-on-slice",
    "error",
    "The shared kernel imports a feature slice, inverting the intended layering.",
  ],
  [
    "orphan-domain-file",
    "warning",
    "A file outside every slice carries slice domain vocabulary or naming.",
  ],
  [
    "slice-fan-out",
    "warning",
    "A slice depends on more peer slices than the configured budget.",
  ],
  [
    "barrel-leak",
    "hint",
    "A slice's public entry re-exports internals, widening its surface.",
  ],
  [
    "shared-abuse",
    "hint",
    "A file pulls many modules from the shared kernel — a hidden horizontal layer.",
  ],
  [
    "loose-slice-file",
    "warning",
    "A generic or foreign-domain module lives inside the wrong slice.",
  ],
  [
    "slice-missing-entry",
    "hint",
    "A slice directory has no public entry, forcing consumers into deep imports.",
  ],
  [
    "file-in-slice-root",
    "hint",
    "A file sits directly in the slice container directory instead of a slice.",
  ],
];

/** Run every rule and return findings sorted by severity, then line. */
export function runRules(facts: EnrichedFacts): Finding[] {
  const rank = { error: 0, warning: 1, hint: 2 } as const;
  return RULES.flatMap((rule) => rule(facts)).sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.line ?? 0) - (b.line ?? 0),
  );
}
