import Database from "better-sqlite3";
import { pushSQLiteSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database(`:memory:`);

export const db = drizzle(sqlite, { schema });

/** Create tables from Drizzle schema */
const { statementsToExecute } = await pushSQLiteSchema(schema, db as any);

for (const stmt of statementsToExecute) {
  sqlite.exec(stmt);
}
