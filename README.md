# Opinion Diffusion Simulator

Standalone TypeScript project for simulating opinion diffusion over signed social networks.

## Included

- Two DSL parsers with AST output:
  - `NGL` for network creation
  - `ORL` for opinion update configuration
- Graph generators:
  - `ER` (Erdos-Renyi)
  - `WS` (Watts-Strogatz)
  - `BA` (Barabasi-Albert)
  - `SBM` (Stochastic Block Model)
- Signed-threshold dynamics engine (sync or async updates)
- Browser UI at `/sim` with graph display and frame slider playback

## Run

```bash
npm install
npm run dev
```

Server starts at `http://localhost:4000`.

## Endpoints

- `GET /health`
- `POST /sim/ngl/validate`
- `POST /sim/orl/validate`
- `POST /sim/run`
- `GET /sim` (UI)

## Minimal sample

```bash
curl -X POST http://localhost:4000/sim/run \
  -H "content-type: application/json" \
  -d '{
    "ngl": "seed 7\nnodes 40\nmodel WS {\n  k = 6\n  beta = 0.25\n}\nnode_attr threshold ~ Uniform(1,3)\nnode_attr opinion ~ Categorical({\"X\":0.5,\"notX\":0.5})\nedge_sign:\npositive with prob 0.7",
    "orl": "state opinion in {\"X\",\"notX\"}\nparam threshold: float in [0,10]\nmode = sync\nupdate:\n  if score > self.threshold then self.opinion := \"X\" else keep",
    "steps": 20
  }'
```

## Spec document

- `docs/opinion-simulation-design.md`
