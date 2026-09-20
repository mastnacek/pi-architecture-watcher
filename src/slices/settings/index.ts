/**
 * Public boundary of the `settings` slice.
 */

export {
  findSetting,
  formatValue,
  parseValue,
  SETTING_SPECS,
  type SettingKind,
  type SettingSpec,
} from "./catalogue.js";
export {
  completeVsaArguments,
  VSA_SUBCOMMANDS,
  type SettingsCompletion,
} from "./complete.js";
