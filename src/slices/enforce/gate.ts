/**
 * Gate — internal to the `enforce` slice.
 *
 * Deep module: `decideGate` maps a `Report`, the config and the presence of UI
 * onto exactly one action. This is the only place that answers *"may this write
 * land, or does a human have to look at it?"*.
 *
 * Decision table
 *   off / disabled / clean      -> pass
 *   severity >= blockAt, UI     -> confirm   (human-in-the-loop)
 *   severity >= blockAt, no UI  -> block     (fail safe for automation)
 *   auto mode                   -> advise    (fix advice injected into the result)
 *   human mode, severity >= notifyFrom -> notify
 *   otherwise                   -> pass
 */

import { atLeast, strongest } from "../classify/index.js";
import { formatInjection, formatOneLiner } from "../report/index.js";
import type { GateDecision, Report, WatcherConfig } from "../../shared/types.js";

export interface GateInputs {
  report: Report;
  config: WatcherConfig;
  /** whether dialog-capable UI is available */
  hasUI: boolean;
}

export function decideGate({ report, config, hasUI }: GateInputs): GateDecision {
  if (!config.enabled || config.mode === "off") {
    return { action: "pass", severity: "clean", reason: "watcher vypnut" };
  }

  const top = strongest(report.findings);
  if (top === "clean") {
    return { action: "pass", severity: "clean", reason: "žádná porušení" };
  }

  const reason = formatOneLiner(report);
  const injection = config.injectFixes ? formatInjection(report) : undefined;

  if (config.blockAt !== "never" && atLeast(top, config.blockAt)) {
    return hasUI
      ? { action: "confirm", severity: top, reason, injection }
      : {
          action: "block",
          severity: top,
          reason: `${reason}\nSpusť znovu v interaktivní relaci, oprav porušení, nebo nastav `
            + `\`blockAt\` na "never" v .pi/architecture-watcher.json.`,
          injection,
        };
  }

  if (config.mode === "auto") {
    return { action: "advise", severity: top, reason, injection };
  }

  if (atLeast(top, config.notifyFrom)) {
    return { action: "notify", severity: top, reason };
  }

  return { action: "advise", severity: top, reason, injection };
}
