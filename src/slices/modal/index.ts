/**
 * Interactive architecture detection modal (Jev / Needle / Comparison).
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { projectConfigPath, saveProjectConfig } from "../../shared/config.js";
import { resolveOpenRouterKey, type WatcherState } from "../../shared/state.js";
import { architectureCode, detectArchitecture } from "../archdetect/index.js";
import {
  detectArchitectureNeedle,
  type NeedleDetectOptions,
  type NeedleDetectResult,
  ArchDetectModal,
  type DetectionEngine,
  type ModalDetectionResult,
} from "../archdetect-needle/index.js";

/** Show the architecture detection modal and handle the result. */
export async function showArchitectureDetectionModal(
  ctx: ExtensionContext,
  state: WatcherState,
  onRefresh?: () => void,
): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    if (ctx.hasUI) {
      ctx.ui.notify("Architektura modální okno je dostupné pouze v TUI režimu.", "warning");
    }
    return;
  }

  let doneFn: ((result?: ModalDetectionResult) => void) | null = null;

  const modal = new ArchDetectModal({
    onEngineSelect: async (engine: DetectionEngine) => {
      if (engine === "compare") {
        modal.startComparing();
        try {
          modal.updateComparisonProgress("Running Jev (OpenRouter)...", 0.2);
          const jevResult = await detectArchitecture(state.lookup, state.config, {
            apiKey: resolveOpenRouterKey(),
          });

          let jevDetection: ModalDetectionResult | null = null;
          if (jevResult.ok) {
            const d = jevResult.detection;
            jevDetection = {
              engine: "jev",
              architecture: d.architecture,
              confidence: d.confidence,
              reasoning: d.digest,
              digest: d.digest,
              cost: d.cost,
            };
          }
          modal.updateComparisonProgress("Jev done, starting Needle...", 0.5, jevDetection!);

          const needleOptions: NeedleDetectOptions = {
            onProgress: (stage, progress) => {
              modal.updateComparisonProgress(stage, progress * 0.5 + 0.5);
            },
          };
          const needleResult = await detectArchitectureNeedle(state.lookup, state.config, needleOptions);

          let needleDetection: ModalDetectionResult | null = null;
          if (needleResult.ok) {
            const d = needleResult.detection;
            needleDetection = {
              engine: "needle",
              architecture: d.architecture,
              confidence: d.confidence,
              reasoning: d.digest,
              digest: d.digest,
              cost: 0,
            };
          }

          modal.showComparison(jevDetection, needleDetection);
        } catch (err) {
          modal.showError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      modal.startDownloading(engine);

      try {
        let result: NeedleDetectResult | { ok: true; detection: ModalDetectionResult } | { ok: false; reason: string };

        if (engine === "jev") {
          modal.updateDownloadProgress("Connecting to Jev...", 0.2);
          result = await detectArchitecture(state.lookup, state.config, {
            apiKey: resolveOpenRouterKey(),
          });
        } else {
          const needleOptions: NeedleDetectOptions = {
            onProgress: (stage, progress) => {
              if (stage.startsWith("Downloading") || stage.startsWith("Preparing")) {
                modal.updateDownloadProgress(stage, progress);
              } else {
                modal.startDetecting(engine);
                modal.updateDetectionProgress(stage, progress);
              }
            },
          };
          result = await detectArchitectureNeedle(state.lookup, state.config, needleOptions);
        }

        if (!result.ok) {
          modal.showError(result.reason);
          return;
        }

        const detection = result.detection;
        const modalResult: ModalDetectionResult = {
          engine,
          architecture: detection.architecture,
          confidence: detection.confidence,
          reasoning: detection.digest,
          digest: detection.digest,
          cost: detection.cost,
        };

        modal.showResult(modalResult);
      } catch (err) {
        modal.showError(err instanceof Error ? err.message : String(err));
      }
    },
    onConfirm: (result: ModalDetectionResult) => {
      state.config = { ...state.config, architecture: result.architecture };
      saveProjectConfig(state.root, state.config);
      onRefresh?.();
      ctx.ui.notify(
        `Architektura detekována: ${architectureCode(result.architecture)} (${Math.round(result.confidence * 100)}%)\nUloženo do ${projectConfigPath(state.root)}`,
        "info",
      );
      doneFn?.(result);
    },
    onCancel: () => {
      ctx.ui.notify("Detekce architektury zrušena. Používá se výchozí: VSA.", "info");
      doneFn?.(undefined);
    },
  });

  await ctx.ui.custom((tui, theme, _keybindings, done) => {
    doneFn = done;
    modal.setContext(tui, theme);
    return {
      render: (width: number) => modal.render(width),
      handleInput: (data: string) => {
        modal.handleInput(data);
        tui.requestRender();
      },
      invalidate: () => modal.invalidate(),
    };
  });
}
