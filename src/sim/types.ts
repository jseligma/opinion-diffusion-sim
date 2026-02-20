export type Opinion = string;

export type EdgeType = "positive" | "negative";
export type ModelKind = "ER" | "WS" | "BA" | "SBM";

export interface NodeState {
  id: string;
  opinion: Opinion;
  threshold: number;
}

export interface EdgeState {
  source: string;
  target: string;
  type: EdgeType;
}

export interface Graph {
  nodes: NodeState[];
  edges: EdgeState[];
}

export interface SimulationFrame {
  step: number;
  nodes: NodeState[];
}

export interface SimulationStats {
  opinionCounts: Record<string, number>;
}

export interface NglConfig {
  seed?: number;
  nodeCount: number;
  model: ModelKind;
  modelParams: Record<string, number | number[] | number[][]>;
  positiveProbability: number;
  thresholdMin: number;
  thresholdMax: number;
  initialOpinionDistribution: Record<string, number>;
}

export interface OrlConfig {
  targetOpinion: string;
  oppositeOpinion: string;
  mode: "sync" | "async";
  thresholdField: string;
}

export type Expr =
  | { type: "literal"; value: string | number | boolean }
  | { type: "identifier"; name: string }
  | { type: "member"; object: Expr; property: string }
  | { type: "call"; callee: string; args: Expr[] }
  | { type: "unary"; operator: "not" | "-"; argument: Expr }
  | {
      type: "binary";
      operator: "or" | "and" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/";
      left: Expr;
      right: Expr;
    }
  | { type: "array"; items: Expr[] }
  | { type: "object"; entries: Array<{ key: string; value: Expr }> };

export type NglStatement =
  | { type: "seed"; value: number }
  | { type: "nodes"; value: number }
  | { type: "node"; id: string; attrs: Array<{ key: string; value: Expr }> }
  | { type: "edge"; source: string; target: string; attrs: Array<{ key: string; value: Expr }> }
  | { type: "model"; kind: ModelKind; assignments: Array<{ key: string; value: Expr }> }
  | {
      type: "attr";
      target: "node_attr" | "edge_attr";
      name: string;
      operator: "~" | "=";
      value: Expr;
    }
  | {
      type: "edge_sign";
      rules: Array<{ label: "positive" | "negative" | string; probability: Expr; condition?: Expr }>;
    };

export interface NglAstNode {
  type: "program";
  statements: NglStatement[];
}

export interface NglParseResult {
  ast: NglAstNode[];
  config: NglConfig;
}

export type OrlDeclaration =
  | { type: "state"; name: string; values: Expr[] }
  | { type: "param"; name: string; valueType: "float" | "int" | "bool" | "string"; range?: [Expr, Expr]; default?: Expr }
  | { type: "let"; name: string; value: Expr }
  | { type: "mode"; value: "sync" | "async" }
  | { type: "option"; name: string; value: Expr };

export type OrlStatement =
  | { type: "if"; condition: Expr; thenStmt: OrlStatement; elseStmt?: OrlStatement }
  | { type: "assign"; target: { object: "self"; field: string }; value: Expr }
  | { type: "keep" }
  | { type: "prob"; probability: Expr; thenStmt: OrlStatement; elseStmt?: OrlStatement };

export interface OrlAstNode {
  type: "program";
  declarations: OrlDeclaration[];
  update: OrlStatement[];
}

export interface OrlParseResult {
  ast: OrlAstNode[];
  config: OrlConfig;
}
