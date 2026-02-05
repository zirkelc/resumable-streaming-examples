import { z } from "zod";
import { generateId } from "../../../shared/utils";
import { publicProcedure, router } from "./trpc";

const messageSchema = z.object({
  id: z.string(),
  content: z.string(),
  role: z.enum([`user`, `assistant`]),
  createdAt: z.number(),
  status: z.enum([`streaming`, `done`, `error`]),
});

type Message = z.infer<typeof messageSchema>;

type StreamChunk = {
  messageId: string;
  status: Message["status"];
  text: string;
};

const messages: Array<Message> = [];

const responses = [
  `This is a very long message that will take a while to stream so we can test the streaming functionality properly and see if everything works as expected`,
];

function completion(): ReadableStream<string> {
  return new ReadableStream<string>({
    async start(controller) {
      console.log(`[completion] Starting`);

      await new Promise((resolve) => setTimeout(resolve, 500));

      const response = responses[Math.floor(Math.random() * responses.length)]!;
      const words = response.split(` `);

      for (const word of words) {
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 300));
        console.log(`[completion] Enqueuing word: "${word}"`);
        controller.enqueue(word);
      }

      console.log(`[completion] Complete`);
      controller.close();
    },
  });
}

async function* convertReadableStreamToAsyncIterable(
  stream: ReadableStream<string>,
  messageId: string,
): AsyncGenerator<StreamChunk> {
  console.log(`[convertReadableStreamToAsyncIterable] Starting for message ${messageId}`);

  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value: word } = await reader.read();
      if (done) break;

      console.log(`[convertReadableStreamToAsyncIterable] Yielding word: "${word}"`);
      yield {
        messageId,
        status: `streaming`,
        text: word,
      };
    }

    console.log(`[convertReadableStreamToAsyncIterable] Done`);
    yield { messageId, status: `done`, text: `` };
  } finally {
    reader.releaseLock();
  }
}

export const appRouter = router({
  listMessages: publicProcedure.query(() => {
    return messages;
  }),

  clearMessages: publicProcedure.mutation(() => {
    messages.length = 0;
  }),

  sendMessage: publicProcedure.input(messageSchema).mutation(async function* ({
    input,
  }): AsyncGenerator<StreamChunk> {
    console.log(
      `[sendMessage] Called with user message id=${input.id}, content: "${input.content}"`,
    );

    messages.push(input);

    const assistantMessage: Message = {
      id: generateId(`assistant`),
      content: ``,
      role: `assistant`,
      createdAt: Date.now(),
      status: `streaming`,
    };
    messages.push(assistantMessage);

    console.log(`[sendMessage] Created assistant message ${assistantMessage.id}`);

    const stream = completion();

    for await (const chunk of convertReadableStreamToAsyncIterable(stream, assistantMessage.id)) {
      if (chunk.text) {
        assistantMessage.content += (assistantMessage.content ? ` ` : ``) + chunk.text;
      }
      if (chunk.status === `done`) {
        assistantMessage.status = `done`;
      }
      yield chunk;
    }
  }),
});

export type AppRouter = typeof appRouter;
