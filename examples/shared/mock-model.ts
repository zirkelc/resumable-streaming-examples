import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

type CreateMockModelOptions = {
  initialDelayInMs?: number;
  chunkDelayInMs?: number;
};

function textToChunks(text: string): Array<LanguageModelV3StreamPart> {
  const words = text.split(` `);
  const textId = `text-001`;

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

/** Create a mock language model that streams the given text */
export function createMockModel(text: string, options?: CreateMockModelOptions): MockLanguageModelV3 {
  const { initialDelayInMs = 500, chunkDelayInMs = 300 } = options ?? {};

  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: textToChunks(text),
        initialDelayInMs,
        chunkDelayInMs,
      }),
    }),
  });
}
