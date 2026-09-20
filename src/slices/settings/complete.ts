/**
 * Completion engine for the `/vsa` command.
 *
 * Deep module: given the raw argument prefix and the currently effective
 * config, it returns the exact autocomplete rows Pi should render — or `null`
 * to let the built-in path completion take over. Pure: no I/O, no Pi imports,
 * no other slice.
 */

import type { WatcherConfig } from "../../shared/types.js";
import { findSetting, formatValue, SETTING_SPECS } from "./catalogue.js";

export interface SettingsCompletion {
  value: string;
  label: string;
  description: string;
}

interface Suggestion {
  value: string;
  description: string;
}

export const VSA_SUBCOMMANDS: readonly Suggestion[] = [
  { value: "status", description: "Zobrazit režim, řezy, sdílené kořeny a poslední report" },
  { value: "check", description: "Analyzovat cestu k souboru proti VSA" },
  { value: "config", description: "Zobrazit nebo změnit nastavení watcheru" },
  { value: "mode", description: "Přepnout režim brány: auto | human | off" },
  { value: "rules", description: "Vypsat všechna detekční pravidla" },
  { value: "explain", description: "Znovu vypsat poslední report" },
  { value: "init", description: "Zapsat výchozí .pi/architecture-watcher.json" },
  { value: "rescan", description: "Přestavět topologii řezů" },
  { value: "on", description: "Zapnout watcher" },
  { value: "off", description: "Vypnout watcher" },
  { value: "help", description: "Zobrazit nápovědu" },
];

const CONFIG_ACTIONS: readonly Suggestion[] = [
  { value: "get", description: "Vypsat aktuální hodnotu nastavení" },
  { value: "set", description: "Uložit novou hodnotu nastavení" },
];

/**
 * Filter suggestions by the leaf token and expand each into the full argument
 * string Pi should insert. `base` is the already-typed, stable part of the
 * argument; `item.value` replaces the *entire* argument prefix, so it must be
 * `base + leaf`, never the leaf alone.
 */
function filter(base: string, suggestions: readonly Suggestion[], prefix: string): SettingsCompletion[] | null {
  const items = suggestions
    .filter((s) => s.value.startsWith(prefix))
    .map((s) => ({ value: `${base}${s.value}`, label: s.value, description: s.description }));
  return items.length > 0 ? items : null;
}

/** Key completions, annotated with the value currently in effect. */
function completeKeys(base: string, current: WatcherConfig, prefix: string): SettingsCompletion[] | null {
  const items = SETTING_SPECS.filter((spec) => spec.key.startsWith(prefix)).map((spec) => ({
    value: `${base}${spec.key}`,
    label: spec.key,
    description: `${spec.description} (nyní: ${formatValue(current[spec.key])})`,
  }));
  return items.length > 0 ? items : null;
}

/** Value completions for one setting: enums and booleans are enumerated. */
function completeValues(
  base: string,
  spec: typeof SETTING_SPECS[number],
  current: WatcherConfig,
  prefix: string,
): SettingsCompletion[] | null {
  const currentText = formatValue(current[spec.key]);
  if (spec.kind === "enum") {
    const items = (spec.values ?? [])
      .filter((value) => value.startsWith(prefix))
      .map((value) => ({
        value: `${base}${value}`,
        label: value,
        description: `${spec.valueHelp?.[value] ?? spec.description} (nyní: ${currentText})`,
      }));
    return items.length > 0 ? items : null;
  }
  if (spec.kind === "boolean") {
    return filter(
      base,
      [
        { value: "true", description: `Zapnout ${spec.key} (nyní: ${currentText})` },
        { value: "false", description: `Vypnout ${spec.key} (nyní: ${currentText})` },
      ],
      prefix,
    );
  }
  return null;
}

function completeConfig(rest: string, current: WatcherConfig): SettingsCompletion[] | null {
  const actionMatch = rest.match(/^(\S+)\s+(.*)$/);
  if (!actionMatch) return filter("config ", CONFIG_ACTIONS, rest);

  const action = actionMatch[1] ?? "";
  const tail = actionMatch[2] ?? "";
  const keyMatch = tail.match(/^(\S+)\s+(.*)$/);
  if (!keyMatch) return completeKeys(`config ${action} `, current, tail);

  const key = keyMatch[1] ?? "";
  const valuePrefix = keyMatch[2] ?? "";
  if (action === "get") return null;
  const spec = findSetting(key);
  return spec ? completeValues(`config ${action} ${key} `, spec, current, valuePrefix) : null;
}

/**
 * Resolve completions for everything typed after `/vsa`.
 *
 * Returns `null` when a subcommand takes a free-form argument (e.g. `check`
 * takes a path), which tells Pi to fall back to its own path completion.
 */
export function completeVsaArguments(
  prefix: string,
  current: WatcherConfig,
): SettingsCompletion[] | null {
  const normalized = prefix.trimStart();
  const subMatch = normalized.match(/^(\S+)\s+(.*)$/);
  if (!subMatch) return filter("", VSA_SUBCOMMANDS, normalized);

  const sub = subMatch[1] ?? "";
  const rest = subMatch[2] ?? "";
  if (sub === "config") return completeConfig(rest, current);
  if (sub === "mode") {
    const mode = findSetting("mode");
    return mode ? completeValues("mode ", mode, current, rest) : null;
  }
  return null;
}
