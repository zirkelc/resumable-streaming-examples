import {
  streamText,
  UIMessageChunk,
} from "ai";
import { createAsyncIterableStream } from "ai-stream-utils/utils";
import { z } from "zod";
import { publicProcedure, router } from "./trpc";
import { createResumableStream } from "./resumable-stream";
import { createMockModel } from "../../../shared/mock-model";
import chalk from "chalk";

const chatInput = z.object({ chatId: z.string() });

const MOCK_RESPONSE = `Once upon a time there was a token that got separated from the rest of its sentence when someone hit the stop button mid-stream. For days it wandered the Redis channels alone, wondering if it would ever be resumed. Then one glorious afternoon a client reconnected, and the token finally found its way back home to finish the thought it started.`;

const model = createMockModel(MOCK_RESPONSE, {
  chunkDelayInMs: 250,
});

export const appRouter = router({
  startStream: publicProcedure
    .input(chatInput)
    .mutation(async function* ({ input }): AsyncGenerator<UIMessageChunk> {
      console.log(chalk.magenta(`[server/start-stream]  Starting stream with ID=${input.chatId}`));

      const abortController = new AbortController();
      const streamContext = await createResumableStream({
        activeStreamId: input.chatId,
        abortController,
      });

      const result = streamText({
        model,
        prompt: `Hello world!`,
        abortSignal: abortController.signal,
        onChunk: ({ chunk }) => {
          if (chunk.type === `text-delta`) {
            console.log(chalk.magenta(`[server/start-stream]  UI chunk: ${chunk.text}`));
          }
        },
        onFinish: () => {
          console.log(chalk.magenta(`[server/start-stream]  Stream finished`));
        },
        onAbort: () => {
          console.log(chalk.magenta(`[server/start-stream]  Stream aborted`));
        }
      });

      const uiStream = result.toUIMessageStream();
      const stream = await streamContext.startStream(uiStream);

      yield* createAsyncIterableStream(stream);
    }),

  resumeStream: publicProcedure
    .input(chatInput)
    .mutation(async function* ({ input }): AsyncGenerator<UIMessageChunk> {
      console.log(chalk.cyan(`[server/resume-stream] Resuming stream with ID=${input.chatId}`));

      const streamContext = await createResumableStream({ activeStreamId: input.chatId });
      const stream = await streamContext.resumeStream();

      if (!stream) {
        console.log(chalk.cyan(`[server/resume-stream] No active stream found`));
        return;
      }

      yield* createAsyncIterableStream(stream);
    }),

  stopStream: publicProcedure
    .input(chatInput)
    .mutation(async ({ input }) => {
      console.log(chalk.red(`[server/stop-stream] Stop requested for ID=${input.chatId}`));

      const streamContext = await createResumableStream({ activeStreamId: input.chatId });
      await streamContext.stopStream();

      console.log(chalk.red(`[server/stop-stream] Stop published`));
      return { success: true };
    }),
});

export type AppRouter = typeof appRouter;
