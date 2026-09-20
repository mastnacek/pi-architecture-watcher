/**
 * Position helpers — internal to the `scan` slice.
 *
 * Deep module: `lineAt(text, index)` turns a match offset into a 1-based line
 * number. Because every masker preserves newlines, the line derived from the
 * masked text matches the original source exactly.
 */

export function lineAt(text: string, index: number): number {
  let line = 1;
  const limit = Math.min(index, text.length);
  for (let i = 0; i < limit; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}
