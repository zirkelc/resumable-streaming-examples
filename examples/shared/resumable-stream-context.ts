import { createResumableStreamContext } from 'resumable-stream';
import { createClient } from 'redis';
import { JsonToSseTransformStream, parseJsonEventStream, uiMessageChunkSchema, UIMessageChunk, AsyncIterableStream } from 'ai';
import { createAsyncIterableStream } from 'ai-stream-utils/utils';
import chalk from 'chalk';

type CreateResumableContext = {
  activeStreamId: string;
  abortController?: AbortController;
};

export async function createResumableContext({ activeStreamId, abortController }: CreateResumableContext) {
  const publisher = createClient({ url: process.env.REDIS_URL });
  const subscriber = createClient({ url: process.env.REDIS_URL });
  await Promise.all([publisher.connect(), subscriber.connect()]);

  const context = createResumableStreamContext({
    waitUntil: null,
    publisher,
    subscriber,
  });

  const keyPrefix = `resumable-stream`;
  const stopChannel = `${keyPrefix}:rs:stop:${activeStreamId}`;

  /** Unsubscribe from stop channel */
  async function unsubscribe() {
    if (!abortController) return;
    console.log(chalk.red(`[resumable-context] Unsubscribing from stop channel`));
    await subscriber.unsubscribe(stopChannel);
  }

  /** Set up stop subscription if abortController provided */
  if (abortController) {
    await subscriber.subscribe(stopChannel, () => {
      console.log(chalk.red(`[resumable-context] Stop message received on channel=${stopChannel}`));
      abortController.abort();
    });

    /** Cleanup when abort signal fires */
    abortController.signal.addEventListener(`abort`, () => {
      unsubscribe();
    }, { once: true });
  }

  async function startStream(stream: ReadableStream<UIMessageChunk>): Promise<AsyncIterableStream<UIMessageChunk>> {
    const [clientStream, resumableStream] = stream.tee();

    const sseStream = resumableStream.pipeThrough(new JsonToSseTransformStream());

    await context.createNewResumableStream(activeStreamId, () => sseStream);

    /** Wrap stream to auto-unsubscribe on completion */
    const wrappedStream = clientStream.pipeThrough(
      new TransformStream<UIMessageChunk, UIMessageChunk>({
        transform(chunk, controller) {
          controller.enqueue(chunk);
        },
        flush() {
          unsubscribe();
        },
      }),
    );

    return createAsyncIterableStream(wrappedStream);
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

  /** Publish a stop message to the Redis stop channel */
  async function stopStream(): Promise<void> {
    console.log(chalk.red(`[resumable-context] Publishing stop to channel=${stopChannel}`));
    await publisher.publish(stopChannel, `stop`);
  }

  return { startStream, resumeStream, stopStream };
}
