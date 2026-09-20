/**
 * Needle-based architecture detection — local, no network.
 *
 * Deep module: `detectArchitectureNeedle` mirrors the Jev-based
 * `detectArchitecture` interface but runs the Needle WASM model locally.
 */

import type { SliceLookup, WatcherConfig } from "../../shared/types.js";
import { buildArchitectureDigest as buildStateDigest } from "../../shared/archdetect.js";
import { ensureNeedleAssets, loadNeedleWasm, type NeedleInstance } from "./wasm-loader.js";
import type { ArchitectureDetection } from "../../shared/archdetect.js";

export interface NeedleDetectOptions {
  /** Progress callback: (stage, 0..1 progress) */
  onProgress?: (stage: string, progress: number) => void;
  /** Fallback architecture if detection fails */
  fallback?: string;
  /** Pre-loaded Needle instance (for testing/reuse) */
  instance?: NeedleInstance;
}

export type NeedleDetectResult =
  | { ok: true; detection: ArchitectureDetection }
  | { ok: false; reason: string };

/**
 * Run architecture detection using Needle (local WASM).
 * Downloads model on first run (~36 MB), then runs entirely offline.
 */
export async function detectArchitectureNeedle(
  lookup: SliceLookup,
  config: WatcherConfig,
  options: NeedleDetectOptions = {},
): Promise<NeedleDetectResult> {
  const digest = buildStateDigest(lookup, config);
  const fallback = options.fallback ?? config.architecture;

  let instance = options.instance;
  let shouldClose = false;

  try {
    if (!instance) {
      options.onProgress?.("Preparing Needle engine...", 0);
      const { modelPath, wasmPath, jsPath } = await ensureNeedleAssets(options.onProgress);
      instance = await loadNeedleWasm(jsPath, wasmPath, modelPath);
      shouldClose = true;
      options.onProgress?.("Needle engine ready", 1);
    }

    options.onProgress?.("Running architecture detection...", 0.5);
    const result = await instance.detect(digest);
    options.onProgress?.("Detection complete", 1);

    // Validate architecture is known
    const validArchs = ["vsa", "clean", "hexagonal", "layered", "modular-monolith", "fsd"] as const;
    if (!validArchs.includes(result.architecture as typeof validArchs[number])) {
      return { ok: false, reason: `Unknown architecture: ${result.architecture}` };
    }

    return {
      ok: true,
      detection: {
        architecture: result.architecture as ArchitectureDetection["architecture"],
        confidence: Math.max(0, Math.min(1, result.confidence)),
        digest,
        provider: "Needle (local)",
        model: "needle3",
        cost: 0,
      },
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  } finally {
    if (shouldClose && instance) {
      try {
        await instance.close();
      } catch {
        // ignore cleanup errors
      }
    }
  }
}