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
import type {
  FileFacts,
  Report,
  Severity,
  SliceLookup,
  SourceFile,
  WatcherConfig,
} from "./src/shared/types.js";
import { scanImports } from "./src/slices/scan/index.js";
import { buildSliceMap } from "./src/slices/topology/index.js";
import { classifyFile, RULE_CATALOGUE } from "./src/slices/classify/index.js";
import {
  formatDeclined,
  formatInjection,
  formatOneLiner,
  formatReport,
  formatRuleCatalogue,
  formatStatus,
} from "./src/slices/report/index.js";
import { decideGate } from "./src/slices/enforce/index.js";

const STATUS_KEY = "vsa";

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
    const facts: FileFacts = {
      file,
      imports: scanImports(content),
      slice: watcher.lookup.sliceOf(absPath),
      shared: watcher.lookup.sharedOf(absPath),
      lookup: watcher.lookup,
      config: watcher.config,
      projectRoot: watcher.lookup.root,
      resolve: (edge) => resolveImport(edge, absPath, watcher.lookup.root, watcher.config),
    };
    return classifyFile(facts);
  };

  const publishStatus = (ctx: ExtensionContext, watcher: WatcherState, report: Report): void => {
    if (!watcher.config.statusLine) return;
    ctx.ui.setStatus(STATUS_KEY, formatStatus(report));
  };

  // --- Pi wiring -----------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    state = createState(ctx.cwd);
    if (state.config.enabled && state.config.statusLine) {
      const sliceCount = state.lookup.slices().length;
      ctx.ui.setStatus(STATUS_KEY, `VSA watching ${sliceCount} slices · mode ${state.config.mode}`);
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
    publishStatus(ctx, watcher, report);

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
          `VSA ${report.verdict} (${report.score}/100)`,
          `${formatReport(report, { verbose: false })}\n\nWrite anyway?`,
        );
        if (!approved) {
          ctx.ui.notify("[vsa] write blocked by architecture watcher", "warning");
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
      content: [...event.content, { type: "text" as const, text: formatInjection(report) }],
    };
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
        return {
          content: [{ type: "text" as const, text: `Cannot read \`${params.path}\`.` }],
          details: null,
        };
      }
      const rel = relPosix(watcher.lookup.root, absPath);
      const report = analyze(watcher, absPath, rel, content);
      watcher.last = report;
      publishStatus(ctx, watcher, report);
      return {
        content: [{ type: "text" as const, text: formatReport(report) }],
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
      "Vertical Slice Architecture watcher: `/vsa [status|check <path>|mode <auto|human|off>|"
      + "rules|explain|init|rescan|on|off]`",
    getArgumentCompletions: (prefix) => {
      const subs = ["status", "check", "mode", "rules", "explain", "init", "rescan", "on", "off"];
      return subs
        .filter((s) => s.startsWith(prefix))
        .map((s) => ({ value: s, label: s }));
    },
    handler: async (args, ctx) => {
      const watcher = ensureState(ctx);
      const [sub = "status", ...rest] = args.trim().split(/\s+/);
      const arg = rest.join(" ");

      switch (sub) {
        case "status": {
          const report = watcher.last;
          const lines = [
            `mode: ${watcher.config.mode} · enabled: ${watcher.config.enabled} · `
              + `blockAt: ${watcher.config.blockAt}`,
            `root: ${watcher.lookup.root}`,
            `slices (${watcher.lookup.slices().length}): `
              + watcher.lookup.slices().map((s) => s.id).join(", "),
            `shared: ${watcher.lookup.sharedRoots().join(", ") || "—"}`,
            `config: ${projectConfigPath(watcher.root)}`,
          ];
          if (report) lines.push("", formatReport(report));
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }

        case "check": {
          const abs = resolveTargetPath(ctx, arg);
          if (!abs) {
            ctx.ui.notify("Usage: /vsa check <path>", "warning");
            return;
          }
          const content = readTextSafe(abs);
          if (content === null) {
            ctx.ui.notify(`Cannot read ${abs}`, "error");
            return;
          }
          const report = analyze(watcher, abs, relPosix(watcher.lookup.root, abs), content);
          watcher.last = report;
          publishStatus(ctx, watcher, report);
          ctx.ui.notify(formatReport(report), report.findings.length === 0 ? "info" : "warning");
          return;
        }

        case "mode": {
          const next = arg.trim();
          if (next !== "auto" && next !== "human" && next !== "off") {
            ctx.ui.notify("Usage: /vsa mode <auto|human|off>", "warning");
            return;
          }
          watcher.config = { ...watcher.config, mode: next };
          saveProjectConfig(watcher.root, watcher.config);
          ctx.ui.notify(`[vsa] mode = ${next} (saved to ${projectConfigPath(watcher.root)})`, "info");
          return;
        }

        case "rules":
          ctx.ui.notify(`VSA rules\n${formatRuleCatalogue(RULE_CATALOGUE)}`, "info");
          return;

        case "explain": {
          if (!watcher.last) {
            ctx.ui.notify("No file analyzed yet. Run `/vsa check <path>`.", "warning");
            return;
          }
          ctx.ui.notify(formatReport(watcher.last), "info");
          return;
        }

        case "init": {
          saveProjectConfig(watcher.root, { ...DEFAULT_CONFIG });
          refreshTopology(ctx);
          ctx.ui.notify(`Wrote default config to ${projectConfigPath(watcher.root)}`, "info");
          return;
        }

        case "rescan": {
          refreshTopology(ctx);
          ctx.ui.notify(
            `[vsa] topology rebuilt: ${watcher.lookup.slices().length} slices`,
            "info",
          );
          return;
        }

        case "on":
        case "off": {
          watcher.config = { ...watcher.config, enabled: sub === "on" };
          saveProjectConfig(watcher.root, watcher.config);
          if (!watcher.config.enabled && watcher.config.statusLine) {
            ctx.ui.setStatus(STATUS_KEY, undefined);
          }
          ctx.ui.notify(`[vsa] enabled = ${watcher.config.enabled}`, "info");
          return;
        }

        default:
          ctx.ui.notify(
            `Unknown subcommand \`${sub}\`. Try: status, check, mode, rules, explain, init, rescan, on, off`,
            "warning",
          );
      }
    },
  });

  pi.registerShortcut("ctrl+shift+v", {
    description: "Re-check the last edited file against VSA",
    handler: async (ctx) => {
      const watcher = ensureState(ctx);
      if (!watcher.last) {
        ctx.ui.notify("[vsa] nothing analyzed yet", "warning");
        return;
      }
      const content = readTextSafe(watcher.last.abs);
      if (content === null) {
        ctx.ui.notify(`[vsa] cannot read ${watcher.last.file}`, "error");
        return;
      }
      const report = analyze(watcher, watcher.last.abs, watcher.last.file, content);
      watcher.last = report;
      publishStatus(ctx, watcher, report);
      ctx.ui.notify(formatOneLiner(report), report.findings.length === 0 ? "info" : "warning");
    },
  });
}

/** Severity re-export kept for consumers that only import types from the root. */
export type { Severity };
