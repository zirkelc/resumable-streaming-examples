import { RedisMemoryServer } from "redis-memory-server";

let redisServer: RedisMemoryServer | null = null;

/** Start Redis memory server and return connection details */
export async function startRedis(): Promise<{ host: string; port: number }> {

  if (!redisServer) {
    console.log(`[redis] Starting Redis memory server...`);
    redisServer = new RedisMemoryServer();

    const host = await redisServer.getHost();
    const port = await redisServer.getPort();

    console.log(`[redis] Redis running at ${host}:${port}`);
  }

  const host = await redisServer.getHost();
  const port = await redisServer.getPort();

  return { host, port };
}

/** Stop Redis server */
export async function stopRedis(): Promise<void> {
  if (redisServer) {
    await redisServer.stop();
    redisServer = null;
  }
  console.log(`[redis] Stopped`);
}
