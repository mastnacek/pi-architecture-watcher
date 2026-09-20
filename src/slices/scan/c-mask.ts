/**
 * Generic C-family lexer layer of the `scan` slice — internal.
 *
 * Deep module: `maskCLike(source, options)` blanks comments and string bodies
 * for every language whose comments are line `//` and block slash-star (Rust,
 * Java, Kotlin, Go) and, optionally, Python's `#`. String bodies are replaced
 * by the same `\u0000<index>\u0001` placeholders the TS/JS masker uses, so Go
 * import specifiers can be read back with exact positions.
 */

export interface LiteralInfo {
  value: string;
  line: number;
  column: number;
}

export interface CMaskResult {
  masked: string;
  literals: LiteralInfo[];
}

export interface CMaskOptions {
  /** `#` starts a line comment (Python). */
  hashComment?: boolean;
  /** backticks delimit raw strings (Go). */
  backtickRaw?: boolean;
  /** `"""` / `'''` delimit multi-line strings (Python text blocks, Kotlin, Java). */
  tripleQuote?: boolean;
  /** `r"..."`, `r#"..."#`, `b"..."` raw/byte strings (Rust). */
  rustRaw?: boolean;
}

export function maskCLike(source: string, options: CMaskOptions = {}): CMaskResult {
  const n = source.length;
  const buf: string[] = [];
  const literals: LiteralInfo[] = [];
  let i = 0;
  let line = 1;
  let column = 1;

  const advance = (): void => {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    i += 1;
  };

  const emitLiteral = (
    value: string,
    startLine: number,
    startColumn: number,
    newlines: number,
  ): void => {
    const index = literals.length;
    literals.push({ value, line: startLine, column: startColumn });
    buf.push("\u0000", String(index), "\u0001");
    for (let k = 0; k < newlines; k += 1) buf.push("\n");
  };

  /** Consume a quoted string body, returning its value and newline count. */
  const consumeString = (quote: string, raw: boolean): { value: string; newlines: number } => {
    advance(); // opening quote
    let value = "";
    let newlines = 0;
    while (i < n) {
      const c = source[i]!;
      if (!raw && c === "\\") {
        advance();
        const esc = source[i] ?? "";
        if (esc === "\n") newlines += 1;
        value += esc;
        advance();
        continue;
      }
      if (c === quote) {
        advance();
        break;
      }
      if (c === "\n") newlines += 1;
      value += c;
      advance();
    }
    return { value, newlines };
  };

  const consumeTriple = (quote: string): { value: string; newlines: number } => {
    advance();
    advance();
    advance();
    let value = "";
    let newlines = 0;
    while (i < n) {
      if (!options.hashComment && source[i] === "\\") {
        advance();
        const esc = source[i] ?? "";
        if (esc === "\n") newlines += 1;
        value += esc;
        advance();
        continue;
      }
      if (source[i] === quote && source[i + 1] === quote && source[i + 2] === quote) {
        advance();
        advance();
        advance();
        break;
      }
      if (source[i] === "\n") newlines += 1;
      value += source[i]!;
      advance();
    }
    return { value, newlines };
  };

  while (i < n) {
    const ch = source[i]!;

    // Comments -------------------------------------------------------------
    if (ch === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") advance();
      continue;
    }
    if (options.hashComment && ch === "#") {
      while (i < n && source[i] !== "\n") advance();
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      advance();
      advance();
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
        if (source[i] === "\n") buf.push("\n");
        advance();
      }
      advance();
      advance();
      continue;
    }

    // Rust raw / byte strings: r"..", r#".."#, b"..", br#".."#
    if (
      options.rustRaw &&
      (ch === "r" || ch === "b") &&
      isRustStringStart(source, i)
    ) {
      const startLine = line;
      const startCol = column;
      if (ch === "b" && source[i + 1] === "r") advance();
      advance(); // r
      let hashes = 0;
      while (source[i] === "#") {
        hashes += 1;
        advance();
      }
      advance(); // opening quote
      let value = "";
      let newlines = 0;
      while (i < n) {
        if (source[i] === '"' && matchHashes(source, i + 1, hashes)) {
          advance();
          for (let k = 0; k < hashes; k += 1) advance();
          break;
        }
        if (source[i] === "\n") newlines += 1;
        value += source[i]!;
        advance();
      }
      emitLiteral(value, startLine, startCol, newlines);
      continue;
    }

    // Triple-quoted strings -------------------------------------------------
    if (
      options.tripleQuote &&
      (ch === '"' || ch === "'") &&
      source[i + 1] === ch &&
      source[i + 2] === ch
    ) {
      const startLine = line;
      const startCol = column;
      const { value, newlines } = consumeTriple(ch);
      emitLiteral(value, startLine, startCol, newlines);
      continue;
    }

    // Backtick raw strings --------------------------------------------------
    if (options.backtickRaw && ch === "`") {
      const startLine = line;
      const startCol = column;
      advance();
      let value = "";
      let newlines = 0;
      while (i < n) {
        if (source[i] === "`") {
          advance();
          break;
        }
        if (source[i] === "\n") newlines += 1;
        value += source[i]!;
        advance();
      }
      emitLiteral(value, startLine, startCol, newlines);
      continue;
    }

    // Quoted strings --------------------------------------------------------
    if (ch === '"' || ch === "'") {
      const startLine = line;
      const startCol = column;
      const { value, newlines } = consumeString(ch, false);
      emitLiteral(value, startLine, startCol, newlines);
      continue;
    }

    // Whitespace ------------------------------------------------------------
    if (ch === "\n" || ch === " " || ch === "\t" || ch === "\r") {
      buf.push(ch);
      advance();
      continue;
    }

    buf.push(ch);
    advance();
  }

  return { masked: buf.join(""), literals };
}

function isRustStringStart(source: string, i: number): boolean {
  let j = i;
  if (source[j] === "b") j += 1;
  if (source[j] !== "r") return false;
  j += 1;
  if (source[j] === '"') return true;
  let hashes = 0;
  while (source[j] === "#") {
    hashes += 1;
    j += 1;
  }
  return hashes > 0 && source[j] === '"';
}

function matchHashes(source: string, from: number, count: number): boolean {
  for (let k = 0; k < count; k += 1) {
    if (source[from + k] !== "#") return false;
  }
  return true;
}
