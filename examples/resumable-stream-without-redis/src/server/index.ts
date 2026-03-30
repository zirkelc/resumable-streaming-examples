import { createHTTPServer } from "@trpc/server/adapters/standalone";
import cors from "cors";
import { appRouter } from "./router";

/** Import DB to trigger table creation */
import "./db/index";

const PORT = 3002;

async function main() {
  /** Create tRPC HTTP server */
  const server = createHTTPServer({
    middleware: cors(),
    router: appRouter,
  });

  server.listen(PORT);
  console.log(`[server] tRPC server listening on http://localhost:${PORT}`);

  /** Handle graceful shutdown */
  const shutdown = () => {
    console.log(`\n[server] Shutting down...`);
    server.close();
    process.exit(0);
  };

  process.on(`SIGINT`, shutdown);
  process.on(`SIGTERM`, shutdown);
}

main().catch((error) => {
  console.error(`[server] Failed to start:`, error);
  process.exit(1);
});
