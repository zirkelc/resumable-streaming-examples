# Resumable Streaming without Redis

Demonstrates resumable streaming with AI SDK + tRPC + SQLite (Drizzle ORM) — no Redis required.

## How it works

**Chunk persistence:** While the server streams an AI response, chunks are buffered in memory and flushed to an in-memory SQLite database every 2 seconds using `throttleit`.

**Resuming:** A resume client replays all stored chunks from the database, then polls for new chunks every second until the stream completes.

**Cancellation:** The `stopStream` endpoint sets a `cancelled_at` timestamp in the database. The streaming loop checks for cancellation on every chunk via a throttled DB query (inspired by [Vercel's pattern](https://github.com/vercel/ai/blob/main/examples/next/app/api/chat/route.ts)).

**Cleanup:** When the stream finishes, `onFinish` saves the final message content and clears the `active_stream_id`. Chunks remain in the database for resume clients to drain.

## Database schema

Two tables managed by Drizzle ORM (`drizzle-kit push` creates them on startup):

- **`messages`** — one row per AI response: `id`, `active_stream_id`, `cancelled_at`, `content`, `created_at`
- **`chunks`** — temporary rows during streaming: `id` (autoincrement), `stream_id`, `data` (JSON), `created_at`

## Usage

Run in 3–4 separate terminals:

```bash
# Terminal 1: Start server
pnpm dev:server

# Terminal 2: First client starts the stream
pnpm start-stream

# Terminal 3: Second client resumes the stream (replays + polls)
pnpm resume-stream

# Terminal 4 (optional): Stop the stream
pnpm stop-stream
```

## Key dependencies

- `ai` — Vercel AI SDK for streaming
- `@trpc/server` + `@trpc/client` — type-safe API
- `drizzle-orm` + `better-sqlite3` — in-memory SQLite
- `drizzle-kit` — schema push on startup
- `throttleit` — throttled DB writes and cancellation checks
