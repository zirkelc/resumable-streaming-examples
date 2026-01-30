import type { ChatTransport, UIMessageChunk } from "ai";
import { convertAsyncIterableToStream } from "ai-stream-utils/utils";
import { MyUIMessage } from "../server/router";
import { trpcClient } from "./trpc";

export class TrpcChatTransport implements ChatTransport<MyUIMessage> {
  async sendMessages(
    options: Parameters<ChatTransport<MyUIMessage>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    console.log(`[TrpcChatTransport] sendMessages chatId=${options.chatId}`);

    const { chatId, abortSignal } = options;
    const message = options.messages.at(-1);

    if (!message) {
      throw new Error(`No message to send`);
    }

    const response = await trpcClient.sendMessage.mutate(
      {
        chatId,
        message,
      },
      { signal: abortSignal },
    );

    return convertAsyncIterableToStream(response) as ReadableStream<UIMessageChunk>;
  }

  async reconnectToStream(
    options: Parameters<ChatTransport<MyUIMessage>["reconnectToStream"]>[0],
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    console.log(`[TrpcChatTransport] reconnectToStream chatId=${options.chatId}`);

    const { chatId } = options;
    const response = await trpcClient.resumeMessage.mutate({
      chatId,
    });

    return convertAsyncIterableToStream(response) as ReadableStream<UIMessageChunk>;
  }
}
