# Resumable Streaming Debug

Demonstrates resumable streaming with AI SDK + tRPC + Redis, with the resumable streaming protocol implemented inline (no `resumable-stream` dependency). The core logic lives in `src/server/resumable-stream.ts` and uses Redis pub/sub directly.

## Usage

This example uses [`redis-memory-server`](https://github.com/mhassan1/redis-memory-server) so you don't need a system Redis. On first `pnpm install` it runs its postinstall hook to download (and on some platforms compile) a Redis binary into a cache (`~/.cache/redis-binaries/` or `node_modules/.cache/redis-memory-server/`). Subsequent installs and runs reuse the cached binary. If you ever want to skip that step, set `REDISMS_DISABLE_POSTINSTALL=1` before `pnpm install` and point `REDISMS_SYSTEM_BINARY=/path/to/redis-server` at an existing binary at runtime.

Start the server, then run the TUI in a second terminal:

```bash
# Terminal 1: Start server
pnpm dev:server

# Terminal 2: Interactive TUI
pnpm dev:client
```

Hotkeys inside the TUI:

| key | action                                                 |
| --- | ------------------------------------------------------ |
| `s` | start a producer (initiates a new upstream)            |
| `r` | add a resumer (joins the in-flight stream)             |
| `a` | broadcast an abort request to the producer             |
| `q` | quit                                                   |

Each client gets its own panel that updates live as chunks arrive, so you can spawn multiple resumers and watch them stay in sync with the producer.

## Debugging the server in VS Code

To step through the server with breakpoints (handy for inspecting the request handler in `resumable-stream.ts`):

1. Open the **JavaScript Debug Terminal** in VS Code — `Cmd/Ctrl+Shift+P` → "Debug: JavaScript Debug Terminal". Any node process spawned from this terminal is auto-attached to the debugger.
2. In that terminal, start the server with `pnpm dev:server` (it runs without `tsx watch`, so file changes don't restart the process and drop breakpoints).
3. Set breakpoints anywhere in `src/server/*.ts`. They'll bind when the file is loaded.
4. Start the TUI in a normal terminal (`pnpm dev:client`) and trigger the flow that hits your breakpoint.

While the server is paused at a breakpoint the source's `setTimeout`-paced chunks are paused too, but Redis is a separate process — any messages already published continue to flow on the wire and will be delivered in burst when you continue. Keep that in mind when reasoning about ordering races.
