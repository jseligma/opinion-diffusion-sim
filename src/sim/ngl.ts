import { z } from "zod";
import { evalConstExpr, parseExpression, TokenStream } from "./dsl.js";
import type { Expr, ModelKind, NglAstNode, NglConfig, NglParseResult, NglStatement } from "./types.js";

const nglConfigSchema = z.object({
  seed: z.number().int().nonnegative().optional(),
  nodeCount: z.number().int().positive().max(5000),
  model: z.enum(["ER", "WS", "BA", "SBM"]),
  modelParams: z.record(z.union([z.number(), z.array(z.number()), z.array(z.array(z.number()))])),
  positiveProbability: z.number().min(0).max(1),
  thresholdMin: z.number().min(0).max(10),
  thresholdMax: z.number().min(0).max(10),
  initialOpinionDistribution: z.record(z.number().min(0)),
});

const DEFAULT_CONFIG: NglConfig = {
  nodeCount: 20,
  model: "ER",
  modelParams: { p: 0.2 },
  positiveProbability: 0.8,
  thresholdMin: 1,
  thresholdMax: 3,
  initialOpinionDistribution: { X: 0.5, notX: 0.5 },
};

function parseKvList(tokens: TokenStream): Array<{ key: string; value: Expr }> {
  const entries: Array<{ key: string; value: Expr }> = [];
  tokens.expectSymbol("{");
  if (!tokens.matches("}")) {
    while (true) {
      const key = tokens.expectIdentifier();
      tokens.expectSymbol(":");
      entries.push({ key, value: parseExpression(tokens) });
      if (!tokens.matches(",")) break;
      tokens.consume();
    }
  }
  tokens.expectSymbol("}");
  return entries;
}

function parseModel(tokens: TokenStream): NglStatement {
  tokens.expectIdentifier("model");
  const kind = tokens.expectIdentifier() as ModelKind;
  if (!["ER", "WS", "BA", "SBM"].includes(kind)) {
    throw new Error(`Unsupported model kind '${kind}'`);
  }
  tokens.expectSymbol("{");
  const assignments: Array<{ key: string; value: Expr }> = [];
  while (!tokens.matches("}")) {
    const key = tokens.expectIdentifier();
    tokens.expectSymbol("=");
    assignments.push({ key, value: parseExpression(tokens) });
  }
  tokens.expectSymbol("}");
  return { type: "model", kind, assignments };
}

function parseAttr(tokens: TokenStream): NglStatement {
  const target = tokens.expectIdentifier() as "node_attr" | "edge_attr";
  const name = tokens.expectIdentifier();
  if (tokens.matches("~")) {
    tokens.expectSymbol("~");
    const value = parseExpression(tokens);
    return { type: "attr", target, name, operator: "~", value };
  }
  tokens.expectSymbol("=");
  return { type: "attr", target, name, operator: "=", value: parseExpression(tokens) };
}

function parseEdgeSign(tokens: TokenStream): NglStatement {
  tokens.expectIdentifier("edge_sign");
  tokens.expectSymbol(":");
  const rules: Array<{ label: "positive" | "negative" | string; probability: Expr; condition?: Expr }> = [];
  while (tokens.peek().type === "identifier") {
    const next = tokens.peek(1);
    if (next.type !== "identifier" || next.value !== "with") {
      break;
    }
    const label = tokens.expectIdentifier();
    tokens.expectIdentifier("with");
    tokens.expectIdentifier("prob");
    const probability = parseExpression(tokens);
    let condition: Expr | undefined;
    if (tokens.matchesIdent("if")) {
      tokens.expectIdentifier("if");
      condition = parseExpression(tokens);
    }
    rules.push({ label, probability, condition });
  }
  return { type: "edge_sign", rules };
}

function parseProgram(source: string): NglAstNode {
  const tokens = new TokenStream(source);
  const statements: NglStatement[] = [];
  while (tokens.peek().type !== "eof") {
    if (tokens.matchesIdent("seed")) {
      tokens.expectIdentifier("seed");
      statements.push({ type: "seed", value: tokens.expectNumber() });
      continue;
    }
    if (tokens.matchesIdent("nodes")) {
      tokens.expectIdentifier("nodes");
      statements.push({ type: "nodes", value: tokens.expectNumber() });
      continue;
    }
    if (tokens.matchesIdent("node")) {
      tokens.expectIdentifier("node");
      const id = tokens.expectIdentifier();
      const attrs = tokens.matches("{") ? parseKvList(tokens) : [];
      statements.push({ type: "node", id, attrs });
      continue;
    }
    if (tokens.matchesIdent("edge")) {
      tokens.expectIdentifier("edge");
      const sourceId = tokens.expectIdentifier();
      const targetId = tokens.expectIdentifier();
      const attrs = tokens.matches("{") ? parseKvList(tokens) : [];
      statements.push({ type: "edge", source: sourceId, target: targetId, attrs });
      continue;
    }
    if (tokens.matchesIdent("model")) {
      statements.push(parseModel(tokens));
      continue;
    }
    if (tokens.matchesIdent("node_attr") || tokens.matchesIdent("edge_attr")) {
      statements.push(parseAttr(tokens));
      continue;
    }
    if (tokens.matchesIdent("edge_sign")) {
      statements.push(parseEdgeSign(tokens));
      continue;
    }
    const token = tokens.peek();
    throw new Error(`Unsupported NGL statement near '${token.value}' at ${token.position}`);
  }
  tokens.expectEOF();
  return { type: "program", statements };
}

function toNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected numeric value for ${context}`);
  }
  return value;
}

function toNumberArray(value: unknown, context: string): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number")) {
    throw new Error(`Expected numeric array for ${context}`);
  }
  return value as number[];
}

function toNumberMatrix(value: unknown, context: string): number[][] {
  if (
    !Array.isArray(value) ||
    value.some((row) => !Array.isArray(row) || (row as unknown[]).some((item) => typeof item !== "number"))
  ) {
    throw new Error(`Expected numeric matrix for ${context}`);
  }
  return value as number[][];
}

function toNumericRecord(value: unknown, context: string): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object for ${context}`);
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`Expected numeric object values for ${context}`);
    }
    out[key] = raw;
  }
  return out;
}

function normalizeDistribution(distribution: Record<string, number>): Record<string, number> {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    throw new Error("Initial opinion distribution must have positive mass.");
  }
  const normalized: Record<string, number> = {};
  for (const [k, v] of Object.entries(distribution)) {
    normalized[k] = v / total;
  }
  return normalized;
}

function parseModelParams(kind: ModelKind, assignments: Map<string, unknown>): Record<string, number | number[] | number[][]> {
  if (kind === "ER") {
    return { p: toNumber(assignments.get("p") ?? 0.2, "ER.p") };
  }
  if (kind === "WS") {
    return {
      k: toNumber(assignments.get("k") ?? 4, "WS.k"),
      beta: toNumber(assignments.get("beta") ?? 0.2, "WS.beta"),
    };
  }
  if (kind === "BA") {
    return { m: toNumber(assignments.get("m") ?? 2, "BA.m") };
  }
  return {
    blocks: toNumberArray(assignments.get("blocks") ?? [10, 10], "SBM.blocks"),
    P: toNumberMatrix(
      assignments.get("P") ?? [
        [0.3, 0.05],
        [0.05, 0.3],
      ],
      "SBM.P"
    ),
  };
}

export function parseNgl(source: string): NglParseResult {
  const program = parseProgram(source);

  let seed: number | undefined;
  let nodeCount = DEFAULT_CONFIG.nodeCount;
  let model: ModelKind = DEFAULT_CONFIG.model;
  const modelAssignments = new Map<string, unknown>();
  let positiveProbability = DEFAULT_CONFIG.positiveProbability;
  let thresholdMin = DEFAULT_CONFIG.thresholdMin;
  let thresholdMax = DEFAULT_CONFIG.thresholdMax;
  let initialOpinionDistribution = { ...DEFAULT_CONFIG.initialOpinionDistribution };

  for (const stmt of program.statements) {
    if (stmt.type === "seed") {
      seed = stmt.value;
      continue;
    }
    if (stmt.type === "nodes") {
      nodeCount = stmt.value;
      continue;
    }
    if (stmt.type === "model") {
      model = stmt.kind;
      modelAssignments.clear();
      for (const assignment of stmt.assignments) {
        modelAssignments.set(assignment.key, evalConstExpr(assignment.value));
      }
      continue;
    }
    if (stmt.type === "attr" && stmt.target === "node_attr") {
      if (stmt.name === "threshold" && stmt.operator === "~") {
        if (stmt.value.type !== "call" || stmt.value.callee !== "Uniform" || stmt.value.args.length !== 2) {
          throw new Error("threshold distribution must be Uniform(min,max)");
        }
        thresholdMin = toNumber(evalConstExpr(stmt.value.args[0]), "threshold min");
        thresholdMax = toNumber(evalConstExpr(stmt.value.args[1]), "threshold max");
      }
      if (stmt.name === "opinion" && stmt.operator === "~") {
        if (stmt.value.type !== "call" || stmt.value.callee !== "Categorical" || stmt.value.args.length !== 1) {
          throw new Error("opinion distribution must be Categorical({...})");
        }
        initialOpinionDistribution = normalizeDistribution(
          toNumericRecord(evalConstExpr(stmt.value.args[0]), "Categorical")
        );
      }
      continue;
    }
    if (stmt.type === "edge_sign") {
      const positive = stmt.rules.find((rule) => rule.label === "positive");
      if (positive) {
        positiveProbability = toNumber(evalConstExpr(positive.probability), "edge_sign positive probability");
      }
    }
  }

  const config = nglConfigSchema.parse({
    seed,
    nodeCount,
    model,
    modelParams: parseModelParams(model, modelAssignments),
    positiveProbability,
    thresholdMin,
    thresholdMax,
    initialOpinionDistribution,
  });

  return { ast: [program], config };
}
