/**
 * Public boundary of the `archdetect` slice.
 *
 * Slices import from here, never from the slice's internal files. Pure
 * re-exports only — no logic, no I/O.
 */

export {
  ARCHETYPES,
  criteriaMap,
  findArchetype,
  type Archetype,
} from "./archetypes.js";
export {
  callSystemOne,
  resolveApiKey,
  SystemOneError,
  SYSTEMONE_ENDPOINT,
  type FetchLike,
  type SystemOneAnswer,
  type SystemOneOptions,
  type SystemOneQuestion,
  type SystemOneRequest,
  type SystemOneResponse,
} from "./systemone.js";
export {
  buildQuestion,
  buildStateDigest,
  decodeDetection,
  detectArchitecture,
  estimateDepth,
  type ArchitectureDetection,
  type DepthStats,
  type DetectOptions,
  type DetectResult,
} from "./detect.js";