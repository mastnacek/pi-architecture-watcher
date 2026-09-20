/**
 * Shared architecture detection types and archetypes.
 *
 * Deep module: pure types and constants for architecture detection.
 * No slice imports, no I/O. Used by `archdetect`, `archdetect-needle`,
 * `classify/architectures/*`, and any slice that needs architecture metadata.
 */

import type { ArchitectureId } from "./types.js";
export type { ArchitectureId } from "./types.js";

/** Architecture archetype with metadata for detection and topology mapping. */
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

/** The single source of truth for every detectable architecture. */
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

/** Result of an architecture detection (model or heuristic). */
export interface ArchitectureDetection {
  architecture: ArchitectureId;
  /** 0..1 confidence the model assigned to the chosen architecture */
  confidence: number;
  /** the digest text sent to the model (for transparency / debugging) */
  digest: string;
  provider?: string;
  model?: string;
  cost?: number;
}

/** The single typed question for architecture detection. */
export function buildArchitectureQuestion(): {
  type: "choice";
  instructions: string;
  criteria: Record<ArchitectureId, string>;
} {
  return {
    type: "choice",
    instructions:
      "Analyze this project's directory structure and import patterns. Which architecture does it most closely follow?",
    criteria: criteriaMap(),
  };
}

/** Build the compact, structure-only digest sent to the decision model. */
export function buildArchitectureDigest(
  lookup: { root: string; slices(): { dir: string; hasPublicEntry: boolean }[] },
  config: { roots: string[]; sharedRoots: string[] },
): string {
  const lines: string[] = [];
  lines.push(`slice roots (configured): ${config.roots.join(", ") || "none"}`);
  lines.push(`shared roots (configured): ${config.sharedRoots.join(", ") || "none"}`);
  const slices = lookup.slices();
  lines.push(`discovered slices (${slices.length}):`);
  for (const s of slices) {
    const rel = s.dir; // caller should provide relative paths
    lines.push(`  - ${rel} (publicEntry=${s.hasPublicEntry ? "yes" : "no"})`);
  }
  return lines.join("\n");
}