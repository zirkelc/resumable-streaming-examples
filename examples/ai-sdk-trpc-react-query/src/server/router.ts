import { z } from "zod";
import { streamText, type UIMessage, UIMessageChunk, InferUITools } from "ai";
import chalk from "chalk";
import { generateId } from "../../../shared/utils";
import { publicProcedure, router } from "./trpc";
import { createResumableContext } from "../../../shared/resumable-stream-context";
import { createMockModel } from "../../../shared/mock-model";
import { createAsyncIterableStream } from "ai-stream-utils/utils";

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
      console.log(chalk.magenta(`[sendMessage] chatId=${chatId}, message=${message.id}`));
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

      console.log(chalk.magenta(`[sendMessage] Starting stream activeStreamId=${activeStreamId}`));

      const abortController = new AbortController();

      const streamContext = await createResumableContext({
        activeStreamId,
        abortController,
      });

      const model = createMockModel(MOCK_RESPONSE, {
        chunkDelayInMs: 500,
      });

      const result = streamText({
        model,
        prompt: `Simulated prompt`,
        abortSignal: abortController.signal,
        onChunk: ({ chunk }) => {
          if (chunk.type === `text-delta`) {
            console.log(chalk.magenta(`[sendMessage] onChunk ${chunk.type}: ${chunk.text}`));
          } else {
            console.log(chalk.magenta(`[sendMessage] onChunk ${chunk.type}`));
          }
        },
        onAbort: () => {
          console.log(chalk.magenta(`[sendMessage] onAbort called`));
        }
      });

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
        onFinish: ({ messages, isAborted }) => {
          console.log(chalk.magenta(`[sendMessage] onFinish called, isAborted=${isAborted}`));
          saveChat({ ...chat, messages, activeStreamId: null });
        },
      }));

      yield* uiStream;
    }),

  resumeMessage: publicProcedure.input(z.object({ chatId: z.string() })).mutation(async function* ({
    input,
  }): AsyncGenerator<UIMessageChunk> {
    const { chatId } = input;
    console.log(chalk.cyan(`[resumeMessage] chatId=${chatId}`));

    const chat = getChat(chatId);

    if (!chat.activeStreamId) {
      console.log(chalk.cyan(`[resumeMessage] No active stream for chat ${chatId}`));
      return;
    }

    console.log(chalk.cyan(`[resumeMessage] Resuming stream ${chat.activeStreamId}`));

    const streamContext = await createResumableContext({ activeStreamId: chat.activeStreamId });
    const resumedStream = await streamContext.resumeStream();

    if (!resumedStream) {
      console.log(chalk.cyan(`[resumeMessage] No stream to resume for activeStreamId=${chat.activeStreamId}`));
      return;
    }

    // yield* resumedStream;
    yield* createAsyncIterableStream(resumedStream?.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        if (chunk.type === `text-delta`) {
          console.log(chalk.cyan(`[resumeMessage] onChunk ${chunk.type}: ${chunk.delta}`));
        } else {
          console.log(chalk.cyan(`[resumeMessage] onChunk ${chunk.type}`));
        }
        controller.enqueue(chunk);
      }
    })))
  }),
  stopStream: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      const { chatId } = input;
      console.log(chalk.yellow(`[stopStream] chatId=${chatId}`));

      const chat = getChat(chatId);

      if (!chat.activeStreamId) {
        console.log(chalk.yellow(`[stopStream] No active stream for chat ${chatId}`));
        return { success: false };
      }

      console.log(chalk.yellow(`[stopStream] Stopping stream ${chat.activeStreamId}`));

      const streamContext = await createResumableContext({ activeStreamId: chat.activeStreamId });
      await streamContext.stopStream();

      return { success: true };
    }),
});

export type AppRouter = typeof appRouter;
