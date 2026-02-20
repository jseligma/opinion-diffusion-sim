import type { Expr } from "./types.js";

type TokenType = "identifier" | "number" | "string" | "symbol" | "eof";

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const SYMBOLS = new Set([
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ",",
  ":",
  ".",
  "~",
  "+",
  "-",
  "*",
  "/",
  "=",
  "<",
  ">",
  "!",
]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("#");
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

function tokenize(source: string): Token[] {
  const cleaned = stripComments(source);
  const tokens: Token[] = [];
  let i = 0;

  while (i < cleaned.length) {
    const ch = cleaned[i];
    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      i += 1;
      while (i < cleaned.length && isIdentPart(cleaned[i])) i += 1;
      tokens.push({ type: "identifier", value: cleaned.slice(start, i), position: start });
      continue;
    }

    if (isDigit(ch) || (ch === "." && i + 1 < cleaned.length && isDigit(cleaned[i + 1]))) {
      const start = i;
      i += 1;
      while (i < cleaned.length && isDigit(cleaned[i])) i += 1;
      if (cleaned[i] === ".") {
        i += 1;
        while (i < cleaned.length && isDigit(cleaned[i])) i += 1;
      }
      tokens.push({ type: "number", value: cleaned.slice(start, i), position: start });
      continue;
    }

    if (ch === '"') {
      const start = i;
      i += 1;
      let value = "";
      while (i < cleaned.length && cleaned[i] !== '"') {
        if (cleaned[i] === "\\" && i + 1 < cleaned.length) {
          value += cleaned[i + 1];
          i += 2;
          continue;
        }
        value += cleaned[i];
        i += 1;
      }
      if (i >= cleaned.length) throw new Error("Unterminated string literal");
      i += 1;
      tokens.push({ type: "string", value, position: start });
      continue;
    }

    const two = cleaned.slice(i, i + 2);
    if (two === ":=" || two === "==" || two === "!=" || two === "<=" || two === ">=") {
      tokens.push({ type: "symbol", value: two, position: i });
      i += 2;
      continue;
    }

    if (SYMBOLS.has(ch)) {
      tokens.push({ type: "symbol", value: ch, position: i });
      i += 1;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at ${i}`);
  }

  tokens.push({ type: "eof", value: "", position: cleaned.length });
  return tokens;
}

export class TokenStream {
  private readonly tokens: Token[];
  private index = 0;

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  consume(): Token {
    const token = this.peek();
    if (this.index < this.tokens.length - 1) {
      this.index += 1;
    }
    return token;
  }

  matches(value: string): boolean {
    return this.peek().value === value;
  }

  matchesIdent(value: string): boolean {
    const token = this.peek();
    return token.type === "identifier" && token.value === value;
  }

  expectSymbol(value: string): Token {
    const token = this.peek();
    if (token.type !== "symbol" || token.value !== value) {
      throw new Error(`Expected symbol '${value}' at ${token.position}`);
    }
    return this.consume();
  }

  expectIdentifier(expected?: string): string {
    const token = this.peek();
    if (token.type !== "identifier") {
      throw new Error(`Expected identifier at ${token.position}`);
    }
    if (expected && token.value !== expected) {
      throw new Error(`Expected identifier '${expected}' at ${token.position}`);
    }
    this.consume();
    return token.value;
  }

  expectNumber(): number {
    const token = this.peek();
    if (token.type !== "number") {
      throw new Error(`Expected number at ${token.position}`);
    }
    this.consume();
    const value = Number(token.value);
    if (!Number.isFinite(value)) throw new Error(`Invalid number '${token.value}'`);
    return value;
  }

  expectEOF(): void {
    const token = this.peek();
    if (token.type !== "eof") throw new Error(`Unexpected token '${token.value}' at ${token.position}`);
  }
}

function parsePrimary(tokens: TokenStream): Expr {
  const token = tokens.peek();

  if (token.type === "number") {
    return { type: "literal", value: tokens.expectNumber() };
  }

  if (token.type === "string") {
    tokens.consume();
    return { type: "literal", value: token.value };
  }

  if (token.type === "identifier" && (token.value === "true" || token.value === "false")) {
    tokens.consume();
    return { type: "literal", value: token.value === "true" };
  }

  if (tokens.matches("(")) {
    tokens.expectSymbol("(");
    const expr = parseExpression(tokens);
    tokens.expectSymbol(")");
    return expr;
  }

  if (tokens.matches("[")) {
    tokens.expectSymbol("[");
    const items: Expr[] = [];
    if (!tokens.matches("]")) {
      do {
        items.push(parseExpression(tokens));
      } while (tokens.matches(",") && tokens.consume());
    }
    tokens.expectSymbol("]");
    return { type: "array", items };
  }

  if (tokens.matches("{")) {
    tokens.expectSymbol("{");
    const entries: Array<{ key: string; value: Expr }> = [];
    if (!tokens.matches("}")) {
      while (true) {
        const keyToken = tokens.peek();
        let key: string;
        if (keyToken.type === "string") {
          key = keyToken.value;
          tokens.consume();
        } else if (keyToken.type === "identifier") {
          key = keyToken.value;
          tokens.consume();
        } else {
          throw new Error(`Expected object key at ${keyToken.position}`);
        }
        tokens.expectSymbol(":");
        entries.push({ key, value: parseExpression(tokens) });
        if (!tokens.matches(",")) break;
        tokens.consume();
      }
    }
    tokens.expectSymbol("}");
    return { type: "object", entries };
  }

  if (token.type === "identifier") {
    let expr: Expr = { type: "identifier", name: tokens.expectIdentifier() };
    while (true) {
      if (tokens.matches("(") && expr.type === "identifier") {
        tokens.expectSymbol("(");
        const args: Expr[] = [];
        if (!tokens.matches(")")) {
          do {
            args.push(parseExpression(tokens));
          } while (tokens.matches(",") && tokens.consume());
        }
        tokens.expectSymbol(")");
        expr = { type: "call", callee: expr.name, args };
        continue;
      }

      if (tokens.matches(".")) {
        tokens.expectSymbol(".");
        const property = tokens.expectIdentifier();
        expr = { type: "member", object: expr, property };
        continue;
      }
      break;
    }
    return expr;
  }

  throw new Error(`Unexpected token '${token.value}' at ${token.position}`);
}

function parseUnary(tokens: TokenStream): Expr {
  if (tokens.matchesIdent("not")) {
    tokens.expectIdentifier("not");
    return { type: "unary", operator: "not", argument: parseUnary(tokens) };
  }

  if (tokens.matches("-")) {
    tokens.expectSymbol("-");
    return { type: "unary", operator: "-", argument: parseUnary(tokens) };
  }

  return parsePrimary(tokens);
}

function parseBinary(
  tokens: TokenStream,
  next: (tokens: TokenStream) => Expr,
  operators: string[]
): Expr {
  let left = next(tokens);
  while (true) {
    const op = tokens.peek().value;
    if (!operators.includes(op)) break;
    tokens.consume();
    left = {
      type: "binary",
      operator: op as "or" | "and" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/",
      left,
      right: next(tokens),
    };
  }
  return left;
}

function parseMul(tokens: TokenStream): Expr {
  return parseBinary(tokens, parseUnary, ["*", "/"]);
}

function parseAdd(tokens: TokenStream): Expr {
  return parseBinary(tokens, parseMul, ["+", "-"]);
}

function parseCmp(tokens: TokenStream): Expr {
  return parseBinary(tokens, parseAdd, ["==", "!=", "<", "<=", ">", ">="]);
}

function parseAnd(tokens: TokenStream): Expr {
  return parseBinary(tokens, parseCmp, ["and"]);
}

function parseOr(tokens: TokenStream): Expr {
  return parseBinary(tokens, parseAnd, ["or"]);
}

export function parseExpression(tokens: TokenStream): Expr {
  return parseOr(tokens);
}

function expectNumberValue(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected numeric expression for ${context}`);
  }
  return value;
}

export function evalConstExpr(expr: Expr): unknown {
  if (expr.type === "literal") return expr.value;

  if (expr.type === "array") return expr.items.map(evalConstExpr);
  if (expr.type === "object") {
    const out: Record<string, unknown> = {};
    for (const entry of expr.entries) {
      out[entry.key] = evalConstExpr(entry.value);
    }
    return out;
  }

  if (expr.type === "unary") {
    const arg = evalConstExpr(expr.argument);
    if (expr.operator === "not") return !arg;
    return -expectNumberValue(arg, "unary minus");
  }

  if (expr.type === "binary") {
    const left = evalConstExpr(expr.left);
    const right = evalConstExpr(expr.right);
    if (expr.operator === "or") return Boolean(left) || Boolean(right);
    if (expr.operator === "and") return Boolean(left) && Boolean(right);
    if (expr.operator === "==") return left === right;
    if (expr.operator === "!=") return left !== right;
    if (expr.operator === "<") return expectNumberValue(left, "< left") < expectNumberValue(right, "< right");
    if (expr.operator === "<=") return expectNumberValue(left, "<= left") <= expectNumberValue(right, "<= right");
    if (expr.operator === ">") return expectNumberValue(left, "> left") > expectNumberValue(right, "> right");
    if (expr.operator === ">=") return expectNumberValue(left, ">= left") >= expectNumberValue(right, ">= right");
    if (expr.operator === "+") return expectNumberValue(left, "+ left") + expectNumberValue(right, "+ right");
    if (expr.operator === "-") return expectNumberValue(left, "- left") - expectNumberValue(right, "- right");
    if (expr.operator === "*") return expectNumberValue(left, "* left") * expectNumberValue(right, "* right");
    return expectNumberValue(left, "/ left") / expectNumberValue(right, "/ right");
  }

  if (expr.type === "call") {
    const args = expr.args.map(evalConstExpr);
    if (expr.callee === "min") {
      return Math.min(...args.map((a) => expectNumberValue(a, "min()")));
    }
    if (expr.callee === "max") {
      return Math.max(...args.map((a) => expectNumberValue(a, "max()")));
    }
    if (expr.callee === "clamp") {
      const x = expectNumberValue(args[0], "clamp(x)");
      const lo = expectNumberValue(args[1], "clamp(a)");
      const hi = expectNumberValue(args[2], "clamp(b)");
      return Math.max(lo, Math.min(hi, x));
    }
    throw new Error(`Cannot evaluate non-constant call '${expr.callee}'`);
  }

  throw new Error("Cannot evaluate non-constant expression");
}
