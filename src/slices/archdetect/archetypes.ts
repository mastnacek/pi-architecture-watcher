/**
 * Architecture archetype registry — re-exports from shared kernel.
 *
 * Deep module: this slice's public API for architecture metadata.
 * The actual definitions live in `src/shared/archdetect.ts` so they can
 * be used by other slices (classify/architectures/*, archdetect-needle)
 * without cross-slice imports.
 */

export {
  ARCHETYPES,
  Archetype,
  architectureCode,
  criteriaMap,
  findArchetype,
  type ArchitectureDetection,
  buildArchitectureDigest,
  buildArchitectureQuestion,
} from "../../shared/archdetect.js";
export type { ArchitectureId } from "../../shared/types.js";