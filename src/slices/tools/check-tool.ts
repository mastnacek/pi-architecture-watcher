/**
 * Tool slice for pi-architecture-watcher: vsa_check custom tool.
 */

import { resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readTextSafe, relPosix } from "../../shared/paths.js";
import type { WatcherState } from "../../shared/state.js";
import type { Report } from "../../shared/types.js";
import { architectureCode } from "../archdetect/index.js";
import { formatReport } from "../report/index.js";

export interface VsaToolHelpers {
  analyze: (watcher: WatcherState, absPath: string, rel: string, content: string) => Report;
  refreshStatus: (ctx: ExtensionContext, watcher: WatcherState, report: Report | null) => void;
}

export function registerVsaCheckTool(
  pi: ExtensionAPI,
  ensureState: (ctx: ExtensionContext) => WatcherState,
  helpers: VsaToolHelpers,
): void {
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
        throw new Error(`Cannot read \`${params.path}\`.`);
      }
      const rel = relPosix(watcher.lookup.root, absPath);
      const report = helpers.analyze(watcher, absPath, rel, content);
      watcher.last = report;
      helpers.refreshStatus(ctx, watcher, report);
      return {
        content: [{
          type: "text" as const,
          text: formatReport(report, { architecture: architectureCode(watcher.config.architecture) }),
        }],
        details: { verdict: report.verdict, score: report.score, findings: report.findings.length },
      };
    },
  });
}
