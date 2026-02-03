# tRPC Streaming Examples

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

### [Resumable Streaming CLI](./examples/resumable-streaming/)

This example demonstrates resumable streaming with a multiple CLI clients that connect. The first client initiates the stream and prints it to the console. When the second client connects, it automatically resumes from where the first client is and then runs in-sync with teh first client.

## License

MIT
