import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, runSimulation } from "../src/sim/engine.js";
import { parseNgl } from "../src/sim/ngl.js";
import { parseOrl } from "../src/sim/orl.js";

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((acc, value) => acc + value, 0);
}

test("Tutorial 1 example: always-switch rule converts everyone to X in one step", () => {
  const ngl = `
    seed 1
    nodes 20
    model ER { p = 0.2 }
    node_attr threshold ~ Uniform(1,3)
    node_attr opinion ~ Categorical({"X":0.5,"notX":0.5})
    edge_sign:
      positive with prob 0.8
  `;

  const orl = `
    state opinion in {"X","notX"}
    mode = sync
    update:
      self.opinion := "X"
  `;

  const nglParsed = parseNgl(ngl);
  const orlParsed = parseOrl(orl);
  const graph = buildGraph(nglParsed.config, nglParsed.config.seed ?? 1);
  const result = runSimulation(graph, orlParsed, 1, nglParsed.config.seed ?? 1);

  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[1].nodes.every((node) => node.opinion === "X"), true);
  assert.equal(result.stats.opinionCounts.X, 20);
});

test("Tutorial 2 example: signed-threshold rule runs and preserves valid opinion labels", () => {
  const ngl = `
    seed 7
    nodes 50
    model SBM {
      blocks = [20,15,15]
      P = [[0.18,0.05,0.03],[0.05,0.2,0.04],[0.03,0.04,0.22]]
    }
    node_attr threshold ~ Uniform(1,3)
    node_attr opinion ~ Categorical({"X":0.45,"notX":0.55})
    edge_sign:
      positive with prob 0.75
  `;

  const orl = `
    state opinion in {"X","notX"}
    param threshold: float in [0,10]
    mode = sync
    let posX = count(neighbors(edge.type=="positive" and neighbor.opinion=="X"))
    let negNotX = count(neighbors(edge.type=="negative" and neighbor.opinion!="X"))
    let negX = count(neighbors(edge.type=="negative" and neighbor.opinion=="X"))
    let posNotX = count(neighbors(edge.type=="positive" and neighbor.opinion!="X"))
    let score = (posX + negNotX) / max(1, (negX + posNotX))
    update:
      if score > self.threshold then self.opinion := "X" else keep
  `;

  const nglParsed = parseNgl(ngl);
  const orlParsed = parseOrl(orl);
  const graph = buildGraph(nglParsed.config, nglParsed.config.seed ?? 1);
  const result = runSimulation(graph, orlParsed, 5, nglParsed.config.seed ?? 1);

  assert.equal(result.frames.length, 6);
  assert.equal(sumCounts(result.stats.opinionCounts), 50);
  assert.equal(
    result.frames[result.frames.length - 1].nodes.every((node) => node.opinion === "X" || node.opinion === "notX"),
    true
  );
});

test("Tutorial 3 example: ER and BA variants both run and generate distinct edge structures", () => {
  const baseOrl = `
    state opinion in {"X","notX"}
    param threshold: float in [0,10]
    mode = sync
    let posX = count(neighbors(edge.type=="positive" and neighbor.opinion=="X"))
    let negNotX = count(neighbors(edge.type=="negative" and neighbor.opinion!="X"))
    let negX = count(neighbors(edge.type=="negative" and neighbor.opinion=="X"))
    let posNotX = count(neighbors(edge.type=="positive" and neighbor.opinion!="X"))
    let score = (posX + negNotX) / max(1, (negX + posNotX))
    update:
      if score > self.threshold then self.opinion := "X" else keep
  `;

  const erNgl = `
    seed 10
    nodes 60
    model ER { p = 0.1 }
    node_attr threshold ~ Uniform(1,3)
    node_attr opinion ~ Categorical({"X":0.45,"notX":0.55})
    edge_sign:
      positive with prob 0.75
  `;

  const baNgl = `
    seed 10
    nodes 60
    model BA { m = 3 }
    node_attr threshold ~ Uniform(1,3)
    node_attr opinion ~ Categorical({"X":0.45,"notX":0.55})
    edge_sign:
      positive with prob 0.75
  `;

  const rule = parseOrl(baseOrl);

  const erParsed = parseNgl(erNgl);
  const erGraph = buildGraph(erParsed.config, erParsed.config.seed ?? 1);
  const erRun = runSimulation(erGraph, rule, 3, erParsed.config.seed ?? 1);

  const baParsed = parseNgl(baNgl);
  const baGraph = buildGraph(baParsed.config, baParsed.config.seed ?? 1);
  const baRun = runSimulation(baGraph, rule, 3, baParsed.config.seed ?? 1);

  assert.equal(erGraph.nodes.length, 60);
  assert.equal(baGraph.nodes.length, 60);
  assert.equal(erRun.frames.length, 4);
  assert.equal(baRun.frames.length, 4);

  const erEdges = erGraph.edges.map((edge) => `${edge.source}-${edge.target}-${edge.type}`).join("|");
  const baEdges = baGraph.edges.map((edge) => `${edge.source}-${edge.target}-${edge.type}`).join("|");
  assert.notEqual(erEdges, baEdges);
});

test("Tutorial 4 example: strict and probabilistic rules both run on the same fixed network", () => {
  const ngl = `
    seed 14
    nodes 40
    model WS { k = 4 beta = 0.2 }
    node_attr threshold ~ Uniform(1,3)
    node_attr opinion ~ Categorical({"X":0.45,"notX":0.55})
    edge_sign:
      positive with prob 0.75
  `;

  const strictOrl = `
    state opinion in {"X","notX"}
    mode = sync
    let support = count(neighbors(neighbor.opinion=="X"))
    update:
      if support > self.threshold then self.opinion := "X" else keep
  `;

  const probabilisticOrl = `
    state opinion in {"X","notX"}
    mode = sync
    let support = count(neighbors(neighbor.opinion=="X"))
    let total = max(1, count(neighbors(true)))
    let p = clamp(support / total, 0, 1)
    update:
      with prob p then self.opinion := "X" else keep
  `;

  const nglParsed = parseNgl(ngl);
  const graph = buildGraph(nglParsed.config, nglParsed.config.seed ?? 1);
  const strictRule = parseOrl(strictOrl);
  const probabilisticRule = parseOrl(probabilisticOrl);

  const strictRun = runSimulation(graph, strictRule, 10, 99);
  const probabilisticRun = runSimulation(graph, probabilisticRule, 10, 99);

  assert.equal(strictRun.frames.length, 11);
  assert.equal(probabilisticRun.frames.length, 11);
  assert.equal(sumCounts(strictRun.stats.opinionCounts), 40);
  assert.equal(sumCounts(probabilisticRun.stats.opinionCounts), 40);
});
