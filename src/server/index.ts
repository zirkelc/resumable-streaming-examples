import cors from 'cors';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { appRouter } from './router';

const server = createHTTPServer({
  router: appRouter,
  createContext: () => ({}),
  middleware: cors(),
});

server.listen(3000);
console.log(`tRPC server listening on http://localhost:3000`);
