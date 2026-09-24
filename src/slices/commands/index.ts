/**
 * Command slice for pi-architecture-watcher: /vsa command and keyboard shortcuts.
 */

import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG,
  projectConfigPath,
  saveConfig,
} from "../../shared/config.js";
import { readTextSafe, relPosix } from "../../shared/paths.js";
import { STATUS_KEY, type WatcherState } from "../../shared/state.js";
import type { Report, WatcherConfig } from "../../shared/types.js";
import { architectureCode, estimateDepth } from "../archdetect/index.js";
import { buildRuleCatalogue } from "../classify/index.js";
import { formatOneLiner, formatReport, formatRuleCatalogue } from "../report/index.js";
import {
  completeVsaArguments,
  findSetting,
  formatValue,
  parseValue,
  SETTING_SPECS,
} from "../settings/index.js";
import { discoverRoots } from "../topology/index.js";

export interface VsaCommandHelpers {
  getConfig: () => WatcherConfig;
  refreshStatus: (ctx: ExtensionContext, watcher: WatcherState, report: Report | null) => void;
  refreshTopology: (ctx: ExtensionContext) => void;
  analyze: (watcher: WatcherState, absPath: string, rel: string, content: string) => Report;
  showDetectionModal: (ctx: ExtensionContext, watcher: WatcherState) => Promise<void>;
}

export function registerVsaCommands(
  pi: ExtensionAPI,
  ensureState: (ctx: ExtensionContext) => WatcherState,
  helpers: VsaCommandHelpers,
): void {
  const resolveTargetPath = (ctx: ExtensionCommandContext, arg: string): string => {
    if (arg.length > 0) return resolve(ctx.cwd, arg);
    const watcher = ensureState(ctx);
    return watcher.last?.abs ?? "";
  };

  pi.registerCommand("vsa", {
    description:
      "Vertical Slice Architecture watcher: `/vsa [status|check <path>|<setting> [val]|"
      + "mode <auto|human|off>|rules|explain|init|detect|depth|roots|rescan|on|off|help|--global]`",
    getArgumentCompletions: (prefix) => {
      const config = helpers.getConfig() ?? DEFAULT_CONFIG;
      return completeVsaArguments(prefix, config);
    },
    handler: async (args, ctx) => {
      const watcher = ensureState(ctx);
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const isGlobal = tokens.some((t) => t.toLowerCase() === "--global");
      const cleanTokens = tokens.filter((t) => t.toLowerCase() !== "--global");

      const sub = (cleanTokens[0] ?? "status").toLowerCase();
      const rest = cleanTokens.slice(1);
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
          const report = helpers.analyze(watcher, abs, relPosix(watcher.lookup.root, abs), content);
          watcher.last = report;
          helpers.refreshStatus(ctx, watcher, report);
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
          saveConfig(watcher.config, isGlobal, watcher.root);
          helpers.refreshStatus(ctx, watcher, watcher.last);
          ctx.ui.notify(`[vsa] režim = ${next} (uloženo ${isGlobal ? "globálně" : "do projektu"})`, "info");
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
          saveConfig({ ...DEFAULT_CONFIG }, isGlobal, watcher.root);
          helpers.refreshTopology(ctx);
          ctx.ui.notify(`Výchozí konfigurace zapsána (${isGlobal ? "globálně" : projectConfigPath(watcher.root)})`, "info");
          return;
        }

        case "rescan": {
          helpers.refreshTopology(ctx);
          ctx.ui.notify(
            `[vsa] topologie přestavěna: ${watcher.lookup.slices().length} řezů`,
            "info",
          );
          return;
        }

        case "detect": {
          await helpers.showDetectionModal(ctx, watcher);
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
          saveConfig(watcher.config, isGlobal, watcher.root);
          helpers.refreshTopology(ctx);
          ctx.ui.notify(
            `[vsa] kořeny řezů (${discovered.roots.length}): ${discovered.roots.join(", ") || "—"}\n`
              + `sdílené (${discovered.sharedRoots.length}): ${discovered.sharedRoots.join(", ") || "—"}\n`
              + `řezy: ${watcher.lookup.slices().length}\n`
              + `uloženo → ${isGlobal ? "globálně" : projectConfigPath(watcher.root)}`,
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
          saveConfig(watcher.config, isGlobal, watcher.root);
          if (!watcher.config.enabled && watcher.config.statusLine) {
            ctx.ui.setStatus(STATUS_KEY, undefined);
          } else {
            helpers.refreshStatus(ctx, watcher, watcher.last);
          }
          ctx.ui.notify(`[vsa] zapnuto = ${watcher.config.enabled} (uloženo ${isGlobal ? "globálně" : "do projektu"})`, "info");
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
            saveConfig(watcher.config, isGlobal, watcher.root);
            helpers.refreshTopology(ctx);
            if (watcher.config.statusLine) helpers.refreshStatus(ctx, watcher, watcher.last);
            else ctx.ui.setStatus(STATUS_KEY, undefined);
            ctx.ui.notify(
              `[vsa] ${spec.key} = ${formatValue(watcher.config[spec.key])} `
                + `(uloženo ${isGlobal ? "globálně" : "do projektu"})`,
              "info",
            );
            return;
          }

          ctx.ui.notify(`Neznámá akce config \`${action}\`. Použij: get, set`, "warning");
          return;
        }

        case "help":
          ctx.ui.notify(
            "Příkazy VSA: /vsa [status | check <cesta> | <nastavení> [hodnota] | "
              + "mode <auto|human|off> | rules | explain | init | detect | depth | roots | rescan | on | off | --global]. "
              + "Přímé nastavení: např. `/vsa blockAt error` nebo `/vsa --global notifyFrom warning`. "
              + "Našeptávač argumentů je kontextový a ukazuje nápovědu při psaní.",
            "info",
          );
          return;

        default: {
          const directSpec = findSetting(sub);
          if (directSpec) {
            if (!arg) {
              ctx.ui.notify(
                `${directSpec.key} = ${formatValue(watcher.config[directSpec.key])} — ${directSpec.description}`,
                "info",
              );
              return;
            }
            const parsed = parseValue(directSpec, arg);
            if (!parsed.ok) {
              ctx.ui.notify(`[vsa] ${parsed.error}`, "warning");
              return;
            }
            watcher.config = { ...watcher.config, [directSpec.key]: parsed.value };
            saveConfig(watcher.config, isGlobal, watcher.root);
            helpers.refreshTopology(ctx);
            if (watcher.config.statusLine) helpers.refreshStatus(ctx, watcher, watcher.last);
            else ctx.ui.setStatus(STATUS_KEY, undefined);
            ctx.ui.notify(
              `[vsa] ${directSpec.key} = ${formatValue(watcher.config[directSpec.key])} `
                + `(uloženo ${isGlobal ? "globálně" : "do projektu"})`,
              "info",
            );
            return;
          }

          ctx.ui.notify(
            `Neznámý podpříkaz \`${sub}\`. Zkus: status, check, mode, on, off, <nastavení>, help`,
            "warning",
          );
        }
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
      const report = helpers.analyze(watcher, watcher.last.abs, watcher.last.file, content);
      watcher.last = report;
      helpers.refreshStatus(ctx, watcher, report);
      ctx.ui.notify(
        formatOneLiner(report, architectureCode(watcher.config.architecture)),
        report.findings.length === 0 ? "info" : "warning",
      );
    },
  });
}
