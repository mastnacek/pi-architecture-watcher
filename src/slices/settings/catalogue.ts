/**
 * Settings catalogue — the single source of truth for the knobs the `/vsa
 * config` command may read or write.
 *
 * Deep module: callers pass a raw key or a raw value string and get back either
 * a validated result or a human-readable error. Nothing here touches disk, Pi
 * or any other slice.
 */

import { ARCHITECTURE_IDS, type WatcherConfig } from "../../shared/types.js";

export type SettingKind = "boolean" | "enum" | "number" | "list";

export interface SettingSpec {
  key: keyof WatcherConfig;
  kind: SettingKind;
  /** one-line help rendered next to the key while typing */
  description: string;
  /** allowed values for `enum` */
  values?: readonly string[];
  /** per-value help rendered next to each enum value */
  valueHelp?: Readonly<Record<string, string>>;
}

export const SETTING_SPECS: readonly SettingSpec[] = [
  {
    key: "enabled",
    kind: "boolean",
    description: "Hlavní vypínač: sledovat úpravy a hlídat zápisy",
  },
  {
    key: "mode",
    kind: "enum",
    description: "Jak watcher reaguje na nález",
    values: ["auto", "human", "off"],
    valueHelp: {
      auto: "Radí modelu vložením návrhů oprav",
      human: "Zeptá se uživatele, než zápis projde",
      off: "Jen detekuje; nikdy nehlídá zápisy",
    },
  },
  {
    key: "blockAt",
    kind: "enum",
    description: "Závažnost, při které se zápis zablokuje",
    values: ["hint", "warning", "error", "never"],
    valueHelp: {
      hint: "Nikdy neblokovat; nálezy úrovně tip jsou jen doporučení",
      warning: "Blokovat zápisy dosahující závažnosti varování",
      error: "Blokovat jen chyby",
      never: "Nikdy neblokovat, bez ohledu na závažnost",
    },
  },
  {
    key: "notifyFrom",
    kind: "enum",
    description: "Minimální závažnost, která vyvolá oznámení",
    values: ["hint", "warning", "error"],
    valueHelp: {
      hint: "Oznámit každý nález",
      warning: "Oznámit od varování výše",
      error: "Oznámit jen chyby",
    },
  },
  {
    key: "publicEntryMode",
    kind: "enum",
    description: "Kde smí řez vystavit své rozhraní",
    values: ["entry-only", "root-level"],
    valueHelp: {
      "entry-only": "Jen veřejný vstupní soubor smí vystavit rozhraní řezu",
      "root-level": "Jakýkoli soubor v kořeni řezu smí vystavit rozhraní řezu",
    },
  },
  {
    key: "maxSliceFanOut",
    kind: "number",
    description: "Maximální počet různých řezů, na které smí řez sahat",
  },
  {
    key: "maxSharedImports",
    kind: "number",
    description: "Maximální počet modulů, které smí soubor táhnout ze sdíleného jádra",
  },
  {
    key: "injectFixes",
    kind: "boolean",
    description: "Připojit návrhy oprav k výsledku nástroje",
  },
  {
    key: "autoFixImports",
    kind: "boolean",
    description: "Automaticky přepisovat problematické importy",
  },
  {
    key: "statusLine",
    kind: "boolean",
    description: "Udržovat stavový řádek podobný LSP",
  },
  {
    key: "architecture",
    kind: "enum",
    description: "Cílová architektura pro topologii a pravidla driftu",
    values: [...ARCHITECTURE_IDS],
    valueHelp: {
      vsa: "Vertical Slice: každý řez vlastní UI, logiku i data",
      clean: "Clean: vrstvy domain / application / infrastructure",
      hexagonal: "Hexagonal: jádro s porty a adaptéry",
      layered: "Vrstvy: controller → service → repository",
      "modular-monolith": "Monolit s oddělenými vnitřními moduly",
      fsd: "Feature-Sliced Design: vrstvy podle feature",
    },
  },
  {
    key: "detectionModel",
    kind: "enum",
    description: "Decision model použitý příkazem /vsa detect",
    values: ["jev-latest"],
    valueHelp: {
      "jev-latest": "TypeSafe Jev — rychlý strukturovaný decision model (zdarma completion)",
    },
  },
  {
    key: "roots",
    kind: "list",
    description: "Adresáře obsahující jeden adresář na řez",
  },
  {
    key: "sharedRoots",
    kind: "list",
    description: "Adresáře tvořící sdílené jádro",
  },
  {
    key: "sourceExtensions",
    kind: "list",
    description: "Přípony souborů považované za zdrojové",
  },
  {
    key: "publicEntries",
    kind: "list",
    description: "Názvy souborů, které se počítají jako veřejné rozhraní řezu",
  },
  {
    key: "internalsDirNames",
    kind: "list",
    description: "Názvy adresářů uvnitř řezu, které jsou vždy interní",
  },
  {
    key: "watchTools",
    kind: "list",
    description: "Zabudované nástroje, jejichž zápisy se kontrolují",
  },
  {
    key: "watchToolPatterns",
    kind: "list",
    description: "Další vlastní názvy nástrojů ke kontrole",
  },
  {
    key: "ignore",
    kind: "list",
    description: "Vzorové cesty k přeskočení, relativně ke kořeni projektu",
  },
];

const BY_KEY = new Map<string, SettingSpec>(SETTING_SPECS.map((s) => [s.key, s]));

export function findSetting(key: string): SettingSpec | undefined {
  return BY_KEY.get(key);
}

/** Render any config value as the string a user would type. */
export function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Validate and coerce a raw CLI token into the shape `WatcherConfig` expects. */
export function parseValue(spec: SettingSpec, raw: string): ParseResult {
  const value = raw.trim();
  switch (spec.kind) {
    case "boolean": {
      const lower = value.toLowerCase();
      if (lower !== "true" && lower !== "false") {
        return { ok: false, error: `${spec.key} očekává true nebo false` };
      }
      return { ok: true, value: lower === "true" };
    }
    case "enum": {
      const allowed = spec.values ?? [];
      if (!allowed.includes(value)) {
        return { ok: false, error: `${spec.key} očekává jednu z: ${allowed.join(", ")}` };
      }
      return { ok: true, value };
    }
    case "number": {
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0) {
        return { ok: false, error: `${spec.key} očekává nezáporné číslo` };
      }
      return { ok: true, value: num };
    }
    case "list": {
      const items = value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (items.length === 0) {
        return { ok: false, error: `${spec.key} očekává čárkami oddělený seznam` };
      }
      return { ok: true, value: items };
    }
  }
}
