import Fastify from "fastify";
import { registerSimRoutes } from "./routes/sim.js";
import { registerUiRoutes } from "./routes/ui.js";

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ ok: true }));
  await registerSimRoutes(app);
  await registerUiRoutes(app);

  const host = process.env.HOST ?? "0.0.0.0";
  const port = Number(process.env.PORT ?? 4000);
  await app.listen({ host, port });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
