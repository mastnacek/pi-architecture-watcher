/**
 * pi-architecture-watcher — composition root.
 *
 * Composition root only: it wires the slices and translates Pi events into
 * slice calls. All detection lives in `src/slices/*`; all rendering lives in
 * the `report` slice. Nothing here computes a rule.
 */

import { resolve } from "node:path";
import { Type } from "typebox";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG,
  loadConfig,
  projectConfigPath,
  saveProjectConfig,
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
import type {
  FileFacts,
  Report,
  Severity,
  SliceLookup,
  SourceFile,
  WatcherConfig,
} from "./src/shared/types.js";
import { scanImports } from "./src/slices/scan/index.js";
import { buildSliceMap, discoverRoots } from "./src/slices/topology/index.js";
import { classifyFile, buildRuleCatalogue } from "./src/slices/classify/index.js";
import {
  formatDeclined,
  formatInjection,
  formatOneLiner,
  formatReport,
  formatRuleCatalogue,
  formatStatus,
  formatWatching,
} from "./src/slices/report/index.js";
import { decideGate } from "./src/slices/enforce/index.js";
import {
  completeVsaArguments,
  findSetting,
  formatValue,
  parseValue,
  SETTING_SPECS,
} from "./src/slices/settings/index.js";
import {
  architectureCode,
  detectArchitecture,
  estimateDepth,
} from "./src/slices/archdetect/index.js";
import {
  detectArchitectureNeedle,
  type NeedleDetectOptions,
  type NeedleDetectResult,
  ArchDetectModal,
  type DetectionEngine,
  type ModalDetectionResult,
} from "./src/slices/archdetect-needle/index.js";

const STATUS_KEY = "vsa";

/**
 * Resolve the OpenRouter key the same way Pi's own providers do: the
 * `OPENROUTER_API_KEY` env var first, then the OpenRouter OAuth credential
 * stored in `~/.pi/agent/auth.json` (its `access` field is the permanent API
 * key). Kept here in the composition root so the `archdetect` slice stays
 * free of `@earendil-works/pi-coding-agent` imports.
 */
function resolveOpenRouterKey(): string | undefined {
  const env = process.env["OPENROUTER_API_KEY"];
  if (env && env.length > 0) return env;
  const cred = readStoredCredential("openrouter") as { access?: unknown } | undefined;
  if (cred && typeof cred.access === "string" && cred.access.length > 0) return cred.access;
  return undefined;
}

interface WatcherState {
  root: string;
  config: WatcherConfig;
  lookup: SliceLookup;
  pending: Map<string, Report>;
  last: Report | null;
}

interface EditInput {
  path?: unknown;
  content?: unknown;
  edits?: unknown;
}

/**
 * Apply Pi's edit semantics: replace the first occurrence of each `oldText`
 * with its `newText`, in order. Returns the prospective file content.
 */
function applyEdits(existing: string, edits: unknown): string | null {
  if (!Array.isArray(edits) || edits.length === 0) return null;
  let next = existing;
  for (const raw of edits) {
    if (!raw || typeof raw !== "object") return null;
    const { oldText, newText } = raw as { oldText?: unknown; newText?: unknown };
    if (typeof oldText !== "string" || typeof newText !== "string") return null;
    const at = next.indexOf(oldText);
    if (at === -1) return null;
    next = next.slice(0, at) + newText + next.slice(at + oldText.length);
  }
  return next;
}

export default function architectureWatcher(pi: ExtensionAPI): void {
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
    const current = ensureState(ctx);
    current.config = loadConfig(current.root);
    current.lookup = buildSliceMap(current.root, current.config);
  };

  /** Decide whether a tool call should be inspected at all. */
  const shouldWatch = (
    toolName: string,
    input: EditInput,
    watcher: WatcherState,
  ): string | null => {
    const watched = new Set([
      ...watcher.config.watchTools,
      ...watcher.config.watchToolPatterns,
    ]);
    if (!watched.has(toolName)) return null;
    if (typeof input.path !== "string" || input.path.length === 0) return null;
    return input.path;
  };

  /** Build the prospective content for the pending write, if determinable. */
  const prospectiveContent = (
    absPath: string,
    toolName: string,
    input: EditInput,
  ): string | null => {
    if (toolName === "write" && typeof input.content === "string") return input.content;
    const existing = readTextSafe(absPath);
    if (existing === null) return null;
    if (toolName === "edit") return applyEdits(existing, input.edits);
    return existing; // custom tools: analyze the file as it stands
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
    // Statusline is UI-only; never touch ctx.ui in a headless session (AGENTS.md §6).
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

/** Show the architecture detection modal and handle the result. */
async function showArchitectureDetectionModal(
  ctx: ExtensionContext,
  state: WatcherState,
): Promise<void> {
  let doneFn: ((result?: ModalDetectionResult) => void) | null = null;

  const modal = new ArchDetectModal({
    onEngineSelect: async (engine: DetectionEngine) => {
      if (engine === "compare") {
        // Run both Jev and Needle for comparison
        modal.startComparing();
        try {
          // Run Jev
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

          // Run Needle
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
          // needle or auto (prefer needle)
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
          reasoning: detection.digest, // use digest as reasoning for now
          digest: detection.digest,
          cost: detection.cost,
        };

        modal.showResult(modalResult);
      } catch (err) {
        modal.showError(err instanceof Error ? err.message : String(err));
      }
    },
    onConfirm: (result: ModalDetectionResult) => {
      // Save the detected architecture to config
      state.config = { ...state.config, architecture: result.architecture };
      saveProjectConfig(state.root, state.config);
      refreshTopology(ctx);
      refreshStatus(ctx, state, state.last);
      ctx.ui.notify(
        `Architektura detekována: ${architectureCode(result.architecture)} (${Math.round(result.confidence * 100)}%)
Uloženo do ${projectConfigPath(state.root)}`,
        "info",
      );
      doneFn?.(result);
    },
    onCancel: () => {
      // User cancelled - keep default architecture
      ctx.ui.notify("Detekce architektury zrušena. Používá se výchozí: VSA.", "info");
      doneFn?.(undefined);
    },
  });

  // Show the modal via ctx.ui.custom
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

  // --- Pi wiring -----------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    state = createState(ctx.cwd);
    if (state.config.enabled && state.config.statusLine) {
      refreshStatus(ctx, state, null);
    }

    // Offer architecture detection if not yet configured
    if (
      state.config.enabled
      && state.config.architecture === "vsa" // default, not yet detected
      && ctx.hasUI
      && state.lookup.slices().length > 0
    ) {
      await showArchitectureDetectionModal(ctx, state);
    }
  });

  pi.on("tool_call", async (event, ctx) => {
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
  });

  pi.on("tool_result", async (event, ctx) => {
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
  });

  // Drop the session-scoped watcher state on shutdown (AGENTS.md §5/§6);
  // it is rebuilt lazily via ensureState() on the next session.
  pi.on("session_shutdown", () => {
    state = null;
  });

  // --- LLM-callable tool ---------------------------------------------------

  pi.registerTool({
    name: "vsa_check",
    label: "VSA check",
    description:
      "Check a file against the project's Vertical Slice Architecture. Returns the verdict, "
      + "a 0-100 violation score and one actionable suggestion per finding. No LLM is involved. "
      + "Use it before large refactors or when unsure which slice a file belongs to.",
    promptSnippet:
      "Check a file for vertical-slice-architecture violations and get fix suggestions",
    promptGuidelines: [
      "Run vsa_check after adding a new module to confirm it landed in the right slice.",
      "Treat vsa_check errors as blocking: fix the import surface before continuing.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "File path, relative to the project root." }),
      content: Type.Optional(
        Type.String({
          description: "Optional prospective content to analyze instead of the file on disk.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const watcher = ensureState(ctx);
      const absPath = resolve(ctx.cwd, params.path);
      const content = typeof params.content === "string"
        ? params.content
        : readTextSafe(absPath);
      if (content === null) {
        // Throw so pi sets isError:true (AGENTS.md §2) instead of returning
        // a value, which would leave the tool result flagged as successful.
        throw new Error(`Cannot read \`${params.path}\`.`);
      }
      const rel = relPosix(watcher.lookup.root, absPath);
      const report = analyze(watcher, absPath, rel, content);
      watcher.last = report;
      refreshStatus(ctx, watcher, report);
      return {
        content: [{
          type: "text" as const,
          text: formatReport(report, { architecture: architectureCode(watcher.config.architecture) }),
        }],
        details: { verdict: report.verdict, score: report.score, findings: report.findings.length },
      };
    },
  });

  // --- Commands ------------------------------------------------------------

  const resolveTargetPath = (ctx: ExtensionCommandContext, arg: string): string => {
    if (arg.length > 0) return resolve(ctx.cwd, arg);
    return state?.last?.abs ?? "";
  };

  pi.registerCommand("vsa", {
    description:
      "Vertical Slice Architecture watcher: `/vsa [status|check <path>|config [get|set] <key> [value]|"
      + "mode <auto|human|off>|rules|explain|init|detect|depth|roots|rescan|on|off|help]`",
    getArgumentCompletions: (prefix) =>
      completeVsaArguments(prefix, state?.config ?? DEFAULT_CONFIG),
    handler: async (args, ctx) => {
      const watcher = ensureState(ctx);
      const [sub = "status", ...rest] = args.trim().split(/\s+/);
      const arg = rest.join(" ");

      switch (sub) {
        case "status": {
          const report = watcher.last;
          const lines = [
            `režim: ${watcher.config.mode} · zapnuto: ${watcher.config.enabled} · `
              + `blockAt: ${watcher.config.blockAt}`,
            `kořen: ${watcher.lookup.root}`,
            `řezy (${watcher.lookup.slices().length}): `
              + watcher.lookup.slices().map((s) => s.id).join(", "),
            `sdílené: ${watcher.lookup.sharedRoots().join(", ") || "—"}`,
            `konfigurace: ${projectConfigPath(watcher.root)}`,
          ];
          if (report) {
            lines.push("", formatReport(report, {
              architecture: architectureCode(watcher.config.architecture),
            }));
          }
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }

        case "check": {
          const abs = resolveTargetPath(ctx, arg);
          if (!abs) {
            ctx.ui.notify("Použití: /vsa check <cesta>", "warning");
            return;
          }
          const content = readTextSafe(abs);
          if (content === null) {
            ctx.ui.notify(`Nelze přečíst ${abs}`, "error");
            return;
          }
          const report = analyze(watcher, abs, relPosix(watcher.lookup.root, abs), content);
          watcher.last = report;
          refreshStatus(ctx, watcher, report);
          ctx.ui.notify(
            formatReport(report, { architecture: architectureCode(watcher.config.architecture) }),
            report.findings.length === 0 ? "info" : "warning",
          );
          return;
        }

        case "mode": {
          const next = arg.trim();
          if (next !== "auto" && next !== "human" && next !== "off") {
            ctx.ui.notify("Použití: /vsa mode <auto|human|off>", "warning");
            return;
          }
          watcher.config = { ...watcher.config, mode: next };
          saveProjectConfig(watcher.root, watcher.config);
          refreshStatus(ctx, watcher, watcher.last);
          ctx.ui.notify(`[vsa] režim = ${next} (uloženo do ${projectConfigPath(watcher.root)})`, "info");
          return;
        }

        case "rules":
          ctx.ui.notify(
            `Pravidla ${architectureCode(watcher.config.architecture)}\n${formatRuleCatalogue(buildRuleCatalogue(watcher.config.architecture))}`,
            "info",
          );
          return;

        case "explain": {
          if (!watcher.last) {
            ctx.ui.notify("Zatím žádný soubor neanalyzován. Spusť `/vsa check <cesta>`.", "warning");
            return;
          }
          ctx.ui.notify(
            formatReport(watcher.last, { architecture: architectureCode(watcher.config.architecture) }),
            "info",
          );
          return;
        }

        case "init": {
          saveProjectConfig(watcher.root, { ...DEFAULT_CONFIG });
          refreshTopology(ctx);
          ctx.ui.notify(`Výchozí konfigurace zapsána do ${projectConfigPath(watcher.root)}`, "info");
          return;
        }

        case "rescan": {
          refreshTopology(ctx);
          ctx.ui.notify(
            `[vsa] topologie přestavěna: ${watcher.lookup.slices().length} řezů`,
            "info",
          );
          return;
        }

        case "detect": {
          await showArchitectureDetectionModal(ctx, watcher);
          return;
        }

        case "roots": {
          const discovered = discoverRoots(watcher.root, watcher.config);
          if (discovered.roots.length === 0 && discovered.sharedRoots.length === 0) {
            ctx.ui.notify("[vsa] nenašel jsem žádné adresáře řezů ani sdílené kořeny.", "warning");
            return;
          }
          const next: WatcherConfig = { ...watcher.config };
          if (discovered.roots.length > 0) next.roots = discovered.roots;
          if (discovered.sharedRoots.length > 0) next.sharedRoots = discovered.sharedRoots;
          watcher.config = next;
          saveProjectConfig(watcher.root, next);
          refreshTopology(ctx);
          ctx.ui.notify(
            `[vsa] kořeny řezů (${discovered.roots.length}): ${discovered.roots.join(", ") || "—"}\n`
              + `sdílené (${discovered.sharedRoots.length}): ${discovered.sharedRoots.join(", ") || "—"}\n`
              + `řezy: ${watcher.lookup.slices().length}\n`
              + `uloženo → ${projectConfigPath(watcher.root)}`,
            "info",
          );
          return;
        }

        case "depth": {
          const depth = estimateDepth(watcher.lookup, watcher.config);
          const shallowPct = Math.round(depth.shallowFraction * 100);
          const lines = [
            "Hloubka modulů (statický odhad, bez modelu)",
            `vzorkováno: ${depth.sampled} souborů`,
            `prům. hloubka (impl/interface): ${depth.avgDepth.toFixed(1)}`,
            `podíl mělkých modulů: ${shallowPct}%`,
          ];
          if (depth.shallowFiles.length > 0) {
            lines.push("", `nejměltější moduly (${depth.shallowFiles.length}):`);
            for (const rel of depth.shallowFiles) lines.push(`  - ${rel}`);
          }
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }

        case "on":
        case "off": {
          watcher.config = { ...watcher.config, enabled: sub === "on" };
          saveProjectConfig(watcher.root, watcher.config);
          if (!watcher.config.enabled && watcher.config.statusLine) {
            ctx.ui.setStatus(STATUS_KEY, undefined);
          } else {
            refreshStatus(ctx, watcher, watcher.last);
          }
          ctx.ui.notify(`[vsa] zapnuto = ${watcher.config.enabled}`, "info");
          return;
        }

        case "config": {
          const [action = "list", settingKey, ...valueParts] = rest;

          if (action === "list") {
            const lines = SETTING_SPECS.map(
              (spec) => `${spec.key} = ${formatValue(watcher.config[spec.key])}`,
            );
            ctx.ui.notify(
              `[vsa] nastavení (${projectConfigPath(watcher.root)})\n${lines.join("\n")}`,
              "info",
            );
            return;
          }

          if (action === "get") {
            if (!settingKey) {
              ctx.ui.notify("Použití: /vsa config get <klíč>", "warning");
              return;
            }
            const spec = findSetting(settingKey);
            if (!spec) {
              ctx.ui.notify(
                `Neznámé nastavení \`${settingKey}\`. Spusť \`/vsa config\` pro seznam nastavení.`,
                "warning",
              );
              return;
            }
            ctx.ui.notify(
              `${spec.key} = ${formatValue(watcher.config[spec.key])} — ${spec.description}`,
              "info",
            );
            return;
          }

          if (action === "set") {
            if (!settingKey) {
              ctx.ui.notify("Použití: /vsa config set <klíč> <hodnota>", "warning");
              return;
            }
            const spec = findSetting(settingKey);
            if (!spec) {
              ctx.ui.notify(
                `Neznámé nastavení \`${settingKey}\`. Spusť \`/vsa config\` pro seznam nastavení.`,
                "warning",
              );
              return;
            }
            const raw = valueParts.join(" ");
            if (!raw) {
              ctx.ui.notify(`Použití: /vsa config set ${spec.key} <hodnota>`, "warning");
              return;
            }
            const parsed = parseValue(spec, raw);
            if (!parsed.ok) {
              ctx.ui.notify(`[vsa] ${parsed.error}`, "warning");
              return;
            }
            watcher.config = { ...watcher.config, [spec.key]: parsed.value };
            saveProjectConfig(watcher.root, watcher.config);
            refreshTopology(ctx);
            if (watcher.config.statusLine) refreshStatus(ctx, watcher, watcher.last);
            else ctx.ui.setStatus(STATUS_KEY, undefined);
            ctx.ui.notify(
              `[vsa] ${spec.key} = ${formatValue(watcher.config[spec.key])} `
                + `(uloženo do ${projectConfigPath(watcher.root)})`,
              "info",
            );
            return;
          }

          ctx.ui.notify(`Neznámá akce config \`${action}\`. Použij: get, set`, "warning");
          return;
        }

        case "help":
          ctx.ui.notify(
            "Příkazy VSA: /vsa [status | check <cesta> | config [get|set] <klíč> [hodnota] | "
              + "mode <auto|human|off> | rules | explain | init | detect | depth | roots | rescan | on | off]. "
              + "Našeptávač argumentů je kontextový a ukazuje nápovědu při psaní.",
            "info",
          );
          return;

        default:
          ctx.ui.notify(
            `Neznámý podpříkaz \`${sub}\`. Zkus: status, check, config, mode, rules, explain, init, detect, depth, roots, rescan, on, off, help`,
            "warning",
          );
      }
    },
  });

  pi.registerShortcut("ctrl+shift+v", {
    description: "Znovu zkontrolovat poslední upravený soubor proti VSA",
    handler: async (ctx) => {
      if (!ctx.hasUI) return;
      const watcher = ensureState(ctx);
      if (!watcher.last) {
        ctx.ui.notify("[vsa] zatím nic neanalyzováno", "warning");
        return;
      }
      const content = readTextSafe(watcher.last.abs);
      if (content === null) {
        ctx.ui.notify(`[vsa] nelze přečíst ${watcher.last.file}`, "error");
        return;
      }
      const report = analyze(watcher, watcher.last.abs, watcher.last.file, content);
      watcher.last = report;
      refreshStatus(ctx, watcher, report);
      ctx.ui.notify(
        formatOneLiner(report, architectureCode(watcher.config.architecture)),
        report.findings.length === 0 ? "info" : "warning",
      );
    },
  });
}

/** Severity re-export kept for consumers that only import types from the root. */
export type { Severity };
