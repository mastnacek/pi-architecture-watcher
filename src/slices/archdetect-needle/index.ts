/**
 * Public boundary of the `archdetect-needle` slice.
 *
 * Mirrors the `archdetect` slice interface but uses local Needle WASM.
 */

export {
  detectArchitectureNeedle,
  type NeedleDetectOptions,
  type NeedleDetectResult,
} from "./detect.js";

export {
  ensureNeedleAssets,
  loadNeedleWasm,
  type NeedleInstance,
} from "./wasm-loader.js";

export {
  buildNeedleQuestion,
  SYSTEM_PROMPT,
  type DetectionResult,
} from "./schema.js";

export {
  ArchDetectModal,
  type DetectionEngine,
  type DetectionResult as ModalDetectionResult,
  type ModalCallbacks,
} from "./components/ArchDetectModal.js";