import { streamText, uiMessageChunkSchema, type UIMessageChunk } from "ai";
import { parseJSON } from "@ai-sdk/provider-utils";
import chalk from "chalk";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import throttle from "throttleit";
import { createMockModel } from "../../../shared/mock-model";
import { db } from "./db/index";
import { chunks, messages } from "./db/schema";
import { publicProcedure, router } from "./trpc";

/** Hardcoded IDs for demo */
const MESSAGE_ID = `demo-message`;
const STREAM_ID = `demo-stream`;

const CANCEL_INTERVAL_MS = 1_000;
const FLUSH_INTERVAL_MS = 2_000;
const POLL_INTERVAL_MS = 1_000;

const MOCK_RESPONSE = `This is a very long message that will take a while to stream so we can test the interrupt and resume functionality properly and see if everything works as expected`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const appRouter = router({
  startStream: publicProcedure.mutation(async function* (): AsyncGenerator<UIMessageChunk> {
    console.log(chalk.magenta(`[server/start-stream] Starting stream`));

    /** Insert message metadata row */
    await db.insert(messages).values({
      id: MESSAGE_ID,
      activeStreamId: STREAM_ID,
    });

    const abortController = new AbortController();

    /** Throttled cancellation check — polls DB every 1s */
    const checkCancelled = throttle(async () => {
      const [message] = await db.select({ cancelledAt: messages.cancelledAt })
        .from(messages)
        .where(and(eq(messages.id, MESSAGE_ID), isNotNull(messages.cancelledAt)));

      if (message) {
        console.log(chalk.red(`[server/start-stream] Cancellation detected, aborting`));
        abortController.abort();
      }
    }, CANCEL_INTERVAL_MS);

    const model = createMockModel(MOCK_RESPONSE, {
      chunkDelayInMs: 500,
    });

    const result = streamText({
      model,
      prompt: `Simulated prompt`,
      abortSignal: abortController.signal,
      onFinish: async ({ text }) => {
        await db.update(messages)
          .set({ content: text, activeStreamId: null })
          .where(eq(messages.id, MESSAGE_ID));

        console.log(chalk.yellow(`[server/start-stream] Saved finished message`));
      },
    });

    /** Buffer chunks and flush to DB in throttled batches */
    let buffer: Array<UIMessageChunk> = [];

    const throttledFlush = throttle(async () => {
      if (buffer.length === 0) return;

      const flushChunks = buffer;
      buffer = [];

      await db.insert(chunks).values(
        flushChunks.map((chunk) => ({
          streamId: STREAM_ID,
          data: JSON.stringify(chunk),
        })),
      );

      console.log(chalk.yellow(`[server/start-stream] Flushed ${flushChunks.length} chunks to DB`));
    }, FLUSH_INTERVAL_MS);

    for await (const chunk of result.toUIMessageStream()) {
      buffer.push(chunk);
      checkCancelled();
      throttledFlush();
      yield chunk;
    }
  }),

  resumeStream: publicProcedure.mutation(async function* (): AsyncGenerator<UIMessageChunk> {
    console.log(chalk.cyan(`[server/resume-stream] Resuming stream`));

    const [message] = await db.select().from(messages).where(eq(messages.id, MESSAGE_ID));

    if (!message || !message.activeStreamId) {
      console.log(chalk.cyan(`[server/resume-stream] No active stream found`));
      return;
    }

    const streamId = message.activeStreamId;

    /** Replay existing chunks */
    const existingChunks = await db.select()
      .from(chunks)
      .where(eq(chunks.streamId, streamId))
      .orderBy(chunks.id);

    let lastId = 0;

    for (const row of existingChunks) {
      const chunk = await parseJSON({ text: row.data, schema: uiMessageChunkSchema });
      yield chunk;
      lastId = row.id;
    }

    console.log(chalk.cyan(`[server/resume-stream] Replayed ${existingChunks.length} chunks`));

    /** Poll for new chunks while stream is active */
    while (true) {
      await delay(POLL_INTERVAL_MS);

      /** Query new chunks first */
      const newChunks = await db.select()
        .from(chunks)
        .where(and(
          eq(chunks.streamId, streamId),
          gt(chunks.id, lastId),
        ))
        .orderBy(chunks.id);

      for (const row of newChunks) {
        const chunk = await parseJSON({ text: row.data, schema: uiMessageChunkSchema });
        yield chunk;
        lastId = row.id;
      }

      /** Check if stream is still active */
      const [current] = await db.select().from(messages).where(eq(messages.id, MESSAGE_ID));

      if (!current || !current.activeStreamId || current.cancelledAt) {
        console.log(chalk.cyan(`[server/resume-stream] Stream no longer active, stopping poll`));
        break;
      }
    }
  }),

  stopStream: publicProcedure.mutation(async () => {
    console.log(chalk.red(`[server/stop-stream] Stop requested`));

    await db.update(messages)
      .set({ cancelledAt: Date.now() })
      .where(eq(messages.id, MESSAGE_ID));

    console.log(chalk.red(`[server/stop-stream] Stream cancelled`));
    return { success: true };
  }),
});

export type AppRouter = typeof appRouter;
