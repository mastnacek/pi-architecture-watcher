/**
 * Public boundary of the `scan` slice.
 *
 * Other slices must import from here, never from `./mask.js` or `./imports.js`.
 */

export { scanImports } from "./imports.js";
export { maskSource } from "./mask.js";
export type { LiteralInfo, MaskResult } from "./mask.js";
