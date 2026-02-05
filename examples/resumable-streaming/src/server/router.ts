import {
  streamText,
  UIMessageChunk,
} from "ai";
import { publicProcedure, router } from "./trpc";
import { createResumableContext } from "../../../shared/resumable-stream-context";
import { createMockModel } from "../../../shared/mock-model";
import chalk from "chalk";

/** Hardcoded stream ID for demo */
const STREAM_ID = `demo-stream`;

const MOCK_RESPONSE = `This is a very long message that will take a while to stream so we can test the interrupt and resume functionality properly and see if everything works as expected`;

export const appRouter = router({
  startStream: publicProcedure.mutation(async function* (): AsyncGenerator<UIMessageChunk> {
    console.log(chalk.magenta(`[server/start-stream]  Starting stream with ID=${STREAM_ID}`));

    const model = createMockModel(MOCK_RESPONSE, {
      chunkDelayInMs: 500
    });

    const result = streamText({
      model,
      prompt: `Simulated prompt`,
      onChunk: ({ chunk }) => {
        if (chunk.type === `text-delta`) {
          console.log(chalk.magenta(`[server/start-stream]  UI chunk: ${chunk.text}`));
        }
      },
      onFinish: () => {
        console.log(chalk.magenta(`[server/start-stream]  Stream finished`));
      }
    });

    const streamContext = await createResumableContext({ activeStreamId: STREAM_ID });
    const uiStream = await streamContext.startStream(result.toUIMessageStream());

    yield* uiStream;
  }),

  resumeStream: publicProcedure.mutation(async function* (): AsyncGenerator<UIMessageChunk> {
    console.log(chalk.cyan(`[server/resume-stream] Resuming stream with ID=${STREAM_ID}`));

    const streamContext = await createResumableContext({ activeStreamId: STREAM_ID });
    const resumedStream = await streamContext.resumeStream();

    if (!resumedStream) {
      console.log(chalk.cyan(`[server/resume-stream] No active stream found`));
      return;
    }

    yield* resumedStream;
  }),
});

export type AppRouter = typeof appRouter;
