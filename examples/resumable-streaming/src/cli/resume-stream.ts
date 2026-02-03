import { readUIMessageStream, type UIMessageChunk, type UIMessage } from "ai";
import { convertAsyncIterableToStream } from "ai-stream-utils/utils";
import { trpcClient } from "./trpc";
import chalk from "chalk";

const DELAY_MS = 2_000;

function getTextFromMessage(message: UIMessage): string {
  const textPart = message.parts.find((p) => p.type === `text`);
  return textPart && `text` in textPart ? textPart.text : ``;
}

async function main() {
  console.log(chalk.cyan(`[resume-stream] Resuming stream\n`));

  const asyncIterable = await trpcClient.resumeStream.mutate();

  const stream = convertAsyncIterableToStream(asyncIterable);

  let messages = 1;

  for await (const uiMessage of readUIMessageStream<UIMessage>({ stream })) {
    console.log(chalk.cyan(`[resume-stream] #${messages++} UI message: "${getTextFromMessage(uiMessage)}"\n`));
  }

  console.log(chalk.cyan(`\n[resume-stream] Stream finished`));
}

main().catch((error) => {
  console.error(chalk.cyan(`[resume-stream] Error:`, error));
  process.exit(1);
});
