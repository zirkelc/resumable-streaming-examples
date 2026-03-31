import { trpcClient } from "./trpc";
import chalk from "chalk";

async function waitForKeypress() {
  process.stdin.setRawMode(true);
  return new Promise<void>((resolve) => {
    process.stdin.once(`data`, () => {
      process.stdin.setRawMode(false);
      resolve();
    });
  });
}

async function main() {
  console.log(chalk.red(`[stop-stream] Press any key to start...`));
  await waitForKeypress();
  console.log(chalk.red(`[stop-stream] Requesting stop`));

  const result = await trpcClient.stopStream.mutate();

  if (result.success) {
    console.log(chalk.red(`[stop-stream] Stream stopped successfully`));
  }
}

main().catch((error) => {
  console.error(chalk.red(`[stop-stream] Error:`, error));
  process.exit(1);
});
