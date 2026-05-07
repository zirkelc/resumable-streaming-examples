# Resumable Streaming Examples

A collection of examples demonstrating **streaming** and **resumable streaming** patterns with tRPC, TanStack Query and AI SDK.

## Examples

### [Basic Streaming](./examples/basic-streaming/)

A basic example demonstrating how to use streaming with tRPC and TanStack Query.

### [AI SDK + tRPC](./examples/ai-sdk-trpc/)

This example implements resumable streaming with Vercel AI SDK on the server and client. 
It uses the `useChat` hook from `@ai-sdk/react` and a custom `ChatTransport` implementation to connect with tRPC on the server. 
The resumable streaming is managed by `resumable-stream` and Redis in-memory database. 

### [AI SDK + tRPC + React Query](./examples/ai-sdk-trpc-react-query/)

This example builds on the [AI SDK + tRPC](src/examples/ai-sdk-trpc/) example, but replaces the AI SDK's built-in `useChat` hook with a custom implementation using TanStack React Query for state management. It does not use `@ai-sdk/react` on the client.

### [Resumable Streaming with Redis](./examples/resumable-stream-with-redis/)

This example demonstrates resumable streaming with multiple CLI clients using Redis for chunk persistence and pub/sub stop signaling via the `resumable-stream` library.

### [Resumable Streaming without Redis](./examples/resumable-stream-without-redis/)

Same resumable streaming pattern as above, but replaces Redis with an in-memory SQLite database (Drizzle ORM). Chunks are flushed to SQLite in throttled batches, resume clients replay stored chunks then poll for new ones, and cancellation is detected via a `cancelled_at` field in the database.

## License

MIT
