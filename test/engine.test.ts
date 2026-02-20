import test from "node:test";
import assert from "node:assert/strict";
import { runSimulation } from "../src/sim/engine.js";
import { parseOrl } from "../src/sim/orl.js";
import type { Graph } from "../src/sim/types.js";

test("runSimulation applies signed threshold update", () => {
  const rule = parseOrl(`
    state opinion in {"X","notX"}
    mode = sync
    let posX    = count(neighbors(edge.type=="positive" and neighbor.opinion=="X"))
    let negNotX = count(neighbors(edge.type=="negative" and neighbor.opinion!="X"))
    let negX    = count(neighbors(edge.type=="negative" and neighbor.opinion=="X"))
    let posNotX = count(neighbors(edge.type=="positive" and neighbor.opinion!="X"))
    let score = (posX + negNotX) / max(1, (negX + posNotX))
    update:
      if score > self.threshold then self.opinion := "X" else keep
  `);

  const graph: Graph = {
    nodes: [
      { id: "n0", opinion: "notX", threshold: 0.5 },
      { id: "n1", opinion: "X", threshold: 0.1 },
    ],
    edges: [{ source: "n0", target: "n1", type: "positive" }],
  };

  const result = runSimulation(graph, rule, 1, 1);
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[1].nodes.find((n) => n.id === "n0")?.opinion, "X");
  assert.equal(result.stats.opinionCounts.X, 2);
});

test("async updates can diverge from sync updates", () => {
  const syncRule = parseOrl(`
    state opinion in {"X","notX"}
    mode = sync
    let posX = count(neighbors(edge.type=="positive" and neighbor.opinion=="X"))
    update:
      if posX > self.threshold then self.opinion := "X" else keep
  `);
  const asyncRule = parseOrl(`
    state opinion in {"X","notX"}
    mode = async
    let posX = count(neighbors(edge.type=="positive" and neighbor.opinion=="X"))
    update:
      if posX > self.threshold then self.opinion := "X" else keep
  `);

  const graph: Graph = {
    nodes: [
      { id: "a", opinion: "X", threshold: 0 },
      { id: "b", opinion: "notX", threshold: 0 },
      { id: "c", opinion: "notX", threshold: 0 },
    ],
    edges: [
      { source: "a", target: "b", type: "positive" },
      { source: "b", target: "c", type: "positive" },
    ],
  };

  const sync = runSimulation(graph, syncRule, 1, 1);
  const async = runSimulation(graph, asyncRule, 1, 1);

  const syncById = new Map(sync.frames[1].nodes.map((node) => [node.id, node.opinion]));
  const asyncById = new Map(async.frames[1].nodes.map((node) => [node.id, node.opinion]));

  assert.equal(syncById.get("c"), "notX");
  assert.equal(asyncById.get("c"), "X");
});

test("with prob honors probabilistic branch deterministically with seed", () => {
  const rule = parseOrl(`
    state opinion in {"X","notX"}
    mode = sync
    update:
      with prob 1 then self.opinion := "X" else keep
  `);

  const graph: Graph = {
    nodes: [{ id: "n0", opinion: "notX", threshold: 0 }],
    edges: [],
  };

  const result = runSimulation(graph, rule, 1, 123);
  assert.equal(result.frames[1].nodes[0].opinion, "X");
});
