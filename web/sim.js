const nglEl = document.getElementById("ngl");
const orlEl = document.getElementById("orl");
const stepsEl = document.getElementById("steps");
const runEl = document.getElementById("run");
const newNetworkEl = document.getElementById("new-network");
const frameEl = document.getElementById("frame");
const frameLabelEl = document.getElementById("frame-label");
const statsEl = document.getElementById("stats");
const heroTitleEl = document.getElementById("hero-title");
const heroSubEl = document.getElementById("hero-sub");
const scenarioNoteEl = document.getElementById("scenario-note");

let cy;
let runResult;

const SCENARIOS = {
  "weekend-binge": {
    title: "Weekend Binge Contagion",
    subtitle: "A clustered social network where heavy-use norms can spread through strong positive ties.",
    note: "Interpretation: opinion X can represent high-risk weekend drinking; notX can represent low-risk behavior.",
    ngl: `seed 21
nodes 24
model SBM {
  blocks = [8, 8, 8]
  P = [[0.24,0.07,0.05],[0.07,0.25,0.06],[0.05,0.06,0.22]]
}
node_attr threshold ~ Uniform(0.6,1.6)
node_attr opinion ~ Categorical({"X":0.3,"notX":0.7})
edge_sign:
  positive with prob 0.82`,
    orl: `state opinion in {"X","notX"}
param threshold: float in [0,10]
mode = async
let posX = count(neighbors(edge.type=="positive" and neighbor.opinion=="X"))
let negNotX = count(neighbors(edge.type=="negative" and neighbor.opinion!="X"))
let negX = count(neighbors(edge.type=="negative" and neighbor.opinion=="X"))
let posNotX = count(neighbors(edge.type=="positive" and neighbor.opinion!="X"))
let score = (posX + negNotX) / max(1, (negX + posNotX))
update:
  if score > self.threshold then self.opinion := "X" else keep`,
  },
  "recovery-islands": {
    title: "Recovery Support Islands",
    subtitle: "Communities with sparse bridges and mostly positive internal ties, exploring protective clustering.",
    note: "Interpretation: opinion X can represent sustained recovery behavior; notX can represent relapse-prone behavior.",
    ngl: `seed 33
nodes 30
model SBM {
  blocks = [10, 10, 10]
  P = [[0.20,0.06,0.04],[0.06,0.14,0.05],[0.04,0.05,0.18]]
}
node_attr threshold ~ Uniform(0.7,1.8)
node_attr opinion ~ Categorical({"X":0.35,"notX":0.65})
edge_sign:
  positive with prob 0.74`,
    orl: `state opinion in {"X","notX"}
mode = async
let support = count(neighbors(edge.type=="positive" and neighbor.opinion=="X"))
let total = max(1, count(neighbors(true)))
let pRecover = clamp((support + 1) / (total + 2), 0.15, 0.75)
update:
  if self.opinion=="notX" then with prob pRecover then self.opinion := "X" else keep else with prob 0.1 then self.opinion := "notX" else keep`,
  },
  "campus-polarization": {
    title: "Campus Polarization Pattern",
    subtitle: "Moderate inter-group contact with mixed-sign ties, showing possible lock-in or swings.",
    note: "Interpretation: opinion X can represent participation in risky drinking scenes vs. notX as abstaining/moderate social norms.",
    ngl: `seed 11
nodes 26
model WS {
  k = 4
  beta = 0.35
}
node_attr threshold ~ Uniform(0.8,1.8)
node_attr opinion ~ Categorical({"X":0.50,"notX":0.50})
edge_sign:
  positive with prob 0.62`,
    orl: `state opinion in {"X","notX"}
mode = async
let support = count(neighbors(edge.type=="positive" and neighbor.opinion=="X"))
let oppose = count(neighbors(edge.type=="positive" and neighbor.opinion!="X"))
let pAdopt = clamp((support - oppose + 3) / 6, 0.05, 0.65)
update:
  if self.opinion=="notX" then with prob pAdopt then self.opinion := "X" else keep else with prob 0.2 then self.opinion := "notX" else keep`,
  },
};

function scenarioIdFromLocation() {
  const fromPath = window.location.pathname.startsWith("/play/") ? window.location.pathname.slice("/play/".length) : "";
  if (fromPath && SCENARIOS[fromPath]) return fromPath;
  const fromQuery = new URLSearchParams(window.location.search).get("scenario");
  if (fromQuery && SCENARIOS[fromQuery]) return fromQuery;
  return "";
}

function applyScenarioPreset() {
  const scenarioId = scenarioIdFromLocation();
  if (!scenarioId) return;
  const scenario = SCENARIOS[scenarioId];
  nglEl.value = scenario.ngl;
  orlEl.value = scenario.orl;
  if (heroTitleEl) heroTitleEl.textContent = scenario.title;
  if (heroSubEl) heroSubEl.textContent = scenario.subtitle;
  if (scenarioNoteEl) {
    scenarioNoteEl.hidden = false;
    scenarioNoteEl.textContent = scenario.note;
  }
}

function styleForOpinion(opinion) {
  if (opinion === "X") return "#0d7c66";
  if (opinion === "notX") return "#b85a3d";
  return "#5c5c5c";
}

function edgeColor(type) {
  return type === "positive" ? "#2a7f62" : "#b0302b";
}

function buildElements(graph, frameNodes) {
  const byId = new Map(frameNodes.map((n) => [n.id, n]));
  const nodeEls = graph.nodes.map((node) => {
    const current = byId.get(node.id) ?? node;
    return {
      data: {
        id: node.id,
        opinion: current.opinion,
        threshold: current.threshold,
      },
    };
  });

  const edgeEls = graph.edges.map((edge, idx) => ({
    data: {
      id: `e${idx}`,
      source: edge.source,
      target: edge.target,
      type: edge.type,
    },
  }));

  return [...nodeEls, ...edgeEls];
}

function setFrame(step) {
  if (!runResult) return;
  const frame = runResult.frames[step];
  if (!frame) return;

  const byId = new Map(frame.nodes.map((n) => [n.id, n]));
  cy.nodes().forEach((n) => {
    const state = byId.get(n.id());
    if (!state) return;
    n.data("opinion", state.opinion);
  });

  cy.style()
    .selector("node")
    .style({
      "background-color": (ele) => styleForOpinion(ele.data("opinion")),
      label: "",
      width: 18,
      height: 18,
    })
    .selector("edge")
    .style({
      width: 1.5,
      "line-color": (ele) => edgeColor(ele.data("type")),
      opacity: 0.6,
    })
    .update();

  frameLabelEl.textContent = String(step);

  const counts = {};
  for (const n of frame.nodes) {
    counts[n.opinion] = (counts[n.opinion] ?? 0) + 1;
  }

  let changedSincePrevious = 0;
  if (step > 0) {
    const prev = runResult.frames[step - 1];
    const prevById = new Map(prev.nodes.map((n) => [n.id, n]));
    for (const node of frame.nodes) {
      const old = prevById.get(node.id);
      if (old && old.opinion !== node.opinion) {
        changedSincePrevious += 1;
      }
    }
  }

  statsEl.textContent = JSON.stringify(
    {
      step,
      nodeCount: frame.nodes.length,
      edgeCount: runResult.graph.edges.length,
      opinionCounts: counts,
      changedSincePrevious,
      model: runResult.ngl.config.model,
      mode: runResult.orl.config.mode,
    },
    null,
    2
  );
}

function initGraph(result) {
  const elements = buildElements(result.graph, result.frames[0].nodes);
  cy = cytoscape({
    container: document.getElementById("cy"),
    elements,
    layout: { name: "cose", animate: true, animationDuration: 500 },
  });

  setFrame(0);
}

async function createNetwork() {
  runEl.disabled = true;
  newNetworkEl.disabled = true;
  newNetworkEl.textContent = "Building...";

  try {
    const response = await fetch("/sim/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ngl: nglEl.value,
        orl: orlEl.value,
        steps: 0,
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error ?? "Simulation failed");
    }

    runResult = {
      ...data,
      frames: [data.frames[0]],
    };

    frameEl.min = "0";
    frameEl.max = "0";
    frameEl.value = "0";

    if (cy) cy.destroy();
    initGraph(runResult);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statsEl.textContent = `Error: ${msg}`;
  } finally {
    newNetworkEl.disabled = false;
    newNetworkEl.textContent = "New Network";
    runEl.disabled = false;
  }
}

function currentGraphState() {
  if (!runResult || !runResult.frames.length) return null;
  const frame = runResult.frames[Number(frameEl.value)] ?? runResult.frames[runResult.frames.length - 1];
  return {
    nodes: frame.nodes,
    edges: runResult.graph.edges,
  };
}

async function runSimulation() {
  runEl.disabled = true;
  newNetworkEl.disabled = true;
  runEl.textContent = "Evolving...";

  try {
    if (!runResult) {
      await createNetwork();
    }

    const graph = currentGraphState();
    if (!graph) {
      throw new Error("No network loaded. Click New Network first.");
    }

    const response = await fetch("/sim/evolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        graph,
        orl: orlEl.value,
        steps: Number(stepsEl.value),
      }),
    });

    const data = await response.json();
    if (response.status === 404) {
      throw new Error("Evolve endpoint not found. Restart the server so latest routes are loaded.");
    }
    if (!response.ok || !data.ok) {
      throw new Error(data.error ?? "Simulation failed");
    }

    const currentStep = runResult.frames.length - 1;
    const appended = data.frames.slice(1).map((frame, idx) => ({
      ...frame,
      step: currentStep + idx + 1,
    }));

    runResult = {
      ...runResult,
      orl: data.orl,
      frames: [...runResult.frames, ...appended],
      graph: {
        ...runResult.graph,
        nodes: graph.nodes,
      },
    };

    frameEl.max = String(runResult.frames.length - 1);
    frameEl.value = frameEl.max;
    setFrame(Number(frameEl.value));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statsEl.textContent = `Error: ${msg}`;
  } finally {
    runEl.disabled = false;
    newNetworkEl.disabled = false;
    runEl.textContent = "Evolve";
  }
}

runEl.addEventListener("click", runSimulation);
newNetworkEl.addEventListener("click", createNetwork);
frameEl.addEventListener("input", () => {
  setFrame(Number(frameEl.value));
});

applyScenarioPreset();
createNetwork();
