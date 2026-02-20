# Opinion Diffusion Simulator: DSL + Prototype Design

This document defines:
1. `ORL` (Opinion Rule Language): rules for opinion updates.
2. `NGL` (Network Generation Language): exact and stochastic graph creation.
3. A practical V1 implementation plan for this TypeScript codebase.

## 1) ORL: Opinion Rule Language

### 1.1 Goals

- Express threshold rules, including signed relationships.
- Support deterministic and probabilistic updates.
- Support synchronous and asynchronous simulation.
- Keep syntax compact enough for a UI rule editor.

### 1.2 Data model assumptions

- Each node has:
  - `opinion` (enum/string)
  - optional numeric attributes (for example `threshold`)
  - optional boolean flags (for example `stubborn`)
- Each edge has:
  - `type` (for example `positive`, `negative`)
  - optional `weight`

### 1.3 ORL EBNF

```ebnf
program         = { declaration } "update" ":" update_block ;

declaration     = state_decl | param_decl | let_decl | mode_decl | option_decl ;

state_decl      = "state" ident "in" "{" literal_list "}" ;
param_decl      = "param" ident ":" type [ "in" range ] [ "=" expr ] ;
let_decl        = "let" ident "=" expr ;
mode_decl       = "mode" "=" ( "sync" | "async" ) ;
option_decl     = "option" ident "=" literal ;

update_block    = stmt { stmt } ;
stmt            = if_stmt | assign_stmt | keep_stmt | probabilistic_stmt ;

if_stmt         = "if" expr "then" stmt [ "else" stmt ] ;
assign_stmt     = "self" "." ident ":=" expr ;
keep_stmt       = "keep" ;
probabilistic_stmt
                = "with" "prob" expr "then" stmt [ "else" stmt ] ;

expr            = or_expr ;
or_expr         = and_expr { "or" and_expr } ;
and_expr        = cmp_expr { "and" cmp_expr } ;
cmp_expr        = add_expr [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) add_expr ] ;
add_expr        = mul_expr { ( "+" | "-" ) mul_expr } ;
mul_expr        = unary_expr { ( "*" | "/" ) unary_expr } ;
unary_expr      = [ "not" | "-" ] primary ;

primary         = number
                | string
                | boolean
                | ident
                | "self" "." ident
                | "neighbor" "." ident
                | function_call
                | "(" expr ")" ;

function_call   = ident "(" [ argument_list ] ")" ;
argument_list   = expr { "," expr } ;

literal_list    = literal { "," literal } ;
literal         = number | string | boolean ;
range           = "[" number "," number "]" ;

type            = "float" | "int" | "bool" | "string" ;

ident           = letter { letter | digit | "_" } ;
number          = digit { digit } [ "." digit { digit } ] ;
string          = "\"" { char } "\"" ;
boolean         = "true" | "false" ;
```

### 1.4 Built-ins

- Neighbor aggregation:
  - `count(neighbors(<predicate>))`
  - `sum(neighbors(<predicate>), <value_expr>)`
  - `mean(neighbors(<predicate>), <value_expr>)`
- Utility:
  - `max(a,b)`, `min(a,b)`, `clamp(x,a,b)`
  - `rand()` in `[0,1)`
  - `argmax(opinions(), score_expr)`

### 1.5 Example: signed threshold update

```orl
state opinion in {"X","notX"}
param threshold: float in [0,10]
mode = sync

let posX    = count(neighbors(edge.type=="positive" and neighbor.opinion=="X"))
let negNotX = count(neighbors(edge.type=="negative" and neighbor.opinion!="X"))
let negX    = count(neighbors(edge.type=="negative" and neighbor.opinion=="X"))
let posNotX = count(neighbors(edge.type=="positive" and neighbor.opinion!="X"))

let score = (posX + negNotX) / max(1, (negX + posNotX))

update:
  if score > self.threshold then self.opinion := "X" else keep
```

## 2) NGL: Network Generation Language

### 2.1 Goals

- Allow exact hand-authored graphs.
- Allow stochastic generation from standard social-network models.
- Assign node and edge attributes from distributions and rules.

### 2.2 NGL EBNF

```ebnf
network_program = { network_stmt } ;

network_stmt    = node_stmt
                | edge_stmt
                | model_stmt
                | attr_stmt
                | sign_stmt
                | seed_stmt ;

seed_stmt       = "seed" number ;

node_stmt       = "nodes" number
                | "node" ident [ "{" kv_list "}" ] ;

edge_stmt       = "edge" ident ident [ "{" kv_list "}" ] ;

model_stmt      = "model" model_kind "{" model_body "}" ;
model_kind      = "ER" | "WS" | "BA" | "SBM" | "CONFIG" | "GEO" ;

model_body      = { model_assign } ;
model_assign    = ident "=" value ;

attr_stmt       = "node_attr" ident "~" distribution
                | "edge_attr" ident "~" distribution
                | "node_attr" ident "=" expr
                | "edge_attr" ident "=" expr ;

sign_stmt       = "edge_sign" ":" rule_list ;
rule_list       = rule { rule } ;
rule            = ("positive" | "negative" | ident) "with" "prob" expr [ "if" expr ] ;

distribution    = ident "(" [ argument_list ] ")" ;
argument_list   = value { "," value } ;

kv_list         = kv { "," kv } ;
kv              = ident ":" value ;

value           = number | string | boolean | array | matrix | expr ;
array           = "[" [ value { "," value } ] "]" ;
matrix          = "[" array { "," array } "]" ;

expr            = or_expr ;
or_expr         = and_expr { "or" and_expr } ;
and_expr        = cmp_expr { "and" cmp_expr } ;
cmp_expr        = add_expr [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) add_expr ] ;
add_expr        = mul_expr { ( "+" | "-" ) mul_expr } ;
mul_expr        = unary_expr { ( "*" | "/" ) unary_expr } ;
unary_expr      = [ "not" | "-" ] primary ;
primary         = number | string | boolean | ident | function_call | "(" expr ")" ;
function_call   = ident "(" [ argument_list ] ")" ;
```

### 2.3 Supported canonical models

- `ER`: Erdos-Renyi (`n`, `p`)
- `WS`: Watts-Strogatz (`n`, `k`, `beta`)
- `BA`: Barabasi-Albert (`n`, `m`)
- `SBM`: Stochastic block model (`blocks`, `P`)
- `CONFIG`: Configuration model (`degree_sequence`)
- `GEO`: Random geometric (`n`, `radius`, optional dimensions)

### 2.4 Example: 20-node SBM with signed edges

```ngl
seed 7
nodes 20

model SBM {
  blocks = [8, 7, 5]
  P = [[0.35,0.05,0.02],
       [0.05,0.30,0.04],
       [0.02,0.04,0.25]]
}

node_attr threshold ~ Beta(2,5)
node_attr opinion ~ Categorical({"X":0.4,"notX":0.6})

edge_sign:
  positive with prob 0.8 if same_block(u,v)
  positive with prob 0.3 if not same_block(u,v)
  negative with prob 1.0
```

## 3) Runtime semantics

- Input bundle:
  - one `NGL` document
  - one `ORL` document
  - optional run config (`steps`, random `seed`, update ordering)
- Compile pipeline:
  1. Parse `NGL` and build graph + attributes.
  2. Parse `ORL` and compile to a safe evaluator (AST interpreter).
  3. Execute simulation step loop.
- Step behavior:
  - `sync`: compute all next states from current snapshot, then commit.
  - `async`: iterate nodes in chosen order, committing each update immediately.

## 4) V1 implementation plan (TypeScript)

### 4.1 Architecture

- `src/sim/types.ts`
  - `NodeState`, `EdgeState`, `Graph`, `SimulationConfig`, `SimulationFrame`
- `src/sim/ngl/lexer.ts`, `src/sim/ngl/parser.ts`, `src/sim/ngl/eval.ts`
- `src/sim/orl/lexer.ts`, `src/sim/orl/parser.ts`, `src/sim/orl/eval.ts`
- `src/sim/engine.ts`
  - `buildGraph(nglAst, seed)`
  - `compileRule(orlAst)`
  - `runSimulation(graph, rule, steps, mode)`
- `src/routes-sim.ts`
  - API endpoints for parse, run, and replay frames.
- `web/sim.html`, `web/sim.js`, small additions to `web/app.css`
  - interactive editor, generator form, timeline, graph playback.

### 4.2 API contract (v1)

- `POST /sim/ngl/validate`
  - body: `{ source: string }`
  - returns: AST summary or parse errors.
- `POST /sim/orl/validate`
  - body: `{ source: string }`
  - returns: AST summary or parse errors.
- `POST /sim/run`
  - body: `{ ngl: string, orl: string, steps: number, seed?: number }`
  - returns: `{ frames: SimulationFrame[], stats: {...} }`

### 4.3 UI requirements (v1)

- Left panel:
  - `NGL` editor + presets (ER/WS/BA/SBM).
  - `ORL` editor + preset threshold rules.
- Center:
  - force-directed graph visualization.
  - node color by `opinion`, edge color/style by sign/type.
- Bottom:
  - step slider and play/pause.
  - summary metrics per frame (opinion counts, polarization index, component stats).

Suggested libraries:
- `cytoscape` for rendering and interaction.
- custom parser/evaluator first (small grammar), optionally migrate to parser generator later.

### 4.4 Security and determinism

- Never execute user DSL as JavaScript.
- Evaluate through explicit AST interpreter.
- Seeded RNG for reproducible runs.
- Hard caps in v1:
  - max nodes: 2,000
  - max steps: 1,000
  - max expression depth and evaluation cost per step

### 4.5 Testing plan

- Parser tests:
  - valid/invalid syntax fixtures for both DSLs.
- Semantic tests:
  - divide-by-zero handling, missing attributes, undefined identifiers.
- Model tests:
  - ER expected edge density, BA heavy-tail tendency, SBM block densities.
- Engine tests:
  - sync vs async regression on fixed seeds.
- UI smoke:
  - load preset, run 20 steps, timeline playback.

## 5) Milestones

1. Parsing + AST for both DSLs.
2. Graph generators for ER/WS/BA/SBM + exact graph mode.
3. Rule evaluator + simulation engine.
4. `/sim/run` endpoint + frame output.
5. Browser UI with playback and metrics.
6. Add remaining models (`CONFIG`, `GEO`) and advanced ORL operators.

