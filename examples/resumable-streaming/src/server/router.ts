import {
  streamText,
  JsonToSseTransformStream,
  parseJsonEventStream,
  uiMessageChunkSchema,
  UIMessageChunk,
} from "ai";
import { publicProcedure, router } from "./trpc";
import { createStreamContext } from "../../../shared/stream-context";
import { createAsyncIterableStream } from "ai-stream-utils/utils";
import { createMockModel } from "../../../shared/mock-model";
import chalk from "chalk";

/** Hardcoded stream ID for demo */
const STREAM_ID = `demo-stream`;

const MOCK_RESPONSE = `This is a very long message that will take a while to stream so we can test the interrupt and resume functionality properly and see if everything works as expected`;

export const appRouter = router({
  startStream: publicProcedure.mutation(async function* (): AsyncGenerator<UIMessageChunk> {
    console.log(chalk.magenta(`[server/start-stream]  Starting stream with ID=${STREAM_ID}`));

    const streamContext = await createStreamContext();
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

    const uiStream = result.toUIMessageStream();
    const [trpcStream, redisStream] = uiStream.tee();

    const sseStream = redisStream.pipeThrough(new JsonToSseTransformStream());

    await streamContext.createNewResumableStream(STREAM_ID, () => sseStream);

    yield* createAsyncIterableStream(trpcStream);
  }),

  resumeStream: publicProcedure.mutation(async function* (): AsyncGenerator<UIMessageChunk> {
    console.log(chalk.cyan(`[server/resume-stream] Resuming stream with ID=${STREAM_ID}`));

    const streamContext = await createStreamContext();
    const resumedStream = await streamContext.resumeExistingStream(STREAM_ID);

    if (!resumedStream) {
      console.log(chalk.cyan(`[server/resume-stream] No active stream found`));
      return;
    }

    const chunkStream = parseJsonEventStream({
      stream: resumedStream.pipeThrough(new TextEncoderStream()),
      schema: uiMessageChunkSchema,
    }).pipeThrough(
      new TransformStream({
        transform(result, controller) {
          if (result.success) {
            const chunk = result.value;
            if (chunk.type === `text-delta`) {
              console.log(chalk.cyan(`[server/resume-stream] UI chunk: ${chunk.delta}`));
            }
            controller.enqueue(chunk);
          }
        },
        flush() {
          console.log(chalk.cyan(`[server/resume-stream] Stream finished`));
        }
      }),
    );

    yield* createAsyncIterableStream(chunkStream);
  }),
});

export type AppRouter = typeof appRouter;
