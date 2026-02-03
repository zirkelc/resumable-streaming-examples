import { createResumableStreamContext } from "resumable-stream";
import { createClient } from "redis";
import { startRedis } from "./redis";

export async function createStreamContext() {
    const { host, port } = await startRedis();
  const redisUrl = `redis://${host}:${port}`;

    /** Create separate publisher and subscriber clients */
    const publisher = createClient({ url: redisUrl });
    const subscriber = createClient({ url: redisUrl });

    await publisher.connect();
    await subscriber.connect();

    const streamContext = createResumableStreamContext({
      waitUntil: null,
      publisher,
      subscriber,
    });


  return streamContext;
}
