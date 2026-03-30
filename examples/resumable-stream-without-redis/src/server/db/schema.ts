import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable(`messages`, {
  id: text(`id`).primaryKey(),
  activeStreamId: text(`active_stream_id`),
  cancelledAt: integer(`cancelled_at`),
  content: text(`content`),
  createdAt: integer(`created_at`).notNull().$defaultFn(() => Date.now()),
});

export const chunks = sqliteTable(`chunks`, {
  id: integer(`id`).primaryKey({ autoIncrement: true }),
  streamId: text(`stream_id`).notNull(),
  data: text(`data`).notNull(),
  createdAt: integer(`created_at`).notNull().$defaultFn(() => Date.now()),
});
