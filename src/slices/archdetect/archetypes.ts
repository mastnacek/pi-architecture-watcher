/**
 * Architecture archetype registry.
 *
 * Deep module: the single source of truth for every architecture the watcher
 * can *detect*. Each archetype carries a Czech label (UI), an English
 * `criteria` phrase (sent to the Jev decision model — English is more reliable
 * for it) and the `roots`/`sharedRoots` the topology must be mapped onto.
 *
 * This registry is what makes the plugin modular: adding a new architecture is
 * one entry here plus — if the drift rules differ — a matching classifier.
 * The detection question itself is generated from this table, so no other code
 * changes.
 */

import type { ArchitectureId } from "../../shared/types.js";

export interface Archetype {
  id: ArchitectureId;
  /** Czech, rendered in `/vsa detect` and the settings help. */
  label: string;
  /** English, sent to the decision model as the choice criterion. */
  criteria: string;
  /** Suggested slice roots (relative to project root). */
  roots: string[];
  /** Suggested shared-kernel roots (relative to project root). */
  sharedRoots: string[];
}

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: "vsa",
    label: "Vertical Slice (vertikální řezy)",
    criteria:
      "feature-oriented folders; each slice owns its UI, logic and data together in one directory",
    roots: ["src/features", "src/slices", "src/modules", "src/vertical", "features", "slices"],
    sharedRoots: ["src/shared", "src/common", "src/kernel", "src/core", "shared", "common"],
  },
  {
    id: "clean",
    label: "Clean Architecture (vrstvy)",
    criteria:
      "layers split by responsibility: domain entities, application use-cases, infrastructure adapters",
    roots: ["src/domain", "src/application", "src/infrastructure", "src/use-cases"],
    sharedRoots: ["src/domain/shared", "src/kernel"],
  },
  {
    id: "hexagonal",
    label: "Hexagonal / Ports & Adapters",
    criteria:
      "ports and adapters: a domain core with inbound/outbound port interfaces and adapter implementations",
    roots: ["src/adapters", "src/ports", "src/application", "src/domain"],
    sharedRoots: ["src/domain", "src/core"],
  },
  {
    id: "layered",
    label: "Layered / N-tier",
    criteria:
      "strict horizontal tiers: controller -> service -> repository; each layer imports only the one below",
    roots: ["src/controllers", "src/services", "src/repositories", "src/presentation", "src/data"],
    sharedRoots: ["src/shared", "src/common"],
  },
  {
    id: "modular-monolith",
    label: "Modulární monolit",
    criteria:
      "single deployable with strongly separated internal modules that expose narrow public APIs",
    roots: ["src/modules", "src/bounded-contexts", "modules"],
    sharedRoots: ["src/shared", "src/common", "src/kernel"],
  },
  {
    id: "fsd",
    label: "Feature-Sliced Design (FSD)",
    criteria:
      "feature-sliced design: app/processes/pages/features/entities/shared layers, sliced by feature",
    roots: ["src/features", "src/entities", "src/features"],
    sharedRoots: ["src/shared", "src/widgets"],
  },
];

/** Short display name per architecture, shown in the UI in place of "VSA". */
const ARCHITECTURE_CODES: Record<ArchitectureId, string> = {
  vsa: "VSA",
  clean: "Clean",
  hexagonal: "Hexagonal",
  layered: "Layered",
  "modular-monolith": "Modular monolith",
  fsd: "FSD",
};

/** Short, human-facing name for an architecture (falls back to the raw id). */
export function architectureCode(id: ArchitectureId): string {
  return ARCHITECTURE_CODES[id] ?? id;
}

/** Id → English criterion, exactly the map Jev's `choice` question expects. */
export function criteriaMap(): Record<ArchitectureId, string> {
  const out = {} as Record<ArchitectureId, string>;
  for (const a of ARCHETYPES) out[a.id] = a.criteria;
  return out;
}

export function findArchetype(id: ArchitectureId): Archetype | undefined {
  return ARCHETYPES.find((a) => a.id === id);
}