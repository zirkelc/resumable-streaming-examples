import { createClient } from 'redis';
import type { UIMessageChunk } from 'ai';

/**
 * Resumable streaming over Redis.
 *
 * One producer drains the source stream once and fans the chunks out to
 * any number of consumers. A consumer that joins late asks the producer
 * for the history so far and then continues to receive every subsequent
 * chunk until the stream finishes.
 *
 * The protocol uses three Redis primitives:
 *
 *  - A sentinel key per stream that records whether the stream is
 *    currently active or already finished. Resumers check this first to
 *    decide whether catching up is even possible.
 *  - A request channel per stream. Late joiners publish their listener
 *    ID here to announce themselves to the producer.
 *  - A chunk channel per listener. The producer pushes both the initial
 *    history and the live chunks here.
 *
 * A separate stop channel lets any process abort the producer remotely.
 *
 * The chunk history is held in the producer's memory rather than in
 * Redis. This keeps the algorithm easy to follow and avoids a Redis
 * write per chunk. The trade-off: resumption only works while the
 * producer process is still running. A multi-instance setup would need
 * to persist the chunks somewhere shared (Redis list, blob store, etc.)
 * and let any instance serve a resume request.
 */

type CreateResumableContext = {
  activeStreamId: string;
  abortController?: AbortController;
};

const KEY_PREFIX = 'rsfs:rs';
const SENTINEL_TTL_SECONDS = 24 * 60 * 60;
const ACTIVE_VALUE = 'ACTIVE';
const DONE_VALUE = 'DONE';

/**
 * Marker pushed onto a chunk channel to signal end-of-stream. Listeners
 * close their reader when they see this and drop the subscription.
 */
const DONE_MESSAGE = '__DONE__';

export async function createResumableStream({ activeStreamId, abortController }: CreateResumableContext) {
  /**
   * Redis requires a dedicated connection for pub/sub subscriptions, so
   * we keep one client for publishing/key operations and a second one
   * for subscriptions. Both connect lazily here for simplicity. In a
   * long-running server you would pool these instead of opening two
   * sockets per request.
   */
  const publisher = createClient({ url: process.env.REDIS_URL });
  const subscriber = createClient({ url: process.env.REDIS_URL });
  await Promise.all([publisher.connect(), subscriber.connect()]);

  /**
   * Redis keys and pub/sub channels used by this stream.
   *
   *  - `sentinel`       — key that flips between ACTIVE and DONE so resumers
   *                       can decide whether catching up is even possible.
   *  - `requestChannel` — pubsub channel where late joiners announce
   *                       themselves with their listener ID.
   *  - `stopChannel`    — pubsub channel any process can use to abort the
   *                       producer remotely.
   *  - `chunkChannelFor(listenerId)` — per-listener pubsub channel that
   *                       carries history chunks, live chunks, and the
   *                       terminating DONE marker for one consumer.
   */
  const sentinel = `${KEY_PREFIX}:sentinel:${activeStreamId}`;
  const requestChannel = `${KEY_PREFIX}:request:${activeStreamId}`;
  const stopChannel = `${KEY_PREFIX}:stop:${activeStreamId}`;
  const chunkChannelFor = (listenerId: string) => `${KEY_PREFIX}:chunk:${listenerId}`;

  /**
   * Start a stream and serve it to the original requester as well as any
   * future consumers that ask to resume.
   *
   * The source is read exactly once by a background pump. Each chunk is
   * appended to an in-memory history buffer and broadcast to every
   * currently-attached listener. Joiners receive the full history when
   * they register, so order is preserved across consumers.
   */
  async function startStream(stream: ReadableStream<UIMessageChunk>): Promise<ReadableStream<UIMessageChunk>> {
    /** Listener IDs that are currently receiving live chunks. */
    const listenerIds = new Set<string>();
    /** Chunk history, JSON-serialized once so re-broadcast is cheap. */
    const history: Array<string> = [];
    let isDone = false;

    /** Flip the sentinel so resumers know the stream exists and is open. */
    await publisher.set(sentinel, ACTIVE_VALUE, { EX: SENTINEL_TTL_SECONDS });

    /**
     * Late joiners publish their listener ID on this channel. When that
     * happens we register them for live fan-out and replay every chunk
     * produced so far. If the source has already completed we also push
     * the done marker so the listener closes immediately.
     *
     * Order is preserved by two invariants:
     *   1. `listenerIds.add` and the history snapshot are synchronous,
     *      so the pump cannot interleave between them.
     *   2. The history publishes are queued on the publisher in one
     *      synchronous `Promise.all(map)` block (see below), so the
     *      pump's live fanout cannot land in the middle of the flush.
     */
    await subscriber.subscribe(requestChannel, async (message) => {
      const { listenerId } = JSON.parse(message) as { listenerId: string };
      const channel = chunkChannelFor(listenerId);

      listenerIds.add(listenerId);
      const replayChunks = [...history];

      /**
       * Queue every history publish on the publisher's command queue in
       * one synchronous block. Doing this via `Promise.all(replayChunks.map)`
       * (rather than awaiting each publish in a `for` loop) is what
       * preserves order: no `await` runs between the publishes, so the
       * pump's live fanout can't interleave a live chunk into the middle
       * of the history flush.
       */
      await Promise.all(replayChunks.map((chunk) => publisher.publish(channel, chunk)));
      if (isDone) {
        await publisher.publish(channel, DONE_MESSAGE);
      }
    });

    /**
     * The stop channel lets any process abort the producer remotely.
     * Aborting the controller is expected to surface as an error or an
     * early end on the source stream, which the pump below treats the
     * same as a normal completion.
     */
    if (abortController) {
      await subscriber.subscribe(stopChannel, () => {
        abortController.abort();
      });
    }

    /**
     * Split the source: one branch stays in-process for the original
     * caller so its chunks arrive without a Redis round-trip; the other
     * branch feeds the broadcast pump that serves resumers.
     *
     * Note that `tee()` buffers chunks for whichever branch reads slower,
     * so if the original caller disconnects mid-stream the abandoned
     * branch can accumulate memory until the source finishes. For a
     * production setup either cancel the abandoned branch on disconnect
     * or have every consumer (including the first) read through the
     * Redis path.
     */
    const [clientStream, producerStream] = stream.tee();

    /**
     * Background pump: drain the source and broadcast each chunk.
     *
     * Runs independently of the original caller's iteration. That is
     * what makes resumption meaningful: if the first client disconnects
     * halfway through, the source is still being consumed and the
     * history buffer keeps growing, so a resumer can pick up where the
     * first client left off.
     */
    (async () => {
      const reader = producerStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const serialized = JSON.stringify(value);
          history.push(serialized);

          /**
           * Fan out in parallel to all currently-attached listeners.
           * Awaiting here serializes the next read after this chunk has
           * reached every listener, which keeps live delivery roughly
           * in lock-step with the source rate.
           */
          await Promise.all(
            [...listenerIds].map((id) => publisher.publish(chunkChannelFor(id), serialized)),
          );
        }
      } catch {
        /**
         * Source errored or was aborted via the stop channel. Treat it
         * the same as natural completion so listeners are released.
         */
      } finally {
        reader.releaseLock();
        isDone = true;

        /**
         * Finalize: flip the sentinel so new resume attempts return
         * immediately, push the done marker to every attached listener
         * so they close cleanly, and drop our subscriptions so the
         * subscriber connection isn't holding stale channels.
         */
        await publisher.set(sentinel, DONE_VALUE, { EX: SENTINEL_TTL_SECONDS });
        await Promise.all(
          [...listenerIds].map((id) => publisher.publish(chunkChannelFor(id), DONE_MESSAGE)),
        );
        await subscriber.unsubscribe(requestChannel);
        if (abortController) await subscriber.unsubscribe(stopChannel);
      }
    })();

    return clientStream;
  }

  /**
   * Resume an in-flight stream. Returns null if no such stream is active,
   * either because it never existed or because it already finished.
   *
   * Protocol on the consumer side:
   *  1. Subscribe to our own chunk channel first, so we don't miss any
   *     message the producer may send back as a reply.
   *  2. Publish a request with our listener ID. The producer reacts by
   *     replaying the history into our channel and registering us for
   *     subsequent live chunks.
   *  3. Read chunks until the done marker arrives, then close.
   */
  async function resumeStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    const state = await publisher.get(sentinel);
    if (state === null || state === DONE_VALUE) return null;

    const listenerId = crypto.randomUUID();
    const channel = chunkChannelFor(listenerId);

    const readable = new ReadableStream<UIMessageChunk>({
      async start(controller) {
        await subscriber.subscribe(channel, async (message) => {
          if (message === DONE_MESSAGE) {
            await subscriber.unsubscribe(channel);
            try { controller.close(); } catch { /** already closed */ }
            return;
          }
          try {
            controller.enqueue(JSON.parse(message) as UIMessageChunk);
          } catch {
            /** Consumer is gone (or the message was malformed). Stop receiving. */
            await subscriber.unsubscribe(channel);
          }
        });

        /**
         * Now that the chunk channel is live, announce ourselves so the
         * producer starts pushing history and live chunks. Doing this
         * after subscribe avoids a race where the producer's reply
         * lands before we are listening.
         *
         * If no producer is subscribed to the request channel (e.g.
         * because the process restarted between the sentinel check and
         * this publish), no reply will ever arrive. A production
         * implementation would add a short ack timeout here and surface
         * "producer gone" as a distinct error.
         */
        await publisher.publish(requestChannel, JSON.stringify({ listenerId }));
      },
    });

    return readable;
  }

  /**
   * Broadcast a stop request for the active stream. Any producer
   * subscribed to this channel will abort its underlying work, which
   * in turn ends the source stream and releases all attached listeners.
   */
  async function stopStream(): Promise<void> {
    await publisher.publish(stopChannel, 'stop');
  }

  return { startStream, resumeStream, stopStream };
}
