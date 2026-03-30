import { readUIMessageStream, type UIMessageChunk, type UIMessage } from "ai";
import { convertAsyncIterableToStream } from "ai-stream-utils/utils";
import { trpcClient } from "./trpc";
import chalk from "chalk";

function getTextFromMessage(message: UIMessage): string {
  const textPart = message.parts.find((p) => p.type === `text`);
  return textPart && `text` in textPart ? textPart.text : ``;
}

async function main() {
  console.log(chalk.magenta(`[start-stream] Starting stream`));

  const asyncIterable = await trpcClient.startStream.mutate();

  const stream = convertAsyncIterableToStream(asyncIterable);

  let messages = 1;

  for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
    console.log(chalk.magenta(`[start-stream] #${messages++} UI message: "${getTextFromMessage(uiMessage)}"\n`));
  }

  console.log(chalk.magenta(`[start-stream] Stream finished`));
}

main().catch((error) => {
  console.error(chalk.magenta(`[start-stream] Error:`, error));
  process.exit(1);
});
