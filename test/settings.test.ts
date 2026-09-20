/**
 * `settings` slice — catalogue parsing and contextual `/vsa` completions.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/shared/config.js";
import {
  completeVsaArguments,
  findSetting,
  formatValue,
  parseValue,
  SETTING_SPECS,
} from "../src/slices/settings/index.js";

test("catalogue covers every scalar and list knob without duplicates", () => {
  const keys = SETTING_SPECS.map((spec) => spec.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const spec of SETTING_SPECS) {
    assert.ok(findSetting(spec.key) === spec, `${spec.key} should be findable`);
    assert.ok(spec.description.length > 0);
  }
  assert.equal(findSetting("nope"), undefined);
});

test("parseValue coerces booleans, enums, numbers and lists", () => {
  assert.deepEqual(parseValue(findSetting("enabled")!, "true"), { ok: true, value: true });
  assert.deepEqual(parseValue(findSetting("enabled")!, "FALSE"), { ok: true, value: false });
  assert.equal(parseValue(findSetting("enabled")!, "yes").ok, false);

  assert.deepEqual(parseValue(findSetting("mode")!, "human"), { ok: true, value: "human" });
  assert.equal(parseValue(findSetting("mode")!, "loud").ok, false);

  assert.deepEqual(parseValue(findSetting("maxSharedImports")!, "3"), { ok: true, value: 3 });
  assert.equal(parseValue(findSetting("maxSharedImports")!, "-1").ok, false);

  assert.deepEqual(parseValue(findSetting("ignore")!, "**/*.test.*, dist "), {
    ok: true,
    value: ["**/*.test.*", "dist"],
  });
  assert.equal(parseValue(findSetting("ignore")!, " , ").ok, false);
});

test("formatValue renders lists as typed input", () => {
  assert.equal(formatValue(["a", "b"]), "a, b");
  assert.equal(formatValue(true), "true");
});

test("top-level completions list subcommands with help", () => {
  const config = completeVsaArguments("con", DEFAULT_CONFIG)?.[0];
  assert.ok(config);
  assert.equal(config.value, "config");
  assert.match(config.description, /nastavení/i);

  const all = completeVsaArguments("", DEFAULT_CONFIG);
  assert.ok(all && all.some((i) => i.value === "help"));
});

test("config completions descend into actions, keys and values", () => {
  const actions = completeVsaArguments("config ", DEFAULT_CONFIG);
  assert.deepEqual(actions?.map((i) => i.value), ["get", "set"]);

  const keys = completeVsaArguments("config set b", DEFAULT_CONFIG);
  assert.deepEqual(keys?.map((i) => i.value), ["blockAt"]);
  assert.match(keys?.[0]?.description ?? "", /nyní:/);

  const values = completeVsaArguments("config set mode ", DEFAULT_CONFIG);
  assert.deepEqual(values?.map((i) => i.value), ["auto", "human", "off"]);
  assert.match(values?.[1]?.description ?? "", /zeptá/i);

  const bools = completeVsaArguments("config set enabled f", DEFAULT_CONFIG);
  assert.deepEqual(bools?.map((i) => i.value), ["false"]);
});

test("mode shorthand and free-form arguments", () => {
  const modes = completeVsaArguments("mode ", DEFAULT_CONFIG);
  assert.deepEqual(modes?.map((i) => i.value), ["auto", "human", "off"]);

  assert.equal(completeVsaArguments("check ", DEFAULT_CONFIG), null);
  assert.equal(completeVsaArguments("status ", DEFAULT_CONFIG), null);
});
