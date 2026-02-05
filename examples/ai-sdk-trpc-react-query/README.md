# AI SDK + tRPC + React Query

A custom `useChat` hook implementation using **TanStack React Query** for state management instead of AI SDK's built-in `useChat` hook.

## Why Custom useChat?

AI SDK's `@ai-sdk/react` provides a `useChat` hook, but you may want more control over:
- **Cache management** - Use React Query's cache for messages
- **Optimistic updates** - Add user messages instantly before server response
- **Query invalidation** - Sync with server state after streaming completes
- **DevTools** - Inspect chat state with React Query DevTools

## How It Works

```ts
const { messages, sendMessage, resumeStream } = useChat({ chatId });
```

### sendMessage Flow

1. Create user message with generated ID
2. **Optimistic update**: Add user message to React Query cache immediately
3. Call `trpcClient.sendMessage.mutate()` → returns `AsyncIterable<UIMessageChunk>`
4. Convert to `ReadableStream` with TransformStream interceptor:
   - Calls `onChunk()` for every chunk
   - Calls `onStart()` when streaming begins
   - Calls `onFinish()` when streaming ends
   - Calls `onData()` for data chunks
5. `readUIMessageStream()` accumulates chunks into complete `UIMessage`
6. `upsertMessage()` updates cache with each accumulated message (insert or replace by ID)
7. On success: invalidate query to sync with server

### resumeStream Flow

1. Call `onResume` callback
2. Get last message from cache 
3. Call `trpcClient.resumeMessage.mutate()` → returns `AsyncIterable<UIMessageChunk>`
4. Convert to `ReadableStream` with TransformStream interceptor:
   - Calls `onChunk()` for every chunk
   - Calls `onStart()` when streaming begins
   - Calls `onFinish()` when streaming ends
   - Calls `onData()` for data chunks
5. `readUIMessageStream()` from latest message
6. `upsertMessage()` updates cache with each accumulated message (insert or replace by ID)
7. On success: invalidate query to sync with server

## Callbacks

The hook provides callbacks for different stages of streaming:

```ts
useChat({
  chatId,
  onChunk: (chunk) => {
    // Fires for every UIMessageChunk received
  },
  onStart: (chunk) => {
    // Fires when streaming starts (type: "start")
  },
  onFinish: (chunk) => {
    // Fires when streaming completes (type: "finish")
    // chunk.finishReason: "stop" | "length" | "error" | ...
  },
  onError: (error) => {
    // Fires on stream errors (not on intentional abort)
  },
  onResume: () => {
    // Fires when resumeStream() is called
  },
});
```

## Resume Streaming

A running stream can be resumed after interruptions (e.g. page refresh), either manually by calling `resumeStream()` or automatically with `autoResume: true`:

```ts
const { resumeStream } = useChat({
  chatId,
  autoResume: true, // Resume automatically on mount
});

useEffect(() => {
  // Or resume manually
  resumeStream();
}, [resumeStream]);
```

The server handles stream state, that means if no active stream exists, the resume call returns empty and completes immediately.

## Server

This example shares the server with `ai-sdk-trpc`. See [../ai-sdk-trpc/README.md](../ai-sdk-trpc/README.md) for server architecture and API reference.

## Running the Example

From the repository root:

```bash
# Install dependencies
pnpm install

# Terminal 1 - Start the tRPC server (port 3002)
pnpm dev:server

# Terminal 2 - Start the Vite dev server
pnpm dev:client
```

## API

### UseChatOptions

| Option | Type | Description |
|--------|------|-------------|
| `chatId` | `string` | Required. Unique identifier for the chat session |
| `autoResume` | `boolean` | Auto-resume incomplete streams on mount |
| `onChunk` | `(chunk: UIMessageChunk) => void` | Called for every chunk received |
| `onData` | `(chunk: DataChunk) => void` | Called for data chunks |
| `onStart` | `(chunk) => void` | Called when streaming starts |
| `onFinish` | `(chunk) => void` | Called when streaming completes |
| `onError` | `(error: Error) => void` | Called on stream errors |
| `onResume` | `() => void` | Called when resume is triggered |

### UseChatReturn

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `MyUIMessage[]` | Array of chat messages from React Query cache |
| `sendMessage` | `(input: string) => Promise<void>` | Send a new message |
| `status` | `UseChatStatus` | Current status: `ready`, `loading`, `streaming`, `error` |
| `resumeStream` | `() => void` | Resume an interrupted stream |

## License

MIT
