import test from "node:test";
import assert from "node:assert/strict";
import { parseNgl } from "../src/sim/ngl.js";
import { parseOrl } from "../src/sim/orl.js";
import type { Expr } from "../src/sim/types.js";

function asBinary(expr: Expr, operator: string): { left: Expr; right: Expr } {
  assert.equal(expr.type, "binary");
  assert.equal(expr.operator, operator);
  return { left: expr.left, right: expr.right };
}

test("parseNgl parses model/attr/rules with expression values", () => {
  const source = `
    seed 7
    nodes 20
    model SBM {
      blocks = [8, 7, 5]
      P = [[0.35,0.05,0.02],[0.05,0.30,0.04],[0.02,0.04,0.25]]
    }
    node_attr threshold ~ Uniform(1 + 1, 5 - 1)
    node_attr opinion ~ Categorical({"X":0.4,"notX":0.6})
    edge_sign:
      positive with prob 0.8 if same_block(u,v)
      positive with prob 0.3 if not same_block(u,v)
      negative with prob 1.0
  `;

  const parsed = parseNgl(source);
  assert.equal(parsed.config.seed, 7);
  assert.equal(parsed.config.nodeCount, 20);
  assert.equal(parsed.config.model, "SBM");
  assert.deepEqual(parsed.config.modelParams.blocks, [8, 7, 5]);
  assert.deepEqual(parsed.config.modelParams.P, [
    [0.35, 0.05, 0.02],
    [0.05, 0.3, 0.04],
    [0.02, 0.04, 0.25],
  ]);
  assert.equal(parsed.config.thresholdMin, 2);
  assert.equal(parsed.config.thresholdMax, 4);
  assert.equal(parsed.config.positiveProbability, 0.8);
  assert.deepEqual(parsed.config.initialOpinionDistribution, { X: 0.4, notX: 0.6 });
  assert.equal(parsed.ast[0].type, "program");
});

test("parseOrl enforces grammar and preserves expression precedence", () => {
  const source = `
    state opinion in {"X","notX"}
    param threshold: float in [0,10]
    mode = async
    let score = 1 + 2 * 3
    update:
      if 1 + 2 * 3 > 6 and not false then self.opinion := "X" else keep
  `;

  const parsed = parseOrl(source);
  assert.equal(parsed.config.mode, "async");
  assert.equal(parsed.config.targetOpinion, "X");
  assert.equal(parsed.config.oppositeOpinion, "notX");
  assert.equal(parsed.config.thresholdField, "threshold");

  const program = parsed.ast[0];
  const letDecl = program.declarations.find((decl) => decl.type === "let");
  assert.ok(letDecl && letDecl.type === "let");

  const add = asBinary(letDecl.value, "+");
  assert.equal(add.left.type, "literal");
  assert.equal(add.left.value, 1);
  const mul = asBinary(add.right, "*");
  assert.equal(mul.left.type, "literal");
  assert.equal(mul.left.value, 2);
  assert.equal(mul.right.type, "literal");
  assert.equal(mul.right.value, 3);
});

test("parseOrl fails on missing update block", () => {
  assert.throws(() => parseOrl(`state opinion in {"X","notX"}`), /Missing update block/);
});
