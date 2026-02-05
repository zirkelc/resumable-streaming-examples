# AI SDK + tRPC Streaming Chat

A demo application showcasing **resumable streaming** with Vercel AI SDK, tRPC v11, and Redis-backed stream persistence.

## Features

- **AI SDK integration** - Uses `@ai-sdk/react` useChat hook with standardized `UIMessage` format
- **Custom ChatTransport** - tRPC-based transport layer implementing AI SDK's ChatTransport interface
- **Redis-backed persistence** - Streams are persisted to Redis for reliable resume across disconnections
- **SSE serialization** - Chunks are stored in Server-Sent Events format using `resumable-stream`
- **Auto-resume** - Automatically detects incomplete streams and resumes on page load

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          SERVER                                  │
│                                                                  │
│  sendMessage()                                                   │
│    │                                                             │
│    ├─► streamText() with MockLanguageModelV3                     │
│    ├─► toUIMessageStream() → UIMessageChunk stream               │
│    ├─► tee() splits stream into two branches                     │
│    │     ├─► Redis branch: SSE format → resumable-stream         │
│    │     └─► tRPC branch: yield chunks to client                 │
│    │                                                             │
│  resumeMessage()                                                 │
│    └─► Retrieve SSE stream from Redis → parse → yield chunks     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

When `sendMessage` is called:

1. AI SDK's `streamText()` creates a simulated LLM stream
2. `toUIMessageStream()` converts to standardized `UIMessageChunk` objects
3. Stream is `tee()`'d into two branches:
   - **Redis branch**: Converted to SSE format and stored via `resumable-stream`
   - **tRPC branch**: Yielded directly to client as raw chunks
4. On completion, `activeStreamId` is cleared

If the client disconnects, the Redis branch continues. When `resumeMessage` is called:

1. Server retrieves the persisted SSE stream from Redis
2. Parses SSE back to `UIMessageChunk` objects
3. Yields remaining chunks to client

## API Reference

### Queries

#### `listMessages`

Returns all messages for a chat from in-memory storage.

- **Input**: `{ chatId: string }`
- **Returns**: `{ chatId: string, messages: UIMessage[] }`

### Mutations

#### `sendMessage`

Sends a user message and streams back an assistant response.

- **Input**: `{ chatId: string, message: UIMessage }`
- **Yields**: `AsyncGenerator<UIMessageChunk>`
- **Behavior**:
  - Stores user message
  - Creates `activeStreamId` for resume tracking
  - Starts dual-branch streaming (tRPC + Redis)
  - Clears `activeStreamId` on completion

#### `resumeMessage`

Resumes an existing stream from Redis.

- **Input**: `{ chatId: string }`
- **Yields**: `AsyncGenerator<UIMessageChunk>`
- **Behavior**:
  - Finds active stream by `activeStreamId`
  - Retrieves SSE stream from Redis
  - Parses and yields remaining chunks

## Running the Example

### Install Dependencies

From the repository root:

```bash
pnpm install
```

### Start Development Servers

You need two terminals:

```bash
# Terminal 1 - Start the tRPC server (port 3002)
pnpm dev:server

# Terminal 2 - Start the Vite dev server
pnpm dev:client
```

Open the URL shown in the Vite output.

## Testing Resumable Streams

1. Send a message to start streaming
2. While streaming, refresh the page (F5)
3. The stream automatically resumes where it left off

## Key Implementation Details

### Custom ChatTransport

`TrpcChatTransport` implements AI SDK's `ChatTransport<UIMessage>` interface:

```ts
class TrpcChatTransport implements ChatTransport<UIMessage> {
  async sendMessages(options): Promise<ReadableStream<UIMessageChunk>> {
    const response = await trpcClient.sendMessage.mutate({ chatId, message });
    return convertAsyncIterableToStream(response);
  }

  async reconnectToStream(options): Promise<ReadableStream<UIMessageChunk> | null> {
    const response = await trpcClient.resumeMessage.mutate({ chatId });
    return convertAsyncIterableToStream(response);
  }
}
```

### Redis Stream Persistence

Streams are persisted using `resumable-stream` library with SSE format:

```ts
const streamContext = await createResumableContext({ activeStreamId });
const uiStream = await streamContext.startStream(result.toUIMessageStream({ ... }));
yield* uiStream;
```

### Auto-Resume Detection

The client detects incomplete streams by checking if the last message is from the user (indicating missing assistant response):

```ts
if (lastMessage?.role === `user`) {
  resumeStream();
}
```

## License

MIT
