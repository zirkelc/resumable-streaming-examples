import { z } from "zod";
import {
  streamText,
  simulateReadableStream,
  type UIMessage,
  UIMessageChunk,
  InferUIMessageChunk,
  InferUITools,
} from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { generateId } from "../../../shared/utils";
import { publicProcedure, router } from "./trpc";
import { createResumableContext } from "../../../shared/resumable-stream-context";

type MyMetadata = {
  createdAt?: string;
  finishReason?: string;
};

type MyDataPart = {};

type MyTools = InferUITools<{}>;

export type MyUIMessage = UIMessage<MyMetadata, MyDataPart, MyTools>;

type Chat = {
  chatId: string;
  messages: Array<MyUIMessage>;
  activeStreamId: string | null;
};

const chats = new Map<string, Chat>();

function getChat(chatId: string) {
  let chat = chats.get(chatId);
  if (!chat) {
    chat = { chatId, messages: [], activeStreamId: null };
    chats.set(chatId, chat);
  }
  return chat;
}

function saveChat(chat: Chat) {
  chats.set(chat.chatId, chat);
}

const MOCK_RESPONSE = `This is a very long message that will take a while to stream so we can test the interrupt and resume functionality properly and see if everything works as expected`;

function textToChunks(text: string): Array<LanguageModelV3StreamPart> {
  const words = text.split(` `);
  const textId = generateId(`text`);

  const chunks: Array<LanguageModelV3StreamPart> = [
    { type: `text-start`, id: textId },
    ...words.map(
      (word) =>
        ({
          type: `text-delta`,
          id: textId,
          delta: word + ` `,
        }) as const,
    ),
    { type: `text-end`, id: textId },
    {
      type: `finish`,
      finishReason: { raw: undefined, unified: `stop` },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: words.length, text: words.length, reasoning: undefined },
      },
    },
  ];

  return chunks;
}

export const appRouter = router({
  listMessages: publicProcedure.input(z.object({ chatId: z.string() })).query(({ input }) => {
    const chat = getChat(input.chatId);
    return {
      chatId: chat.chatId,
      messages: chat.messages,
    };
  }),

  sendMessage: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        message: z.custom<MyUIMessage>(),
      }),
    )
    .mutation(async function* ({ input }): AsyncGenerator<UIMessageChunk> {
      const { chatId, message } = input;
      console.log(`[sendMessage] chatId=${chatId}, message=${message.id}`);
      const chat = getChat(chatId);
      const messages = chat.messages;

      const index = messages.findIndex((m) => m.id === message.id);
      if (index !== -1) {
        messages[index] = message;
      } else {
        messages.push(message);
      }

      const activeStreamId = generateId(`stream`);
      saveChat({ ...chat, messages, activeStreamId });

      console.log(`[sendMessage] Starting stream activeStreamId=${activeStreamId}`);

      const model = new MockLanguageModelV3({
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: textToChunks(MOCK_RESPONSE),
            initialDelayInMs: 500,
            chunkDelayInMs: 300,
          }),
        }),
      });

      const result = streamText({
        model,
        prompt: `Simulated prompt`,
        onChunk: ({ chunk }) => {
          if (chunk.type === `text-delta`) {
            console.log(`[sendMessage] onChunk ${chunk.type}: ${chunk.text}`);
          } else {
            console.log(`[sendMessage] onChunk ${chunk.type}`);
          }
        },
      });

      const streamContext = await createResumableContext({ activeStreamId });
      const uiStream = await streamContext.startStream(result.toUIMessageStream({
        originalMessages: messages,
        generateMessageId: () => generateId(`msg`),
        messageMetadata: ({ part }) => {
          if (part.type === `start`) {
            return {
              createdAt: new Date().toISOString(),
            };
          }

          if (part.type === `finish`) {
            return {
              finishReason: part.finishReason,
            };
          }
        },
        onFinish: ({ messages }) => {
          console.log(`[sendMessage] onFinish called`);
          saveChat({ ...chat, messages, activeStreamId: null });
        },
      }));

      yield* uiStream;
    }),

  resumeMessage: publicProcedure.input(z.object({ chatId: z.string() })).mutation(async function* ({
    input,
  }): AsyncGenerator<InferUIMessageChunk<MyUIMessage>> {
    const { chatId } = input;
    console.log(`[resumeMessage] chatId=${chatId}`);

    const chat = getChat(chatId);

    if (!chat.activeStreamId) {
      console.log(`[resumeMessage] No active stream for chat ${chatId}`);
      return;
    }

    console.log(`[resumeMessage] Resuming stream ${chat.activeStreamId}`);

    const streamContext = await createResumableContext({ activeStreamId: chat.activeStreamId });
    const resumedStream = await streamContext.resumeStream();

    if (resumedStream) {
      yield* resumedStream;
    }
  }),
});

export type AppRouter = typeof appRouter;
