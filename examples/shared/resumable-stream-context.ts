import { createResumableStreamContext } from 'resumable-stream';
import { createClient } from 'redis';
import { streamText, JsonToSseTransformStream, parseJsonEventStream, uiMessageChunkSchema, UIMessageChunk, AsyncIterableStream } from 'ai';
import { createAsyncIterableStream } from 'ai-stream-utils/utils';
import chalk from 'chalk';

type CreateResumableContext = {
  activeStreamId: string;
};

export async function createResumableContext({ activeStreamId }: CreateResumableContext) {
  const publisher = createClient({ url: process.env.REDIS_URL });
  const subscriber = createClient({ url: process.env.REDIS_URL });
  await Promise.all([publisher.connect(), subscriber.connect()]);

  const context = createResumableStreamContext({
    waitUntil: null,
    publisher,
    subscriber,
  });

  async function startStream(stream: ReadableStream<UIMessageChunk>): Promise<AsyncIterableStream<UIMessageChunk>> {
    const [clientStream, resumableStream] = stream.tee();

    const sseStream = resumableStream.pipeThrough(new JsonToSseTransformStream());

    await context.createNewResumableStream(activeStreamId, () => sseStream);

    return createAsyncIterableStream(clientStream);
  }

  async function resumeStream(): Promise<AsyncIterableStream<UIMessageChunk> | null> {
    const resumedStream = await context.resumeExistingStream(activeStreamId);
    if (!resumedStream) return null;

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

    return createAsyncIterableStream(chunkStream);
  }

  return { startStream, resumeStream };
}
