import { createHTTPServer } from "@trpc/server/adapters/standalone";
import cors from "cors";
import { appRouter } from "./router";
import { startRedis, stopRedis } from "../../../shared/redis";

const PORT = 3002;

async function main() {
  /** Start Redis memory server first */
  await startRedis();

  /** Create tRPC HTTP server */
  const server = createHTTPServer({
    middleware: cors(),
    router: appRouter,
  });

  server.listen(PORT);
  console.log(`[server] tRPC server listening on http://localhost:${PORT}`);

  /** Handle graceful shutdown */
  const shutdown = async () => {
    console.log(`\n[server] Shutting down...`);
    server.close();
    await stopRedis();
    process.exit(0);
  };

  process.on(`SIGINT`, shutdown);
  process.on(`SIGTERM`, shutdown);
}

main().catch((error) => {
  console.error(`[server] Failed to start:`, error);
  process.exit(1);
});
