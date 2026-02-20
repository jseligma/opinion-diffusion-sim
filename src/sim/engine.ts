import type {
  EdgeState,
  Expr,
  Graph,
  NodeState,
  NglConfig,
  OrlAstNode,
  OrlConfig,
  OrlDeclaration,
  OrlParseResult,
  OrlStatement,
  SimulationFrame,
  SimulationStats,
} from "./types.js";

class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (1664525 * this.state + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

function randomInRange(rng: SeededRng, min: number, max: number): number {
  return min + (max - min) * rng.next();
}

function cloneNodes(nodes: NodeState[]): NodeState[] {
  return nodes.map((n) => ({ ...n }));
}

function normalizeDistribution(distribution: Record<string, number>): Array<{ opinion: string; cumulative: number }> {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  let running = 0;
  const out: Array<{ opinion: string; cumulative: number }> = [];

  for (const [opinion, weight] of Object.entries(distribution)) {
    running += weight / total;
    out.push({ opinion, cumulative: running });
  }

  if (out.length === 0) {
    out.push({ opinion: "X", cumulative: 0.5 });
    out.push({ opinion: "notX", cumulative: 1 });
  }

  out[out.length - 1].cumulative = 1;
  return out;
}

function sampleOpinion(rng: SeededRng, cdf: Array<{ opinion: string; cumulative: number }>): string {
  const r = rng.next();
  for (const entry of cdf) {
    if (r <= entry.cumulative) return entry.opinion;
  }
  return cdf[cdf.length - 1].opinion;
}

function makeNodes(config: NglConfig, rng: SeededRng): NodeState[] {
  const cdf = normalizeDistribution(config.initialOpinionDistribution);
  const nodes: NodeState[] = [];

  for (let i = 0; i < config.nodeCount; i += 1) {
    nodes.push({
      id: `n${i}`,
      opinion: sampleOpinion(rng, cdf),
      threshold: randomInRange(rng, config.thresholdMin, config.thresholdMax),
    });
  }

  return nodes;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function addUndirectedEdge(
  set: Set<string>,
  edges: EdgeState[],
  sourceIndex: number,
  targetIndex: number,
  positiveProbability: number,
  rng: SeededRng
): void {
  if (sourceIndex === targetIndex) return;
  const source = `n${sourceIndex}`;
  const target = `n${targetIndex}`;
  const key = edgeKey(source, target);
  if (set.has(key)) return;
  set.add(key);
  edges.push({
    source,
    target,
    type: rng.next() < positiveProbability ? "positive" : "negative",
  });
}

function generateER(config: NglConfig, rng: SeededRng): EdgeState[] {
  const edges: EdgeState[] = [];
  const set = new Set<string>();
  const p = Number(config.modelParams.p ?? 0.2);

  for (let i = 0; i < config.nodeCount; i += 1) {
    for (let j = i + 1; j < config.nodeCount; j += 1) {
      if (rng.next() < p) {
        addUndirectedEdge(set, edges, i, j, config.positiveProbability, rng);
      }
    }
  }

  return edges;
}

function generateWS(config: NglConfig, rng: SeededRng): EdgeState[] {
  const edges: EdgeState[] = [];
  const set = new Set<string>();
  const rawK = Math.max(2, Math.floor(Number(config.modelParams.k ?? 4)));
  const k = rawK % 2 === 0 ? rawK : rawK + 1;
  const beta = Math.min(1, Math.max(0, Number(config.modelParams.beta ?? 0.2)));
  const n = config.nodeCount;

  for (let i = 0; i < n; i += 1) {
    for (let offset = 1; offset <= k / 2; offset += 1) {
      let target = (i + offset) % n;
      if (rng.next() < beta) {
        let candidate = rng.int(n);
        let guard = 0;
        while ((candidate === i || set.has(edgeKey(`n${i}`, `n${candidate}`))) && guard < n * 2) {
          candidate = rng.int(n);
          guard += 1;
        }
        target = candidate;
      }
      addUndirectedEdge(set, edges, i, target, config.positiveProbability, rng);
    }
  }

  return edges;
}

function weightedPick(rng: SeededRng, degrees: number[], maxIndex: number): number {
  const total = degrees.slice(0, maxIndex).reduce((a, b) => a + b, 0);
  if (total <= 0) return rng.int(maxIndex);
  let r = rng.next() * total;
  for (let i = 0; i < maxIndex; i += 1) {
    r -= degrees[i];
    if (r <= 0) return i;
  }
  return maxIndex - 1;
}

function generateBA(config: NglConfig, rng: SeededRng): EdgeState[] {
  const edges: EdgeState[] = [];
  const set = new Set<string>();
  const n = config.nodeCount;
  const m = Math.max(1, Math.floor(Number(config.modelParams.m ?? 2)));

  const seedSize = Math.min(n, Math.max(m + 1, 3));
  const degrees = new Array<number>(n).fill(0);

  for (let i = 0; i < seedSize; i += 1) {
    for (let j = i + 1; j < seedSize; j += 1) {
      addUndirectedEdge(set, edges, i, j, config.positiveProbability, rng);
      degrees[i] += 1;
      degrees[j] += 1;
    }
  }

  for (let node = seedSize; node < n; node += 1) {
    const targets = new Set<number>();
    while (targets.size < Math.min(m, node)) {
      targets.add(weightedPick(rng, degrees, node));
    }
    for (const t of targets) {
      addUndirectedEdge(set, edges, node, t, config.positiveProbability, rng);
      degrees[node] += 1;
      degrees[t] += 1;
    }
  }

  return edges;
}

function chooseBlock(cumulative: number[], r: number): number {
  for (let i = 0; i < cumulative.length; i += 1) {
    if (r <= cumulative[i]) return i;
  }
  return cumulative.length - 1;
}

function generateSBM(config: NglConfig, rng: SeededRng): EdgeState[] {
  const edges: EdgeState[] = [];
  const set = new Set<string>();
  const blocksRaw = (config.modelParams.blocks as number[] | undefined) ?? [10, 10];
  const matrixRaw = (config.modelParams.P as number[][] | undefined) ?? [
    [0.3, 0.05],
    [0.05, 0.3],
  ];

  const total = blocksRaw.reduce((a, b) => a + b, 0);
  const normalized = blocksRaw.map((b) => b / total);
  const cumulative: number[] = [];
  let running = 0;
  for (const p of normalized) {
    running += p;
    cumulative.push(running);
  }

  const memberships: number[] = [];
  for (let i = 0; i < config.nodeCount; i += 1) {
    memberships.push(chooseBlock(cumulative, rng.next()));
  }

  for (let i = 0; i < config.nodeCount; i += 1) {
    for (let j = i + 1; j < config.nodeCount; j += 1) {
      const bi = memberships[i];
      const bj = memberships[j];
      const p = matrixRaw[bi]?.[bj] ?? 0;
      if (rng.next() < p) {
        addUndirectedEdge(set, edges, i, j, config.positiveProbability, rng);
      }
    }
  }

  return edges;
}

export function buildGraph(config: NglConfig, seed = 1): Graph {
  const rng = new SeededRng(config.seed ?? seed);
  const nodes = makeNodes(config, rng);

  const edges = (() => {
    if (config.model === "ER") return generateER(config, rng);
    if (config.model === "WS") return generateWS(config, rng);
    if (config.model === "BA") return generateBA(config, rng);
    return generateSBM(config, rng);
  })();

  return { nodes, edges };
}

type NeighborEntry = { node: NodeState; edgeType: EdgeState["type"] };
type EvalVars = Record<string, unknown>;

interface EvalEnv {
  graph: Graph;
  self: NodeState;
  vars: EvalVars;
  rng: SeededRng;
  neighbor?: NodeState;
  edge?: { type: EdgeState["type"] };
}

interface ExecutionResult {
  handled: boolean;
  self: NodeState;
}

function neighbors(graph: Graph, nodeId: string): NeighborEntry[] {
  const out: NeighborEntry[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const edge of graph.edges) {
    if (edge.source === nodeId) {
      const node = byId.get(edge.target);
      if (node) out.push({ node, edgeType: edge.type });
    } else if (edge.target === nodeId) {
      const node = byId.get(edge.source);
      if (node) out.push({ node, edgeType: edge.type });
    }
  }

  return out;
}

function toBoolean(value: unknown): boolean {
  return Boolean(value);
}

function toNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected number for ${context}`);
  }
  return value;
}

function evalNeighborFilter(selfEnv: EvalEnv, predicate: Expr | undefined): NeighborEntry[] {
  const all = neighbors(selfEnv.graph, selfEnv.self.id);
  if (!predicate) return all;
  return all.filter((entry) =>
    toBoolean(
      evalExpr(predicate, {
        ...selfEnv,
        neighbor: entry.node,
        edge: { type: entry.edgeType },
      })
    )
  );
}

function evalExpr(expr: Expr, env: EvalEnv): unknown {
  if (expr.type === "literal") return expr.value;
  if (expr.type === "array") return expr.items.map((item) => evalExpr(item, env));
  if (expr.type === "object") {
    const out: Record<string, unknown> = {};
    for (const entry of expr.entries) out[entry.key] = evalExpr(entry.value, env);
    return out;
  }

  if (expr.type === "identifier") {
    if (expr.name in env.vars) return env.vars[expr.name];
    if (expr.name === "self") return env.self;
    if (expr.name === "neighbor") return env.neighbor;
    if (expr.name === "edge") return env.edge;
    if (expr.name === "true") return true;
    if (expr.name === "false") return false;
    throw new Error(`Unknown identifier '${expr.name}'`);
  }

  if (expr.type === "member") {
    const object = evalExpr(expr.object, env);
    if (!object || typeof object !== "object") return undefined;
    return (object as Record<string, unknown>)[expr.property];
  }

  if (expr.type === "unary") {
    const arg = evalExpr(expr.argument, env);
    if (expr.operator === "not") return !toBoolean(arg);
    return -toNumber(arg, "unary -");
  }

  if (expr.type === "binary") {
    const left = evalExpr(expr.left, env);
    const right = evalExpr(expr.right, env);
    if (expr.operator === "or") return toBoolean(left) || toBoolean(right);
    if (expr.operator === "and") return toBoolean(left) && toBoolean(right);
    if (expr.operator === "==") return left === right;
    if (expr.operator === "!=") return left !== right;
    if (expr.operator === "<") return toNumber(left, "< left") < toNumber(right, "< right");
    if (expr.operator === "<=") return toNumber(left, "<= left") <= toNumber(right, "<= right");
    if (expr.operator === ">") return toNumber(left, "> left") > toNumber(right, "> right");
    if (expr.operator === ">=") return toNumber(left, ">= left") >= toNumber(right, ">= right");
    if (expr.operator === "+") return toNumber(left, "+ left") + toNumber(right, "+ right");
    if (expr.operator === "-") return toNumber(left, "- left") - toNumber(right, "- right");
    if (expr.operator === "*") return toNumber(left, "* left") * toNumber(right, "* right");
    return toNumber(left, "/ left") / toNumber(right, "/ right");
  }

  if (expr.type === "call") {
    if (expr.callee === "neighbors") {
      const predicate = expr.args[0];
      return evalNeighborFilter(env, predicate);
    }

    if (expr.callee === "count") {
      const source = expr.args[0] ? evalExpr(expr.args[0], env) : [];
      if (!Array.isArray(source)) return 0;
      return source.length;
    }

    if (expr.callee === "sum") {
      const source = expr.args[0] ? evalExpr(expr.args[0], env) : [];
      if (!Array.isArray(source)) return 0;
      if (expr.args.length < 2) return source.reduce((acc, item) => acc + toNumber(item, "sum item"), 0);
      let total = 0;
      for (const item of source) {
        if (item && typeof item === "object" && "node" in item && "edgeType" in item) {
          const neighborEntry = item as NeighborEntry;
          total += toNumber(
            evalExpr(expr.args[1], {
              ...env,
              neighbor: neighborEntry.node,
              edge: { type: neighborEntry.edgeType },
            }),
            "sum mapping"
          );
        } else {
          total += toNumber(evalExpr(expr.args[1], { ...env, vars: { ...env.vars, item } }), "sum mapping");
        }
      }
      return total;
    }

    if (expr.callee === "mean") {
      const source = expr.args[0] ? evalExpr(expr.args[0], env) : [];
      if (!Array.isArray(source) || source.length === 0) return 0;
      const total = toNumber(evalExpr({ type: "call", callee: "sum", args: expr.args }, env), "mean sum");
      return total / source.length;
    }

    if (expr.callee === "max") {
      return Math.max(...expr.args.map((arg) => toNumber(evalExpr(arg, env), "max arg")));
    }
    if (expr.callee === "min") {
      return Math.min(...expr.args.map((arg) => toNumber(evalExpr(arg, env), "min arg")));
    }
    if (expr.callee === "clamp") {
      const x = toNumber(evalExpr(expr.args[0], env), "clamp x");
      const lo = toNumber(evalExpr(expr.args[1], env), "clamp lo");
      const hi = toNumber(evalExpr(expr.args[2], env), "clamp hi");
      return Math.max(lo, Math.min(hi, x));
    }
    if (expr.callee === "rand") {
      return env.rng.next();
    }
    if (expr.callee === "opinions") {
      return [...new Set(env.graph.nodes.map((node) => node.opinion))];
    }
    if (expr.callee === "argmax") {
      const candidates = evalExpr(expr.args[0], env);
      if (!Array.isArray(candidates) || expr.args.length < 2) return undefined;
      let bestValue: unknown = undefined;
      let bestScore = -Infinity;
      for (const candidate of candidates) {
        const score = toNumber(evalExpr(expr.args[1], { ...env, vars: { ...env.vars, opinion: candidate } }), "argmax score");
        if (score > bestScore) {
          bestScore = score;
          bestValue = candidate;
        }
      }
      return bestValue;
    }

    throw new Error(`Unsupported function '${expr.callee}'`);
  }

  return undefined;
}

function executeStatement(stmt: OrlStatement, env: EvalEnv): ExecutionResult {
  if (stmt.type === "keep") {
    return { handled: true, self: env.self };
  }

  if (stmt.type === "assign") {
    const value = evalExpr(stmt.value, env);
    const updated: NodeState = { ...env.self };
    (updated as unknown as Record<string, unknown>)[stmt.target.field] = value;
    return { handled: true, self: updated };
  }

  if (stmt.type === "if") {
    if (toBoolean(evalExpr(stmt.condition, env))) {
      return executeStatement(stmt.thenStmt, env);
    }
    if (stmt.elseStmt) return executeStatement(stmt.elseStmt, env);
    return { handled: false, self: env.self };
  }

  if (stmt.type === "prob") {
    const p = toNumber(evalExpr(stmt.probability, env), "with prob");
    const branch = env.rng.next() < p ? stmt.thenStmt : stmt.elseStmt;
    if (!branch) return { handled: false, self: env.self };
    return executeStatement(branch, env);
  }

  return { handled: false, self: env.self };
}

function evalParamDefaults(declarations: OrlDeclaration[]): EvalVars {
  const vars: EvalVars = {};
  for (const declaration of declarations) {
    if (declaration.type === "param" && declaration.default) {
      // Defaults are evaluated once as constants.
      const value = evalExpr(declaration.default, {
        graph: { nodes: [], edges: [] },
        self: { id: "", opinion: "", threshold: 0 },
        vars,
        rng: new SeededRng(1),
      });
      vars[declaration.name] = value;
    }
  }
  return vars;
}

function updateNodeFromProgram(graph: Graph, self: NodeState, program: OrlAstNode, rng: SeededRng): NodeState {
  const baseVars = evalParamDefaults(program.declarations);
  const env: EvalEnv = { graph, self, vars: { ...baseVars }, rng };

  for (const declaration of program.declarations) {
    if (declaration.type === "let") {
      env.vars[declaration.name] = evalExpr(declaration.value, env);
    }
  }

  for (const stmt of program.update) {
    const result = executeStatement(stmt, env);
    if (result.handled) return result.self;
  }
  return self;
}

function updateNodeLegacy(graph: Graph, self: NodeState, config: OrlConfig): NodeState {
  const neigh = neighbors(graph, self.id);

  let posX = 0;
  let negNotX = 0;
  let negX = 0;
  let posNotX = 0;

  for (const n of neigh) {
    const isX = n.node.opinion === config.targetOpinion;
    if (n.edgeType === "positive" && isX) posX += 1;
    if (n.edgeType === "negative" && !isX) negNotX += 1;
    if (n.edgeType === "negative" && isX) negX += 1;
    if (n.edgeType === "positive" && !isX) posNotX += 1;
  }

  const denominator = Math.max(1, negX + posNotX);
  const score = (posX + negNotX) / denominator;
  const threshold = self[config.thresholdField as keyof NodeState];
  const thresholdValue = typeof threshold === "number" ? threshold : self.threshold;

  if (score > thresholdValue) {
    return { ...self, opinion: config.targetOpinion };
  }

  return self;
}

function stepSync(
  graph: Graph,
  mode: "legacy" | "program",
  ruleConfig: OrlConfig,
  program: OrlAstNode | undefined,
  rng: SeededRng
): Graph {
  const nextNodes = graph.nodes.map((node) =>
    mode === "program" && program ? updateNodeFromProgram(graph, node, program, rng) : updateNodeLegacy(graph, node, ruleConfig)
  );
  return { nodes: nextNodes, edges: graph.edges };
}

function stepAsync(
  graph: Graph,
  mode: "legacy" | "program",
  ruleConfig: OrlConfig,
  program: OrlAstNode | undefined,
  rng: SeededRng
): Graph {
  const nextGraph: Graph = { nodes: cloneNodes(graph.nodes), edges: graph.edges };
  for (let i = 0; i < nextGraph.nodes.length; i += 1) {
    nextGraph.nodes[i] =
      mode === "program" && program
        ? updateNodeFromProgram(nextGraph, nextGraph.nodes[i], program, rng)
        : updateNodeLegacy(nextGraph, nextGraph.nodes[i], ruleConfig);
  }
  return nextGraph;
}

function opinionCounts(nodes: NodeState[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    counts[node.opinion] = (counts[node.opinion] ?? 0) + 1;
  }
  return counts;
}

function extractRule(input: OrlConfig | OrlParseResult): {
  mode: "legacy" | "program";
  config: OrlConfig;
  program?: OrlAstNode;
} {
  if ("config" in input && "ast" in input) {
    const program = input.ast[0];
    const declaredMode = program.declarations.find((decl): decl is Extract<OrlDeclaration, { type: "mode" }> => decl.type === "mode");
    return {
      mode: program ? "program" : "legacy",
      config: { ...input.config, mode: declaredMode?.value ?? input.config.mode },
      program,
    };
  }
  return { mode: "legacy", config: input };
}

export function runSimulation(
  initialGraph: Graph,
  rule: OrlConfig | OrlParseResult,
  steps: number,
  randomSeed = 1
): { frames: SimulationFrame[]; stats: SimulationStats } {
  const extracted = extractRule(rule);
  const rng = new SeededRng(randomSeed);

  const frames: SimulationFrame[] = [
    {
      step: 0,
      nodes: cloneNodes(initialGraph.nodes),
    },
  ];

  let graph = initialGraph;
  for (let i = 1; i <= steps; i += 1) {
    graph =
      extracted.config.mode === "sync"
        ? stepSync(graph, extracted.mode, extracted.config, extracted.program, rng)
        : stepAsync(graph, extracted.mode, extracted.config, extracted.program, rng);
    frames.push({
      step: i,
      nodes: cloneNodes(graph.nodes),
    });
  }

  return {
    frames,
    stats: {
      opinionCounts: opinionCounts(graph.nodes),
    },
  };
}
