% Opinion Diffusion Simulator: Full Language Guide with Plain Explanations
% opinion-diffusion-sim
% February 2026

# Purpose of This Guide

This guide explains the two domain-specific languages used by the simulator.

A domain-specific language is a small language designed for one kind of task.
In this project, we use:

1. **Network Generation Language (NGL)**
2. **Opinion Rule Language (ORL)**

This guide is intentionally explicit. It defines terms, explains syntax in plain language, and gives practical examples from simple to advanced.

---

# Why Two Languages Instead of One

The software intentionally separates structure from behavior.

- Network Generation Language describes the social world at the beginning.
- Opinion Rule Language describes how people react over time.

This separation helps you run controlled experiments.

For example:

- Keep the same update rule and compare different network families.
- Keep the same network and compare different update rules.

---

# Part One: Network Generation Language

## What Network Generation Language controls

Network Generation Language controls:

- population size,
- network family,
- model parameters,
- initial opinion distribution,
- node threshold distribution,
- edge sign tendency.

## Supported statement types

A Network Generation Language script may include these statement types:

- `seed <integer>`
- `nodes <integer>`
- `model <kind> { ... }`
- `node_attr threshold ~ Uniform(min,max)`
- `node_attr opinion ~ Categorical({ ... })`
- `edge_sign: ...`

## Supported network families

- `ER` for Erdos-Renyi random graph
- `WS` for Watts-Strogatz small-world graph
- `BA` for Barabasi-Albert preferential attachment graph
- `SBM` for Stochastic Block Model

## Parameter expectations

- Erdos-Renyi: parameter `p`
- Watts-Strogatz: parameters `k` and `beta`
- Barabasi-Albert: parameter `m`
- Stochastic Block Model: parameters `blocks` and `P`

---

# Part Two: Opinion Rule Language

## What Opinion Rule Language controls

Opinion Rule Language controls the update behavior for each node.

It defines:

- which opinions exist,
- update timing mode,
- derived variables,
- conditional branching,
- probabilistic branching,
- assignment versus keep behavior.

## Declaration forms

- `state opinion in {"X","notX"}`
- `param threshold: float in [0,10]`
- `let name = expression`
- `mode = sync` or `mode = async`

## Update forms

- `if condition then statement else statement`
- `with prob value then statement else statement`
- `self.opinion := "X"`
- `keep`

---

# Expression Language (Both Languages)

Expressions support numbers, strings, boolean values, arithmetic, comparison, and logic.

## Operators

- unary: `not`, `-`
- arithmetic: `+`, `-`, `*`, `/`
- comparison: `==`, `!=`, `<`, `<=`, `>`, `>=`
- logical: `and`, `or`

## Useful built-in functions for Opinion Rule Language

- `neighbors(predicate)`
- `count(list)`
- `sum(list, expression)`
- `mean(list, expression)`
- `max(...)`, `min(...)`, `clamp(...)`
- `rand()`
- `opinions()`
- `argmax(list, expression)`

## Scope objects inside neighbor logic

- `self.field`
- `neighbor.field`
- `edge.type`

---

# Example Set

## Example 1: Minimal network + deterministic conversion

### Network Generation Language

```ngl
seed 1
nodes 20
model ER {
  p = 0.2
}
node_attr threshold ~ Uniform(1,3)
node_attr opinion ~ Categorical({"X":0.5,"notX":0.5})
edge_sign:
  positive with prob 0.8
```

### Opinion Rule Language

```orl
state opinion in {"X","notX"}
mode = sync
update:
  self.opinion := "X"
```

Expected behavior: complete conversion to `X` in one step.

## Example 2: Signed threshold ratio model

```orl
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
```

Expected behavior: often early change followed by stabilization.

## Example 3: Probabilistic adoption

```orl
state opinion in {"X","notX"}
mode = sync
let support = count(neighbors(neighbor.opinion=="X"))
let total = max(1, count(neighbors(true)))
let p = clamp(support / total, 0, 1)
update:
  with prob p then self.opinion := "X" else keep
```

Expected behavior: smoother and more variable transitions than hard threshold rules.

## Example 4: Compare structure with fixed behavior

Use the same Opinion Rule Language script and swap only the network family:

- Erdos-Renyi input
- Barabasi-Albert input
- Watts-Strogatz input
- Stochastic Block Model input

This isolates structural effects.

---

# Practical Checklist Before Running Experiments

1. Confirm both scripts parse successfully.
2. Click New Network once per intended reset.
3. Use Evolve for temporal progression.
4. Keep seeds fixed for controlled comparison.
5. Record final opinionCounts and change trajectory.

---

# Common Mistakes and Corrections

## Mistake: using a variable before defining it

Error symptom: unknown identifier message.

Correction: add `let variableName = ...` before `update:`.

## Mistake: treating New Network like Evolve

Correction: New Network resets. Evolve continues.

## Mistake: interpreting no visual change as failure

Correction: check `changedSincePrevious`.

- if positive, nodes changed;
- if zero, the model step ran but produced no switches.

---

# Final Guidance

Use the languages as experimental tools, not as mere configuration files.

Every line in your scripts is an assumption about:

- social structure,
- behavioral response,
- timing of influence.

The clearer those assumptions are, the stronger your analysis becomes.
