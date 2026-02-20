import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";

const WEB_DIR = path.resolve(process.cwd(), "web");
const DOCS_DIR = path.resolve(process.cwd(), "docs");

async function sendFile(reply: { type: (v: string) => { send: (body: string) => void } }, fileName: string, contentType: string): Promise<void> {
  const filePath = path.join(WEB_DIR, fileName);
  const body = await readFile(filePath, "utf8");
  reply.type(contentType).send(body);
}

async function sendBinary(reply: { type: (v: string) => { send: (body: Buffer) => void } }, filePath: string, contentType: string): Promise<void> {
  const body = await readFile(filePath);
  reply.type(contentType).send(body);
}

export async function registerUiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_req, reply) => {
    await sendFile(reply, "index.html", "text/html; charset=utf-8");
  });

  app.get("/sim", async (_req, reply) => {
    await sendFile(reply, "sim.html", "text/html; charset=utf-8");
  });

  app.get("/play/:scenario", async (_req, reply) => {
    await sendFile(reply, "sim.html", "text/html; charset=utf-8");
  });

  app.get("/sim.js", async (_req, reply) => {
    await sendFile(reply, "sim.js", "application/javascript; charset=utf-8");
  });

  app.get("/sim.css", async (_req, reply) => {
    await sendFile(reply, "sim.css", "text/css; charset=utf-8");
  });

  app.get("/site.css", async (_req, reply) => {
    await sendFile(reply, "site.css", "text/css; charset=utf-8");
  });

  app.get("/docs/:name", async (req, reply) => {
    const fileName = String((req.params as { name?: string }).name ?? "");
    if (!/^[A-Za-z0-9_.-]+$/.test(fileName)) {
      return reply.status(400).send({ error: "Invalid file name" });
    }
    const fullPath = path.join(DOCS_DIR, fileName);
    const ext = path.extname(fileName).toLowerCase();
    const contentType = ext === ".pdf" ? "application/pdf" : "text/plain; charset=utf-8";
    await sendBinary(reply, fullPath, contentType);
  });
}
