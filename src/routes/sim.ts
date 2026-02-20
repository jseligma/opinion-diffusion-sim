import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildGraph, runSimulation } from "../sim/engine.js";
import { parseNgl } from "../sim/ngl.js";
import { parseOrl } from "../sim/orl.js";
import type { EdgeState, Graph, NodeState } from "../sim/types.js";

const validateSchema = z.object({
  source: z.string().min(1),
});

const runSchema = z.object({
  ngl: z.string().min(1),
  orl: z.string().min(1),
  steps: z.number().int().min(0).max(1000),
  seed: z.number().int().min(0).optional(),
});

const nodeSchema = z.object({
  id: z.string().min(1),
  opinion: z.string().min(1),
  threshold: z.number(),
});

const edgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.enum(["positive", "negative"]),
});

const evolveSchema = z.object({
  graph: z.object({
    nodes: z.array(nodeSchema),
    edges: z.array(edgeSchema),
  }),
  orl: z.string().min(1),
  steps: z.number().int().min(1).max(1000),
  seed: z.number().int().min(0).optional(),
});

export async function registerSimRoutes(app: FastifyInstance): Promise<void> {
  app.post("/sim/ngl/validate", async (req, reply) => {
    const parsedBody = validateSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsedBody.error.flatten() });
    }

    try {
      const parsed = parseNgl(parsedBody.data.source);
      return reply.send({ ok: true, ast: parsed.ast, config: parsed.config });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/sim/orl/validate", async (req, reply) => {
    const parsedBody = validateSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsedBody.error.flatten() });
    }

    try {
      const parsed = parseOrl(parsedBody.data.source);
      return reply.send({ ok: true, ast: parsed.ast, config: parsed.config });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/sim/run", async (req, reply) => {
    const parsedBody = runSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsedBody.error.flatten() });
    }

    try {
      const nglParsed = parseNgl(parsedBody.data.ngl);
      const orlParsed = parseOrl(parsedBody.data.orl);
      const graph = buildGraph(nglParsed.config, parsedBody.data.seed ?? nglParsed.config.seed ?? 1);
      const result = runSimulation(graph, orlParsed, parsedBody.data.steps, parsedBody.data.seed ?? nglParsed.config.seed ?? 1);
      return reply.send({
        ok: true,
        ngl: nglParsed,
        orl: orlParsed,
        graph,
        ...result,
      });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: (err as Error).message });
    }
  });

  app.post("/sim/evolve", async (req, reply) => {
    const parsedBody = evolveSchema.safeParse(req.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: "Invalid request body", details: parsedBody.error.flatten() });
    }

    try {
      const orlParsed = parseOrl(parsedBody.data.orl);
      const graph: Graph = {
        nodes: parsedBody.data.graph.nodes as NodeState[],
        edges: parsedBody.data.graph.edges as EdgeState[],
      };
      const result = runSimulation(graph, orlParsed, parsedBody.data.steps, parsedBody.data.seed ?? 1);
      return reply.send({
        ok: true,
        orl: orlParsed,
        graph,
        ...result,
      });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: (err as Error).message });
    }
  });
}
