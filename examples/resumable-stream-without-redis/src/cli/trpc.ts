import { createTRPCClient, httpBatchStreamLink } from "@trpc/client";
import type { AppRouter } from "../server/router";

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchStreamLink({
      url: `http://localhost:3002`,
    }),
  ],
});
