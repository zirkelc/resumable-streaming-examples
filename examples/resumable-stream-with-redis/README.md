# Resumable Streaming

Demonstrates resumable streaming with AI SDK + tRPC + Redis.

## Usage

Run in 3 separate terminals:

```bash
# Terminal 1: Start server
pnpm dev:server

# Terminal 2: First clients starts the stream 
pnpm start-stream

# Terminal 3: Second client resumes the stream and runs in-sync with first
pnpm resume-stream
```
