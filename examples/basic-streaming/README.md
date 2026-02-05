# Streaming tRPC + React Query

A demo application showcasing **streaming chat** with tRPC v11, TanStack Query v5, and React 19.

## Features

- **Streaming mutations** - Server yields chunks via async generators, client updates UI in real-time

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                          SERVER                           │
│                                                           │
│  sendMessage()                                            │
│    │                                                      │
│    ├─► Create user + assistant messages                   │
│    ├─► completion() → ReadableStream                      │
│    └─► yield chunks directly to client                    │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

When `sendMessage` is called:

1. A `ReadableStream` is created (simulating an LLM API)
2. The stream is converted to an async iterable
3. Chunks are yielded directly to the client

## API Reference

### Queries

#### `listMessages`

Returns all messages from in-memory storage.

- **Returns**: `Message[]`

### Mutations

#### `sendMessage`

Sends a user message and streams back an assistant response.

- **Input**: `Message` (full user message object)
- **Yields**: `AsyncGenerator<StreamChunk>`
- **Behavior**:
  - Stores user message (passed from client)
  - Creates assistant message (status: `streaming`)
  - Yields chunks to client
  - Sets status to `done` when complete

#### `clearMessages`

Clears all messages from storage.

- **Returns**: `void`

## Running the Example

### Install Dependencies

From the repository root:

```bash
pnpm install
```

### Start Development Servers

You need two terminals:

```bash
# Terminal 1 - Start the tRPC server (port 3000)
pnpm dev:server

# Terminal 2 - Start the Vite dev server (port 5173)
pnpm dev:client
```

Open http://localhost:5173 in your browser.

## Testing

1. Type a message and click **Send**
2. Watch the assistant response stream in word by word

## License

MIT
