% Opinion Diffusion Simulator: Complete Guided Tutorial for Non-Technical Readers
% opinion-diffusion-sim
% February 2026

# Start Here

This document is written for readers who care about the social ideas but do not want to fight technical language.

If that describes you, this guide is for you.

The goal of this tutorial is not only to tell you which button to click. The goal is to help you understand what the software is doing, why it is doing it, and how to design meaningful experiments.

---

# The Central Idea of the Project

The project models how opinions spread through a social network.

In this simulator:

- A **node** represents one person.
- An **edge** represents one social relationship between two people.
- Each person holds an opinion label, usually `X` or `notX`.
- Over time, each person may keep or change their opinion.

What makes this tool useful is that it separates two parts of the problem:

1. **How the social network is built**.
2. **How opinions update inside that network**.

This separation lets you ask clean research questions, such as:

- If the social structure changes but the behavior rule stays the same, what changes?
- If the behavior rule changes but the social structure stays the same, what changes?

---

# Two Languages, Explained in Plain Language

The simulator uses two small text languages.

## 1) Network Generation Language (NGL)

The **Network Generation Language (NGL)** describes the social world at the start of a run.

It answers questions like:

- How many people are in the model?
- What style of network connects them?
- How are initial opinions distributed?
- How many ties are supportive or opposing?

## 2) Opinion Rule Language (ORL)

The **Opinion Rule Language (ORL)** describes how each person updates their opinion from one step to the next.

It answers questions like:

- Which neighbors count as support?
- Which neighbors count as opposition?
- How does personal threshold affect switching?
- Should updates happen all at once or one-by-one?

You do not need to memorize either language. The examples in this tutorial are copy-and-paste ready.

---

# What Each Button Means (Very Important)

The two most important actions in the interface are:

- **New Network**
- **Evolve**

These are not interchangeable.

## New Network

Use **New Network** when you want to generate a fresh social network from the text in the Network Generation Language editor.

This resets the current run to a new starting graph.

## Evolve

Use **Evolve** when you want to advance the current graph forward in time using the rule in the Opinion Rule Language editor.

This continues from the current state.

If you press New Network between evolve steps, you are starting over.

---

# How to Read Results Correctly

Always look at the stats panel after each evolve action.

The most important fields are:

- `step`: the current time step.
- `opinionCounts`: how many people currently hold each opinion.
- `changedSincePrevious`: how many people changed opinion in the most recent step.

Interpretation:

- If `step` increases, the model ran.
- If `changedSincePrevious` is `0`, the model ran but no one switched this step.

That is often a substantive result, not an error.

---

# Tutorial Section 1: Verify the Software in One Minute

This first scenario is intentionally simple and dramatic.

We force every person to become `X` in one step.

Why we do this:

- it proves parsing works,
- it proves simulation works,
- it proves graph rendering is updating.

## Step 1: Paste this network description

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

## Step 2: Click **New Network**

## Step 3: Paste this opinion update rule

```orl
state opinion in {"X","notX"}
mode = sync
update:
  self.opinion := "X"
```

## Step 4: Set steps to `1` and click **Evolve**

Expected result:

- everyone becomes `X`,
- changedSincePrevious is greater than zero,
- opinionCounts shows only `X`.

Example output from this codebase:

```json
[
  {
    "step": 0,
    "opinionCounts": { "X": 12, "notX": 8 },
    "changedSincePrevious": 0
  },
  {
    "step": 1,
    "opinionCounts": { "X": 20 },
    "changedSincePrevious": 8
  }
]
```

---

# Tutorial Section 2: Your Signed Threshold Model

Now we use the core model that motivated this project.

In words:

1. Count supportive pressure.
2. Count opposing pressure.
3. Compute a ratio.
4. Compare ratio to personal threshold.
5. Switch to `X` only if ratio is large enough.

## Step 1: Paste this network description

```ngl
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
```

## Step 2: Click **New Network**

## Step 3: Paste this opinion update rule

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

## Step 4: Evolve one step at a time and observe

What you should watch for:

- quick shifts in early steps,
- slowing change over time,
- possible stabilization.

Example output from this project for five steps:

```json
[
  { "step": 0, "opinionCounts": { "X": 25, "notX": 25 }, "changedSincePrevious": 0 },
  { "step": 1, "opinionCounts": { "X": 31, "notX": 19 }, "changedSincePrevious": 6 },
  { "step": 2, "opinionCounts": { "X": 32, "notX": 18 }, "changedSincePrevious": 1 },
  { "step": 3, "opinionCounts": { "X": 32, "notX": 18 }, "changedSincePrevious": 0 },
  { "step": 4, "opinionCounts": { "X": 32, "notX": 18 }, "changedSincePrevious": 0 },
  { "step": 5, "opinionCounts": { "X": 32, "notX": 18 }, "changedSincePrevious": 0 }
]
```

This is a common social pattern: movement first, then lock-in.

---

# Tutorial Section 3: Compare Network Structures (Hold Dynamics Fixed)

Now we do a clean comparison.

Use the same Opinion Rule Language rule from Section 2.
Only change the Network Generation Language input.

## Network A: Erdos-Renyi random graph

```ngl
seed 10
nodes 60
model ER {
  p = 0.1
}
node_attr threshold ~ Uniform(1,3)
node_attr opinion ~ Categorical({"X":0.45,"notX":0.55})
edge_sign:
  positive with prob 0.75
```

## Network B: Barabasi-Albert preferential attachment graph

```ngl
seed 10
nodes 60
model BA {
  m = 3
}
node_attr threshold ~ Uniform(1,3)
node_attr opinion ~ Categorical({"X":0.45,"notX":0.55})
edge_sign:
  positive with prob 0.75
```

## Comparison method

1. Run Network A for a fixed number of steps (for example, 20).
2. Record final opinionCounts.
3. Run Network B with the same number of steps.
4. Record final opinionCounts.
5. Compare.

If outcomes differ, network structure is carrying causal weight.

---

# Tutorial Section 4: Compare Dynamics (Hold Network Fixed)

Now do the opposite.

Keep the same network and compare two behavioral assumptions.

## Rule A: hard threshold rule

```orl
state opinion in {"X","notX"}
mode = sync
let support = count(neighbors(neighbor.opinion=="X"))
update:
  if support > self.threshold then self.opinion := "X" else keep
```

## Rule B: probabilistic switching rule

```orl
state opinion in {"X","notX"}
mode = sync
let support = count(neighbors(neighbor.opinion=="X"))
let total = max(1, count(neighbors(true)))
let p = clamp(support / total, 0, 1)
update:
  with prob p then self.opinion := "X" else keep
```

Interpretation:

- Rule A assumes strict, deterministic behavior.
- Rule B assumes gradual and noisy behavior.

This is a meaningful modeling choice, not just a technical one.

---

# Guided Scenario Pages on the Website

The website includes prepared pages with smaller networks and visible early evolution.

Each scenario is designed to show non-zero opinion change for at least three early steps under its preset seed.

- `/play/weekend-binge`
- `/play/recovery-islands`
- `/play/campus-polarization`

If you do not see updates, hard refresh the page once.

---

# Frequent Questions

## “I clicked evolve and nothing changed visually.”

First check the stats.

If step increased and changedSincePrevious is zero, the run happened. The system simply did not switch nodes that step.

## “I see unknown identifier errors.”

That means your rule references a variable name that was not defined with `let`.

## “How do I keep runs comparable?”

Keep seed, steps, and one language input fixed while changing only the other.

---

# Suggested Research Workflow

1. Choose one primary research question.
2. Decide what you will hold fixed.
3. Decide what you will vary.
4. Run multiple seeds.
5. Record all settings and outcomes.
6. Interpret pattern, not single run anomalies.

---

# Final Note

This software is most useful when you treat it as a laboratory for assumptions.

The point is not to produce one dramatic animation.
The point is to make social assumptions explicit, run them consistently, and compare outcomes carefully.

That is what gives the project scientific value.
