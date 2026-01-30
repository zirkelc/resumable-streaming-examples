import { createResumableStreamContext } from "resumable-stream";
import { createClient } from "redis";
import { startRedis } from "./redis";

let streamContext: ReturnType<typeof createResumableStreamContext> | null = null;

/** Get or create the resumable stream context */
export async function getStreamContext() {
  if (!streamContext) {
    const { host, port } = await startRedis();
    const redisUrl = `redis://${host}:${port}`;
    // const redisUrl = `rediss://default:AWw-AAIncDExOGIwMjgxODc0ZTI0OTk4OWYwY2VkYzMzMWE5ZTQxMXAxMjc3MTA@sought-ibex-27710.upstash.io:6379`;

    /** Create separate publisher and subscriber clients */
    const publisher = createClient({ url: redisUrl });
    const subscriber = createClient({ url: redisUrl });

    await publisher.connect();
    await subscriber.connect();

    console.log(`[stream-context] Redis clients connected to ${redisUrl}`);

    streamContext = createResumableStreamContext({
      waitUntil: null,
      publisher,
      subscriber,
    });
  }

  return streamContext;
}
