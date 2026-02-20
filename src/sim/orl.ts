import { z } from "zod";
import { evalConstExpr, parseExpression, TokenStream } from "./dsl.js";
import type {
  Expr,
  OrlAstNode,
  OrlConfig,
  OrlDeclaration,
  OrlParseResult,
  OrlStatement,
} from "./types.js";

const orlConfigSchema = z.object({
  targetOpinion: z.string().min(1),
  oppositeOpinion: z.string().min(1),
  mode: z.enum(["sync", "async"]),
  thresholdField: z.string().min(1),
});

const DEFAULT_CONFIG: OrlConfig = {
  targetOpinion: "X",
  oppositeOpinion: "notX",
  mode: "sync",
  thresholdField: "threshold",
};

function parseType(tokens: TokenStream): "float" | "int" | "bool" | "string" {
  const value = tokens.expectIdentifier();
  if (value !== "float" && value !== "int" && value !== "bool" && value !== "string") {
    throw new Error(`Invalid param type '${value}'`);
  }
  return value;
}

function parseStateDeclaration(tokens: TokenStream): OrlDeclaration {
  tokens.expectIdentifier("state");
  const name = tokens.expectIdentifier();
  tokens.expectIdentifier("in");
  tokens.expectSymbol("{");
  const values: Expr[] = [];
  if (!tokens.matches("}")) {
    while (true) {
      values.push(parseExpression(tokens));
      if (!tokens.matches(",")) break;
      tokens.consume();
    }
  }
  tokens.expectSymbol("}");
  return { type: "state", name, values };
}

function parseParamDeclaration(tokens: TokenStream): OrlDeclaration {
  tokens.expectIdentifier("param");
  const name = tokens.expectIdentifier();
  tokens.expectSymbol(":");
  const valueType = parseType(tokens);
  let range: [Expr, Expr] | undefined;
  let defaultValue: Expr | undefined;

  if (tokens.matchesIdent("in")) {
    tokens.expectIdentifier("in");
    tokens.expectSymbol("[");
    const start = parseExpression(tokens);
    tokens.expectSymbol(",");
    const end = parseExpression(tokens);
    tokens.expectSymbol("]");
    range = [start, end];
  }

  if (tokens.matches("=")) {
    tokens.expectSymbol("=");
    defaultValue = parseExpression(tokens);
  }

  return { type: "param", name, valueType, range, default: defaultValue };
}

function parseLetDeclaration(tokens: TokenStream): OrlDeclaration {
  tokens.expectIdentifier("let");
  const name = tokens.expectIdentifier();
  tokens.expectSymbol("=");
  return { type: "let", name, value: parseExpression(tokens) };
}

function parseModeDeclaration(tokens: TokenStream): OrlDeclaration {
  tokens.expectIdentifier("mode");
  tokens.expectSymbol("=");
  const mode = tokens.expectIdentifier();
  if (mode !== "sync" && mode !== "async") {
    throw new Error(`Invalid mode '${mode}'`);
  }
  return { type: "mode", value: mode };
}

function parseOptionDeclaration(tokens: TokenStream): OrlDeclaration {
  tokens.expectIdentifier("option");
  const name = tokens.expectIdentifier();
  tokens.expectSymbol("=");
  return { type: "option", name, value: parseExpression(tokens) };
}

function parseAssignStatement(tokens: TokenStream): OrlStatement {
  tokens.expectIdentifier("self");
  tokens.expectSymbol(".");
  const field = tokens.expectIdentifier();
  tokens.expectSymbol(":=");
  return { type: "assign", target: { object: "self", field }, value: parseExpression(tokens) };
}

function parseIfStatement(tokens: TokenStream): OrlStatement {
  tokens.expectIdentifier("if");
  const condition = parseExpression(tokens);
  tokens.expectIdentifier("then");
  const thenStmt = parseStatement(tokens);
  let elseStmt: OrlStatement | undefined;
  if (tokens.matchesIdent("else")) {
    tokens.expectIdentifier("else");
    elseStmt = parseStatement(tokens);
  }
  return { type: "if", condition, thenStmt, elseStmt };
}

function parseProbStatement(tokens: TokenStream): OrlStatement {
  tokens.expectIdentifier("with");
  tokens.expectIdentifier("prob");
  const probability = parseExpression(tokens);
  tokens.expectIdentifier("then");
  const thenStmt = parseStatement(tokens);
  let elseStmt: OrlStatement | undefined;
  if (tokens.matchesIdent("else")) {
    tokens.expectIdentifier("else");
    elseStmt = parseStatement(tokens);
  }
  return { type: "prob", probability, thenStmt, elseStmt };
}

function parseStatement(tokens: TokenStream): OrlStatement {
  if (tokens.matchesIdent("if")) return parseIfStatement(tokens);
  if (tokens.matchesIdent("with")) return parseProbStatement(tokens);
  if (tokens.matchesIdent("keep")) {
    tokens.expectIdentifier("keep");
    return { type: "keep" };
  }
  if (tokens.matchesIdent("self")) return parseAssignStatement(tokens);

  const token = tokens.peek();
  throw new Error(`Invalid ORL statement near '${token.value}' at ${token.position}`);
}

function parseProgram(source: string): OrlAstNode {
  const tokens = new TokenStream(source);
  const declarations: OrlDeclaration[] = [];

  while (!tokens.matchesIdent("update")) {
    if (tokens.peek().type === "eof") throw new Error("Missing update block");

    if (tokens.matchesIdent("state")) {
      declarations.push(parseStateDeclaration(tokens));
      continue;
    }
    if (tokens.matchesIdent("param")) {
      declarations.push(parseParamDeclaration(tokens));
      continue;
    }
    if (tokens.matchesIdent("let")) {
      declarations.push(parseLetDeclaration(tokens));
      continue;
    }
    if (tokens.matchesIdent("mode")) {
      declarations.push(parseModeDeclaration(tokens));
      continue;
    }
    if (tokens.matchesIdent("option")) {
      declarations.push(parseOptionDeclaration(tokens));
      continue;
    }

    const token = tokens.peek();
    throw new Error(`Unsupported ORL declaration near '${token.value}' at ${token.position}`);
  }

  tokens.expectIdentifier("update");
  tokens.expectSymbol(":");
  const update: OrlStatement[] = [];
  while (tokens.peek().type !== "eof") {
    update.push(parseStatement(tokens));
  }

  tokens.expectEOF();
  return { type: "program", declarations, update };
}

function asStringLiteral(expr: Expr, context: string): string {
  const value = evalConstExpr(expr);
  if (typeof value !== "string") throw new Error(`Expected string literal for ${context}`);
  return value;
}

export function parseOrl(source: string): OrlParseResult {
  const program = parseProgram(source);

  let targetOpinion = DEFAULT_CONFIG.targetOpinion;
  let oppositeOpinion = DEFAULT_CONFIG.oppositeOpinion;
  let mode = DEFAULT_CONFIG.mode;
  let thresholdField = DEFAULT_CONFIG.thresholdField;

  for (const declaration of program.declarations) {
    if (declaration.type === "state" && declaration.name === "opinion" && declaration.values.length >= 2) {
      targetOpinion = asStringLiteral(declaration.values[0], "state opinion first value");
      oppositeOpinion = asStringLiteral(declaration.values[1], "state opinion second value");
      continue;
    }

    if (declaration.type === "param" && declaration.name.toLowerCase().includes("threshold")) {
      thresholdField = declaration.name;
      continue;
    }

    if (declaration.type === "mode") {
      mode = declaration.value;
    }
  }

  const config = orlConfigSchema.parse({
    targetOpinion,
    oppositeOpinion,
    mode,
    thresholdField,
  });

  return { ast: [program], config };
}
