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
  `This is a very long message that will take a while to stream so we can test the interrupt and resume functionality properly and see if everything works as expected`,
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

function consumeStream(stream: ReadableStream<string>, message: Message): void {
  (async () => {
    console.log(`[consumeStream] Starting for message ${message.id}`);
    try {
      const reader = stream.getReader();
      while (true) {
        const { done, value: word } = await reader.read();
        if (done) break;

        message.content += (message.content ? ` ` : ``) + word;
        console.log(`[consumeStream] Word: "${word}", total: "${message.content}"`);
      }
      message.status = `done`;
      console.log(`[consumeStream] Complete for message ${message.id}`);
    } catch (error) {
      message.status = `error`;
      console.error(`[consumeStream] Error for message ${message.id}:`, error);
    }
  })();
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

async function* pollMessage(message: Message, startWordCount: number): AsyncGenerator<StreamChunk> {
  console.log(`[pollMessage] Starting for message ${message.id}, startWordCount=${startWordCount}`);

  let lastWordCount = startWordCount;

  while (true) {
    const words = message.content.split(` `).filter(Boolean);

    for (let i = lastWordCount; i < words.length; i++) {
      console.log(`[pollMessage] Yielding word: "${words[i]}"`);
      yield {
        messageId: message.id,
        status: `streaming`,
        text: words[i]!,
      };
    }
    lastWordCount = words.length;

    if (message.status === `done`) {
      console.log(`[pollMessage] Message is done, exiting`);
      yield { messageId: message.id, status: `done`, text: `` };
      break;
    }

    if (message.status === `error`) {
      console.log(`[pollMessage] Message has error, exiting`);
      yield { messageId: message.id, status: `error`, text: `` };
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
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
    const [stream1, stream2] = stream.tee();

    consumeStream(stream1, assistantMessage);

    yield* convertReadableStreamToAsyncIterable(stream2, assistantMessage.id);
  }),

  resumeMessage: publicProcedure.input(messageSchema).mutation(async function* ({
    input,
  }): AsyncGenerator<StreamChunk> {
    console.log(`[resumeMessage] Called with id=${input.id}, content="${input.content}"`);

    const message = messages.find((m) => m.id === input.id);

    if (!message) {
      console.log(`[resumeMessage] Message not found!`);
      throw new Error(`Message not found`);
    }

    console.log(
      `[resumeMessage] Server message status: ${message.status}, content: "${message.content}"`,
    );

    const startWordCount = input.content.split(` `).filter(Boolean).length;
    console.log(`[resumeMessage] Client has ${startWordCount} words`);

    yield* pollMessage(message, startWordCount);
  }),
});

export type AppRouter = typeof appRouter;
