/**
 * Lexer layer of the `scan` slice — internal.
 *
 * Deep module: `maskSource(source)` blanks comments, string bodies, template
 * bodies and regex bodies while keeping every newline, and returns the literal
 * values with exact line/column positions. Import scanning then runs over a
 * plain "code only" surface, which is why it never trips over a `//` inside a
 * string or a brace inside a comment.
 */

export interface LiteralInfo {
  value: string;
  line: number;
  column: number;
}

export interface MaskResult {
  masked: string;
  literals: LiteralInfo[];
}

const PUNCT_BEFORE_REGEX = new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);

const KEYWORDS_BEFORE_REGEX = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "do",
  "else",
  "case",
  "yield",
  "await",
  "throw",
]);

const IDENT_CHAR = /[A-Za-z0-9_$]/;

/** Mask a source file. Pure function, no I/O. */
export function maskSource(source: string): MaskResult {
  const n = source.length;
  const buf: string[] = [];
  const literals: LiteralInfo[] = [];

  let i = 0;
  let line = 1;
  let column = 1;
  let prevChar = "";
  let prevWord = "";

  const advance = (): void => {
    const ch = source[i]!;
    if (ch === "\n") {
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
    prevChar = '"';
    prevWord = "";
  };

  const regexAllowed = (): boolean => {
    if (prevChar === "") return true;
    if (PUNCT_BEFORE_REGEX.has(prevChar)) return true;
    return KEYWORDS_BEFORE_REGEX.has(prevWord);
  };

  while (i < n) {
    const ch = source[i]!;

    // Comments -------------------------------------------------------------
    if (ch === "/" && source[i + 1] === "/") {
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

    // Regex literal --------------------------------------------------------
    if (ch === "/" && regexAllowed()) {
      advance();
      let inClass = false;
      let closed = false;
      while (i < n) {
        const c = source[i]!;
        if (c === "\\") {
          advance();
          advance();
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) {
          advance();
          closed = true;
          break;
        } else if (c === "\n") {
          break;
        }
        advance();
      }
      if (closed) {
        while (i < n && /[a-z]/.test(source[i]!)) advance();
        buf.push(" ");
        prevChar = '"';
        prevWord = "";
        continue;
      }
      buf.push("/");
      prevChar = "/";
      prevWord = "";
      continue;
    }

    // Template literal -----------------------------------------------------
    if (ch === "`") {
      const startLine = line;
      const startCol = column;
      advance();
      let value = "";
      let newlines = 0;
      while (i < n) {
        const c = source[i]!;
        if (c === "\\") {
          advance();
          const esc = source[i] ?? "";
          if (esc === "\n") newlines += 1;
          value += esc;
          advance();
          continue;
        }
        if (c === "`") {
          advance();
          break;
        }
        if (c === "$" && source[i + 1] === "{") {
          advance();
          advance();
          let depth = 1;
          while (i < n && depth > 0) {
            const d = source[i]!;
            if (d === "{") depth += 1;
            else if (d === "}") depth -= 1;
            if (d === "\n") newlines += 1;
            advance();
          }
          value += "\u0002";
          continue;
        }
        if (c === "\n") newlines += 1;
        value += c;
        advance();
      }
      emitLiteral(value, startLine, startCol, newlines);
      continue;
    }

    // Quoted string --------------------------------------------------------
    if (ch === "'" || ch === '"') {
      const quote = ch;
      const startLine = line;
      const startCol = column;
      advance();
      let value = "";
      let newlines = 0;
      while (i < n) {
        const c = source[i]!;
        if (c === "\\") {
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
        if (c === "\n") break; // unterminated — bail before swallowing code
        value += c;
        advance();
      }
      emitLiteral(value, startLine, startCol, newlines);
      continue;
    }

    // Whitespace -----------------------------------------------------------
    if (ch === "\n" || ch === " " || ch === "\t" || ch === "\r") {
      buf.push(ch);
      advance();
      if (ch === "\n" || ch === " ") {
        prevWord = "";
        if (ch === "\n") prevChar = "";
      }
      continue;
    }

    // Identifier -----------------------------------------------------------
    if (IDENT_CHAR.test(ch)) {
      let word = "";
      while (i < n && IDENT_CHAR.test(source[i]!)) {
        word += source[i]!;
        buf.push(source[i]!);
        advance();
      }
      prevWord = word;
      prevChar = word[word.length - 1] ?? "";
      continue;
    }

    // Anything else --------------------------------------------------------
    buf.push(ch);
    advance();
    prevChar = ch;
    prevWord = "";
  }

  return { masked: buf.join(""), literals };
}
