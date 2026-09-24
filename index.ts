/**
 * pi-architecture-watcher — composition root.
 *
 * Composition root only: it wires the slices and translates Pi events into
 * slice calls. All detection lives in `src/slices/*`; all rendering lives in
 * the `report` slice. Nothing here computes a rule.
 */

import { resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG,
  loadConfig,
} from "./src/shared/config.js";
import {
  baseName,
  hasSourceExtension,
  isSubPath,
  matchesAny,
  readTextSafe,
  relPosix,
  resolveImport,
} from "./src/shared/paths.js";
import { languageOf } from "./src/shared/languages.js";
import {
  applyEdits,
  STATUS_KEY,
  type EditInput,
  type WatcherState,
} from "./src/shared/state.js";
import type {
  FileFacts,
  Report,
  Severity,
  SourceFile,
} from "./src/shared/types.js";
import { scanImports } from "./src/slices/scan/index.js";
import { buildSliceMap } from "./src/slices/topology/index.js";
import { classifyFile } from "./src/slices/classify/index.js";
import {
  formatDeclined,
  formatInjection,
  formatReport,
  formatStatus,
  formatWatching,
} from "./src/slices/report/index.js";
import { decideGate } from "./src/slices/enforce/index.js";
import { architectureCode } from "./src/slices/archdetect/index.js";
import { showArchitectureDetectionModal } from "./src/slices/modal/index.js";
import { registerVsaCheckTool } from "./src/slices/tools/check-tool.js";
import { registerVsaCommands } from "./src/slices/commands/index.js";

export default function architectureWatcher(pi: ExtensionAPI): void {
  /** Unsubscribers from every `pi.on()`; drained on session_shutdown (AGENTS §5). */
  const unsubscribers: Array<() => void> = [];

  /** Retain a `pi.on()` return value; older engine typings declare it void. */
  const track = (result: unknown): void => {
    if (typeof result === "function") unsubscribers.push(result as () => void);
  };

  let state: WatcherState | null = null;

  const createState = (root: string): WatcherState => {
    const config = loadConfig(root);
    return {
      root,
      config,
      lookup: buildSliceMap(root, config),
      pending: new Map(),
      last: null,
    };
  };

  const ensureState = (ctx: ExtensionContext): WatcherState => {
    if (!state || state.root !== ctx.cwd) state = createState(ctx.cwd);
    return state;
  };

  const refreshTopology = (ctx: ExtensionContext): void => {
    const watcher = ensureState(ctx);
    watcher.config = loadConfig(watcher.root);
    watcher.lookup = buildSliceMap(watcher.root, watcher.config);
  };

  const shouldWatch = (
    toolName: string,
    input: EditInput,
    watcher: WatcherState,
  ): string | null => {
    const rawPath = typeof input.path === "string" ? input.path : null;
    if (rawPath === null) return null;
    if (watcher.config.watchTools.includes(toolName)) return rawPath;
    if (matchesAny(toolName, watcher.config.watchToolPatterns)) return rawPath;
    return null;
  };

  const prospectiveContent = (
    absPath: string,
    toolName: string,
    input: EditInput,
  ): string | null => {
    if (toolName === "write") {
      return typeof input.content === "string" ? input.content : null;
    }
    const existing = readTextSafe(absPath);
    if (existing === null) return null;
    if (toolName === "edit") {
      return applyEdits(existing, input.edits);
    }
    return typeof input.content === "string" ? input.content : existing;
  };

  const analyze = (
    watcher: WatcherState,
    absPath: string,
    rel: string,
    content: string,
  ): Report => {
    const file: SourceFile = { path: absPath, rel, content };
    const language = languageOf(absPath);
    const facts: FileFacts = {
      file,
      imports: scanImports(content, language),
      slice: watcher.lookup.sliceOf(absPath),
      shared: watcher.lookup.sharedOf(absPath),
      lookup: watcher.lookup,
      config: watcher.config,
      projectRoot: watcher.lookup.root,
      resolve: (edge) => resolveImport(edge, absPath, watcher.lookup.root, watcher.config, language),
    };
    return classifyFile(facts);
  };

  const refreshStatus = (ctx: ExtensionContext, watcher: WatcherState, report: Report | null): void => {
    if (!ctx.hasUI) return;
    if (!watcher.config.statusLine) return;
    if (report) {
      ctx.ui.setStatus(STATUS_KEY, formatStatus(report, {
        mode: watcher.config.mode,
        theme: ctx.ui.theme,
        architecture: architectureCode(watcher.config.architecture),
      }));
    } else {
      ctx.ui.setStatus(STATUS_KEY, formatWatching(
        watcher.lookup.slices().length,
        watcher.config.mode,
        ctx.ui.theme,
        architectureCode(watcher.config.architecture),
      ));
    }
  };

  // --- Pi wiring -----------------------------------------------------------

  track(pi.on("session_start", async (_event, ctx) => {
    state = createState(ctx.cwd);
    if (state.config.enabled && state.config.statusLine) {
      refreshStatus(ctx, state, null);
    }

    if (
      state.config.enabled
      && state.config.architecture === "vsa"
      && ctx.hasUI
      && state.lookup.slices().length > 0
    ) {
      await showArchitectureDetectionModal(ctx, state, () => {
        refreshTopology(ctx);
        if (state) refreshStatus(ctx, state, state.last);
      });
    }
  }));

  track(pi.on("tool_call", async (event, ctx) => {
    const watcher = ensureState(ctx);
    if (!watcher.config.enabled) return;

    const toolName = event.toolName;
    const input = event.input as EditInput;
    const rawPath = shouldWatch(toolName, input, watcher);
    if (rawPath === null) return;

    const absPath = resolve(ctx.cwd, rawPath);
    if (!isSubPath(watcher.lookup.root, absPath)) return;
    if (!hasSourceExtension(baseName(absPath), watcher.config.sourceExtensions)) return;

    const rel = relPosix(watcher.lookup.root, absPath);
    if (matchesAny(rel, watcher.config.ignore)) return;

    const content = prospectiveContent(absPath, toolName, input);
    if (content === null) return;

    const report = analyze(watcher, absPath, rel, content);
    watcher.last = report;
    refreshStatus(ctx, watcher, report);

    const decision = decideGate({
      report,
      config: watcher.config,
      hasUI: ctx.hasUI,
    });

    switch (decision.action) {
      case "pass":
        return;

      case "advise":
        watcher.pending.set(event.toolCallId, report);
        return;

      case "notify":
        ctx.ui.notify(`[vsa] ${decision.reason}`, "warning");
        return;

      case "confirm": {
        const approved = await ctx.ui.confirm(
          `${architectureCode(watcher.config.architecture)} ${report.verdict} (${report.score}/100)`,
          `${formatReport(report, {
            verbose: false,
            architecture: architectureCode(watcher.config.architecture),
          })}\n\nPřesto zapsat?`,
        );
        if (!approved) {
          ctx.ui.notify("[vsa] zápis zablokován architecture watcherem", "warning");
          return {
            block: true,
            reason: formatDeclined(report),
            terminate: false,
          };
        }
        return;
      }

      case "block":
        return { block: true, reason: decision.reason, terminate: false };
    }
  }));

  track(pi.on("tool_result", async (event, ctx) => {
    const watcher = ensureState(ctx);
    const report = watcher.pending.get(event.toolCallId);
    if (!report) return;
    watcher.pending.delete(event.toolCallId);

    if (event.isError || !watcher.config.injectFixes) return;
    if (report.findings.length === 0) return;

    return {
      content: [...event.content, {
        type: "text" as const,
        text: formatInjection(report, architectureCode(watcher.config.architecture)),
      }],
    };
  }));

  pi.on("session_shutdown", () => {
    while (unsubscribers.length > 0) unsubscribers.pop()?.();
    state = null;
  });

  // --- Register Tools & Commands -------------------------------------------

  registerVsaCheckTool(pi, ensureState, {
    analyze,
    refreshStatus,
  });

  registerVsaCommands(pi, ensureState, {
    getConfig: () => state?.config ?? DEFAULT_CONFIG,
    refreshStatus,
    refreshTopology,
    analyze,
    showDetectionModal: async (ctx, watcher) => {
      await showArchitectureDetectionModal(ctx, watcher, () => {
        refreshTopology(ctx);
        refreshStatus(ctx, watcher, watcher.last);
      });
    },
  });
}

/** Severity re-export kept for consumers that only import types from the root. */
export type { Severity };
